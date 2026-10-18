import { Decimal } from 'decimal.js';
import type {
  ZenmoneyAccount,
  ZenmoneyTransaction,
  ZenmoneyBudget,
} from '../mcp/types.js';
import type {
  CategorySavingsPlan,
  SavingsGoalsSummary,
} from './types.js';

const LIFESTYLE_LEAK_REGEX =
  /eating\s*out|dining|restaurant|cafe|café|coffee|koffie|matcha|bar|takeout|thuisbezorgd|uber\s*eats|deliveroo|snack|bakery|bakker|uit\s*eten|horeca|shopping|winkel|kleding|clothing|gadget|hardware|electronic|entertainment|leisure|uitgaan|hobby|impulse|game|alcohol|lunch/i;

const FIXED_ESSENTIAL_REGEX =
  /rent|huur|mortgage|hypotheek|insurance|verzekering|tax|belasting|utilities|energie|stroom|gas|water|internet|telecom|lease|loan|lening|zorg|health\s*insurance/i;

const SAVINGS_ACCOUNT_REGEX = /buffer|spaar|saving|reserve|vault/i;

export class SavingsPlanner {
  public static computeSavingsPlan(params: {
    accounts: ZenmoneyAccount[];
    transactions: ZenmoneyTransaction[];
    budgets: ZenmoneyBudget[];
    referenceDate?: string;
  }): SavingsGoalsSummary {
    const refDateStr = params.referenceDate || new Date().toISOString().split('T')[0];
    const [yearStr, monthStr, dayStr] = refDateStr.split('-');
    const year = parseInt(yearStr, 10);
    const monthIndex = parseInt(monthStr, 10) - 1;
    const dayOfMonth = parseInt(dayStr, 10);

    const lastDayDate = new Date(Date.UTC(year, monthIndex + 1, 0));
    const daysInMonth = lastDayDate.getUTCDate();
    const daysElapsedInMonth = Math.max(1, dayOfMonth);
    const daysRemainingInMonth = Math.max(1, daysInMonth - dayOfMonth + 1);

    const refDateObj = new Date(`${refDateStr}T00:00:00Z`);
    const utcDayOfWeek = refDateObj.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const isoDayOfWeek = utcDayOfWeek === 0 ? 7 : utcDayOfWeek;
    const daysRemainingInWeek = Math.max(1, 7 - isoDayOfWeek + 1);

    const currentMonthStart = `${yearStr}-${monthStr}-01`;
    const currentMonthEnd = `${yearStr}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

    const last30Obj = new Date(`${refDateStr}T00:00:00Z`);
    last30Obj.setUTCDate(last30Obj.getUTCDate() - 30);
    const last30Start = last30Obj.toISOString().split('T')[0];

    const accountById = new Map<string, ZenmoneyAccount>();
    for (const acc of params.accounts) {
      accountById.set(acc.id, acc);
    }

    let monthlyIncomeDec = new Decimal(0);
    let monthlyExpensesDec = new Decimal(0);
    let monthlySavingsTransfersDec = new Decimal(0);
    let last30IncomeDec = new Decimal(0);

    const monthCategorySpent: Record<string, Decimal> = {};
    const last30CategorySpent: Record<string, Decimal> = {};

    for (const tx of params.transactions) {
      if (tx.date > refDateStr || tx.date < last30Start) {
        continue;
      }

      const inc = new Decimal(tx.income || 0);
      const out = new Decimal(tx.outcome || 0);
      const isTransfer =
        Boolean(tx.isTransfer) ||
        (inc.greaterThan(0) && out.greaterThan(0)) ||
        (Boolean(tx.incomeAccount) && Boolean(tx.outcomeAccount) && tx.incomeAccount !== tx.outcomeAccount);

      const inCurrentMonth = tx.date >= currentMonthStart && tx.date <= currentMonthEnd;

      if (isTransfer) {
        if (inCurrentMonth) {
          const toAcc = tx.incomeAccount ? accountById.get(tx.incomeAccount) : undefined;
          const toTitle = tx.incomeAccountTitle || toAcc?.title || '';
          if (toAcc?.type === 'deposit' || SAVINGS_ACCOUNT_REGEX.test(toTitle)) {
            const transferAmt = out.greaterThan(0) ? out : inc;
            monthlySavingsTransfersDec = monthlySavingsTransfersDec.plus(transferAmt);
          }
        }
        continue;
      }

      last30IncomeDec = last30IncomeDec.plus(inc);
      if (inCurrentMonth) {
        monthlyIncomeDec = monthlyIncomeDec.plus(inc);
        monthlyExpensesDec = monthlyExpensesDec.plus(out);
      }

      if (out.greaterThan(0)) {
        const cat = tx.categoryTitle || tx.category || 'Uncategorized';
        last30CategorySpent[cat] = (last30CategorySpent[cat] || new Decimal(0)).plus(out);
        if (inCurrentMonth) {
          monthCategorySpent[cat] = (monthCategorySpent[cat] || new Decimal(0)).plus(out);
        }
      }
    }

    // Map Zenmoney budgets by category title for currentMonthStart
    // Only fall back to the most recent month if currentMonthStart has no budgets at all
    const sortedBudgets = [...params.budgets].sort((a, b) => b.date.localeCompare(a.date));
    const hasCurrentMonthBudgets = sortedBudgets.some((b) => b.date === currentMonthStart);
    const budgetByCategory = new Map<string, Decimal>();
    for (const b of sortedBudgets) {
      const catName = b.categoryTitle || b.category;
      if (!catName) continue;
      const bDec = new Decimal(b.budgetedOutcome || 0);
      if (bDec.lessThanOrEqualTo(0)) continue;
      if (hasCurrentMonthBudgets) {
        if (b.date === currentMonthStart) {
          budgetByCategory.set(catName, bDec);
        }
      } else if (!budgetByCategory.has(catName)) {
        budgetByCategory.set(catName, bDec);
      }
    }

    const allCategories = new Set<string>([
      ...Object.keys(last30CategorySpent),
      ...Object.keys(monthCategorySpent),
      ...budgetByCategory.keys(),
    ]);

    const daysInMonthDec = new Decimal(daysInMonth);
    const daysRemainingDec = new Decimal(daysRemainingInMonth);
    const daysElapsedDec = new Decimal(daysElapsedInMonth);
    const thirtyDec = new Decimal(30);

    const categoryPlans: CategorySavingsPlan[] = [];
    let totalPotentialMonthlySavingsDec = new Decimal(0);
    let todayVariableLimitDec = new Decimal(0);
    let weekVariableLimitDec = new Decimal(0);
    let restOfMonthVariableLimitDec = new Decimal(0);

    for (const category of allCategories) {
      const mtdDec = monthCategorySpent[category] || new Decimal(0);
      const l30Dec = last30CategorySpent[category] || mtdDec;
      const zmBudgetDec = budgetByCategory.get(category) || null;

      const isFixed = FIXED_ESSENTIAL_REGEX.test(category);
      const isLifestyleLeak = !isFixed && LIFESTYLE_LEAK_REGEX.test(category);

      const dailyAvgDec = l30Dec.greaterThan(0)
        ? l30Dec.dividedBy(thirtyDec)
        : mtdDec.dividedBy(daysElapsedDec);

      const baselineMonthlyDec = Decimal.max(l30Dec, mtdDec);

      let recommendedDec: Decimal;
      let needsNewZenmoneyGoal = false;
      let goalReason = 'Volgt bestaand Zenmoney-budget';

      if (isFixed) {
        recommendedDec = zmBudgetDec || baselineMonthlyDec;
        goalReason = 'Vaste lasten (essentieel)';
      } else if (isLifestyleLeak) {
        // Lifestyle leak: target a 35% reduction from 30-day spend
        const strictTargetDec = baselineMonthlyDec.times(new Decimal('0.65')).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        if (zmBudgetDec && zmBudgetDec.lessThanOrEqualTo(strictTargetDec)) {
          recommendedDec = zmBudgetDec;
          if (mtdDec.greaterThan(zmBudgetDec)) {
            needsNewZenmoneyGoal = true;
            goalReason = 'Zenmoney-budget overschreden: zet uitgaven voor deze categorie de rest van de maand op EUR 0';
          }
        } else {
          recommendedDec = strictTargetDec;
          needsNewZenmoneyGoal = true;
          goalReason = zmBudgetDec
            ? `Leefstijllek: verlaag je huidige Zenmoney-budget (EUR ${zmBudgetDec.toFixed(2)}) met 35% naar EUR ${recommendedDec.toFixed(2)}`
            : `Leefstijllek zonder limiet: stel EUR ${recommendedDec.toFixed(2)}/mnd in als nieuw budget in Zenmoney (-35%)`;
        }
      } else {
        // Regular variable category (e.g. groceries, transport): target 15% efficiency savings if unbudgeted or overspent
        const efficientTargetDec = baselineMonthlyDec.times(new Decimal('0.85')).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        if (zmBudgetDec) {
          if (mtdDec.greaterThan(zmBudgetDec)) {
            recommendedDec = zmBudgetDec;
            needsNewZenmoneyGoal = true;
            goalReason = `Boven Zenmoney-maandlimiet (EUR ${zmBudgetDec.toFixed(2)}): beperk tot strikt noodzakelijk`;
          } else {
            recommendedDec = zmBudgetDec;
          }
        } else {
          recommendedDec = efficientTargetDec;
          needsNewZenmoneyGoal = baselineMonthlyDec.greaterThanOrEqualTo(30);
          goalReason = needsNewZenmoneyGoal
            ? `Geen Zenmoney-limiet: stel EUR ${recommendedDec.toFixed(2)}/mnd in bij Zenmoney om 15% te besparen`
            : 'Variabele uitgave zonder vast maandbudget';
        }
      }

      const remainingMonthDec = Decimal.max(new Decimal(0), recommendedDec.minus(mtdDec));
      const dailyAllowanceDec = remainingMonthDec.dividedBy(daysRemainingDec);
      const weeklyAllowanceDec = Decimal.min(remainingMonthDec, dailyAllowanceDec.times(new Decimal(7)));

      const potentialMonthlySavingsDec = isFixed
        ? new Decimal(0)
        : Decimal.max(new Decimal(0), baselineMonthlyDec.minus(recommendedDec));
      const potentialDailySavingsDec = potentialMonthlySavingsDec.dividedBy(daysInMonthDec);
      const potentialWeeklySavingsDec = potentialDailySavingsDec.times(new Decimal(7));

      if (!isFixed) {
        totalPotentialMonthlySavingsDec = totalPotentialMonthlySavingsDec.plus(potentialMonthlySavingsDec);
        todayVariableLimitDec = todayVariableLimitDec.plus(dailyAllowanceDec);
        weekVariableLimitDec = weekVariableLimitDec.plus(weeklyAllowanceDec);
        restOfMonthVariableLimitDec = restOfMonthVariableLimitDec.plus(remainingMonthDec);
      }

      categoryPlans.push({
        category,
        spentMonthToDate: mtdDec.toDecimalPlaces(2).toNumber(),
        spentLast30Days: l30Dec.toDecimalPlaces(2).toNumber(),
        dailyAverageSpent: dailyAvgDec.toDecimalPlaces(2).toNumber(),
        zenmoneyBudget: zmBudgetDec ? zmBudgetDec.toDecimalPlaces(2).toNumber() : null,
        recommendedMonthlyBudget: recommendedDec.toDecimalPlaces(2).toNumber(),
        needsNewZenmoneyGoal,
        goalReason,
        remainingMonthAllowance: remainingMonthDec.toDecimalPlaces(2).toNumber(),
        dailyAllowanceRestOfMonth: dailyAllowanceDec.toDecimalPlaces(2).toNumber(),
        weeklyAllowance: weeklyAllowanceDec.toDecimalPlaces(2).toNumber(),
        potentialDailySavings: potentialDailySavingsDec.toDecimalPlaces(2).toNumber(),
        potentialWeeklySavings: potentialWeeklySavingsDec.toDecimalPlaces(2).toNumber(),
        potentialMonthlySavings: potentialMonthlySavingsDec.toDecimalPlaces(2).toNumber(),
        isLifestyleLeak,
      });
    }

    categoryPlans.sort((a, b) => {
      const diff = new Decimal(b.potentialMonthlySavings).minus(a.potentialMonthlySavings);
      if (!diff.equals(0)) return diff.toNumber();
      return new Decimal(b.spentLast30Days).minus(a.spentLast30Days).toNumber();
    });

    const referenceIncomeDec = Decimal.max(monthlyIncomeDec, last30IncomeDec);
    const currentNetDec = monthlyIncomeDec.minus(monthlyExpensesDec);
    const currentSavingsRateDec = monthlyIncomeDec.greaterThan(0)
      ? currentNetDec.dividedBy(monthlyIncomeDec).times(100)
      : new Decimal(0);

    const targetRateDec = new Decimal(20);
    const twentyPercentSavingsDec = referenceIncomeDec.times(new Decimal('0.20'));
    const targetMonthlySavingsDec = Decimal.max(
      twentyPercentSavingsDec,
      monthlySavingsTransfersDec.plus(totalPotentialMonthlySavingsDec)
    );

    const potentialExtraDailyDec = totalPotentialMonthlySavingsDec.dividedBy(daysInMonthDec);
    const potentialExtraWeeklyDec = potentialExtraDailyDec.times(new Decimal(7));

    const todayTargetSavingsDec = Decimal.max(
      potentialExtraDailyDec,
      targetMonthlySavingsDec.dividedBy(daysInMonthDec)
    );
    const weekTargetSavingsDec = todayTargetSavingsDec.times(new Decimal(7));
    const restOfMonthSavingsDec = todayTargetSavingsDec.times(daysRemainingDec);

    return {
      referenceDate: refDateStr,
      currentMonthStart,
      currentMonthEnd,
      daysInMonth,
      daysElapsedInMonth,
      daysRemainingInMonth,
      daysRemainingInWeek,
      monthlyIncomeToDate: monthlyIncomeDec.toDecimalPlaces(2).toNumber(),
      monthlyExpensesToDate: monthlyExpensesDec.toDecimalPlaces(2).toNumber(),
      monthlySavingsTransfersToDate: monthlySavingsTransfersDec.toDecimalPlaces(2).toNumber(),
      currentSavingsRatePercentage: currentSavingsRateDec.toDecimalPlaces(1).toNumber(),
      targetSavingsRatePercentage: targetRateDec.toNumber(),
      targetMonthlySavingsAmount: targetMonthlySavingsDec.toDecimalPlaces(2).toNumber(),
      potentialExtraMonthlySavings: totalPotentialMonthlySavingsDec.toDecimalPlaces(2).toNumber(),
      potentialExtraDailySavings: potentialExtraDailyDec.toDecimalPlaces(2).toNumber(),
      potentialExtraWeeklySavings: potentialExtraWeeklyDec.toDecimalPlaces(2).toNumber(),
      todayTargetVariableSpendLimit: todayVariableLimitDec.toDecimalPlaces(2).toNumber(),
      todayTargetSavingsAmount: todayTargetSavingsDec.toDecimalPlaces(2).toNumber(),
      weekTargetVariableSpendLimit: weekVariableLimitDec.toDecimalPlaces(2).toNumber(),
      weekTargetSavingsAmount: weekTargetSavingsDec.toDecimalPlaces(2).toNumber(),
      restOfMonthVariableSpendLimit: restOfMonthVariableLimitDec.toDecimalPlaces(2).toNumber(),
      restOfMonthTargetSavingsAmount: restOfMonthSavingsDec.toDecimalPlaces(2).toNumber(),
      categoryPlans,
    };
  }
}
