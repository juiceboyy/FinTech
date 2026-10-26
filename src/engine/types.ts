import type {
  ZenmoneyAccount,
  ZenmoneyTransaction,
  ZenmoneyPlannedTransaction,
  ZenmoneyBudget,
} from '../mcp/types.js';

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

export interface AccountLiquidityAlert {
  accountId: string;
  accountTitle: string;
  currentBalance: number;
  plannedOutflows: number;
  plannedInflows: number;
  projectedEndingBalance: number;
  shortfallAmount: number;
}

export interface PlannedCashFlowSummary {
  horizonDays: number;
  startDate: string;
  endDate: string;
  plannedIncomeTotal: number;
  plannedExpenseTotal: number;
  plannedTransferTotal: number;
  projectedNetCashFlow: number;
  items: ZenmoneyPlannedTransaction[];
  liquidityAlerts: AccountLiquidityAlert[];
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
  plannedSchedule: PlannedCashFlowSummary;
  accounts: ZenmoneyAccount[];
  categoryBreakdown: CategoryExpense[];
  topAnomalies: FinancialAnomaly[];
  transactionsCount: number;
  recentTransactions: ZenmoneyTransaction[];
  budgets: ZenmoneyBudget[];
  sourceMode: 'live';
}

export interface CategorySavingsPlan {
  category: string;
  categoryId?: string;
  spentMonthToDate: number;
  spentLast30Days: number;
  dailyAverageSpent: number;
  zenmoneyBudget: number | null;
  recommendedMonthlyBudget: number;
  needsNewZenmoneyGoal: boolean;
  goalReason: string;
  remainingMonthAllowance: number;
  dailyAllowanceRestOfMonth: number;
  weeklyAllowance: number;
  potentialDailySavings: number;
  potentialWeeklySavings: number;
  potentialMonthlySavings: number;
  isLifestyleLeak: boolean;
}

export interface SavingsGoalsSummary {
  referenceDate: string;
  currentMonthStart: string;
  currentMonthEnd: string;
  daysInMonth: number;
  daysElapsedInMonth: number;
  daysRemainingInMonth: number;
  daysRemainingInWeek: number;
  monthlyIncomeToDate: number;
  monthlyExpensesToDate: number;
  monthlySavingsTransfersToDate: number;
  currentSavingsRatePercentage: number;
  targetSavingsRatePercentage: number;
  targetMonthlySavingsAmount: number;
  potentialExtraMonthlySavings: number;
  potentialExtraDailySavings: number;
  potentialExtraWeeklySavings: number;
  todayTargetVariableSpendLimit: number;
  todayTargetSavingsAmount: number;
  weekTargetVariableSpendLimit: number;
  weekTargetSavingsAmount: number;
  restOfMonthVariableSpendLimit: number;
  restOfMonthTargetSavingsAmount: number;
  categoryPlans: CategorySavingsPlan[];
}

