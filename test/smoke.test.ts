import assert from 'node:assert';
import test from 'node:test';
import { FinancialDataNormalizer } from '../src/engine/dataNormalizer.js';
import { generateMockFinancialData } from '../src/engine/mockData.js';
import { financeController } from '../src/engine/financeController.js';
import { healthCheckAnalyzer } from '../src/ai/healthCheckAnalyzer.js';
import { reportStorage } from '../src/ai/reportStorage.js';
import { createApp } from '../src/server/app.js';

test('FinancialDataNormalizer calculates accurate net cash flow and savings rate', () => {
  const mock = generateMockFinancialData();
  const summary = FinancialDataNormalizer.normalize({
    accounts: mock.accounts,
    transactions: mock.transactions,
    budgets: mock.budgets,
    periodDays: 15,
  });

  assert.ok(summary.totalIncome > 0, 'Total income should be positive');
  assert.ok(summary.totalExpenses > 0, 'Total expenses should be positive');
  assert.strictEqual(
    summary.netCashFlow,
    Number((summary.totalIncome - summary.totalExpenses).toFixed(2)),
    'Net cash flow should match income minus expenses'
  );
  assert.ok(summary.categoryBreakdown.length > 0, 'Category breakdown should be populated');
  assert.ok(summary.topAnomalies.length > 0, 'Anomalies should be detected for large expenditures');
});

test('FinanceController delivers normalized 15-day financial summary in mock mode', async () => {
  const summary = await financeController.getFinancialSummary(15);
  assert.strictEqual(summary.periodDays, 15);
  assert.ok(summary.accounts.length >= 3, 'Should contain accounts');
  assert.strictEqual(summary.sourceMode, 'mock');
});

test('HealthCheckAnalyzer generates structured report and persists it to storage', async () => {
  const summary = await financeController.getFinancialSummary(15);
  const report = await healthCheckAnalyzer.analyzeAndSave(summary);

  assert.ok(report.id.startsWith('report-'), 'Report ID must have report- prefix');
  assert.ok(report.markdownContent.includes('### Executive Cash Flow Assessment'), 'Must contain executive section');
  assert.ok(report.markdownContent.includes('### Savings Rate & Liquidity Benchmark'), 'Must contain savings benchmark');

  const retrieved = reportStorage.getReportById(report.id);
  assert.ok(retrieved !== null, 'Report should be retrievable from disk');
  assert.strictEqual(retrieved?.id, report.id);
});

test('Express application factory instantiates properly', () => {
  const app = createApp();
  assert.ok(typeof app.listen === 'function', 'App should have listen method');
});
