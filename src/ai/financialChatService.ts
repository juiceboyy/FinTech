import { Decimal } from 'decimal.js';
import { geminiService, GEMINI_MODEL } from './geminiClient.js';
import { PromptContextBuilder } from './promptContextBuilder.js';
import type { AdvisorDataset } from '../engine/financeController.js';
import type { SavingsGoalsSummary } from '../engine/types.js';

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAdvisorResponse {
  reply: string;
  generatedBy: string;
  savingsPlan: SavingsGoalsSummary;
  timestamp: string;
}

export class FinancialChatService {
  public async chatWithAdvisor(params: {
    message: string;
    history?: ChatHistoryItem[];
    dataset: AdvisorDataset;
  }): Promise<ChatAdvisorResponse> {
    const { message, history = [], dataset } = params;
    let reply = '';
    let generatedBy = '';

    if (geminiService.isAvailable()) {
      try {
        reply = await this.generateGeminiReply(message, history, dataset);
        generatedBy = GEMINI_MODEL;
      } catch (err) {
        console.warn('Gemini chat generation failed, using deterministic financial coach:', err);
        reply = this.generateDeterministicReply(message, dataset);
        generatedBy = 'local-savings-coach';
      }
    } else {
      reply = this.generateDeterministicReply(message, dataset);
      generatedBy = 'local-savings-coach (voeg GEMINI_API_KEY toe voor neurale AI-chat)';
    }

    return {
      reply,
      generatedBy,
      savingsPlan: dataset.savingsPlan,
      timestamp: new Date().toISOString(),
    };
  }

  private async generateGeminiReply(
    message: string,
    history: ChatHistoryItem[],
    dataset: AdvisorDataset
  ): Promise<string> {
    const fullContext = PromptContextBuilder.buildFullFinancialContext(dataset);
    const recentHistory = history.slice(-10);
    const historyBlock =
      recentHistory.length > 0
        ? recentHistory
            .map((h) => `${h.role === 'user' ? 'GEBRUIKER' : 'FINANCIELE COACH'}: ${h.content}`)
            .join('\n\n')
        : 'Geen eerdere berichten in dit gesprek.';

    const prompt = `
Je hebt toegang tot de volledige en actuele Zenmoney financiele administratie van de gebruiker hieronder:

${fullContext}

=== EERDERE GESPREKSGESCHIEDENIS ===
${historyBlock}

=== NIEUWE VRAAG VAN DE GEBRUIKER ===
${message}

=== INSTRUCTIES VOOR JOUW ANTWOORD ===
1. Beantwoord de vraag direct, scherp en op basis van de exacte bedragen uit de bovenstaande data.
2. Leg ALTIJD de nadruk op SPAREN:
   - Benoem expliciet hoeveel euro per dag (EUR X.XX/dag) er bespaard kan of moet worden en op welk specifiek soort uitgave (categorie en winkels/horeca/koffie/matcha/impulsaankopen).
   - Geef de doelen concreet weer voor VANDAAG, DEZE WEEK en de REST VAN DE MAAND.
3. Kijk naar de Zenmoney-budgetten:
   - Gebruik bestaande Zenmoney-budgetten als basis, maar kom zelf proactief met NIEUWE of SCHERPERE maanddoelen per categorie als je ziet dat een categorie geen budget heeft of te veel geld weglekt.
   - Vermeld het exacte maandbedrag dat de gebruiker zelf in Zenmoney kan instellen als budget voor die categorie.
4. Antwoord in dezelfde taal als de gebruiker (standaard Nederlands tenzij de vraag in het Engels is).
5. Gebruik duidelijke Markdown (korte kopjes en bullet points met exacte EUR-bedragen).
6. STRIKTE REGELS: Gebruik NOOIT emoji's en gebruik NOOIT em-dashes ('—'). Gebruik gewone koppeltekens (' - ') of dubbele punten.
`.trim();

    const systemInstruction =
      'Je bent een scherpe, directe en gedisciplineerde persoonlijke financiele spaarcoach. Je analyseert de volledige Zenmoney data van de gebruiker en legt de nadruk op hoeveel euro per dag, per week en voor de rest van de maand bespaard kan worden en op welk soort uitgave (zoals uit eten, koffie/matcha, bezorging en winkelen). Je stelt concrete nieuwe maandbudgetten voor die de gebruiker in Zenmoney kan instellen. Gebruik nooit emoji\'s en nooit em-dashes.';

    return geminiService.generateContent(prompt, systemInstruction);
  }

