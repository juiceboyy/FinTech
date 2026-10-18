import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { geminiService, GEMINI_MODEL } from './geminiClient.js';
import { PromptContextBuilder } from './promptContextBuilder.js';
import { emailService, type EmailSendResult } from './emailService.js';
import type { AdvisorDataset } from '../engine/financeController.js';
import type { SavingsGoalsSummary } from '../engine/types.js';

export interface MorningDigestReport {
  subject: string;
  markdownContent: string;
  generatedBy: string;
  generatedAt: string;
  savingsPlan: SavingsGoalsSummary;
  emailResult: EmailSendResult;
}

export interface MorningDigestOptions {
  skipEmail?: boolean;
}

export class MorningDigestService {
  public async generateAndSendDigest(
    dataset: AdvisorDataset,
    options: MorningDigestOptions = {}
  ): Promise<MorningDigestReport> {
    const { savingsPlan } = dataset;
    const subject = `Fintech Ochtendplan (${savingsPlan.referenceDate}) - Dagdoel: Bespaar EUR ${new Decimal(savingsPlan.todayTargetSavingsAmount).toFixed(2)}`;

    let markdownContent = '';
    let generatedBy = '';

    if (geminiService.isAvailable()) {
      try {
        markdownContent = await this.generateGeminiMorningDigest(dataset);
        generatedBy = GEMINI_MODEL;
      } catch (err) {
        console.warn('Gemini morning digest failed, falling back to deterministic digest:', err);
        markdownContent = this.generateDeterministicMorningDigest(dataset);
        generatedBy = 'local-morning-engine';
      }
    } else {
      markdownContent = this.generateDeterministicMorningDigest(dataset);
      generatedBy = 'local-morning-engine';
    }

    const contentHash = createHash('sha256').update(markdownContent).digest('hex').slice(0, 12);
    const idempotencyKey = `morning-digest/${savingsPlan.referenceDate}/${contentHash}`;

    const emailResult: EmailSendResult = options.skipEmail
      ? {
          sent: false,
          recipient: emailService.getStatus().recipient,
          idempotencyKey,
          error: 'Email sending skipped (test mode).',
        }
      : await emailService.sendEmail({
          subject,
          markdownBody: markdownContent,
          idempotencyKey,
          templateVariables: {
            REFERENCE_DATE: savingsPlan.referenceDate,
            TODAY_SPEND_LIMIT: new Decimal(savingsPlan.todayTargetVariableSpendLimit).toFixed(2),
            TODAY_SAVINGS_GOAL: new Decimal(savingsPlan.todayTargetSavingsAmount).toFixed(2),
            WEEK_SPEND_LIMIT: new Decimal(savingsPlan.weekTargetVariableSpendLimit).toFixed(2),
            WEEK_SAVINGS_GOAL: new Decimal(savingsPlan.weekTargetSavingsAmount).toFixed(2),
            MONTH_SAVINGS_GOAL: new Decimal(savingsPlan.targetMonthlySavingsAmount).toFixed(2),
          },
        });

    return {
      subject,
      markdownContent,
      generatedBy,
      generatedAt: new Date().toISOString(),
      savingsPlan,
      emailResult,
    };
  }

