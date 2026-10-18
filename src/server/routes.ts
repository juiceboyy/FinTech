import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { mcpClient } from '../mcp/client.js';
import { authManager } from '../mcp/oauth.js';
import { financeController } from '../engine/financeController.js';
import { geminiService, GEMINI_MODEL } from '../ai/geminiClient.js';
import { reportStorage } from '../ai/reportStorage.js';
import { cronService } from '../scheduler/cronService.js';
import { importRouter } from './importRoutes.js';
import { advisorRouter } from './advisorRoutes.js';

export const apiRouter = Router();

// ING Credit Card CSV Importer Routes
apiRouter.use('/import', importRouter);

// AI Financial Coach, Savings Plan & Daily Morning Email Routes
apiRouter.use('/advisor', advisorRouter);

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

const StoredReportSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  periodDays: z.number(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  netCashFlow: z.number(),
  savingsRatePercentage: z.number(),
  markdownContent: z.string().min(1),
  sourceMode: z.literal('live'),
  generatedBy: z.string().min(1),
});

const ReconcileReportsSchema = z.object({
  reports: z.array(StoredReportSchema),
});

// Reports Endpoints
apiRouter.get('/reports', async (_req: Request, res: Response) => {
  try {
    const reports = await reportStorage.listReports();
    res.json(reports);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

apiRouter.get('/reports/latest', async (_req: Request, res: Response) => {
  try {
    const latest = await reportStorage.getLatestReport();
    if (!latest) {
      res.status(404).json({ error: 'No reports generated yet.' });
      return;
    }
    res.json(latest);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

apiRouter.get('/reports/:id', async (req: Request, res: Response) => {
  try {
    const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const report = await reportStorage.getReportById(paramId);
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json(report);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Reconcile and Sync Client Cached Reports with Server
apiRouter.post('/reports/reconcile', async (req: Request, res: Response) => {
  try {
    const parseResult = ReconcileReportsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid reports payload', details: parseResult.error.format() });
      return;
    }
    const consolidated = await reportStorage.reconcileReports(parseResult.data.reports);
    res.json({ success: true, count: parseResult.data.reports.length, reports: consolidated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
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

