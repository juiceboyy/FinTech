import crypto from 'node:crypto';
import { Decimal } from 'decimal.js';
import { ParsedCsvRowSchema, type ParsedCsvRow, type TransactionDirection } from './schemas.js';

const REPAYMENT_REGEX =
  /incasso\s+ing\s+creditcard|automatische\s+incasso|aflossing|betaling\s+creditcard|incasso\s+creditcard|verrekening\s+vorig\s+overzicht|incasso\s+maandoverzicht/i;

const DUTCH_MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mrt: '03', apr: '04', mei: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', okt: '10', nov: '11', dec: '12',
};

export class IngCsvParser {
  public static parse(csvContent: string): ParsedCsvRow[] {
    const cleaned = csvContent.replace(/^\uFEFF/, '').trim();
    if (!cleaned) {
      throw new Error('Uploaded CSV file is empty.');
    }

    const lines = cleaned
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      throw new Error('CSV must contain a header row and at least one transaction row.');
    }

    const delimiter = this.detectDelimiter(lines[0]);
    const rawHeaders = this.splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase().trim());

    const colMap = this.mapColumns(rawHeaders);
    const occurrenceTracker = new Map<string, number>();
    const results: ParsedCsvRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = this.splitCsvLine(lines[i], delimiter);
      if (cells.length <= 1 && (!cells[0] || cells[0].trim() === '')) {
        continue;
      }

      const rawDate = this.getCell(cells, colMap.date);
      const rawPayee = this.getCell(cells, colMap.payee);
      const rawAmount = this.getCell(cells, colMap.amount);
      if (!rawDate && !rawAmount) {
        continue;
      }

      const date = this.normalizeDate(rawDate, i + 1);
      const rawDir = this.getCell(cells, colMap.direction);
      const rawComment = this.getCell(cells, colMap.comment);
      const rawMutType = this.getCell(cells, colMap.mutationType);
      const rawForeignAmt = this.getCell(cells, colMap.foreignAmount);
      const rawForeignCur = this.getCell(cells, colMap.foreignCurrency);

      const { amountDec, signedNegative, signedPositive } = this.parseDecimalAmount(rawAmount, i + 1);
      if (amountDec.equals(0)) {
        continue;
      }

      const combinedText = `${rawPayee} ${rawComment} ${rawMutType}`.trim();
      const isRepayment = REPAYMENT_REGEX.test(combinedText);
      const direction = this.resolveDirection(rawDir, signedNegative, signedPositive, isRepayment);
      const cleanPayee = this.cleanPayeeName(rawPayee || rawComment || 'ING Creditcard Transaction');

      const commentParts: string[] = [];
      if (rawComment && rawComment !== cleanPayee) {
        commentParts.push(rawComment);
      }
      if (rawForeignAmt && rawForeignCur && rawForeignCur.toUpperCase() !== 'EUR') {
        commentParts.push(`Original: ${rawForeignAmt} ${rawForeignCur}`);
      }
      const comment = commentParts.join(' | ');
      const normalizedAmount = amountDec.toFixed(2);

      const baseFingerprint = `${date}|${normalizedAmount}|${direction}|${(rawPayee || cleanPayee).toLowerCase().trim()}`;
      const seenCount = (occurrenceTracker.get(baseFingerprint) ?? 0) + 1;
      occurrenceTracker.set(baseFingerprint, seenCount);

      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`${baseFingerprint}|#${seenCount}`)
        .digest('hex');

      const validated = ParsedCsvRowSchema.parse({
        rowIndex: results.length,
        date,
        rawPayee: rawPayee || cleanPayee,
        payee: cleanPayee,
        amount: normalizedAmount,
        currency: 'EUR',
        direction,
        comment,
        isRepayment,
        idempotencyKey,
      });

      results.push(validated);
    }

    if (results.length === 0) {
      throw new Error('No valid transactions could be parsed from the CSV file.');
    }

    return results;
  }

  private static detectDelimiter(headerLine: string): string {
    const candidates = [';', ',', '\t'];
    let best = ';';
    let maxCount = -1;

    for (const delim of candidates) {
      const count = this.splitCsvLine(headerLine, delim).length;
      if (count > maxCount) {
        maxCount = count;
        best = delim;
      }
    }
    return best;
  }

  private static splitCsvLine(line: string, delimiter: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out;
  }

  private static mapColumns(headers: string[]) {
    const findIdx = (patterns: RegExp[]): number => {
      for (const pat of patterns) {
        const idx = headers.findIndex((h) => pat.test(h));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const date = findIdx([/^datum$/, /^date$/, /transactiedatum/, /boekingsdatum/, /datum/]);
    const payee = findIdx([
      /naam\s*\/\s*omschrijving/,
      /name\s*\/\s*description/,
      /^omschrijving$/,
      /^description$/,
      /^naam$/,
      /merchant|payee|tegenpartij/,
    ]);
    const direction = findIdx([/af\s*\/?\s*bij/, /debit\s*\/?\s*credit/, /debet\s*\/?\s*credit/, /^type$/]);
    const amount = findIdx([
      /bedrag\s*\(eur\)/,
      /amount\s*\(eur\)/,
      /^bedrag$/,
      /^amount$/,
      /bedrag\s+in\s+eur/,
      /bedrag/,
    ]);
    const comment = findIdx([/^mededelingen$/, /^notifications$/, /toelichting/, /opmerking/]);
    const mutationType = findIdx([/^mutatiesoort$/, /transaction\s*type/]);
    const foreignAmount = findIdx([/vreemde\s*valuta/, /foreign\s*amount/]);
    const foreignCurrency = findIdx([/^valuta$/, /^currency$/]);

    if (date === -1 || amount === -1) {
      throw new Error(
        `Unrecognized ING CSV header columns: [${headers.join(', ')}]. Expected Datum/Date and Bedrag/Amount columns.`
      );
    }

    return {
      date,
      payee: payee !== -1 ? payee : Math.min(1, headers.length - 1),
      direction,
      amount,
      comment,
      mutationType,
      foreignAmount,
      foreignCurrency,
    };
  }

  private static getCell(cells: string[], idx: number): string {
    if (idx < 0 || idx >= cells.length) return '';
    return cells[idx].replace(/^["']|["']$/g, '').trim();
  }

  private static normalizeDate(raw: string, lineNum: number): string {
    const s = raw.trim();
    if (/^\d{8}$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return s;
    }
    const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmyMatch) {
      const dd = dmyMatch[1].padStart(2, '0');
      const mm = dmyMatch[2].padStart(2, '0');
      return `${dmyMatch[3]}-${mm}-${dd}`;
    }
    const dutchTextMatch = s.toLowerCase().match(/^(\d{1,2})\s+([a-z]{3})\.?\s+(\d{4})$/);
    if (dutchTextMatch && DUTCH_MONTHS[dutchTextMatch[2]]) {
      const dd = dutchTextMatch[1].padStart(2, '0');
      return `${dutchTextMatch[3]}-${DUTCH_MONTHS[dutchTextMatch[2]]}-${dd}`;
    }
    throw new Error(`Invalid date "${raw}" on CSV line ${lineNum}`);
  }

  private static parseDecimalAmount(raw: string, lineNum: number): {
    amountDec: Decimal;
    signedNegative: boolean;
    signedPositive: boolean;
  } {
    let s = raw.replace(/[€$£\s]/g, '').trim();
    const signedNegative = s.startsWith('-') || s.endsWith('-');
    const signedPositive = s.startsWith('+');
    s = s.replace(/^[+-]|-$/g, '');

    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }

    try {
      const dec = new Decimal(s).abs();
      return { amountDec: dec, signedNegative, signedPositive };
    } catch {
      throw new Error(`Invalid numeric amount "${raw}" on CSV line ${lineNum}`);
    }
  }

  private static resolveDirection(
    rawDir: string,
    signedNegative: boolean,
    signedPositive: boolean,
    isRepayment: boolean
  ): TransactionDirection {
    const dir = rawDir.toLowerCase().trim();
    if (dir === 'bij' || dir === 'credit' || dir === 'c' || dir === '+') {
      return 'income';
    }
    if (dir === 'af' || dir === 'debit' || dir === 'debet' || dir === 'd' || dir === '-') {
      return 'expense';
    }
    if (signedNegative) return 'expense';
    if (signedPositive || isRepayment) return 'income';
    return 'expense';
  }

  private static cleanPayeeName(raw: string): string {
    return raw
      .replace(/\s+/g, ' ')
      .replace(/^(pasvolgnr|kaartnr)[:\s]*\d+\s*/i, '')
      .trim();
  }
}
