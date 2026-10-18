import assert from 'node:assert';
import test from 'node:test';
import { Decimal } from 'decimal.js';
import { SavingsPlanner } from '../src/engine/savingsPlanner.js';
import { FinancialDataNormalizer } from '../src/engine/dataNormalizer.js';
import { PromptContextBuilder } from '../src/ai/promptContextBuilder.js';
import { financialChatService } from '../src/ai/financialChatService.js';
import { morningDigestService } from '../src/ai/morningDigestService.js';
import { generateMockFinancialData } from '../src/engine/mockData.js';

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
        budgetedOutcome: 500,
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
  assert.strictEqual(groceriesPlan.zenmoneyBudget, 500, 'Must match configured Zenmoney budget');
  assert.strictEqual(groceriesPlan.remainingMonthAllowance, 100, '500 budget minus 400 spent = 100 remaining');
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

  const digest = await morningDigestService.generateAndSendDigest(dataset);
  assert.ok(digest.markdownContent.includes('Doelen voor Vandaag'), 'Morning digest must include today goals');
  assert.ok(digest.markdownContent.includes('Doelen Verspreid over Deze Week'), 'Morning digest must include weekly goals');
  assert.ok(digest.markdownContent.includes('Rest van de Maand'), 'Morning digest must include rest-of-month goals');
  assert.ok(!digest.markdownContent.includes('—'), 'Morning digest must never contain em-dashes');
});
