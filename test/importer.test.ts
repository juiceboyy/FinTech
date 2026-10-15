import assert from 'node:assert';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { IngCsvParser } from '../src/importer/ingCsvParser.js';
import {
  CommitImportRequestSchema,
  PreviewCsvRequestSchema,
} from '../src/importer/schemas.js';

test('IngCsvParser parses semicolon-separated Mijn ING CSV with Dutch comma decimals and repayment detection', () => {
  const sampleMijnIngCsv = [
    '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"',
    '"20261006";"Incasso ING creditcard";"REDACTED_CARD";"NL00INGB0000000000";"IC";"Bij";"13,32";"Incasso";"Accountnr REDACTED Periode september 2026"',
    '"20261009";"Albert Heijn 1492 Amsterdam";"REDACTED_CARD";"";"BA";"Af";"42,85";"Betaalautomaat";"Pasvolgnr: 001"',
    '"20261011";"KLM Airlines Schiphol";"REDACTED_CARD";"";"BA";"Af";"1.249,95";"Creditcard";"Ticket Booking"',
    '"20261012";"Bol.com Retour";"REDACTED_CARD";"";"CB";"Bij";"19,99";"Terugboeking";"Order refund"',
  ].join('\n');

  const rows = IngCsvParser.parse(sampleMijnIngCsv);
  assert.strictEqual(rows.length, 4, 'Should parse all 4 rows');

  // Row 0: Monthly repayment
  assert.strictEqual(rows[0].date, '2026-10-06');
  assert.strictEqual(rows[0].isRepayment, true, 'Should auto-detect Incasso ING creditcard as repayment');
  assert.strictEqual(rows[0].direction, 'income');
  assert.ok(new Decimal(rows[0].amount).equals(new Decimal('13.32')));

  // Row 1: Standard expense
  assert.strictEqual(rows[1].date, '2026-10-09');
  assert.strictEqual(rows[1].payee, 'Albert Heijn 1492 Amsterdam');
  assert.strictEqual(rows[1].direction, 'expense');
  assert.strictEqual(rows[1].isRepayment, false);
  assert.ok(new Decimal(rows[1].amount).equals(new Decimal('42.85')));

  // Row 2: Thousand-separator Dutch amount (1.249,95)
  assert.strictEqual(rows[2].date, '2026-10-11');
  assert.strictEqual(rows[2].direction, 'expense');
  assert.strictEqual(rows[2].amount, '1249.95');
  assert.ok(new Decimal(rows[2].amount).equals(new Decimal('1249.95')));

  // Row 3: Refund / Credit on card (Bij, not a monthly repayment)
  assert.strictEqual(rows[3].date, '2026-10-12');
  assert.strictEqual(rows[3].direction, 'income');
  assert.strictEqual(rows[3].isRepayment, false, 'Merchant refund should not be marked as monthly repayment');
  assert.strictEqual(rows[3].amount, '19.99');
});

test('IngCsvParser parses comma-separated Creditcard statement CSV with signed amounts and foreign currency metadata', () => {
  const sampleStatementCsv = [
    '"Datum","Omschrijving","Bedrag (EUR)","Bedrag vreemde valuta","Valuta"',
    '"05-10-2026","Anthropic Claude Pro","-21,78","20.00","USD"',
    '"06-10-2026","Automatische incasso vorig overzicht","+92,78","","EUR"',
    '"08 okt 2026","Uber Trip Amsterdam","-14,50","","EUR"',
  ].join('\n');

  const rows = IngCsvParser.parse(sampleStatementCsv);
  assert.strictEqual(rows.length, 3);

  assert.strictEqual(rows[0].date, '2026-10-05');
  assert.strictEqual(rows[0].direction, 'expense');
  assert.strictEqual(rows[0].amount, '21.78');
  assert.ok(rows[0].comment.includes('Original: 20.00 USD'), 'Should preserve foreign currency note');

  assert.strictEqual(rows[1].date, '2026-10-06');
  assert.strictEqual(rows[1].isRepayment, true, 'Should detect Automatische incasso as repayment');
  assert.strictEqual(rows[1].direction, 'income');
  assert.strictEqual(rows[1].amount, '92.78');

  assert.strictEqual(rows[2].date, '2026-10-08');
  assert.strictEqual(rows[2].direction, 'expense');
  assert.strictEqual(rows[2].amount, '14.50');
});

test('IngCsvParser generates deterministic idempotency keys and distinguishes identical same-day purchases', () => {
  const duplicateDayCsv = [
    'Datum;Omschrijving;Af Bij;Bedrag (EUR)',
    '2026-10-10;NS Groep;Af;5,40',
    '2026-10-10;NS Groep;Af;5,40',
  ].join('\n');

  const firstRun = IngCsvParser.parse(duplicateDayCsv);
  const secondRun = IngCsvParser.parse(duplicateDayCsv);

  assert.strictEqual(firstRun[0].idempotencyKey, secondRun[0].idempotencyKey, 'Idempotency key must be deterministic across parses');
  assert.strictEqual(firstRun[1].idempotencyKey, secondRun[1].idempotencyKey, 'Second occurrence key must also be deterministic');
  assert.notStrictEqual(firstRun[0].idempotencyKey, firstRun[1].idempotencyKey, 'Two identical coffees/train rides on same day must get distinct occurrence keys');
});

test('Zod boundary schemas strictly validate preview and commit payloads', () => {
  assert.throws(() => {
    PreviewCsvRequestSchema.parse({ csvContent: '' });
  }, 'Empty CSV should fail Zod validation');

  const validCommit = CommitImportRequestSchema.parse({
    batchId: 'batch-123',
    accountId: '649f8c45-304c-4868-bc5d-6c49c82ed985',
    items: [
      {
        idempotencyKey: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        selected: true,
        date: '2026-10-09',
        payee: 'Albert Heijn',
        amount: '42.85',
        direction: 'expense',
        categoryId: '25a24efa-51eb-48dd-ae11-2396b4c2c7dc',
      },
    ],
  });
  assert.strictEqual(validCommit.items.length, 1);
});
