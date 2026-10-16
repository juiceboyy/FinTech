export interface ZenmoneyAccount {
  id: string;
  title: string;
  type: 'cash' | 'ccard' | 'checking' | 'loan' | 'deposit' | 'investment' | 'debt';
  balance: number;
  currency: string;
  instrumentId?: number;
  archive?: boolean;
}

export interface ZenmoneyCategory {
  id: string;
  title: string;
  parent?: string | null;
  showIncome?: boolean;
  showOutcome?: boolean;
}

export interface ZenmoneyCategorySuggestion {
  payee: string;
  normalizedPayee?: string;
  categoryId?: string;
  categoryTitle?: string;
  merchantId?: string;
}

export interface ZenmoneyTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  income: number;
  outcome: number;
  incomeAccount?: string;
  outcomeAccount?: string;
  incomeAccountTitle?: string;
  outcomeAccountTitle?: string;
  isTransfer?: boolean;
  category?: string;
  categoryTitle?: string;
  payee?: string;
  comment?: string;
  currency?: string;
}

export interface ZenmoneyBudget {
  id: string;
  date: string;
  category: string;
  categoryTitle?: string;
  budgetedOutcome: number;
  actualOutcome?: number;
}

export interface ZenmoneySyncData {
  accounts: ZenmoneyAccount[];
  transactions: ZenmoneyTransaction[];
  budgets: ZenmoneyBudget[];
  categories?: ZenmoneyCategory[];
  userId?: number;
  defaultInstrumentId?: number;
  serverTimestamp?: number;
}

export interface AddExpenseInput {
  accountId: string;
  amount: string; // Decimal string e.g. "12.34"
  date: string;   // YYYY-MM-DD
  categoryId?: string;
  payee?: string;
  comment?: string;
}

export interface AddIncomeInput {
  accountId: string;
  amount: string; // Decimal string e.g. "12.34"
  date: string;   // YYYY-MM-DD
  categoryId?: string;
  payee?: string;
  comment?: string;
}

export interface MutationResult {
  id: string;
  serverTimestamp?: number;
}

export interface McpClientStatus {
  connected: boolean;
  endpoint: string;
  mode: 'live' | 'disconnected';
  authenticated: boolean;
  lastSyncAt: string | null;
  error?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  savedAt: string;
}

