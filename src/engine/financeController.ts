import { mcpClient } from '../mcp/client.js';
import { FinancialDataNormalizer } from './dataNormalizer.js';
import { SavingsPlanner } from './savingsPlanner.js';
import type { NormalizedFinancialSummary, SavingsGoalsSummary } from './types.js';
import type { ZenmoneyAccount, ZenmoneyTransaction, ZenmoneyBudget } from '../mcp/types.js';

export interface AdvisorDataset {
  summary: NormalizedFinancialSummary;
  savingsPlan: SavingsGoalsSummary;
  allRecentTransactions: ZenmoneyTransaction[];
}

export class FinanceController {
  public async getFinancialSummary(periodDays = 15): Promise<NormalizedFinancialSummary> {
    const dataset = await this.getAdvisorDataset(periodDays);
    return dataset.summary;
  }

  public async getSavingsGoals(): Promise<SavingsGoalsSummary> {
    const dataset = await this.getAdvisorDataset(15);
    return dataset.savingsPlan;
  }

  public async getAdvisorDataset(periodDays = 15): Promise<AdvisorDataset> {
    let status = mcpClient.getStatus();

    if (!status.connected) {
      const connected = await mcpClient.connect();
      status = mcpClient.getStatus();
      if (!connected) {
        throw new Error(
          status.error || 'Zenmoney MCP is disconnected. Please configure ZENMONEY_TOKEN in your environment or authorize your Zenmoney account.'
        );
      }
    }

    if (mcpClient.isDirectMode()) {
      const liveSync = await mcpClient.getSyncData();
      if (!liveSync) {
        throw new Error('Failed to retrieve live Zenmoney sync data.');
      }
      const summary = FinancialDataNormalizer.normalize({
        accounts: liveSync.accounts,
        transactions: liveSync.transactions,
        plannedTransactions: liveSync.plannedTransactions,
        budgets: liveSync.budgets,
        periodDays,
        sourceMode: 'live',
      });
      const savingsPlan = SavingsPlanner.computeSavingsPlan({
        accounts: liveSync.accounts,
        transactions: liveSync.transactions,
        budgets: liveSync.budgets,
      });
      return {
        summary,
        savingsPlan,
        allRecentTransactions: liveSync.transactions.slice(0, 200),
      };
    }

    const liveData = await this.fetchRemoteMcpData();
    const summary = FinancialDataNormalizer.normalize({
      accounts: liveData.accounts,
      transactions: liveData.transactions,
      budgets: liveData.budgets,
      periodDays,
      sourceMode: 'live',
    });
    const savingsPlan = SavingsPlanner.computeSavingsPlan({
      accounts: liveData.accounts,
      transactions: liveData.transactions,
      budgets: liveData.budgets,
    });
    return {
      summary,
      savingsPlan,
      allRecentTransactions: liveData.transactions.slice(0, 200),
    };
  }

  private async fetchRemoteMcpData(): Promise<{
    accounts: ZenmoneyAccount[];
    transactions: ZenmoneyTransaction[];
    budgets: ZenmoneyBudget[];
  }> {
    const accounts: ZenmoneyAccount[] = [];
    const transactions: ZenmoneyTransaction[] = [];
    const budgets: ZenmoneyBudget[] = [];

    // Trigger sync_data tool if available
    try {
      await mcpClient.callTool('sync_data');
    } catch {
      // sync_data might not be required if server already synchronized
    }

    // Fetch accounts
    try {
      const rawAccounts = (await mcpClient.callTool('list_accounts')) as { content?: Array<{ text?: string }> };
      const parsed = this.parseMcpContent(rawAccounts);
      if (Array.isArray(parsed)) {
        accounts.push(...parsed);
      }
    } catch (e) {
      console.warn('list_accounts tool call failed:', e);
    }

    // Fetch transactions
    try {
      const rawTx = (await mcpClient.callTool('list_transactions', { limit: 100 })) as { content?: Array<{ text?: string }> };
      const parsed = this.parseMcpContent(rawTx);
      if (Array.isArray(parsed)) {
        transactions.push(...parsed);
      }
    } catch (e) {
      console.warn('list_transactions tool call failed:', e);
    }

    // Fetch budgets
    try {
      const rawBudgets = (await mcpClient.callTool('list_budgets')) as { content?: Array<{ text?: string }> };
      const parsed = this.parseMcpContent(rawBudgets);
      if (Array.isArray(parsed)) {
        budgets.push(...parsed);
      }
    } catch {
      // Budgets are optional
    }

    return { accounts, transactions, budgets };
  }

  private parseMcpContent(result: { content?: Array<{ text?: string }> }): unknown {
    if (!result?.content || !Array.isArray(result.content)) {
      return result;
    }
    const textPart = result.content.find((part) => typeof part.text === 'string');
    if (!textPart?.text) {
      return [];
    }
    try {
      return JSON.parse(textPart.text);
    } catch {
      return textPart.text;
    }
  }
}

export const financeController = new FinanceController();
