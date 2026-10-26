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
import { v8Mutations } from '../src/mcp/v8Mutations.js';
import { createApp } from '../src/server/app.js';
import { financeController } from '../src/engine/financeController.js';

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

test('SavingsPlanner resolves and attaches categoryId from categories, budgets, and transactions', () => {
  const plan = SavingsPlanner.computeSavingsPlan({
    referenceDate: '2026-10-18',
    accounts: [{ id: 'acc-1', title: 'Betaal', type: 'checking', balance: 1000, currency: 'EUR' }],
    categories: [
      { id: 'cat-dining-uuid', title: 'Dining & Cafes' },
      { id: 'cat-groceries-uuid', title: 'Groceries' },
    ],
    transactions: [
      {
        id: 't1',
        date: '2026-10-05',
        income: 0,
        outcome: 120,
        outcomeAccount: 'acc-1',
        category: 'cat-dining-uuid',
        categoryTitle: 'Dining & Cafes',
        payee: 'Cafe',
        currency: 'EUR',
      },
    ],
    budgets: [
      {
        id: 'b1',
        date: '2026-10-01',
        category: 'cat-groceries-uuid',
        categoryTitle: 'Groceries',
        budgetedOutcome: 500,
      },
    ],
  });

  const dining = plan.categoryPlans.find((c) => c.category === 'Dining & Cafes');
  assert.ok(dining);
  assert.strictEqual(dining.categoryId, 'cat-dining-uuid');

  const groceries = plan.categoryPlans.find((c) => c.category === 'Groceries');
  assert.ok(groceries);
  assert.strictEqual(groceries.categoryId, 'cat-groceries-uuid');
});

test('ZenmoneyV8MutationService.writeBudgetsBatch formats diff payload with Decimal precision, subtracts planned reminderMarkers, and locks outcome', async () => {
  const originalFetch = global.fetch;
  let capturedBody: any = null;

  global.fetch = (async (_url: any, options: any) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        serverTimestamp: 1729000000,
      }),
    };
  }) as any;

  try {
    const syncContext: any = {
      userId: 42,
      serverTimestamp: 1728900000,
      accounts: [],
      transactions: [],
      budgets: [],
      plannedTransactions: [
        {
          id: 'rm-1',
          date: '2026-10-25',
          income: 0,
          outcome: 150,
          category: 'cat-groceries-uuid',
          state: 'planned',
          isTransfer: false,
          payee: 'Pre-order AH',
          currency: 'EUR',
        },
      ],
    };

    const results = await v8Mutations.writeBudgetsBatch('fake-token', syncContext, [
      {
        categoryId: 'cat-groceries-uuid',
        amount: 450,
        monthDate: '2026-10-01',
      },
      {
        categoryId: 'cat-dining-uuid',
        amount: '120.50',
        monthDate: '2026-10-01',
      },
    ]);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(syncContext.serverTimestamp, 1729000000);

    assert.ok(capturedBody);
    assert.strictEqual(capturedBody.serverTimestamp, 1728900000);
    assert.ok(Array.isArray(capturedBody.budget));
    assert.strictEqual(capturedBody.budget.length, 2);

    const b1 = capturedBody.budget.find((b: any) => b.tag === 'cat-groceries-uuid');
    assert.ok(b1);
    assert.strictEqual(b1.user, 42);
    assert.strictEqual(b1.date, '2026-10-01');
    // Desired 450 minus scheduled marker 150 = 300 remainder
    assert.strictEqual(b1.outcome, 300);
    assert.strictEqual(b1.outcomeLock, true);
    assert.strictEqual(b1.incomeLock, false);

    const b2 = capturedBody.budget.find((b: any) => b.tag === 'cat-dining-uuid');
    assert.ok(b2);
    assert.strictEqual(b2.outcome, 120.5);
    assert.strictEqual(b2.outcomeLock, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Express /api/advisor/apply-budgets validates request and applies budgets', async () => {
  const app = createApp();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const originalApply = financeController.applyBudgetGoals;
  let receivedItems: any = null;
  (financeController as any).applyBudgetGoals = async (items: any) => {
    receivedItems = items;
    return {
      appliedCount: items.length,
      updatedBudgets: items.map((i: any) => ({
        categoryId: i.categoryId,
        outcome: i.amount,
        date: i.monthDate || '2026-10-01',
      })),
      savingsPlan: {
        referenceDate: '2026-10-18',
        currentMonthStart: '2026-10-01',
        categoryPlans: [],
      },
    };
  };

  try {
    // 1. Invalid payload: missing categoryId
    const resInvalid = await fetch(`http://127.0.0.1:${port}/api/advisor/apply-budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgets: [{ amount: 100 }],
      }),
    });
    assert.strictEqual(resInvalid.status, 400);

    // 2. Valid payload
    const resValid = await fetch(`http://127.0.0.1:${port}/api/advisor/apply-budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monthDate: '2026-10-01',
        budgets: [
          { categoryId: 'cat-dining', amount: 150 },
          { categoryId: 'cat-groceries', amount: '450.00' },
        ],
      }),
    });
    assert.strictEqual(resValid.status, 200);
    const data: any = await resValid.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.appliedCount, 2);
    assert.strictEqual(receivedItems.length, 2);
    assert.strictEqual(receivedItems[0].categoryId, 'cat-dining');
    assert.strictEqual(receivedItems[0].monthDate, '2026-10-01');
  } finally {
    (financeController as any).applyBudgetGoals = originalApply;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

