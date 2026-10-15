import { Router, type Request, type Response } from 'express';
import { mcpClient } from '../mcp/client.js';
import { authManager } from '../mcp/oauth.js';
import { financeController } from '../engine/financeController.js';
import { geminiService, GEMINI_MODEL } from '../ai/geminiClient.js';
import { reportStorage } from '../ai/reportStorage.js';
import { cronService } from '../scheduler/cronService.js';

export const apiRouter = Router();

// System Status
apiRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    mcp: mcpClient.getStatus(),
    cron: cronService.getStatus(),
    gemini: {
      available: geminiService.isAvailable(),
      model: GEMINI_MODEL,
    },
    systemTime: new Date().toISOString(),
  });
});

// Normalized 15-Day Financial Data
apiRouter.get('/financial-summary', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 15;
    const summary = await financeController.getFinancialSummary(days);
    res.json(summary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Reports Endpoints
apiRouter.get('/reports', (_req: Request, res: Response) => {
  res.json(reportStorage.listReports());
});

apiRouter.get('/reports/latest', (_req: Request, res: Response) => {
  const latest = reportStorage.getLatestReport();
  if (!latest) {
    res.status(404).json({ error: 'No reports generated yet.' });
    return;
  }
  res.json(latest);
});

apiRouter.get('/reports/:id', (req: Request, res: Response) => {
  const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const report = reportStorage.getReportById(paramId);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json(report);
});

// On-demand Trigger
apiRouter.post('/trigger-analysis', async (_req: Request, res: Response) => {
  try {
    const report = await cronService.runRoutine();
    res.json({ success: true, report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// OAuth 2.0 PKCE Handshake Routes
apiRouter.get('/auth/login', (_req: Request, res: Response) => {
  const { url } = authManager.createAuthorizationUrl();
  res.redirect(url);
});

apiRouter.get('/auth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('Authorization code missing in callback.');
    return;
  }

  try {
    await authManager.exchangeCodeForToken({ code });
    await mcpClient.connect();
    res.redirect('/?auth=success');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`OAuth token exchange error: ${msg}`);
  }
});

// Direct Token Configuration Endpoint
apiRouter.post('/set-token', async (req: Request, res: Response) => {
  const token = req.body?.token as string;
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    res.status(400).json({ error: 'Token string is required' });
    return;
  }
  authManager.saveTokens({ accessToken: token.trim() });
  const connected = await mcpClient.connect();
  res.json({
    success: true,
    connected,
    status: mcpClient.getStatus(),
  });
});

