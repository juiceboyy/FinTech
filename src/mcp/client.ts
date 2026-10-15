import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { authManager } from './oauth.js';
import type { McpClientStatus } from './types.js';

export class ZenmoneyMcpClient {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private endpoint: string;
  private isConnected = false;
  private lastSyncAt: string | null = null;
  private lastError?: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || process.env.ZENMONEY_MCP_URL || 'https://api.zenmoney.app/mcp';
  }

  public async connect(): Promise<boolean> {
    const token = authManager.getAccessToken();
    if (!token) {
      this.lastError = 'No access token found in environment or session file.';
      this.isConnected = false;
      return false;
    }

    try {
      this.client = new Client(
        {
          name: 'zenmoney-fintech-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      };

      this.transport = new SSEClientTransport(new URL(this.endpoint), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        eventSourceInit: {
          fetch: (url, init) => {
            return fetch(url, {
              ...init,
              headers: {
                ...(init?.headers || {}),
                ...headers,
              },
            });
          },
        },
      });

      await this.client.connect(this.transport);
      this.isConnected = true;
      this.lastError = undefined;
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.isConnected = false;
      console.warn(`Zenmoney MCP connection warning: ${msg}`);
      return false;
    }
  }

  public async listTools(): Promise<Array<{ name: string; description?: string }>> {
    if (!this.client || !this.isConnected) {
      return [];
    }
    try {
      const result = await this.client.listTools();
      return result.tools || [];
    } catch (err) {
      console.error('Error listing remote MCP tools:', err);
      return [];
    }
  }

  public async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw new Error('MCP client is not connected to remote Zenmoney endpoint');
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
      endpoint: this.endpoint,
      mode: this.isConnected ? 'live' : 'mock',
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
        // ignore close error
      }
    }
    this.client = null;
    this.transport = null;
    this.isConnected = false;
  }
}

export const mcpClient = new ZenmoneyMcpClient();
