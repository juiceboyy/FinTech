import { mcpClient } from '../mcp/client.js';
import { FinancialDataNormalizer } from './dataNormalizer.js';
import type { NormalizedFinancialSummary } from './types.js';
import type { ZenmoneyAccount, ZenmoneyTransaction, ZenmoneyBudget } from '../mcp/types.js';

export class FinanceController {
  public async getFinancialSummary(periodDays = 15): Promise<NormalizedFinancialSummary> {
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

    const liveData = await this.fetchRemoteMcpData();
    return FinancialDataNormalizer.normalize({
      accounts: liveData.accounts,
      transactions: liveData.transactions,
      budgets: liveData.budgets,
      periodDays,
      sourceMode: 'live',
    });
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