  private async generateGeminiMorningDigest(dataset: AdvisorDataset): Promise<string> {
    const fullContext = PromptContextBuilder.buildFullFinancialContext(dataset);
    const { savingsPlan } = dataset;

    const prompt = `
Schrijf de dagelijkse financiele ochtendmail voor vandaag (${savingsPlan.referenceDate}) op basis van de volledige Zenmoney data hieronder:

${fullContext}

De ochtendmail moet kort, krachtig en direct toepasbaar zijn bij het opstaan. Gebruik exact deze 3 secties in het Nederlands:

### 1. Doelen voor Vandaag (${savingsPlan.referenceDate})
- Noem het exacte maximale variabele dagbudget voor vandaag (EUR ${new Decimal(savingsPlan.todayTargetVariableSpendLimit).toFixed(2)}) en het bedrag dat vandaag bespaard moet worden (EUR ${new Decimal(savingsPlan.todayTargetSavingsAmount).toFixed(2)}).
- Benoem specifiek op welk soort niet-essentiele uitgaven (zoals Eating out, koffie/matcha, bezorging of uitgaan) vandaag hoeveel euro per dag bespaard wordt door ze op EUR 0 te houden, en noem daarnaast expliciet het dagbudget voor Boodschappen (Groceries) om gezond thuis te koken. Zet Groceries NOOIT op EUR 0/dag.
- Vermeld eventuele geplande afschrijvingen van vandaag of morgen.

### 2. Doelen Verspreid over Deze Week
- Geef het maximale weekbudget voor variabele uitgaven (EUR ${new Decimal(savingsPlan.weekTargetVariableSpendLimit).toFixed(2)}) en het weekspaardoel (EUR ${new Decimal(savingsPlan.weekTargetSavingsAmount).toFixed(2)}).
- Verdeel de belangrijkste uitgavencategorieen (inclusief Groceries voor thuis koken versus horeca/leefstijllekken) in heldere weeklimieten.

### 3. Doelen voor de Rest van de Maand & Zenmoney Budget-advies (${savingsPlan.daysRemainingInMonth} dagen resterend)
- Vat samen hoeveel er deze maand al is uitgegeven (EUR ${new Decimal(savingsPlan.monthlyExpensesToDate).toFixed(2)}) versus het resterende variabele maandbudget (EUR ${new Decimal(savingsPlan.restOfMonthVariableSpendLimit).toFixed(2)}) en het maandspaardoel (EUR ${new Decimal(savingsPlan.targetMonthlySavingsAmount).toFixed(2)}).
- Geef een concrete lijst van bestaande Zenmoney-budgetten en NIEUWE of aangescherpte maanddoelen die de gebruiker zelf in Zenmoney kan instellen (inclusief het realistisch ophogen van een te krap Groceries-budget voor thuis koken, gedekt door het schrappen van Eating out en Matcha).

Strikte opmaakregels:
- Gebruik NOOIT emoji's.
- Gebruik NOOIT em-dashes ('—'), gebruik altijd een normaal koppelteken (' - ') of dubbele punt.
- Wees scherp, gedisciplineerd en motiverend zonder wollige taal.
`.trim();

    return geminiService.generateContent(
      prompt,
      'Je bent een scherpe, directe financiele ochtendcoach. Je stuurt elke ochtend een helder overzicht met de spaardoelen voor vandaag, deze week en de rest van de maand. Zet niet-essentiele horeca (Eating out, Matcha) bij overschrijding op EUR 0, maar behoud altijd een realistisch dagbudget voor Boodschappen (Groceries) zodat de gebruiker thuis kan koken. Gebruik nooit emoji\'s en nooit em-dashes.'
    );
  }

