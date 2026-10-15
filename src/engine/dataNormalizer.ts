import { Decimal } from 'decimal.js';
import type { ZenmoneyAccount, ZenmoneyTransaction, ZenmoneyBudget } from '../mcp/types.js';
import type { NormalizedFinancialSummary, CategoryExpense, FinancialAnomaly } from './types.js';

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

    // Filter transactions within period
    const filtered = params.transactions.filter((tx) => {
      return tx.date >= startDate && tx.date <= endDate;
    });

    let totalIncomeDec = new Decimal(0);
    let totalExpensesDec = new Decimal(0);
    const categoryTotals: Record<string, Decimal> = {};

    for (const tx of filtered) {
      const inc = new Decimal(tx.income || 0);
      const out = new Decimal(tx.outcome || 0);

      totalIncomeDec = totalIncomeDec.plus(inc);
      totalExpensesDec = totalExpensesDec.plus(out);

      if (out.greaterThan(0)) {
        const cat = tx.categoryTitle || tx.category || 'Uncategorized';
        categoryTotals[cat] = (categoryTotals[cat] || new Decimal(0)).plus(out);
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

    // Identify anomalies (expenses >= 250 EUR threshold)
    const topAnomalies: FinancialAnomaly[] = [];
    for (const tx of filtered) {
      const out = new Decimal(tx.outcome || 0);
      if (out.greaterThanOrEqualTo(250)) {
        topAnomalies.push({
          id: tx.id,
          date: tx.date,
          payee: tx.payee || 'Unknown Payee',
          category: tx.categoryTitle || tx.category || 'General',
          amount: out.toDecimalPlaces(2).toNumber(),
          reason: `High expenditure single transaction exceeding 250 EUR threshold`,
        });
      }
    }

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

