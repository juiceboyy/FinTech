import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { OAuthTokens } from './types.js';

const SESSION_FILE = path.resolve(process.cwd(), '.zenmoney-session.json');

export class ZenmoneyAuthManager {
  private activeCodeVerifier: string | null = null;

  public getAccessToken(): string | null {
    if (process.env.ZENMONEY_TOKEN && process.env.ZENMONEY_TOKEN.trim().length > 0) {
      return process.env.ZENMONEY_TOKEN.trim();
    }

    try {
      if (fs.existsSync(SESSION_FILE)) {
        const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
        const session: OAuthTokens = JSON.parse(raw);
        if (session.accessToken) {
          return session.accessToken;
        }
      }
    } catch (err) {
      console.warn('Could not read stored Zenmoney session:', err);
    }

    return null;
  }

  public saveTokens(tokens: { accessToken: string; refreshToken?: string; expiresIn?: number }): void {
    const payload: OAuthTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
      savedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write Zenmoney session file:', err);
    }
  }

  public createAuthorizationUrl(options?: {
    clientId?: string;
    redirectUri?: string;
  }): { url: string; codeVerifier: string } {
    const clientId = options?.clientId || process.env.ZENMONEY_CLIENT_ID || 'fintech-app';
    const redirectUri = options?.redirectUri || process.env.ZENMONEY_REDIRECT_URI || 'http://localhost:3000/oauth/callback';

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    this.activeCodeVerifier = codeVerifier;

    const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const authUrl = new URL('https://api.zenmoney.app/oauth2/authorize/');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'all');
    authUrl.searchParams.set('code_challenge', hash);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return {
      url: authUrl.toString(),
      codeVerifier,
    };
  }

  public async exchangeCodeForToken(params: {
    code: string;
    codeVerifier?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  }): Promise<string> {
    const verifier = params.codeVerifier || this.activeCodeVerifier;
    const clientId = params.clientId || process.env.ZENMONEY_CLIENT_ID || 'fintech-app';
    const clientSecret = params.clientSecret || process.env.ZENMONEY_CLIENT_SECRET;
    const redirectUri = params.redirectUri || process.env.ZENMONEY_REDIRECT_URI || 'http://localhost:3000/oauth/callback';

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirectUri,
      client_id: clientId,
    });

    if (verifier) {
      body.set('code_verifier', verifier);
    }
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const response = await fetch('https://api.zenmoney.app/oauth2/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token exchange failed with status ${response.status}: ${errText}`);
    }

    const json = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    this.saveTokens({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    });

    return json.access_token;
  }
}

export const authManager = new ZenmoneyAuthManager();
