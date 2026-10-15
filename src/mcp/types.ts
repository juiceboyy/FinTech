export interface ZenmoneyAccount {
  id: string;
  title: string;
  type: 'cash' | 'ccard' | 'checking' | 'loan' | 'deposit' | 'investment';
  balance: number;
  currency: string;
  archive?: boolean;
}

export interface ZenmoneyTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  income: number;
  outcome: number;
  incomeAccount?: string;
  outcomeAccount?: string;
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