  private generateDeterministicReply(message: string, dataset: AdvisorDataset): string {
    const { savingsPlan, summary } = dataset;
    const topSavingsCats = savingsPlan.categoryPlans
      .filter((c) => new Decimal(c.potentialMonthlySavings).greaterThan(0))
      .slice(0, 5);

    const catLines =
      topSavingsCats.length > 0
        ? topSavingsCats
            .map(
              (c) =>
                `- **${c.category}**${c.isLifestyleLeak ? ' (Leefstijllek)' : ''}: Bespaar **EUR ${new Decimal(c.potentialDailySavings).toFixed(2)} per dag** (EUR ${new Decimal(c.potentialWeeklySavings).toFixed(2)}/week | EUR ${new Decimal(c.potentialMonthlySavings).toFixed(2)}/maand). Uitgegeven afgelopen 30d: EUR ${new Decimal(c.spentLast30Days).toFixed(2)}. Voorgesteld Zenmoney-maandbudget: **EUR ${new Decimal(c.recommendedMonthlyBudget).toFixed(2)}** (Max EUR ${new Decimal(c.dailyAllowanceRestOfMonth).toFixed(2)}/dag voor de rest van de maand).`
            )
            .join('\n')
        : '- Geen directe categorie-overschrijdingen gedetecteerd; houd je variabele daglimiet scherp aan.';

    return `### Spaaradvies & Analyse op basis van je Zenmoney Data

Op basis van je vraag ("${message}") en je volledige administratie t/m ${savingsPlan.referenceDate}:

#### 1. Doelen voor Vandaag, Deze Week en de Rest van de Maand
- **Vandaag (${savingsPlan.referenceDate})**: Geef maximaal **EUR ${new Decimal(savingsPlan.todayTargetVariableSpendLimit).toFixed(2)}** uit aan variabele kosten en zet **EUR ${new Decimal(savingsPlan.todayTargetSavingsAmount).toFixed(2)}** opzij.
- **Deze Week (7 dagen)**: Houd je variabele uitgaven onder **EUR ${new Decimal(savingsPlan.weekTargetVariableSpendLimit).toFixed(2)}** en bespaar **EUR ${new Decimal(savingsPlan.weekTargetSavingsAmount).toFixed(2)}**.
- **Rest van de Maand (${savingsPlan.daysRemainingInMonth} dagen)**: Resterende variabele ruimte is **EUR ${new Decimal(savingsPlan.restOfMonthVariableSpendLimit).toFixed(2)}** om op een totale maandbesparing van **EUR ${new Decimal(savingsPlan.targetMonthlySavingsAmount).toFixed(2)}** uit te komen.

#### 2. Hoeveel Besparen per Dag & Van Welk Soort Expense
Je kunt direct **EUR ${new Decimal(savingsPlan.potentialExtraDailySavings).toFixed(2)} per dag** (EUR ${new Decimal(savingsPlan.potentialExtraMonthlySavings).toFixed(2)} per maand) extra sparen door op deze categorieen in te grijpen en de voorgestelde budgetten in Zenmoney in te stellen:
${catLines}

#### 3. Actuele Liquide Positie
- **Liquide saldo totaal**: EUR ${new Decimal(summary.totalLiquidBalance).toFixed(2)}
- **Inkomsten deze maand**: EUR ${new Decimal(savingsPlan.monthlyIncomeToDate).toFixed(2)} | **Uitgaven deze maand**: EUR ${new Decimal(savingsPlan.monthlyExpensesToDate).toFixed(2)}
- **Spaarstortingen deze maand**: EUR ${new Decimal(savingsPlan.monthlySavingsTransfersToDate).toFixed(2)}`;
  }
}

export const financialChatService = new FinancialChatService();
