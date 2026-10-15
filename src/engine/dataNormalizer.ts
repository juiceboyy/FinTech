import type { ZenmoneyAccount, ZenmoneyTransaction, ZenmoneyBudget } from '../mcp/types.js';
import type { NormalizedFinancialSummary, CategoryExpense, FinancialAnomaly } from './types.js';

export class FinancialDataNormalizer {
  public static normalize(params: {
    accounts: ZenmoneyAccount[];
    transactions: ZenmoneyTransaction[];
    budgets: ZenmoneyBudget[];
    periodDays?: number;
    sourceMode?: 'live' | 'mock';
  }): NormalizedFinancialSummary {
    const periodDays = params.periodDays || 15;
    const sourceMode = params.sourceMode || 'mock';

    const now = new Date();
    const startDateObj = new Date(now);
    startDateObj.setDate(startDateObj.getDate() - periodDays);
    const startDate = startDateObj.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    // Filter transactions within period
    const filtered = params.transactions.filter((tx) => {
      return tx.date >= startDate && tx.date <= endDate;
    });

    let totalIncome = 0;
    let totalExpenses = 0;
    const categoryTotals: Record<string, number> = {};

    for (const tx of filtered) {
      const inc = Number(tx.income) || 0;
      const out = Number(tx.outcome) || 0;

      totalIncome += inc;
      totalExpenses += out;

      if (out > 0) {
        const cat = tx.categoryTitle || tx.category || 'Uncategorized';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + out;
      }
    }

    const netCashFlow = Number((totalIncome - totalExpenses).toFixed(2));
    const savingsRate = totalIncome > 0
      ? Number(((netCashFlow / totalIncome) * 100).toFixed(1))
      : 0;

    // Category breakdown
    const categoryBreakdown: CategoryExpense[] = Object.entries(categoryTotals)
      .map(([category, amount]) => {
        const percentage = totalExpenses > 0
          ? Number(((amount / totalExpenses) * 100).toFixed(1))
          : 0;
        const matchingBudget = params.budgets.find((b) => b.category === category || b.categoryTitle === category);
        return {
          category,
          amount: Number(amount.toFixed(2)),
          percentage,
          budgeted: matchingBudget?.budgetedOutcome,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    // Identify anomalies (e.g. expenses >= 250 or exceeding budget significantly)
    const topAnomalies: FinancialAnomaly[] = [];
    for (const tx of filtered) {
      const out = Number(tx.outcome) || 0;
      if (out >= 250) {
        topAnomalies.push({
          id: tx.id,
          date: tx.date,
          payee: tx.payee || 'Unknown Payee',
          category: tx.categoryTitle || tx.category || 'General',
          amount: out,
          reason: `High expenditure single transaction exceeding 250 EUR threshold`,
        });
      }
    }

    // Liquid balance (checking + savings + cash)
    const totalLiquidBalance = params.accounts
      .filter((acc) => ['checking', 'deposit', 'cash'].includes(acc.type))
      .reduce((sum, acc) => sum + (Number(acc.balance) || 0), 0);

    return {
      periodDays,
      startDate,
      endDate,
      totalIncome: Number(totalIncome.toFixed(2)),
      totalExpenses: Number(totalExpenses.toFixed(2)),
      netCashFlow,
      savingsRatePercentage: savingsRate,
      totalLiquidBalance: Number(totalLiquidBalance.toFixed(2)),
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
