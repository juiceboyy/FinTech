import type { ZenmoneyAccount, ZenmoneyTransaction, ZenmoneyBudget } from '../mcp/types.js';

export interface CategoryExpense {
  category: string;
  amount: number;
  percentage: number;
  budgeted?: number;
}

export interface InternalTransferItem {
  id: string;
  date: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  comment?: string;
  isSavingsAllocation: boolean;
}

export interface FinancialAnomaly {
  id: string;
  date: string;
  payee: string;
  category: string;
  amount: number;
  account?: string;
  comment?: string;
  reason: string;
}

export interface NormalizedFinancialSummary {
  periodDays: number;
  startDate: string;
  endDate: string;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRatePercentage: number;
  totalLiquidBalance: number;
  internalTransfers: InternalTransferItem[];
  totalInternalTransfers: number;
  savingsTransfersTotal: number;
  accounts: ZenmoneyAccount[];
  categoryBreakdown: CategoryExpense[];
  topAnomalies: FinancialAnomaly[];
  transactionsCount: number;
  recentTransactions: ZenmoneyTransaction[];
  budgets: ZenmoneyBudget[];
  sourceMode: 'live';
}
