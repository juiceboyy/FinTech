import type {
  ZenmoneyAccount,
  ZenmoneyTransaction,
  ZenmoneyBudget,
  ZenmoneyCategory,
  ZenmoneySyncData,
} from './types.js';

interface RawAccount {
  id: string;
  title: string;
  type: string;
  balance: number;
  instrument?: number;
  archive?: boolean;
}

interface RawTransaction {
  id: string;
  date: string;
  income: number;
  outcome: number;
  incomeAccount?: string;
  outcomeAccount?: string;
  tag?: string[];
  payee?: string;
  comment?: string;
  deleted?: boolean;
}

interface RawTag {
  id: string;
  title: string;
  parent?: string | null;
  showIncome?: boolean;
  showOutcome?: boolean;
}

interface RawMerchant {
  id: string;
  title: string;
}

interface RawUser {
  id: number;
  currency?: number;
}

export class ZenmoneyV8SyncService {
  private endpoint = 'https://api.zenmoney.app/v8/diff/';

  public async probeToken(token: string): Promise<boolean> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serverTimestamp: 0,
          currentClientTimestamp: Math.floor(Date.now() / 1000),
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async fetchSyncData(token: string): Promise<ZenmoneySyncData> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        serverTimestamp: 0,
        currentClientTimestamp: Math.floor(Date.now() / 1000),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Zenmoney API v8 sync failed (HTTP ${res.status}): ${text || 'Unauthorized'}`);
    }

    const data = (await res.json()) as {
      serverTimestamp?: number;
      account?: RawAccount[];
      transaction?: RawTransaction[];
      tag?: RawTag[];
      merchant?: RawMerchant[];
      user?: RawUser[];
    };

    const tagMap = new Map<string, string>();
    const categories: ZenmoneyCategory[] = [];
    for (const t of data.tag || []) {
      tagMap.set(t.id, t.title.trim());
      categories.push({
        id: t.id,
        title: t.title.trim(),
        parent: t.parent ?? null,
        showIncome: t.showIncome ?? true,
        showOutcome: t.showOutcome ?? true,
      });
    }
    categories.sort((a, b) => a.title.localeCompare(b.title));

    const merchantMap = new Map<string, string>();
    for (const m of data.merchant || []) {
      merchantMap.set(m.id, m.title);
    }

    const primaryUser = data.user && data.user.length > 0 ? data.user[0] : undefined;

    const accounts: ZenmoneyAccount[] = (data.account || [])
      .filter((a) => !a.archive)
      .map((a) => ({
        id: a.id,
        title: a.title,
        type: (a.type as ZenmoneyAccount['type']) || 'checking',
        balance: Number(a.balance) || 0,
        currency: 'EUR',
        instrumentId: a.instrument ?? primaryUser?.currency ?? 2,
      }));

    const transactions: ZenmoneyTransaction[] = (data.transaction || [])
      .filter((t) => !t.deleted)
      .map((t) => {
        const firstTag = t.tag && t.tag.length > 0 ? t.tag[0] : undefined;
        const categoryTitle = firstTag ? tagMap.get(firstTag) || 'General' : 'General';
        const payeeName = t.payee ? merchantMap.get(t.payee) || t.payee || t.comment || 'Transaction' : t.comment || 'Transaction';

        return {
          id: t.id,
          date: t.date,
          income: Number(t.income) || 0,
          outcome: Number(t.outcome) || 0,
          incomeAccount: t.incomeAccount,
          outcomeAccount: t.outcomeAccount,
          category: firstTag,
          categoryTitle,
          payee: payeeName,
          comment: t.comment,
          currency: 'EUR',
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const budgets: ZenmoneyBudget[] = [];

    return {
      accounts,
      transactions,
      budgets,
      categories,
      userId: primaryUser?.id,
      defaultInstrumentId: primaryUser?.currency ?? 2,
      serverTimestamp: data.serverTimestamp,
    };
  }
}

export const v8SyncService = new ZenmoneyV8SyncService();

