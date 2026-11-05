import { Decimal } from 'decimal.js';
import type {
  ZenmoneyAccount,
  ZenmoneyTransaction,
  ZenmoneyPlannedTransaction,
  ZenmoneyBudget,
  ZenmoneyCategory,
} from '../mcp/types.js';
import type {
  NormalizedFinancialSummary,
  CategoryExpense,
  FinancialAnomaly,
  InternalTransferItem,
  PlannedCashFlowSummary,
  AccountLiquidityAlert,
} from './types.js';

const SAVINGS_ACCOUNT_REGEX = /buffer|spaar|saving|reserve|vault/i;
const INCOME_CATEGORY_REGEX =
  /\b(salary|salaris|loon|income|inkomsten|interest|rente|gift|freelance|consulting|dividend|stipend|omzet|revenue|toeslag|uitkering)\b/i;

function isExpenseCategory(
  categoryTitle?: string,
  categoryKey?: string,
  categoryMap?: Map<string, ZenmoneyCategory>
): boolean {
  if (categoryMap) {
    for (const key of [categoryTitle, categoryKey]) {
      if (!key) continue;
      const cat = categoryMap.get(key.toLowerCase());
      if (cat) {
        if (cat.showOutcome && !cat.showIncome) return true;
        if (cat.showIncome && !cat.showOutcome) return false;
      }
    }
  }
  for (const key of [categoryTitle, categoryKey]) {
    if (!key) continue;
    if (INCOME_CATEGORY_REGEX.test(key)) return false;
  }
  return true;
}

export class FinancialDataNormalizer {
  public static normalize(params: {
    accounts: ZenmoneyAccount[];
    transactions: ZenmoneyTransaction[];
    plannedTransactions?: ZenmoneyPlannedTransaction[];
    budgets: ZenmoneyBudget[];
    categories?: ZenmoneyCategory[];
    periodDays?: number;
    forecastHorizonDays?: number;
    sourceMode?: 'live';
  }): NormalizedFinancialSummary {
    const periodDays = params.periodDays || 15;
    const forecastHorizonDays = params.forecastHorizonDays || 30;
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

    const categoryByTitleOrId = new Map<string, ZenmoneyCategory>();
    if (params.categories) {
      for (const c of params.categories) {
        if (c.title) categoryByTitleOrId.set(c.title.toLowerCase(), c);
        if (c.id) categoryByTitleOrId.set(c.id.toLowerCase(), c);
      }
    }

    // Filter transactions within period
    const filtered = params.transactions
      .filter((tx) => tx.date >= startDate && tx.date <= endDate)
      .map((tx) => ({ ...tx }));

    let totalIncomeDec = new Decimal(0);
    let totalExpensesOutflowDec = new Decimal(0);
    let totalExpenseRefundsDec = new Decimal(0);
    let totalInternalTransfersDec = new Decimal(0);
    let savingsTransfersDec = new Decimal(0);
    const categoryOutflows: Record<string, Decimal> = {};
    const categoryRefunds: Record<string, Decimal> = {};
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

      const cat = tx.categoryTitle || tx.category || 'Uncategorized';
      const isExpenseCat = isExpenseCategory(tx.categoryTitle, tx.category, categoryByTitleOrId);

      if (isExpenseCat && inc.greaterThan(0)) {
        // Refund or Tikkie payback on expense category
        totalExpenseRefundsDec = totalExpenseRefundsDec.plus(inc);
        categoryRefunds[cat] = (categoryRefunds[cat] || new Decimal(0)).plus(inc);
      } else {
        totalIncomeDec = totalIncomeDec.plus(inc);
      }

      if (out.greaterThan(0)) {
        totalExpensesOutflowDec = totalExpensesOutflowDec.plus(out);
        categoryOutflows[cat] = (categoryOutflows[cat] || new Decimal(0)).plus(out);
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

    const totalExpensesDec = Decimal.max(0, totalExpensesOutflowDec.minus(totalExpenseRefundsDec));
    const netCashFlowDec = totalIncomeDec.minus(totalExpensesDec);
    const savingsRateDec = totalIncomeDec.greaterThan(0)
      ? netCashFlowDec.dividedBy(totalIncomeDec).times(100)
      : new Decimal(0);

    // Category breakdown
    const allCategoryNames = new Set<string>([
      ...Object.keys(categoryOutflows),
      ...Object.keys(categoryRefunds),
    ]);

    const currentMonthStart = `${endDate.slice(0, 7)}-01`;
    const hasCurrentMonthBudgets = params.budgets.some((b) => b.date === currentMonthStart);
    const categoryBreakdown: CategoryExpense[] = Array.from(allCategoryNames)
      .map((category) => {
        const outDec = categoryOutflows[category] || new Decimal(0);
        const refDec = categoryRefunds[category] || new Decimal(0);
        const amountDec = Decimal.max(0, outDec.minus(refDec));
        const percentage = totalExpensesDec.greaterThan(0)
          ? amountDec.dividedBy(totalExpensesDec).times(100).toDecimalPlaces(1).toNumber()
          : 0;
        const matchingBudget = hasCurrentMonthBudgets
          ? params.budgets.find(
              (b) => b.date === currentMonthStart && (b.category === category || b.categoryTitle === category)
            )
          : params.budgets.find((b) => b.category === category || b.categoryTitle === category);
        return {
          category,
          amount: amountDec.toDecimalPlaces(2).toNumber(),
          refund: refDec.greaterThan(0) ? refDec.toDecimalPlaces(2).toNumber() : undefined,
          percentage,
          budgeted: matchingBudget?.budgetedOutcome,
        };
      })
      .filter((c) => c.amount > 0 || (c.refund && c.refund > 0) || c.budgeted !== undefined)
      .sort((a, b) => new Decimal(b.amount).minus(a.amount).toNumber());

    // Liquid balance (checking + savings + cash)
    const totalLiquidDec = params.accounts
      .filter((acc) => ['checking', 'deposit', 'cash'].includes(acc.type))
      .reduce((sum, acc) => sum.plus(new Decimal(acc.balance || 0)), new Decimal(0));

    const plannedSchedule = this.normalizePlannedSchedule({
      accounts: params.accounts,
      accountById,
      plannedTransactions: params.plannedTransactions || [],
      todayDate: endDate,
      horizonDays: forecastHorizonDays,
    });

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
      plannedSchedule,
      accounts: params.accounts,
      categoryBreakdown,
      topAnomalies,
      transactionsCount: filtered.length,
      recentTransactions: filtered.slice(0, 15),
      budgets: params.budgets,
      sourceMode,
    };
  }

