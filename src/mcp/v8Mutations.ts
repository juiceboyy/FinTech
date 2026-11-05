import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import type {
  AddExpenseInput,
  AddIncomeInput,
  MutationResult,
  ZenmoneyCategory,
  ZenmoneyCategorySuggestion,
  ZenmoneySyncData,
} from './types.js';

const SuggestItemSchema = z.object({
  payee: z.string().nullable().optional(),
  merchant: z.string().nullable().optional(),
  tag: z.union([z.array(z.string()), z.string()]).nullable().optional(),
});

const SuggestResponseSchema = z.array(SuggestItemSchema);

const DiffResponseSchema = z.object({
  serverTimestamp: z.number().optional(),
});

export class ZenmoneyV8MutationService {
  private diffEndpoint = 'https://api.zenmoney.app/v8/diff/';
  private suggestEndpoint = 'https://api.zenmoney.app/v8/suggest/';

  public async suggestCategories(
    token: string,
    payees: string[],
    categories: ZenmoneyCategory[]
  ): Promise<Map<string, ZenmoneyCategorySuggestion>> {
    const resultMap = new Map<string, ZenmoneyCategorySuggestion>();
    const uniquePayees = Array.from(new Set(payees.map((p) => p.trim()).filter(Boolean)));
    if (uniquePayees.length === 0) {
      return resultMap;
    }

    const catById = new Map<string, ZenmoneyCategory>();
    for (const c of categories) {
      catById.set(c.id, c);
    }

    try {
      const res = await fetch(this.suggestEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(uniquePayees.map((payee) => ({ payee }))),
      });

      if (!res.ok) {
        return resultMap;
      }

      const rawJson = await res.json();
      const parsed = SuggestResponseSchema.safeParse(rawJson);
      if (!parsed.success) {
        return resultMap;
      }

      parsed.data.forEach((item, idx) => {
        const originalPayee = uniquePayees[idx];
        if (!originalPayee) return;

        let tagId: string | undefined;
        if (Array.isArray(item.tag) && item.tag.length > 0) {
          tagId = item.tag[0];
        } else if (typeof item.tag === 'string' && item.tag.length > 0) {
          tagId = item.tag;
        }

        const matchedCat = tagId ? catById.get(tagId) : undefined;
        resultMap.set(originalPayee, {
          payee: originalPayee,
          normalizedPayee: item.payee || originalPayee,
          categoryId: matchedCat ? matchedCat.id : undefined,
          categoryTitle: matchedCat ? matchedCat.title : undefined,
          merchantId: item.merchant ?? undefined,
        });
      });
    } catch {
      // Fallback gracefully if suggest endpoint is unreachable
    }

