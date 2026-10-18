import { Decimal } from 'decimal.js';
import type { AdvisorDataset } from '../engine/financeController.js';

export class PromptContextBuilder {
  public static buildFullFinancialContext(dataset: AdvisorDataset): string {
    const { summary, savingsPlan, allRecentTransactions } = dataset;

    const accountsText =
      summary.accounts.length > 0
        ? summary.accounts
            .map((a) => `- ${a.title} [${a.type}]: EUR ${new Decimal(a.balance).toFixed(2)}`)
            .join('\n')
        : '- Geen actieve rekeningen gevonden.';

    const categoryGoalsText =
      savingsPlan.categoryPlans.length > 0
        ? savingsPlan.categoryPlans
            .map((cp) => {
              const zmText =
                cp.zenmoneyBudget !== null
                  ? `Zenmoney Budget: EUR ${new Decimal(cp.zenmoneyBudget).toFixed(2)}`
                  : 'Zenmoney Budget: NIET INGESTELD';
              const recText = `Aanbevolen Doel: EUR ${new Decimal(cp.recommendedMonthlyBudget).toFixed(2)}/mnd`;
              const dailySave = `Te besparen: EUR ${new Decimal(cp.potentialDailySavings).toFixed(2)}/dag (EUR ${new Decimal(cp.potentialWeeklySavings).toFixed(2)}/week, EUR ${new Decimal(cp.potentialMonthlySavings).toFixed(2)}/mnd)`;
              const allowance = `Resterend deze maand: EUR ${new Decimal(cp.remainingMonthAllowance).toFixed(2)} (Max EUR ${new Decimal(cp.dailyAllowanceRestOfMonth).toFixed(2)}/dag | Max EUR ${new Decimal(cp.weeklyAllowance).toFixed(2)}/week)`;
              const leakTag = cp.isLifestyleLeak ? ' [LEEFSTIJLLEK]' : '';
              return `- ${cp.category}${leakTag}: Uitgegeven deze maand EUR ${new Decimal(cp.spentMonthToDate).toFixed(2)} (Afgelopen 30d: EUR ${new Decimal(cp.spentLast30Days).toFixed(2)}, gem. EUR ${new Decimal(cp.dailyAverageSpent).toFixed(2)}/dag) | ${zmText} | ${recText} | ${dailySave} | ${allowance} | Advies: ${cp.goalReason}`;
            })
            .join('\n')
        : '- Geen categorie-uitgaven geregistreerd.';

    const planned = summary.plannedSchedule;
    const plannedText =
      planned && planned.items.length > 0
        ? planned.items
            .map((pt) => {
              const incDec = new Decimal(pt.income || 0);
              const outDec = new Decimal(pt.outcome || 0);
              const label = pt.isTransfer
                ? `TRANSFER EUR ${outDec.greaterThan(0) ? outDec.toFixed(2) : incDec.toFixed(2)} (${pt.outcomeAccountTitle || 'Bron'} -> ${pt.incomeAccountTitle || 'Doel'})`
                : incDec.greaterThan(0)
                  ? `INKOMEN +EUR ${incDec.toFixed(2)} (${pt.incomeAccountTitle || 'Rekening'})`
                  : `UITGAVE -EUR ${outDec.toFixed(2)} (${pt.outcomeAccountTitle || 'Rekening'})`;
              return `- ${pt.date} | ${label} | ${pt.payee} (${pt.categoryTitle})`;
            })
            .join('\n')
        : '- Geen geplande transacties in de komende 30 dagen.';

    const alertsText =
      planned && planned.liquidityAlerts.length > 0
        ? planned.liquidityAlerts
            .map(
              (al) =>
                `- TEKORT WAARSCHUWING op ${al.accountTitle}: Huidig saldo EUR ${new Decimal(al.currentBalance).toFixed(2)}, Geplande afschrijvingen -EUR ${new Decimal(al.plannedOutflows).toFixed(2)} -> Verwacht eindsaldo EUR ${new Decimal(al.projectedEndingBalance).toFixed(2)} (Tekort: EUR ${new Decimal(al.shortfallAmount).toFixed(2)})`
            )
            .join('\n')
        : '- Alle rekeningen hebben voldoende saldo voor geplande afschrijvingen.';

    const transfersText =
      summary.internalTransfers && summary.internalTransfers.length > 0
        ? summary.internalTransfers
            .map(
              (t) =>
                `- ${t.date} | ${t.fromAccount} -> ${t.toAccount}: EUR ${new Decimal(t.amount).toFixed(2)}${t.isSavingsAllocation ? ' [Spaarbuffer storting]' : ' [Interne overboeking]'}`
            )
            .join('\n')
        : '- Geen interne overboekingen in deze periode.';

    const txSlice = allRecentTransactions.slice(0, 150);
    const transactionsText =
      txSlice.length > 0
        ? txSlice
            .map((tx) => {
              const incDec = new Decimal(tx.income || 0);
              const outDec = new Decimal(tx.outcome || 0);
              const kind = tx.isTransfer
                ? `TRANSFER EUR ${outDec.greaterThan(0) ? outDec.toFixed(2) : incDec.toFixed(2)}`
                : outDec.greaterThan(0)
                  ? `EXPENSE -EUR ${outDec.toFixed(2)}`
                  : `INCOME +EUR ${incDec.toFixed(2)}`;
              const acc = tx.outcomeAccountTitle || tx.incomeAccountTitle || '';
              const note = tx.comment ? ` | Note: ${tx.comment.replace(/<br\s*\/?>/gi, ', ').trim()}` : '';
              return `- ${tx.date} | ${kind} | ${tx.payee || 'Onbekend'} | Categorie: ${tx.categoryTitle || 'General'}${acc ? ` | Rekening: ${acc}` : ''}${note}`;
            })
            .join('\n')
        : '- Geen recente transacties gevonden.';

    return `
=== VOLLEDIGE FINANCIELE DATA & SPAARPLAN (Peildatum: ${savingsPlan.referenceDate}) ===

1. REKENINGEN & LIQUIDE VERMOGEN
- Totaal Liquide Saldo (Betaal + Spaar + Contant): EUR ${new Decimal(summary.totalLiquidBalance).toFixed(2)}
${accountsText}

2. LOPENDE MAAND & 15-DAAGSE CASHFLOW
- Lopende maand (${savingsPlan.currentMonthStart} t/m ${savingsPlan.currentMonthEnd}): Dag ${savingsPlan.daysElapsedInMonth} van ${savingsPlan.daysInMonth} (${savingsPlan.daysRemainingInMonth} dagen resterend in de maand, ${savingsPlan.daysRemainingInWeek} dagen resterend in deze week)
- Inkomsten deze maand tot nu toe: EUR ${new Decimal(savingsPlan.monthlyIncomeToDate).toFixed(2)}
- Uitgaven deze maand tot nu toe: EUR ${new Decimal(savingsPlan.monthlyExpensesToDate).toFixed(2)}
- Overgeboekt naar spaarbuffer deze maand: EUR ${new Decimal(savingsPlan.monthlySavingsTransfersToDate).toFixed(2)}
- Huidige spaarquote deze maand: ${new Decimal(savingsPlan.currentSavingsRatePercentage).toFixed(1)}% (Doel: ${new Decimal(savingsPlan.targetSavingsRatePercentage).toFixed(1)}%)
- 15-daagse samenvatting (${summary.startDate} t/m ${summary.endDate}): Inkomen EUR ${new Decimal(summary.totalIncome).toFixed(2)}, Uitgaven EUR ${new Decimal(summary.totalExpenses).toFixed(2)}, Netto Cashflow EUR ${new Decimal(summary.netCashFlow).toFixed(2)}

3. CONCRETE SPAARDOELEN: VANDAAG, DEZE WEEK & REST VAN DE MAAND
- DOEL VANDAAG (${savingsPlan.referenceDate}):
  * Maximaal toegestane variabele uitgaven vandaag: EUR ${new Decimal(savingsPlan.todayTargetVariableSpendLimit).toFixed(2)}
  * Doelbedrag om vandaag te besparen / opzij te zetten: EUR ${new Decimal(savingsPlan.todayTargetSavingsAmount).toFixed(2)}
  * Directe besparingspotentie per dag op variabele kosten: EUR ${new Decimal(savingsPlan.potentialExtraDailySavings).toFixed(2)}/dag
- DOEL DEZE WEEK (Komende 7 dagen):
  * Maximaal weekbudget variabele uitgaven: EUR ${new Decimal(savingsPlan.weekTargetVariableSpendLimit).toFixed(2)}
  * Weekdoel om te besparen: EUR ${new Decimal(savingsPlan.weekTargetSavingsAmount).toFixed(2)} (waarvan EUR ${new Decimal(savingsPlan.potentialExtraWeeklySavings).toFixed(2)} door minder uitgaven)
- DOEL REST VAN DE MAAND (${savingsPlan.daysRemainingInMonth} dagen t/m ${savingsPlan.currentMonthEnd}):
  * Resterend variabel budget voor de rest van de maand: EUR ${new Decimal(savingsPlan.restOfMonthVariableSpendLimit).toFixed(2)}
  * Totaal maandspaardoel: EUR ${new Decimal(savingsPlan.targetMonthlySavingsAmount).toFixed(2)} (Extra maandbesparing uit categorie-aanpassingen: EUR ${new Decimal(savingsPlan.potentialExtraMonthlySavings).toFixed(2)}/mnd)

4. SPAARPLAN PER EXPENSE CATEGORIE & AANBEVOLEN ZENMONEY BUDGETTEN
${categoryGoalsText}

5. INTERNE OVERBOEKINGEN & SPAARSTORTINGEN (15 dagen)
${transfersText}

6. GEPLANDE TRANSACTIES (KOMENDE 30 DAGEN) & SALDOWAARSCHUWINGEN
${alertsText}
${plannedText}

7. ALLE RECENTE TRANSACTIES (${txSlice.length} items)
${transactionsText}
`.trim();
  }
}
