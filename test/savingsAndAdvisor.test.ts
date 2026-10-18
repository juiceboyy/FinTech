import assert from 'node:assert';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { SavingsPlanner } from '../src/engine/savingsPlanner.js';
import { FinancialDataNormalizer } from '../src/engine/dataNormalizer.js';
import { PromptContextBuilder } from '../src/ai/promptContextBuilder.js';
import { financialChatService } from '../src/ai/financialChatService.js';
import { morningDigestService } from '../src/ai/morningDigestService.js';
import { generateMockFinancialData } from '../src/engine/mockData.js';
import { normalizeZenmoneyBudgets } from '../src/mcp/v8BudgetNormalizer.js';

test('SavingsPlanner computes daily, weekly, and rest-of-month goals and recommends Zenmoney budgets', () => {
  const today = '2026-10-18';
  const plan = SavingsPlanner.computeSavingsPlan({
    referenceDate: today,
    accounts: [
      { id: 'acc-1', title: 'Betaalrekening', type: 'checking', balance: 1500, currency: 'EUR' },
      { id: 'acc-2', title: 'Spaarbuffer', type: 'deposit', balance: 5000, currency: 'EUR' },
    ],
    transactions: [
      {
        id: 't1',
        date: '2026-10-02',
        income: 3200,
        outcome: 0,
        incomeAccount: 'acc-1',
        categoryTitle: 'Salary',
        payee: 'Werkgever',
        currency: 'EUR',
      },
      {
        id: 't2',
        date: '2026-10-05',
        income: 0,
        outcome: 240,
        outcomeAccount: 'acc-1',
        categoryTitle: 'Dining & Cafes',
        payee: 'Matcha & Coffee Bar',
        currency: 'EUR',
      },
      {
        id: 't3',
        date: '2026-10-12',
        income: 0,
        outcome: 400,
        outcomeAccount: 'acc-1',
        categoryTitle: 'Groceries',
        payee: 'Albert Heijn',
        currency: 'EUR',
      },
    ],
    budgets: [
      {
        id: 'b1',
        date: '2026-10-01',
        category: 'Groceries',
        categoryTitle: 'Groceries',
        budgetedOutcome: 550,
      },
    ],
  });

  assert.strictEqual(plan.daysInMonth, 31);
  assert.strictEqual(plan.daysElapsedInMonth, 18);
  assert.strictEqual(plan.daysRemainingInMonth, 14);
  assert.strictEqual(plan.monthlyIncomeToDate, 3200);
  assert.strictEqual(plan.monthlyExpensesToDate, 640);

  const diningPlan = plan.categoryPlans.find((c) => c.category === 'Dining & Cafes');
  assert.ok(diningPlan, 'Should include Dining & Cafes category plan');
  assert.strictEqual(diningPlan.isLifestyleLeak, true, 'Dining & Cafes must be detected as a lifestyle leak');
  assert.strictEqual(diningPlan.needsNewZenmoneyGoal, true, 'Unbudgeted lifestyle leak must recommend a new Zenmoney goal');
  assert.strictEqual(
    diningPlan.recommendedMonthlyBudget,
    new Decimal(240).times('0.65').toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
  );
  assert.ok(new Decimal(diningPlan.potentialDailySavings).greaterThan(0), 'Must calculate positive daily savings for lifestyle leak');

  const groceriesPlan = plan.categoryPlans.find((c) => c.category === 'Groceries');
  assert.ok(groceriesPlan, 'Should include Groceries category plan');
  assert.strictEqual(groceriesPlan.zenmoneyBudget, 550, 'Must match configured Zenmoney budget');
  assert.strictEqual(groceriesPlan.remainingMonthAllowance, 150, '550 budget minus 400 spent = 150 remaining');
});

test('SavingsPlanner never starves Groceries to EUR 0/day when Eating out is frozen and Groceries budget is exceeded', () => {
  const plan = SavingsPlanner.computeSavingsPlan({
    referenceDate: '2026-10-18',
    accounts: [{ id: 'acc-1', title: 'Privé', type: 'checking', balance: 461.13, currency: 'EUR' }],
    transactions: [
      {
        id: 'tx-eo',
        date: '2026-10-10',
        income: 0,
        outcome: 328.93,
        outcomeAccount: 'acc-1',
        categoryTitle: 'Eating out',
        payee: 'Restaurants',
        currency: 'EUR',
      },
      {
        id: 'tx-gr',
        date: '2026-10-12',
        income: 0,
        outcome: 240.68,
        outcomeAccount: 'acc-1',
        categoryTitle: 'Groceries',
        payee: 'Albert Heijn',
        currency: 'EUR',
      },
    ],
    budgets: [
      { id: 'b-eo', date: '2026-10-01', category: 'Eating out', categoryTitle: 'Eating out', budgetedOutcome: 153 },
      { id: 'b-gr', date: '2026-10-01', category: 'Groceries', categoryTitle: 'Groceries', budgetedOutcome: 200 },
    ],
  });

  const eatingOut = plan.categoryPlans.find((c) => c.category === 'Eating out');
  const groceries = plan.categoryPlans.find((c) => c.category === 'Groceries');
  assert.ok(eatingOut && groceries);
  assert.strictEqual(eatingOut.dailyAllowanceRestOfMonth, 0, 'Eating out must be frozen at EUR 0/day');
  assert.ok(
    new Decimal(groceries.dailyAllowanceRestOfMonth).greaterThanOrEqualTo('8.50'),
    'Groceries must retain a realistic daily home-cooking allowance (>= EUR 8.50/day)'
  );
  assert.ok(
    new Decimal(groceries.weeklyAllowance).greaterThanOrEqualTo('59.50'),
    'Groceries must retain a realistic weekly home-cooking allowance'
  );
});

