import type { ZenmoneyAccount, ZenmoneyTransaction, ZenmoneyBudget, ZenmoneySyncData } from '../mcp/types.js';

export function generateMockFinancialData(): ZenmoneySyncData {
  const now = new Date();
  
  const formatDate = (daysAgo: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  };

  const accounts: ZenmoneyAccount[] = [
    {
      id: 'acc-main-checking',
      title: 'Main Checking Account',
      type: 'checking',
      balance: 4820.50,
      currency: 'EUR',
    },
    {
      id: 'acc-savings',
      title: 'High-Yield Savings',
      type: 'deposit',
      balance: 18450.00,
      currency: 'EUR',
    },
    {
      id: 'acc-credit-card',
      title: 'Platinum Credit Card',
      type: 'ccard',
      balance: -1120.30,
      currency: 'EUR',
    },
  ];

  const transactions: ZenmoneyTransaction[] = [
    // Income
    {
      id: 'tx-01',
      date: formatDate(14),
      income: 3850.00,
      outcome: 0,
      incomeAccount: 'acc-main-checking',
      category: 'Salary',
      categoryTitle: 'Primary Salary',
      payee: 'Tech Corp BV',
      comment: 'Monthly payroll',
      currency: 'EUR',
    },
    {
      id: 'tx-02',
      date: formatDate(6),
      income: 420.00,
      outcome: 0,
      incomeAccount: 'acc-main-checking',
      category: 'Freelance',
      categoryTitle: 'Consulting & Freelance',
      payee: 'Design Studio LLC',
      comment: 'API Integration consulting',
      currency: 'EUR',
    },
    // Standard recurring expenses
    {
      id: 'tx-03',
      date: formatDate(13),
      income: 0,
      outcome: 1250.00,
      outcomeAccount: 'acc-main-checking',
      category: 'Housing',
      categoryTitle: 'Rent & Utilities',
      payee: 'City Properties',
      comment: 'Apartment rent',
      currency: 'EUR',
    },
    {
      id: 'tx-04',
      date: formatDate(11),
      income: 0,
      outcome: 86.40,
      outcomeAccount: 'acc-credit-card',
      category: 'Groceries',
      categoryTitle: 'Supermarket & Essentials',
      payee: 'Albert Heijn',
      comment: 'Weekly groceries',
      currency: 'EUR',
    },
    {
      id: 'tx-05',
      date: formatDate(9),
      income: 0,
      outcome: 42.50,
      outcomeAccount: 'acc-credit-card',
      category: 'Dining',
      categoryTitle: 'Restaurants & Cafes',
      payee: 'Bakery & Espresso Bar',
      comment: 'Lunch with colleagues',
      currency: 'EUR',
    },
    {
      id: 'tx-06',
      date: formatDate(8),
      income: 0,
      outcome: 14.99,
      outcomeAccount: 'acc-credit-card',
      category: 'Subscriptions',
      categoryTitle: 'Software & Media',
      payee: 'Spotify AB',
      comment: 'Music streaming',
      currency: 'EUR',
    },
    {
      id: 'tx-07',
      date: formatDate(7),
      income: 0,
      outcome: 124.80,
      outcomeAccount: 'acc-credit-card',
      category: 'Groceries',
      categoryTitle: 'Supermarket & Essentials',
      payee: 'Marqt Eco Market',
      comment: 'Organic groceries',
      currency: 'EUR',
    },
    // Anomaly expense
    {
      id: 'tx-08',
      date: formatDate(4),
      income: 0,
      outcome: 689.00,
      outcomeAccount: 'acc-credit-card',
      category: 'Electronics',
      categoryTitle: 'Gadgets & Hardware',
      payee: 'Coolblue NV',
      comment: 'UltraWide Monitor replacement',
      currency: 'EUR',
    },
    {
      id: 'tx-09',
      date: formatDate(3),
      income: 0,
      outcome: 58.20,
      outcomeAccount: 'acc-credit-card',
      category: 'Transportation',
      categoryTitle: 'Transit & Fuel',
      payee: 'NS Dutch Railways',
      comment: 'Intercity train pass',
      currency: 'EUR',
    },
    {
      id: 'tx-10',
      date: formatDate(2),
      income: 0,
      outcome: 94.10,
      outcomeAccount: 'acc-credit-card',
      category: 'Dining',
      categoryTitle: 'Restaurants & Cafes',
      payee: 'Osteria Trattoria',
      comment: 'Dinner with partner',
      currency: 'EUR',
    },
    {
      id: 'tx-11',
      date: formatDate(1),
      income: 0,
      outcome: 65.00,
      outcomeAccount: 'acc-main-checking',
      category: 'Health',
      categoryTitle: 'Pharmacy & Fitness',
      payee: 'Gym Club Amsterdam',
      comment: 'Monthly membership',
      currency: 'EUR',
    },
  ];

  const budgets: ZenmoneyBudget[] = [
    {
      id: 'b-housing',
      date: formatDate(15),
      category: 'Housing',
      categoryTitle: 'Rent & Utilities',
      budgetedOutcome: 1300.00,
      actualOutcome: 1250.00,
    },
    {
      id: 'b-groceries',
      date: formatDate(15),
      category: 'Groceries',
      categoryTitle: 'Supermarket & Essentials',
      budgetedOutcome: 350.00,
      actualOutcome: 211.20,
    },
    {
      id: 'b-dining',
      date: formatDate(15),
      category: 'Dining',
      categoryTitle: 'Restaurants & Cafes',
      budgetedOutcome: 200.00,
      actualOutcome: 136.60,
    },
    {
      id: 'b-electronics',
      date: formatDate(15),
      category: 'Electronics',
      categoryTitle: 'Gadgets & Hardware',
      budgetedOutcome: 100.00,
      actualOutcome: 689.00,
    },
  ];

  return { accounts, transactions, budgets, serverTimestamp: Date.now() };
}
