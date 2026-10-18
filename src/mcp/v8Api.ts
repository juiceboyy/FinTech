import { Decimal } from 'decimal.js';
import type {
  ZenmoneyAccount,
  ZenmoneyTransaction,
  ZenmoneyPlannedTransaction,
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

import {
  normalizeZenmoneyBudgets,
  type RawBudget,
  type RawReminder,
  type RawReminderMarker,
} from './v8BudgetNormalizer.js';

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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverTimestamp: 0, currentClientTimestamp: Math.floor(Date.now() / 1000) }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async fetchSyncData(token: string): Promise<ZenmoneySyncData> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverTimestamp: 0, currentClientTimestamp: Math.floor(Date.now() / 1000) }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Zenmoney API v8 sync failed (HTTP ${res.status}): ${text || 'Unauthorized'}`);
    }

    const data = (await res.json()) as {
      serverTimestamp?: number;
      account?: RawAccount[];
      transaction?: RawTransaction[];
      reminder?: RawReminder[];
      reminderMarker?: RawReminderMarker[];
      budget?: RawBudget[];
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

    const accountMap = new Map<string, string>();
    for (const a of data.account || []) {
      accountMap.set(a.id, a.title.trim());
    }

    const reminderMap = new Map<string, RawReminder>();
    for (const r of data.reminder || []) {
      if (!r.deleted) {
        reminderMap.set(r.id, r);
      }
    }

    const primaryUser = data.user && data.user.length > 0 ? data.user[0] : undefined;

    const accounts: ZenmoneyAccount[] = (data.account || [])
      .filter((a) => !a.archive)
      .map((a) => ({
        id: a.id,
        title: a.title,
        type: (a.type as ZenmoneyAccount['type']) || 'checking',
        balance: new Decimal(a.balance || 0).toDecimalPlaces(2).toNumber(),
        currency: 'EUR',
        instrumentId: a.instrument ?? primaryUser?.currency ?? 2,
      }));

    const transactions: ZenmoneyTransaction[] = (data.transaction || [])
      .filter((t) => !t.deleted)
      .map((t) => {
        const incDec = new Decimal(t.income || 0);
        const outDec = new Decimal(t.outcome || 0);
        const isTransfer =
          (incDec.greaterThan(0) && outDec.greaterThan(0)) ||
          (Boolean(t.incomeAccount) && Boolean(t.outcomeAccount) && t.incomeAccount !== t.outcomeAccount);

        const incomeAccountTitle = t.incomeAccount ? accountMap.get(t.incomeAccount) : undefined;
        const outcomeAccountTitle = t.outcomeAccount ? accountMap.get(t.outcomeAccount) : undefined;

        const firstTag = t.tag && t.tag.length > 0 ? t.tag[0] : undefined;
        const categoryTitle = isTransfer
          ? 'Internal Transfer'
          : firstTag
            ? tagMap.get(firstTag) || 'General'
            : 'General';

        const transferLabel = `Transfer: ${outcomeAccountTitle || 'Account'} -> ${incomeAccountTitle || 'Account'}`;
        const payeeName = isTransfer
          ? transferLabel
          : t.payee
            ? merchantMap.get(t.payee) || t.payee || t.comment || 'Transaction'
            : t.comment || 'Transaction';

        return {
          id: t.id,
          date: t.date,
          income: incDec.toDecimalPlaces(2).toNumber(),
          outcome: outDec.toDecimalPlaces(2).toNumber(),
          incomeAccount: t.incomeAccount,
          outcomeAccount: t.outcomeAccount,
          incomeAccountTitle,
          outcomeAccountTitle,
          isTransfer,
          category: firstTag,
          categoryTitle,
          payee: payeeName,
          comment: t.comment,
          currency: 'EUR',
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const plannedTransactions: ZenmoneyPlannedTransaction[] = (data.reminderMarker || [])
      .filter((m) => !m.deleted && m.state === 'planned')
      .map((m) => {
        const parent = m.reminder ? reminderMap.get(m.reminder) : undefined;
        const incDec = new Decimal(m.income ?? parent?.income ?? 0);
        const outDec = new Decimal(m.outcome ?? parent?.outcome ?? 0);
        const incomeAccount = m.incomeAccount || parent?.incomeAccount;
        const outcomeAccount = m.outcomeAccount || parent?.outcomeAccount;

        const isTransfer =
          (incDec.greaterThan(0) && outDec.greaterThan(0)) ||
          (Boolean(incomeAccount) && Boolean(outcomeAccount) && incomeAccount !== outcomeAccount);

        const incomeAccountTitle = incomeAccount ? accountMap.get(incomeAccount) : undefined;
        const outcomeAccountTitle = outcomeAccount ? accountMap.get(outcomeAccount) : undefined;

        const firstTag =
          (m.tag && m.tag.length > 0 ? m.tag[0] : undefined) ||
          (parent?.tag && parent.tag.length > 0 ? parent.tag[0] : undefined);
        const categoryTitle = isTransfer
          ? 'Internal Transfer'
          : firstTag
            ? tagMap.get(firstTag) || 'General'
            : 'General';

        const merchantId = m.merchant || parent?.merchant || undefined;
        const resolvedMerchant = merchantId ? merchantMap.get(merchantId) : undefined;
        const rawPayee = m.payee || parent?.payee || undefined;
        const rawComment = m.comment || parent?.comment || undefined;

        const transferLabel = `Transfer: ${outcomeAccountTitle || 'Account'} -> ${incomeAccountTitle || 'Account'}`;
        const payeeName = isTransfer
          ? transferLabel
          : resolvedMerchant || rawPayee || rawComment || 'Planned Transaction';

        return {
          id: m.id,
          reminderId: m.reminder,
          date: m.date,
          income: incDec.toDecimalPlaces(2).toNumber(),
          outcome: outDec.toDecimalPlaces(2).toNumber(),
          incomeAccount,
          outcomeAccount,
          incomeAccountTitle,
          outcomeAccountTitle,
          isTransfer,
          state: m.state || 'planned',
          isForecast: m.isForecast,
          category: firstTag,
          categoryTitle,
          payee: payeeName,
          comment: rawComment,
          currency: 'EUR',
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const budgets: ZenmoneyBudget[] = normalizeZenmoneyBudgets({
      rawBudgets: data.budget || [],
      rawReminderMarkers: data.reminderMarker || [],
      reminderMap,
      tagMap,
    });

    return {
      accounts,
      transactions,
      plannedTransactions,
      budgets,
      categories,
      userId: primaryUser?.id,
      defaultInstrumentId: primaryUser?.currency ?? 2,
      serverTimestamp: data.serverTimestamp,
    };
  }
}

export const v8SyncService = new ZenmoneyV8SyncService();

