import { Decimal } from 'decimal.js';
import type { ZenmoneyAccount, ZenmoneyTransaction, ZenmoneyBudget } from '../mcp/types.js';
import type {
  NormalizedFinancialSummary,
  CategoryExpense,
  FinancialAnomaly,
  InternalTransferItem,
} from './types.js';

const SAVINGS_ACCOUNT_REGEX = /buffer|spaar|saving|reserve|vault/i;

export class FinancialDataNormalizer {
  public static normalize(params: {
    accounts: ZenmoneyAccount[];
    transactions: ZenmoneyTransaction[];
    budgets: ZenmoneyBudget[];
    periodDays?: number;
    sourceMode?: 'live';
  }): NormalizedFinancialSummary {
    const periodDays = params.periodDays || 15;
    const sourceMode = 'live';

    const now = new Date();
    const startDateObj = new Date(now);
    startDateObj.setDate(startDateObj.getDate() - periodDays);
    const startDate = startDateObj.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    const accountById = new Map<string, ZenmoneyAccount>();
    for (const acc of params.accounts) {
      accountById.set(acc.id, acc);
    }

    // Filter transactions within period
    const filtered = params.transactions
      .filter((tx) => tx.date >= startDate && tx.date <= endDate)
      .map((tx) => ({ ...tx }));

    let totalIncomeDec = new Decimal(0);
    let totalExpensesDec = new Decimal(0);
    let totalInternalTransfersDec = new Decimal(0);
    let savingsTransfersDec = new Decimal(0);
    const categoryTotals: Record<string, Decimal> = {};
    const internalTransfers: InternalTransferItem[] = [];
    const topAnomalies: FinancialAnomaly[] = [];

    for (const tx of filtered) {
      const inc = new Decimal(tx.income || 0);
      const out = new Decimal(tx.outcome || 0);

      const isTransfer =
        Boolean(tx.isTransfer) ||
        (inc.greaterThan(0) && out.greaterThan(0)) ||
        (Boolean(tx.incomeAccount) && Boolean(tx.outcomeAccount) && tx.incomeAccount !== tx.outcomeAccount);

      const fromAcc = tx.outcomeAccount ? accountById.get(tx.outcomeAccount) : undefined;
      const toAcc = tx.incomeAccount ? accountById.get(tx.incomeAccount) : undefined;
      const fromTitle = tx.outcomeAccountTitle || fromAcc?.title || 'Source Account';
      const toTitle = tx.incomeAccountTitle || toAcc?.title || 'Target Account';

      if (isTransfer) {
        const transferAmountDec = out.greaterThan(0) ? out : inc;
        const isSavingsAllocation =
          toAcc?.type === 'deposit' || SAVINGS_ACCOUNT_REGEX.test(toTitle);

        tx.isTransfer = true;
        tx.categoryTitle = 'Internal Transfer';
        if (!tx.payee || tx.payee === 'Transaction') {
          tx.payee = `Transfer: ${fromTitle} -> ${toTitle}`;
        }

        totalInternalTransfersDec = totalInternalTransfersDec.plus(transferAmountDec);
        if (isSavingsAllocation) {
          savingsTransfersDec = savingsTransfersDec.plus(transferAmountDec);
        }

        internalTransfers.push({
          id: tx.id,
          date: tx.date,
          fromAccount: fromTitle,
          toAccount: toTitle,
          amount: transferAmountDec.toDecimalPlaces(2).toNumber(),
          comment: tx.comment,
          isSavingsAllocation,
        });
        continue;
      }

      totalIncomeDec = totalIncomeDec.plus(inc);
      totalExpensesDec = totalExpensesDec.plus(out);

      if (out.greaterThan(0)) {
        const cat = tx.categoryTitle || tx.category || 'Uncategorized';
        categoryTotals[cat] = (categoryTotals[cat] || new Decimal(0)).plus(out);
      }

      if (out.greaterThanOrEqualTo(250)) {
        const cleanComment = tx.comment ? tx.comment.replace(/<br\s*\/?>/gi, ', ').trim() : undefined;
        const contextNotes: string[] = [];
        if (fromAcc?.title || tx.outcomeAccountTitle) {
          contextNotes.push(`Account: ${fromTitle}`);
        }
        if (cleanComment) {
          contextNotes.push(`Note: ${cleanComment}`);
        }
        const suffix = contextNotes.length > 0 ? ` (${contextNotes.join(' | ')})` : '';

        topAnomalies.push({
          id: tx.id,
          date: tx.date,
          payee: tx.payee || 'Unknown Payee',
          category: tx.categoryTitle || tx.category || 'General',
          amount: out.toDecimalPlaces(2).toNumber(),
          account: fromTitle,
          comment: cleanComment,
          reason: `High expenditure single transaction exceeding 250 EUR threshold${suffix}`,
        });
      }
    }

    const netCashFlowDec = totalIncomeDec.minus(totalExpensesDec);
    const savingsRateDec = totalIncomeDec.greaterThan(0)
      ? netCashFlowDec.dividedBy(totalIncomeDec).times(100)
      : new Decimal(0);

    // Category breakdown
    const categoryBreakdown: CategoryExpense[] = Object.entries(categoryTotals)
      .map(([category, amountDec]) => {
        const percentage = totalExpensesDec.greaterThan(0)
          ? amountDec.dividedBy(totalExpensesDec).times(100).toDecimalPlaces(1).toNumber()
          : 0;
        const matchingBudget = params.budgets.find((b) => b.category === category || b.categoryTitle === category);
        return {
          category,
          amount: amountDec.toDecimalPlaces(2).toNumber(),
          percentage,
          budgeted: matchingBudget?.budgetedOutcome,
        };
      })
      .sort((a, b) => new Decimal(b.amount).minus(a.amount).toNumber());

    // Liquid balance (checking + savings + cash)
    const totalLiquidDec = params.accounts
      .filter((acc) => ['checking', 'deposit', 'cash'].includes(acc.type))
      .reduce((sum, acc) => sum.plus(new Decimal(acc.balance || 0)), new Decimal(0));

    return {
      periodDays,
      startDate,
      endDate,
      totalIncome: totalIncomeDec.toDecimalPlaces(2).toNumber(),
      totalExpenses: totalExpensesDec.toDecimalPlaces(2).toNumber(),
      netCashFlow: netCashFlowDec.toDecimalPlaces(2).toNumber(),
      savingsRatePercentage: savingsRateDec.toDecimalPlaces(1).toNumber(),
      totalLiquidBalance: totalLiquidDec.toDecimalPlaces(2).toNumber(),
      internalTransfers,
      totalInternalTransfers: totalInternalTransfersDec.toDecimalPlaces(2).toNumber(),
      savingsTransfersTotal: savingsTransfersDec.toDecimalPlaces(2).toNumber(),
      accounts: params.accounts,
      categoryBreakdown,
      topAnomalies,
      transactionsCount: filtered.length,
      recentTransactions: filtered.slice(0, 15),
      budgets: params.budgets,
      sourceMode,
    };
  }
}

