import fs from 'node:fs';
import path from 'node:path';
import { Decimal } from 'decimal.js';
import type { ZenmoneyAccount, ZenmoneyCategory, ZenmoneyTransaction } from '../mcp/types.js';

const LEDGER_FILE = path.resolve(process.cwd(), 'data/imports/ledger.json');
const DEFAULT_ING_CC_NAME_REGEX = /ing\s*creditcard/i;

export interface PersistedLedgerEntry {
  idempotencyKey: string;
  zenmoneyTxId: string;
  accountId: string;
  settledAt: string;
}

export class ImportLedgerStore {
  public static loadSettledLedger(): Map<string, PersistedLedgerEntry> {
    const map = new Map<string, PersistedLedgerEntry>();
    try {
      if (fs.existsSync(LEDGER_FILE)) {
        const raw = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')) as PersistedLedgerEntry[];
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            map.set(entry.idempotencyKey, entry);
          }
        }
      }
    } catch {
      // Ignore corrupt ledger file
    }
    return map;
  }

  public static saveSettledLedger(map: Map<string, PersistedLedgerEntry>): void {
    try {
      const dir = path.dirname(LEDGER_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(LEDGER_FILE, JSON.stringify(Array.from(map.values()), null, 2), 'utf-8');
    } catch {
      // Non-fatal in serverless read-only filesystem
    }
  }

  public static resolveTargetAccount(
    accounts: ZenmoneyAccount[],
    requestedId?: string
  ): ZenmoneyAccount {
    if (requestedId) {
      const explicit = accounts.find(
        (a) => a.id === requestedId || a.title.toLowerCase() === requestedId.toLowerCase()
      );
      if (explicit) return explicit;
    }

    const ingCcard = accounts.find((a) => DEFAULT_ING_CC_NAME_REGEX.test(a.title));
    if (ingCcard) return ingCcard;

    const anyCcard = accounts.find((a) => a.type === 'ccard');
    if (anyCcard) return anyCcard;

    if (accounts.length > 0) return accounts[0];
    throw new Error('No active Zenmoney accounts found.');
  }

  public static matchHeuristicCategory(
    payee: string,
    categories: ZenmoneyCategory[]
  ): ZenmoneyCategory | undefined {
    const p = payee.toLowerCase();
    const rules: Array<{ pattern: RegExp; titleMatch: RegExp }> = [
      { pattern: /albert heijn|jumbo|dirk|aldi|lidl|picnic|supermarkt|ah to go/i, titleMatch: /^groceries$/i },
      { pattern: /uber|ns\s|ov-chipkaart|shell|bp\s|total|tango|q-park|parkeren|bolt|swapfiets/i, titleMatch: /^transport$|^auto$/i },
      { pattern: /booking\.com|airbnb|klm|transavia|easyjet|ryanair|hotel|schiphol/i, titleMatch: /^travel$/i },
      { pattern: /netflix|spotify|apple\.com\/bill|claude|openai|anthropic|google\s*\*|disney|prime video|chatgpt/i, titleMatch: /^subscriptions$/i },
      { pattern: /restaurant|cafe|coffee|starbucks|thuisbezorgd|uber\s*eats|bar\s|bistro|bakkerij/i, titleMatch: /^eating out$/i },
      { pattern: /bol\.com|amazon|coolblue|zalando|ikea|hema|action|mediamarkt/i, titleMatch: /^shopping$/i },
    ];

    for (const rule of rules) {
      if (rule.pattern.test(p)) {
        const found = categories.find((c) => rule.titleMatch.test(c.title.trim()));
        if (found) return found;
      }
    }
    return undefined;
  }

  public static findLiveZenmoneyMatch(
    existingOnAccount: ZenmoneyTransaction[],
    date: string,
    direction: 'expense' | 'income',
    amountDec: Decimal,
    shortRef: string,
    payee: string
  ): ZenmoneyTransaction | undefined {
    return existingOnAccount.find((tx) => {
      if (tx.date !== date) return false;
      const txAmt = new Decimal(direction === 'expense' ? tx.outcome : tx.income);
      if (!txAmt.equals(amountDec)) return false;
      if (tx.comment && tx.comment.includes(shortRef)) return true;
      const p1 = (tx.payee || tx.comment || '').toLowerCase();
      const p2 = payee.toLowerCase().slice(0, 8);
      return p2.length > 0 && p1.includes(p2);
    });
  }

  public static prepareCommitItems(
    items: Array<{
      idempotencyKey: string;
      selected: boolean;
      date: string;
      payee: string;
      amount: string;
      direction: 'expense' | 'income';
      categoryId?: string;
      comment?: string;
    }>,
    targetAccountId: string,
    existingOnAccount: ZenmoneyTransaction[],
    settledMap: Map<string, PersistedLedgerEntry>
  ): {
    itemsToCreate: Array<{
      accountId: string;
      amount: string;
      date: string;
      categoryId?: string;
      payee?: string;
      comment?: string;
      direction: 'expense' | 'income';
      idempotencyKey: string;
      rowIndex: number;
    }>;
    itemStagingMap: Map<number, any>;
    settledCount: number;
    skippedCount: number;
    settledExpenseDec: Decimal;
    settledIncomeDec: Decimal;
  } {
    let settledCount = 0;
    let skippedCount = 0;
    let settledExpenseDec = new Decimal(0);
    let settledIncomeDec = new Decimal(0);
    const itemsToCreate: any[] = [];
    const itemStagingMap = new Map<number, any>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const existingLedger = settledMap.get(item.idempotencyKey);
      const shortRef = item.idempotencyKey.slice(0, 10);
      const itemAmtDec = new Decimal(item.amount);
      const liveHit = this.findLiveZenmoneyMatch(
        existingOnAccount,
        item.date,
        item.direction,
        itemAmtDec,
        shortRef,
        item.payee
      );

      const alreadySettled = existingLedger || liveHit;
      if (alreadySettled) {
        const txId = existingLedger?.zenmoneyTxId || liveHit?.id || 'synced';
        settledMap.set(item.idempotencyKey, {
          idempotencyKey: item.idempotencyKey,
          zenmoneyTxId: txId,
          accountId: targetAccountId,
          settledAt: new Date().toISOString(),
        });
        settledCount++;
        if (item.direction === 'expense') {
          settledExpenseDec = settledExpenseDec.plus(itemAmtDec);
        } else {
          settledIncomeDec = settledIncomeDec.plus(itemAmtDec);
        }
        itemStagingMap.set(i, {
          rowIndex: i,
          date: item.date,
          rawPayee: item.payee,
          payee: item.payee,
          amount: item.amount,
          currency: 'EUR',
          direction: item.direction,
          comment: item.comment || '',
          isRepayment: false,
          idempotencyKey: item.idempotencyKey,
          categoryId: item.categoryId,
          isDuplicate: true,
          duplicateReason: 'Already synced in Zenmoney',
          selected: false,
          state: 'SETTLED',
          zenmoneyTxId: txId,
        });
        continue;
      }

      if (!item.selected) {
        skippedCount++;
        itemStagingMap.set(i, {
          rowIndex: i,
          date: item.date,
          rawPayee: item.payee,
          payee: item.payee,
          amount: item.amount,
          currency: 'EUR',
          direction: item.direction,
          comment: item.comment || '',
          isRepayment: false,
          idempotencyKey: item.idempotencyKey,
          categoryId: item.categoryId,
          isDuplicate: false,
          selected: false,
          state: 'DRAFT',
        });
        continue;
      }

      const commentWithRef = item.comment ? `${item.comment} [ing:${shortRef}]` : `[ing:${shortRef}]`;
      itemsToCreate.push({
        accountId: targetAccountId,
        amount: item.amount,
        date: item.date,
        categoryId: item.categoryId || undefined,
        payee: item.payee,
        comment: commentWithRef,
        direction: item.direction,
        idempotencyKey: item.idempotencyKey,
        rowIndex: i,
      });
    }

    return {
      itemsToCreate,
      itemStagingMap,
      settledCount,
      skippedCount,
      settledExpenseDec,
      settledIncomeDec,
    };
  }
}

