import assert from 'node:assert';
import test from 'node:test';
import { Decimal } from 'decimal.js';
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

  assert.ok(new Decimal(summary.totalIncome).greaterThan(0), 'Total income should be positive');
  assert.ok(new Decimal(summary.totalExpenses).greaterThan(0), 'Total expenses should be positive');
  assert.strictEqual(
    summary.netCashFlow,
    new Decimal(summary.totalIncome).minus(summary.totalExpenses).toDecimalPlaces(2).toNumber(),
    'Net cash flow should match income minus expenses'
  );
  assert.ok(summary.categoryBreakdown.length > 0, 'Category breakdown should be populated');
  assert.ok(summary.topAnomalies.length > 0, 'Anomalies should be detected for large expenditures');
});

test('FinancialDataNormalizer excludes internal savings transfers from expenses and anomalies', () => {
  const today = new Date().toISOString().split('T')[0];
  const summary = FinancialDataNormalizer.normalize({
    accounts: [
      { id: 'acc-prive', title: 'Privé', type: 'checking', balance: 461.8, currency: 'EUR' },
      { id: 'acc-buffer', title: 'Buffer', type: 'checking', balance: 1901.82, currency: 'EUR' },
    ],
    transactions: [
      {
        id: 'tx-salary',
        date: today,
        income: 2000,
        outcome: 0,
        incomeAccount: 'acc-prive',
        category: 'Salary',
        categoryTitle: 'Salary',
        payee: 'Employer BV',
        currency: 'EUR',
      },
      {
        id: 'tx-savings-transfer',
        date: today,
        income: 1000,
        outcome: 1000,
        outcomeAccount: 'acc-prive',
        incomeAccount: 'acc-buffer',
        categoryTitle: 'General',
        payee: 'Transaction',
        currency: 'EUR',
      },
    ],
    budgets: [],
    periodDays: 15,
  });

  assert.strictEqual(summary.totalIncome, 2000, 'Transfer must not inflate totalIncome');
  assert.strictEqual(summary.totalExpenses, 0, 'Transfer must not be counted as an expense');
  assert.strictEqual(summary.topAnomalies.length, 0, 'Transfer must not be flagged as an anomaly');
  assert.strictEqual(summary.internalTransfers.length, 1, 'Transfer should be recorded in internalTransfers');
  assert.strictEqual(summary.savingsTransfersTotal, 1000, 'Transfer to Buffer should count as savings allocation');
  assert.strictEqual(summary.internalTransfers[0].fromAccount, 'Privé');
  assert.strictEqual(summary.internalTransfers[0].toAccount, 'Buffer');
  assert.strictEqual(summary.internalTransfers[0].isSavingsAllocation, true);
});

test('FinanceController enforces live Zenmoney connection requirement', async () => {
  await assert.rejects(
    async () => {
      await financeController.getFinancialSummary(15);
    },
    /Zenmoney MCP is disconnected|No access token found/,
    'Should reject when MCP is disconnected and no token is present'
  );
});

test('HealthCheckAnalyzer generates structured report and persists it to storage', async () => {
  const mock = generateMockFinancialData();
  const summary = FinancialDataNormalizer.normalize({
    accounts: mock.accounts,
    transactions: mock.transactions,
    budgets: mock.budgets,
    periodDays: 15,
  });
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
