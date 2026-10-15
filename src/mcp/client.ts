import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { authManager } from './oauth.js';
import { v8SyncService } from './v8Api.js';
import { v8Mutations } from './v8Mutations.js';
import type {
  AddExpenseInput,
  AddIncomeInput,
  McpClientStatus,
  MutationResult,
  ZenmoneyCategory,
  ZenmoneyCategorySuggestion,
  ZenmoneySyncData,
} from './types.js';

export class ZenmoneyMcpClient {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private endpoint: string;
  private isConnected = false;
  private isV8Direct = false;
  private lastSyncAt: string | null = null;
  private lastError?: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || process.env.ZENMONEY_MCP_URL || 'https://api.zenmoney.app/mcp';
  }

  public async connect(): Promise<boolean> {
    const token = authManager.getAccessToken();
    if (!token) {
      this.lastError = 'No access token found in environment or session.';
      this.isConnected = false;
      return false;
    }

    // Step 1: Probe Zenmoney API v8 directly (validates zerro.app/token tokens)
    const v8Valid = await v8SyncService.probeToken(token);
    if (v8Valid) {
      this.isConnected = true;
      this.isV8Direct = true;
      this.lastError = undefined;
      this.lastSyncAt = new Date().toISOString();
      return true;
    }

    // Step 2: Fall back to remote MCP SSE transport (for OAuth-minted tokens)
    try {
      this.client = new Client(
        { name: 'zenmoney-fintech-client', version: '1.0.0' },
        { capabilities: {} }
      );

      this.transport = new SSEClientTransport(new URL(this.endpoint), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });

      await this.client.connect(this.transport);
      this.isConnected = true;
      this.isV8Direct = false;
      this.lastError = undefined;
      this.lastSyncAt = new Date().toISOString();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = `Zenmoney authentication failed: ${msg}. Please ensure your token from zerro.app/token is valid and active.`;
      this.isConnected = false;
      return false;
    }
  }

  public async getSyncData(): Promise<ZenmoneySyncData | null> {
    const token = authManager.getAccessToken();
    if (this.isV8Direct && token) {
      const data = await v8SyncService.fetchSyncData(token);
      this.lastSyncAt = new Date().toISOString();
      return data;
    }
    return null;
  }

  public async suggestCategories(
    payees: string[],
    categories: ZenmoneyCategory[]
  ): Promise<Map<string, ZenmoneyCategorySuggestion>> {
    const token = authManager.getAccessToken();
    if (this.isV8Direct && token) {
      return v8Mutations.suggestCategories(token, payees, categories);
    }

    const map = new Map<string, ZenmoneyCategorySuggestion>();
    if (!this.client || !this.isConnected) {
      return map;
    }

    for (const payee of new Set(payees.map((p) => p.trim()).filter(Boolean))) {
      try {
        const res = (await this.callTool('suggest_category', { payee })) as {
          content?: Array<{ text?: string }>;
        };
        const text = res?.content?.[0]?.text || '';
        const idMatch = text.match(/`([0-9a-f-]{36})`/i);
        const cat = idMatch ? categories.find((c) => c.id === idMatch[1]) : undefined;
        map.set(payee, {
          payee,
          categoryId: cat?.id,
          categoryTitle: cat?.title,
        });
      } catch {
        // Ignore individual suggest failures
      }
    }
    return map;
  }

  public async addExpense(
    syncContext: ZenmoneySyncData,
    input: AddExpenseInput
  ): Promise<MutationResult> {
    const token = authManager.getAccessToken();
    if (this.isV8Direct && token) {
      const result = await v8Mutations.addExpense(token, syncContext, input);
      this.lastSyncAt = new Date().toISOString();
      return result;
    }

    const amountNum = new Decimal(input.amount).toDecimalPlaces(2).toNumber();
    await this.callTool('add_expense', {
      account: input.accountId,
      amount: amountNum,
      date: input.date,
      category: input.categoryId,
      payee: input.payee,
      comment: input.comment,
    });
    return { id: randomUUID() };
  }

  public async addIncome(
    syncContext: ZenmoneySyncData,
    input: AddIncomeInput
  ): Promise<MutationResult> {
    const token = authManager.getAccessToken();
    if (this.isV8Direct && token) {
      const result = await v8Mutations.addIncome(token, syncContext, input);
      this.lastSyncAt = new Date().toISOString();
      return result;
    }

    const amountNum = new Decimal(input.amount).toDecimalPlaces(2).toNumber();
    await this.callTool('add_income', {
      account: input.accountId,
      amount: amountNum,
      date: input.date,
      category: input.categoryId,
      payee: input.payee,
      comment: input.comment,
    });
    return { id: randomUUID() };
  }

  public isDirectMode(): boolean {
    return this.isV8Direct;
  }

  public async listTools(): Promise<Array<{ name: string; description?: string }>> {
    if (!this.client || !this.isConnected || this.isV8Direct) {
      return [];
    }
    try {
      const result = await this.client.listTools();
      return result.tools || [];
    } catch {
      return [];
    }
  }

  public async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw new Error('MCP client is not connected');
    }
    const response = await this.client.callTool({
      name,
      arguments: args,
    });
    this.lastSyncAt = new Date().toISOString();
    return response;
  }

  public getStatus(): McpClientStatus {
    const token = authManager.getAccessToken();
    return {
      connected: this.isConnected,
      endpoint: this.isV8Direct ? 'https://api.zenmoney.app/v8/diff/ (Zenmoney Live)' : this.endpoint,
      mode: this.isConnected ? 'live' : 'disconnected',
      authenticated: Boolean(token),
      lastSyncAt: this.lastSyncAt,
      error: this.lastError,
    };
  }

  public async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // ignore
      }
    }
    this.client = null;
    this.transport = null;
    this.isConnected = false;
    this.isV8Direct = false;
  }
}

export const mcpClient = new ZenmoneyMcpClient();