test('PromptContextBuilder includes all financial data, transactions, and category savings goals', () => {
  const mock = generateMockFinancialData();
  const summary = FinancialDataNormalizer.normalize({
    accounts: mock.accounts,
    transactions: mock.transactions,
    plannedTransactions: mock.plannedTransactions,
    budgets: mock.budgets,
    periodDays: 15,
  });
  const savingsPlan = SavingsPlanner.computeSavingsPlan({
    accounts: mock.accounts,
    transactions: mock.transactions,
    budgets: mock.budgets,
  });

  const contextStr = PromptContextBuilder.buildFullFinancialContext({
    summary,
    savingsPlan,
    allRecentTransactions: mock.transactions,
  });

  assert.ok(contextStr.includes('1. REKENINGEN & LIQUIDE VERMOGEN'), 'Must include accounts section');
  assert.ok(contextStr.includes('3. CONCRETE SPAARDOELEN: VANDAAG, DEZE WEEK & REST VAN DE MAAND'), 'Must include daily/weekly/monthly goals');
  assert.ok(contextStr.includes('4. SPAARPLAN PER EXPENSE CATEGORIE & AANBEVOLEN ZENMONEY BUDGETTEN'), 'Must include category savings plans');
  assert.ok(contextStr.includes('7. ALLE RECENTE TRANSACTIES'), 'Must include recent transactions in prompt');
});

test('FinancialChatService and MorningDigestService generate savings-focused responses without emojis or em-dashes', async () => {
  const mock = generateMockFinancialData();
  const summary = FinancialDataNormalizer.normalize({
    accounts: mock.accounts,
    transactions: mock.transactions,
    plannedTransactions: mock.plannedTransactions,
    budgets: mock.budgets,
    periodDays: 15,
  });
  const savingsPlan = SavingsPlanner.computeSavingsPlan({
    accounts: mock.accounts,
    transactions: mock.transactions,
    budgets: mock.budgets,
  });
  const dataset = {
    summary,
    savingsPlan,
    allRecentTransactions: mock.transactions,
  };

  const chatRes = await financialChatService.chatWithAdvisor({
    message: 'Hoeveel kan ik per dag besparen en op welk soort uitgave?',
    history: [],
    dataset,
  });

  assert.ok(chatRes.reply.length > 50, 'Chat reply should be non-empty');
  assert.ok(!chatRes.reply.includes('—'), 'Chat reply must never contain em-dashes');
  assert.ok(chatRes.reply.includes('per dag') || chatRes.reply.includes('/dag'), 'Chat reply must emphasize daily savings');

  const digest = await morningDigestService.generateAndSendDigest(dataset, { skipEmail: true });
  assert.ok(digest.markdownContent.includes('Doelen voor Vandaag'), 'Morning digest must include today goals');
  assert.ok(digest.markdownContent.includes('Doelen Verspreid over Deze Week'), 'Morning digest must include weekly goals');
  assert.ok(digest.markdownContent.includes('Rest van de Maand'), 'Morning digest must include rest-of-month goals');
  assert.ok(!digest.markdownContent.includes('—'), 'Morning digest must never contain em-dashes');
});

test('normalizeZenmoneyBudgets reconstructs full EUR 1500 Auto budget by adding monthly reminderMarker outflows to budget.outcome', () => {
  const autoTag = 'c70f553b-c30c-4626-ac82-b89ae6019cdc';
  const travelTag = '4d20be9f-dbfc-4556-8c46-38a771a4ac09';
  const tagMap = new Map<string, string>([
    [autoTag, 'Auto'],
    [travelTag, 'Travel'],
  ]);

  const budgets = normalizeZenmoneyBudgets({
    rawBudgets: [
      { date: '2026-10-01', tag: autoTag, outcome: 398.01 },
      { date: '2026-10-01', tag: travelTag, outcome: 0 },
      { date: '2025-10-01', tag: travelTag, outcome: 173 },
    ],
    rawReminderMarkers: [
      {
        id: 'm1',
        date: '2026-10-02',
        income: 0,
        outcome: 1100,
        state: 'processed',
        tag: [autoTag],
      },
      {
        id: 'm2',
        date: '2026-10-08',
        income: 0,
        outcome: 1.99,
        state: 'planned',
        tag: [autoTag],
      },
    ],
    reminderMap: new Map(),
    tagMap,
  });

  const octAuto = budgets.find((b) => b.date === '2026-10-01' && b.categoryTitle === 'Auto');
  assert.ok(octAuto, 'Should include October Auto budget');
  assert.strictEqual(octAuto.budgetedOutcome, 1500, '398.01 + 1100.00 + 1.99 must equal 1500.00');

  const plan = SavingsPlanner.computeSavingsPlan({
    referenceDate: '2026-10-18',
    accounts: [{ id: 'a1', title: 'Checking', type: 'checking', balance: 2000, currency: 'EUR' }],
    transactions: [
      {
        id: 'tx-auto',
        date: '2026-10-10',
        income: 0,
        outcome: 1445.9,
        outcomeAccount: 'a1',
        categoryTitle: 'Auto',
        payee: 'Lease & Fuel',
        currency: 'EUR',
      },
    ],
    budgets,
  });

  const autoPlan = plan.categoryPlans.find((c) => c.category === 'Auto');
  assert.ok(autoPlan);
  assert.strictEqual(autoPlan.zenmoneyBudget, 1500);
  assert.strictEqual(autoPlan.remainingMonthAllowance, 54.1);

  const travelPlan = plan.categoryPlans.find((c) => c.category === 'Travel');
  assert.strictEqual(travelPlan, undefined, 'Stale 2025 Travel budget must not leak into October 2026 when October Travel budget is 0');
});