    return resultMap;
  }

  public async addExpense(
    token: string,
    syncContext: ZenmoneySyncData,
    input: AddExpenseInput
  ): Promise<MutationResult> {
    const results = await this.writeTransactionsBatch(token, syncContext, [
      { ...input, direction: 'expense', idempotencyKey: randomUUID() },
    ]);
    return Array.from(results.values())[0];
  }

  public async addIncome(
    token: string,
    syncContext: ZenmoneySyncData,
    input: AddIncomeInput
  ): Promise<MutationResult> {
    const results = await this.writeTransactionsBatch(token, syncContext, [
      { ...input, direction: 'income', idempotencyKey: randomUUID() },
    ]);
    return Array.from(results.values())[0];
  }

  public async writeTransactionsBatch(
    token: string,
    syncContext: ZenmoneySyncData,
    items: Array<{
      accountId: string;
      amount: string;
      date: string;
      categoryId?: string;
      payee?: string;
      comment?: string;
      direction: 'expense' | 'income';
      idempotencyKey: string;
    }>
  ): Promise<Map<string, MutationResult>> {
    const resultMap = new Map<string, MutationResult>();
    if (items.length === 0) return resultMap;

    if (!syncContext.userId) {
      throw new Error('Zenmoney userId missing from sync context. Run sync_data first.');
    }

    const now = Math.floor(Date.now() / 1000);
    const transactionPayloads: unknown[] = [];

    for (const item of items) {
      const acc = syncContext.accounts.find(
        (a) => a.id === item.accountId || a.title.toLowerCase() === item.accountId.toLowerCase()
      );
      if (!acc) {
        throw new Error(`Zenmoney account "${item.accountId}" not found.`);
      }

      const amountDec = new Decimal(item.amount);
      if (amountDec.lessThanOrEqualTo(0)) {
        throw new Error(`Transaction amount must be positive, got ${item.amount}`);
      }

      const instrumentId = acc.instrumentId ?? syncContext.defaultInstrumentId ?? 2;
      const txId = randomUUID();
      const numericAmount = amountDec.toDecimalPlaces(2).toNumber();

      transactionPayloads.push({
        id: txId,
        changed: now,
        created: now,
        user: syncContext.userId,
        deleted: false,
        hold: null,
        viewed: false,
        incomeInstrument: instrumentId,
        incomeAccount: acc.id,
        income: item.direction === 'income' ? numericAmount : 0,
        incomeBankID: null,
        outcomeInstrument: instrumentId,
        outcomeAccount: acc.id,
        outcome: item.direction === 'expense' ? numericAmount : 0,
        outcomeBankID: null,
        opIncome: null,
        opIncomeInstrument: null,
        opOutcome: null,
        opOutcomeInstrument: null,
        tag: item.categoryId ? [item.categoryId] : null,
        merchant: null,
        payee: item.payee ?? null,
        originalPayee: null,
        comment: item.comment ?? null,
        date: item.date,
        mcc: null,
        latitude: null,
        longitude: null,
        reminderMarker: null,
        qrCode: null,
      });

      resultMap.set(item.idempotencyKey, { id: txId });
    }

    const res = await fetch(this.diffEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentClientTimestamp: now,
        serverTimestamp: syncContext.serverTimestamp ?? 0,
        transaction: transactionPayloads,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Zenmoney v8 diff write failed (HTTP ${res.status}): ${errText}`);
    }

    const rawResp = await res.json();
    const validated = DiffResponseSchema.parse(rawResp);
    if (validated.serverTimestamp) {
      syncContext.serverTimestamp = validated.serverTimestamp;
      for (const val of resultMap.values()) {
        val.serverTimestamp = validated.serverTimestamp;
      }
    }

    return resultMap;
  }

  public async writeBudgetsBatch(
    token: string,
    syncContext: ZenmoneySyncData,
    items: Array<{
      categoryId: string;
      amount: string | number;
      monthDate?: string;
    }>
  ): Promise<Array<{ categoryId: string; outcome: number; date: string }>> {
    if (items.length === 0) return [];

    if (!syncContext.userId) {
      throw new Error('Zenmoney userId missing from sync context. Run sync_data first.');
    }

    const now = Math.floor(Date.now() / 1000);
    const currentDate = new Date().toISOString().split('T')[0];
    const defaultMonthStart = `${currentDate.slice(0, 7)}-01`;

    const markerOutflowByTag = new Map<string, Decimal>();
    if (syncContext.plannedTransactions) {
      for (const m of syncContext.plannedTransactions) {
        if (m.state === 'planned' && m.category && !m.isTransfer && m.outcome > 0 && m.date) {
          const monthKey = `${m.date.slice(0, 7)}-01::${m.category}`;
          const current = markerOutflowByTag.get(monthKey) || new Decimal(0);
          markerOutflowByTag.set(monthKey, current.plus(new Decimal(m.outcome)));
        }
      }
    }

    const budgetPayloads: unknown[] = [];
    const results: Array<{ categoryId: string; outcome: number; date: string }> = [];

    for (const item of items) {
      const monthStart = item.monthDate || defaultMonthStart;
      const targetAmountDec = new Decimal(item.amount);
      if (targetAmountDec.lessThan(0)) {
        throw new Error(`Budgetbedrag mag niet negatief zijn, ontvangen: ${item.amount}`);
      }

      const key = `${monthStart}::${item.categoryId}`;
      const scheduledMarkersDec = markerOutflowByTag.get(key) || new Decimal(0);
      const remainderOutcomeDec = Decimal.max(new Decimal(0), targetAmountDec.minus(scheduledMarkersDec));
      const numericOutcome = remainderOutcomeDec.toDecimalPlaces(2).toNumber();

      budgetPayloads.push({
        changed: now,
        date: monthStart,
        tag: item.categoryId,
        user: syncContext.userId,
        income: 0,
        outcome: numericOutcome,
        incomeLock: false,
        outcomeLock: true,
      });

      results.push({
        categoryId: item.categoryId,
        outcome: numericOutcome,
        date: monthStart,
      });
    }

    const res = await fetch(this.diffEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentClientTimestamp: now,
        serverTimestamp: syncContext.serverTimestamp ?? 0,
        budget: budgetPayloads,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Zenmoney v8 diff write budget failed (HTTP ${res.status}): ${errText}`);
    }

    const rawResp = await res.json();
    const validated = DiffResponseSchema.parse(rawResp);
    if (validated.serverTimestamp) {
      syncContext.serverTimestamp = validated.serverTimestamp;
    }

    return results;
  }
}

export const v8Mutations = new ZenmoneyV8MutationService();

