import fs from 'node:fs';
import path from 'node:path';
import type { ZenmoneyAccount, ZenmoneyCategory } from '../mcp/types.js';

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
}
