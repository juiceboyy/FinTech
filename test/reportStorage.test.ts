import assert from 'node:assert';
import test from 'node:test';
import { reportStorage, type StoredReport } from '../src/ai/reportStorage.js';
import { blobsAdapter } from '../src/ai/blobsStorage.js';
import { createApp } from '../src/server/app.js';
import type { NormalizedFinancialSummary } from '../src/engine/types.js';

test('ReportStorage saves, retrieves, and lists reports with multi-tier fallback', async () => {
  const dummySummary: NormalizedFinancialSummary = {
    periodDays: 15,
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    totalIncome: 3500,
    totalExpenses: 2100,
    netCashFlow: 1400,
    savingsRatePercentage: 40.0,
    totalLiquidBalance: 8200,
    transactionsCount: 24,
    categoryBreakdown: [],
    topAnomalies: [],
    accounts: [],
    sourceMode: 'live',
  };

  const report = await reportStorage.saveReport({
    summary: dummySummary,
    markdownContent: '### Executive Cash Flow Assessment\nSolid performance.',
    generatedBy: 'test-suite',
  });

  assert.ok(report.id.startsWith('report-'), 'Report ID should start with report-');
  assert.strictEqual(report.netCashFlow, 1400);

  // Retrieve by ID
  const retrieved = await reportStorage.getReportById(report.id);
  assert.ok(retrieved !== null, 'Report should be retrievable');
  assert.strictEqual(retrieved?.id, report.id);
  assert.ok(retrieved?.markdownContent.includes('Executive Cash Flow Assessment'));

  // Retrieve latest
  const latest = await reportStorage.getLatestReport();
  assert.ok(latest !== null, 'Latest report should exist');
  assert.strictEqual(latest?.id, report.id);

  // List reports
  const list = await reportStorage.listReports();
  assert.ok(list.length > 0, 'Report list should not be empty');
  const found = list.find((r) => r.id === report.id);
  assert.ok(found !== undefined, 'Report should appear in listing');
  assert.strictEqual((found as any).markdownContent, undefined, 'Listing should omit heavy markdown content');
});

test('ReportStorage.reconcileReports merges client cached reports without duplicates', async () => {
  const pastReport: StoredReport = {
    id: `report-client-reconciled-${Date.now()}`,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    periodDays: 15,
    startDate: '2026-09-15',
    endDate: '2026-09-30',
    totalIncome: 3000,
    totalExpenses: 2000,
    netCashFlow: 1000,
    savingsRatePercentage: 33.3,
    markdownContent: '### Executive Cash Flow Assessment\nClient side archive.',
    sourceMode: 'live',
    generatedBy: 'client-offline-cache',
  };

  const updatedList = await reportStorage.reconcileReports([pastReport]);
  const found = updatedList.find((r) => r.id === pastReport.id);
  assert.ok(found !== undefined, 'Reconciled report should now be listed');

  const retrieved = await reportStorage.getReportById(pastReport.id);
  assert.ok(retrieved !== null, 'Reconciled report content should be available');
  assert.strictEqual(retrieved?.id, pastReport.id);
});

test('Express /api/reports/reconcile route validates schema and persists client reports', async () => {
  const app = createApp();

  const validReport: StoredReport = {
    id: `report-api-reconcile-${Date.now()}`,
    createdAt: new Date().toISOString(),
    periodDays: 15,
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    totalIncome: 4000,
    totalExpenses: 2500,
    netCashFlow: 1500,
    savingsRatePercentage: 37.5,
    markdownContent: '### Reconciled via API',
    sourceMode: 'live',
    generatedBy: 'api-test',
  };

  // Mock serverless request handler
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    // 1. Valid payload
    const res = await fetch(`http://127.0.0.1:${port}/api/reports/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reports: [validReport] }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.count, 1);

    // 2. Invalid payload (missing markdownContent)
    const invalidRes = await fetch(`http://127.0.0.1:${port}/api/reports/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reports: [{ id: 'bad' }] }),
    });
    assert.strictEqual(invalidRes.status, 400);
  } finally {
    server.close();
  }
});
