import { geminiService, GEMINI_MODEL } from './geminiClient.js';
import { reportStorage, type StoredReport } from './reportStorage.js';
import type { NormalizedFinancialSummary } from '../engine/types.js';

export class HealthCheckAnalyzer {
  public async analyzeAndSave(summary: NormalizedFinancialSummary): Promise<StoredReport> {
    let markdownContent = '';
    let generatedBy = '';

    if (geminiService.isAvailable()) {
      try {
        markdownContent = await this.generateGeminiReport(summary);
        generatedBy = GEMINI_MODEL;
      } catch (err) {
        console.warn('Gemini report generation failed, using local analytical engine:', err);
        markdownContent = this.generateDeterministicReport(summary);
        generatedBy = 'local-rule-engine';
      }
    } else {
      markdownContent = this.generateDeterministicReport(summary);
      generatedBy = 'local-rule-engine (add GEMINI_API_KEY for neural analysis)';
    }

    return reportStorage.saveReport({
      summary,
      markdownContent,
      generatedBy,
    });
  }

  private async generateGeminiReport(summary: NormalizedFinancialSummary): Promise<string> {
    const prompt = `
Generate a structured 15-day financial health audit based on the following verified financial metrics:

Financial Context (${summary.startDate} to ${summary.endDate}, ${summary.periodDays} days):
- Total Income: EUR ${summary.totalIncome.toFixed(2)}
- Total Expenses: EUR ${summary.totalExpenses.toFixed(2)}
- Net Cash Flow: EUR ${summary.netCashFlow.toFixed(2)}
- Savings Rate: ${summary.savingsRatePercentage.toFixed(1)}%
- Total Liquid Reserves: EUR ${summary.totalLiquidBalance.toFixed(2)}
- Source Data Mode: ${summary.sourceMode.toUpperCase()}

Category Expenses Breakdown:
${summary.categoryBreakdown.map((c) => `- ${c.category}: EUR ${c.amount.toFixed(2)} (${c.percentage.toFixed(1)}% of expenses)`).join('\n')}

Detected Outlier & Anomalous Transactions:
${summary.topAnomalies.length > 0 ? summary.topAnomalies.map((a) => `- ${a.date} | ${a.payee} (${a.category}): EUR ${a.amount.toFixed(2)} - ${a.reason}`).join('\n') : 'None detected.'}

Format the report using clean Markdown with these exact sections:
1. ### Executive Cash Flow Assessment
2. ### Savings Rate & Liquidity Benchmark
3. ### Category Velocity & Budget Analysis
4. ### Anomaly & Outlier Identification
5. ### Tactical Directives for the Next 15 Days

Formatting constraints:
- Do NOT use any emojis.
- Do NOT use em-dashes (do not use '—'; use standard hyphens ' - ' or commas instead).
- Maintain a direct, quantitative, and professional editorial tone.
`;

    return geminiService.generateContent(
      prompt,
      'You are a senior quantitative wealth advisor. Present crisp financial diagnosis without conversational banter, emojis, or em-dashes.'
    );
  }

  private generateDeterministicReport(summary: NormalizedFinancialSummary): string {
    const isPositiveFlow = summary.netCashFlow >= 0;
    const flowAssessment = isPositiveFlow
      ? `The portfolio produced a positive cash flow of EUR ${summary.netCashFlow.toFixed(2)}, demonstrating disciplined expenditure control across the 15-day reporting cycle.`
      : `The portfolio experienced a net negative cash flow of EUR ${Math.abs(summary.netCashFlow).toFixed(2)}, requiring immediate monitoring of discretionary outflow.`;

    const topCategory = summary.categoryBreakdown[0]
      ? `${summary.categoryBreakdown[0].category} (EUR ${summary.categoryBreakdown[0].amount.toFixed(2)}, ${summary.categoryBreakdown[0].percentage.toFixed(1)}% of total outlays)`
      : 'None recorded';

    const anomalyText = summary.topAnomalies.length > 0
      ? summary.topAnomalies.map((a) => `- ${a.date}: EUR ${a.amount.toFixed(2)} at ${a.payee} (${a.category}) - ${a.reason}`).join('\n')
      : 'No transactions met or exceeded the outlier threshold of EUR 250.';

    return `### Executive Cash Flow Assessment
${flowAssessment} Total revenue stood at EUR ${summary.totalIncome.toFixed(2)} against gross outlays of EUR ${summary.totalExpenses.toFixed(2)} across ${summary.transactionsCount} recorded events.

### Savings Rate & Liquidity Benchmark
- Observed Savings Rate: ${summary.savingsRatePercentage.toFixed(1)}%
- Target Benchmark: 20.0% (50/30/20 guideline)
- Liquid Capital Available: EUR ${summary.totalLiquidBalance.toFixed(2)}
The current savings rate ${summary.savingsRatePercentage >= 20 ? 'meets and exceeds' : 'falls short of'} the classical 20% accumulation threshold.

### Category Velocity & Budget Analysis
- Primary Expenditure Vector: ${topCategory}
- Total Active Categories: ${summary.categoryBreakdown.length}
${summary.categoryBreakdown.slice(0, 5).map((c) => `- ${c.category}: EUR ${c.amount.toFixed(2)} (${c.percentage.toFixed(1)}%)`).join('\n')}

### Anomaly & Outlier Identification
${anomalyText}

### Tactical Directives for the Next 15 Days
1. Calibrate discretionary outlays in ${summary.categoryBreakdown[0]?.category || 'high-volume categories'} to maintain net positive liquidity.
2. Maintain emergency cash reserves at or above EUR ${(summary.totalExpenses * 3).toFixed(2)} to cover three months of basic operational expenses.
3. Review auto-renewing subscriptions and non-essential merchant charges before the upcoming cycle reconciliation.`;
  }
}

export const healthCheckAnalyzer = new HealthCheckAnalyzer();