  private generateDeterministicMorningDigest(dataset: AdvisorDataset): string {
    const { savingsPlan, summary } = dataset;
    const groceriesRegex = /grocer|boodschap|supermark|food|voeding/i;
    const groceriesPlan = savingsPlan.categoryPlans.find((c) => groceriesRegex.test(c.category));
    const nonFoodLeaks = savingsPlan.categoryPlans
      .filter((c) => (c.isLifestyleLeak || c.needsNewZenmoneyGoal) && !groceriesRegex.test(c.category))
      .slice(0, 3);
    const leakCategories = savingsPlan.categoryPlans
      .filter((c) => c.isLifestyleLeak || c.needsNewZenmoneyGoal)
      .slice(0, 6);

    const todayBullets: string[] = [];
    for (const c of nonFoodLeaks) {
      todayBullets.push(
        `- **${c.category}**: Bespaar vandaag **EUR ${new Decimal(c.potentialDailySavings).toFixed(2)}/dag** (Houd je daguitgave op EUR ${new Decimal(c.dailyAllowanceRestOfMonth).toFixed(2)}/dag).`
      );
    }
    if (groceriesPlan) {
      todayBullets.push(
        `- **${groceriesPlan.category} (Thuis koken i.p.v. horeca)**: Dagbudget **EUR ${new Decimal(groceriesPlan.dailyAllowanceRestOfMonth).toFixed(2)}/dag** (Max EUR ${new Decimal(groceriesPlan.weeklyAllowance).toFixed(2)}/week, gedekt door Eating out & Matcha te laten staan).`
      );
    }

    const todayLeaksList =
      todayBullets.length > 0
        ? todayBullets.join('\n')
        : '- Houd niet-essentiele uitgaven vandaag op EUR 0.00 om je dagelijkse spaarbuffer maximaal op te bouwen.';

    const topWeekPlans = savingsPlan.categoryPlans.slice(0, 5);
    if (groceriesPlan && !topWeekPlans.some((c) => c.category === groceriesPlan.category)) {
      topWeekPlans.splice(1, 0, groceriesPlan);
    }

    const weekList =
      topWeekPlans
        .slice(0, 6)
        .map((c) => {
          const isGroc = groceriesRegex.test(c.category);
          const suffix = isGroc
            ? `voor boodschappen & thuis koken (${new Decimal(c.dailyAllowanceRestOfMonth).toFixed(2)}/dag)`
            : `besparingsdoel: EUR ${new Decimal(c.potentialWeeklySavings).toFixed(2)}/week`;
          return `- **${c.category}**: Max **EUR ${new Decimal(c.weeklyAllowance).toFixed(2)} deze week** (${suffix}).`;
        })
        .join('\n') || '- Geen variabele categorieen geregistreerd.';

    const monthGoalsList =
      leakCategories.length > 0
        ? leakCategories
            .map((c) => {
              const zmLabel =
                c.zenmoneyBudget !== null
                  ? `Huidig Zenmoney-budget: EUR ${new Decimal(c.zenmoneyBudget).toFixed(2)}`
                  : 'Nog geen Zenmoney-budget';
              const isBudgetIncrease =
                c.zenmoneyBudget !== null &&
                new Decimal(c.recommendedMonthlyBudget).greaterThan(c.zenmoneyBudget);
              if (isBudgetIncrease) {
                return `- **${c.category}**: Uitgegeven deze maand EUR ${new Decimal(c.spentMonthToDate).toFixed(2)} (${zmLabel}) - **Verhoog in Zenmoney naar EUR ${new Decimal(c.recommendedMonthlyBudget).toFixed(2)}/mnd** -> houdt **EUR ${new Decimal(c.dailyAllowanceRestOfMonth).toFixed(2)}/dag** vrij voor thuis koken (gedekt door horeca-stop) en bespaart alsnog **EUR ${new Decimal(c.potentialDailySavings).toFixed(2)}/dag** t.o.v. je 30-dagen gemiddelde.`;
              }
              return `- **${c.category}**: Uitgegeven deze maand EUR ${new Decimal(c.spentMonthToDate).toFixed(2)} (${zmLabel}) - **Stel in op EUR ${new Decimal(c.recommendedMonthlyBudget).toFixed(2)}/mnd in Zenmoney** -> levert **EUR ${new Decimal(c.potentialDailySavings).toFixed(2)}/dag** (EUR ${new Decimal(c.potentialMonthlySavings).toFixed(2)}/mnd) extra spaarruimte op.`;
            })
            .join('\n')
        : '- Alle categorieen lopen binnen de maanddoelen.';

    return `### 1. Doelen voor Vandaag (${savingsPlan.referenceDate})
- **Maximaal variabel dagbudget vandaag**: **EUR ${new Decimal(savingsPlan.todayTargetVariableSpendLimit).toFixed(2)}**
- **Spaardoel voor vandaag**: **EUR ${new Decimal(savingsPlan.todayTargetSavingsAmount).toFixed(2)}** (waarvan EUR ${new Decimal(savingsPlan.potentialExtraDailySavings).toFixed(2)} door leefstijllekken te schrappen)
- **Actueel liquide saldo**: EUR ${new Decimal(summary.totalLiquidBalance).toFixed(2)}

Focuspunten voor vandaag (Horeca-stop vs. Thuis koken):
${todayLeaksList}

### 2. Doelen Verspreid over Deze Week
- **Maximaal weekbudget variabele uitgaven**: **EUR ${new Decimal(savingsPlan.weekTargetVariableSpendLimit).toFixed(2)}**
- **Weekdoel sparen**: **EUR ${new Decimal(savingsPlan.weekTargetSavingsAmount).toFixed(2)}**

Maximale weekruimte per categorie:
${weekList}

### 3. Doelen voor de Rest van de Maand & Zenmoney Budget-advies (${savingsPlan.daysRemainingInMonth} dagen resterend)
- **Uitgegeven deze maand tot nu toe**: EUR ${new Decimal(savingsPlan.monthlyExpensesToDate).toFixed(2)} (Inkomsten: EUR ${new Decimal(savingsPlan.monthlyIncomeToDate).toFixed(2)})
- **Resterend variabel budget tot ${savingsPlan.currentMonthEnd}**: **EUR ${new Decimal(savingsPlan.restOfMonthVariableSpendLimit).toFixed(2)}**
- **Maandspaardoel**: **EUR ${new Decimal(savingsPlan.targetMonthlySavingsAmount).toFixed(2)}** (Huidige spaarquote: ${new Decimal(savingsPlan.currentSavingsRatePercentage).toFixed(1)}%, streefdoel: ${new Decimal(savingsPlan.targetSavingsRatePercentage).toFixed(1)}%)

Aanbevolen categoriebudgetten om in Zenmoney aan te houden of nieuw in te stellen:
${monthGoalsList}`;
  }
}

export const morningDigestService = new MorningDigestService();
