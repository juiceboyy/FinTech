import { Decimal } from 'decimal.js';
import type { ZenmoneyBudget } from './types.js';

export interface RawReminder {
  id: string;
  income?: number;
  outcome?: number;
  incomeAccount?: string;
  outcomeAccount?: string;
  tag?: string[] | null;
  merchant?: string | null;
  payee?: string | null;
  comment?: string | null;
  deleted?: boolean;
}

export interface RawReminderMarker {
  id: string;
  date: string;
  income: number;
  outcome: number;
  incomeAccount?: string;
  outcomeAccount?: string;
  state?: 'planned' | 'processed' | 'deleted';
  isForecast?: boolean;
  reminder?: string;
  tag?: string[] | null;
  merchant?: string | null;
  payee?: string | null;
  comment?: string | null;
  deleted?: boolean;
}

export interface RawBudget {
  tag?: string | null;
  date: string;
  income?: number;
  outcome?: number;
  incomeLock?: boolean;
  outcomeLock?: boolean;
}

/**
 * Reconstructs total monthly category budgets from Zenmoney v8 diff data.
 *
 * In Zenmoney's internal data model, `budget.outcome` only stores the *unplanned*
 * remainder of a category's monthly budget after subtracting all non-deleted
 * `reminderMarker` outflows (`planned` and `processed`) in that same month and tag.
 * To obtain the actual total budget set by the user in Zenmoney (e.g. EUR 1500.00
 * for Auto = EUR 398.01 remainder + EUR 1101.99 scheduled markers), we sum both
 * using arbitrary-precision Decimal arithmetic.
 */
export function normalizeZenmoneyBudgets(params: {
  rawBudgets: RawBudget[];
  rawReminderMarkers: RawReminderMarker[];
  reminderMap: Map<string, RawReminder>;
  tagMap: Map<string, string>;
}): ZenmoneyBudget[] {
  const markerOutcomeByMonthAndTag = new Map<string, Decimal>();

  for (const m of params.rawReminderMarkers) {
    if (m.deleted || m.state === 'deleted' || !m.date || m.date.length < 7) {
      continue;
    }

    const parent = m.reminder ? params.reminderMap.get(m.reminder) : undefined;
    const incDec = new Decimal(m.income ?? parent?.income ?? 0);
    const outDec = new Decimal(m.outcome ?? parent?.outcome ?? 0);
    const incomeAccount = m.incomeAccount || parent?.incomeAccount;
    const outcomeAccount = m.outcomeAccount || parent?.outcomeAccount;

    const isTransfer =
      (incDec.greaterThan(0) && outDec.greaterThan(0)) ||
      (Boolean(incomeAccount) && Boolean(outcomeAccount) && incomeAccount !== outcomeAccount);

    if (isTransfer || !outDec.greaterThan(0)) {
      continue;
    }

    const firstTag =
      (m.tag && m.tag.length > 0 ? m.tag[0] : undefined) ||
      (parent?.tag && parent.tag.length > 0 ? parent.tag[0] : undefined);

    if (!firstTag) {
      continue;
    }

    const monthStart = `${m.date.slice(0, 7)}-01`;
    const key = `${monthStart}::${firstTag}`;
    const existing = markerOutcomeByMonthAndTag.get(key) || new Decimal(0);
    markerOutcomeByMonthAndTag.set(key, existing.plus(outDec));
  }

  const budgets: ZenmoneyBudget[] = [];

  for (let idx = 0; idx < params.rawBudgets.length; idx++) {
    const b = params.rawBudgets[idx];
    if (!b.tag || !b.date) {
      continue;
    }

    const key = `${b.date}::${b.tag}`;
    const rawOutcomeDec = new Decimal(b.outcome || 0);
    const markerOutcomeDec = markerOutcomeByMonthAndTag.get(key) || new Decimal(0);
    const totalOutcomeDec = rawOutcomeDec.plus(markerOutcomeDec);

    if (!totalOutcomeDec.greaterThan(0)) {
      continue;
    }

    budgets.push({
      id: `${b.date}-${b.tag || idx}`,
      date: b.date,
      category: b.tag,
      categoryTitle: params.tagMap.get(b.tag) || 'General',
      budgetedOutcome: totalOutcomeDec.toDecimalPlaces(2).toNumber(),
    });
  }

  budgets.sort((a, b) => b.date.localeCompare(a.date));
  return budgets;
}