  private static normalizePlannedSchedule(params: {
    accounts: ZenmoneyAccount[];
    accountById: Map<string, ZenmoneyAccount>;
    plannedTransactions: ZenmoneyPlannedTransaction[];
    todayDate: string;
    horizonDays: number;
  }): PlannedCashFlowSummary {
    const horizonDateObj = new Date(`${params.todayDate}T00:00:00Z`);
    horizonDateObj.setUTCDate(horizonDateObj.getUTCDate() + params.horizonDays);
    const forecastEndDate = horizonDateObj.toISOString().split('T')[0];

    const upcoming = params.plannedTransactions
      .filter((pt) => pt.state === 'planned' && pt.date >= params.todayDate && pt.date <= forecastEndDate)
      .map((pt) => {
        const fromAcc = pt.outcomeAccount ? params.accountById.get(pt.outcomeAccount) : undefined;
        const toAcc = pt.incomeAccount ? params.accountById.get(pt.incomeAccount) : undefined;
        return {
          ...pt,
          outcomeAccountTitle: pt.outcomeAccountTitle || fromAcc?.title,
          incomeAccountTitle: pt.incomeAccountTitle || toAcc?.title,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    let plannedIncomeDec = new Decimal(0);
    let plannedExpenseDec = new Decimal(0);
    let plannedTransferDec = new Decimal(0);

    const inflowsByAcc = new Map<string, Decimal>();
    const outflowsByAcc = new Map<string, Decimal>();

    for (const item of upcoming) {
      const inc = new Decimal(item.income || 0);
      const out = new Decimal(item.outcome || 0);

      if (item.isTransfer) {
        const transferAmt = out.greaterThan(0) ? out : inc;
        plannedTransferDec = plannedTransferDec.plus(transferAmt);
        if (item.outcomeAccount) {
          outflowsByAcc.set(item.outcomeAccount, (outflowsByAcc.get(item.outcomeAccount) || new Decimal(0)).plus(out));
        }
        if (item.incomeAccount) {
          inflowsByAcc.set(item.incomeAccount, (inflowsByAcc.get(item.incomeAccount) || new Decimal(0)).plus(inc));
        }
      } else {
        plannedIncomeDec = plannedIncomeDec.plus(inc);
        plannedExpenseDec = plannedExpenseDec.plus(out);
        if (inc.greaterThan(0) && item.incomeAccount) {
          inflowsByAcc.set(item.incomeAccount, (inflowsByAcc.get(item.incomeAccount) || new Decimal(0)).plus(inc));
        }
        if (out.greaterThan(0) && item.outcomeAccount) {
          outflowsByAcc.set(item.outcomeAccount, (outflowsByAcc.get(item.outcomeAccount) || new Decimal(0)).plus(out));
        }
      }
    }

    const liquidityAlerts: AccountLiquidityAlert[] = [];
    for (const acc of params.accounts) {
      const outDec = outflowsByAcc.get(acc.id) || new Decimal(0);
      if (outDec.lessThanOrEqualTo(0)) continue;
      const inDec = inflowsByAcc.get(acc.id) || new Decimal(0);
      const balDec = new Decimal(acc.balance || 0);
      const projectedEndingDec = balDec.plus(inDec).minus(outDec);

      if (projectedEndingDec.lessThan(0)) {
        liquidityAlerts.push({
          accountId: acc.id,
          accountTitle: acc.title,
          currentBalance: balDec.toDecimalPlaces(2).toNumber(),
          plannedOutflows: outDec.toDecimalPlaces(2).toNumber(),
          plannedInflows: inDec.toDecimalPlaces(2).toNumber(),
          projectedEndingBalance: projectedEndingDec.toDecimalPlaces(2).toNumber(),
          shortfallAmount: projectedEndingDec.abs().toDecimalPlaces(2).toNumber(),
        });
      }
    }

    return {
      horizonDays: params.horizonDays,
      startDate: params.todayDate,
      endDate: forecastEndDate,
      plannedIncomeTotal: plannedIncomeDec.toDecimalPlaces(2).toNumber(),
      plannedExpenseTotal: plannedExpenseDec.toDecimalPlaces(2).toNumber(),
      plannedTransferTotal: plannedTransferDec.toDecimalPlaces(2).toNumber(),
      projectedNetCashFlow: plannedIncomeDec.minus(plannedExpenseDec).toDecimalPlaces(2).toNumber(),
      items: upcoming,
      liquidityAlerts,
    };
  }
}

