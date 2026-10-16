import { Decimal } from 'decimal.js';
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
    const accountsBreakdown =
      summary.accounts.length > 0
        ? summary.accounts
            .map((a) => `- ${a.title} [${a.type}]: EUR ${new Decimal(a.balance).toFixed(2)}`)
            .join('\n')
        : 'No active accounts listed.';

    const transfersBreakdown =
      summary.internalTransfers && summary.internalTransfers.length > 0
        ? summary.internalTransfers
            .map((t) => {
              const roleTag = t.isSavingsAllocation ? ' [Savings/Buffer Allocation]' : ' [Internal Account Transfer]';
              const cleanNote = t.comment ? ` (Note: ${t.comment.replace(/<br\s*\/?>/gi, ', ').trim()})` : '';
              return `- ${t.date} | ${t.fromAccount} -> ${t.toAccount}: EUR ${new Decimal(t.amount).toFixed(2)}${roleTag}${cleanNote}`;
            })
            .join('\n')
        : 'None recorded in this period.';

    const anomaliesBreakdown =
      summary.topAnomalies.length > 0
        ? summary.topAnomalies
            .map((a) => `- ${a.date} | ${a.payee} (${a.category}): EUR ${new Decimal(a.amount).toFixed(2)} - ${a.reason}`)
            .join('\n')
        : 'None detected.';

    const prompt = `
Generate a structured 15-day financial health audit based on the following verified financial metrics:

Financial Context (${summary.startDate} to ${summary.endDate}, ${summary.periodDays} days):
- Total External Income: EUR ${new Decimal(summary.totalIncome).toFixed(2)}
- Total External Expenses: EUR ${new Decimal(summary.totalExpenses).toFixed(2)}
- Net Cash Flow: EUR ${new Decimal(summary.netCashFlow).toFixed(2)}
- Savings Rate: ${new Decimal(summary.savingsRatePercentage).toFixed(1)}%
- Total Liquid Reserves: EUR ${new Decimal(summary.totalLiquidBalance).toFixed(2)}
- Total Internal Transfers (Excluded from Expenses): EUR ${new Decimal(summary.totalInternalTransfers || 0).toFixed(2)}
- Dedicated Savings / Buffer Allocations: EUR ${new Decimal(summary.savingsTransfersTotal || 0).toFixed(2)}
- Source Data Mode: ${summary.sourceMode.toUpperCase()}

Active Account Balances:
${accountsBreakdown}

Internal Account Transfers & Savings Allocations (Excluded from Gross Income & Expenses):
${transfersBreakdown}

Category Expenses Breakdown (External Outflows Only):
${summary.categoryBreakdown.map((c) => `- ${c.category}: EUR ${new Decimal(c.amount).toFixed(2)} (${new Decimal(c.percentage).toFixed(1)}% of expenses)`).join('\n')}

Detected High-Value External Expenditures (>= EUR 250):
${anomaliesBreakdown}

Domain Rules & Analytical Guidance:
- Internal transfers between the user's own accounts (such as Privé -> Buffer savings allocations or Privé -> ING Creditcard settlements) are NOT expenses and have already been excluded from Total External Expenses and Anomalies.
- Explicitly acknowledge transfers into Buffer or savings accounts as disciplined capital allocation and reserve building within the Savings Rate & Liquidity Benchmark section.
- When evaluating high-value expenditures, distinguish fixed contractual obligations (such as lease car payments, rent, or household bills noted in transaction comments) from discretionary spending outliers.

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
    const netFlowDec = new Decimal(summary.netCashFlow);
    const totalIncDec = new Decimal(summary.totalIncome);
    const totalExpDec = new Decimal(summary.totalExpenses);
    const savingsRateDec = new Decimal(summary.savingsRatePercentage);
    const liquidDec = new Decimal(summary.totalLiquidBalance);
    const savingsAllocDec = new Decimal(summary.savingsTransfersTotal || 0);

    const isPositiveFlow = netFlowDec.greaterThanOrEqualTo(0);
    const flowAssessment = isPositiveFlow
      ? `The portfolio produced a positive cash flow of EUR ${netFlowDec.toFixed(2)}, demonstrating disciplined expenditure control across the 15-day reporting cycle.`
      : `The portfolio experienced a net negative cash flow of EUR ${netFlowDec.abs().toFixed(2)}, requiring immediate monitoring of discretionary outflow.`;

    const topCategory = summary.categoryBreakdown[0]
      ? `${summary.categoryBreakdown[0].category} (EUR ${new Decimal(summary.categoryBreakdown[0].amount).toFixed(2)}, ${new Decimal(summary.categoryBreakdown[0].percentage).toFixed(1)}% of total outlays)`
      : 'None recorded';

    const savingsTransferSummary =
      summary.internalTransfers && summary.internalTransfers.length > 0
        ? summary.internalTransfers
            .map((t) => `- Internal Transfer (${t.date}): EUR ${new Decimal(t.amount).toFixed(2)} from ${t.fromAccount} to ${t.toAccount}${t.isSavingsAllocation ? ' (Savings/Buffer allocation)' : ''}`)
            .join('\n')
        : '- No internal account transfers recorded during this cycle.';

    const anomalyText = summary.topAnomalies.length > 0
      ? summary.topAnomalies.map((a) => `- ${a.date}: EUR ${new Decimal(a.amount).toFixed(2)} at ${a.payee} (${a.category}) - ${a.reason}`).join('\n')
      : 'No external transactions met or exceeded the outlier threshold of EUR 250.';

    const emergencyReserveTarget = totalExpDec.times(3).toFixed(2);

    return `### Executive Cash Flow Assessment
${flowAssessment} Total external revenue stood at EUR ${totalIncDec.toFixed(2)} against gross external outlays of EUR ${totalExpDec.toFixed(2)} across ${summary.transactionsCount} recorded events.

### Savings Rate & Liquidity Benchmark
- Observed Cash Flow Savings Rate: ${savingsRateDec.toFixed(1)}%
- Dedicated Buffer / Savings Transfers: EUR ${savingsAllocDec.toFixed(2)}
- Target Benchmark: 20.0% (50/30/20 guideline)
- Liquid Capital Available: EUR ${liquidDec.toFixed(2)}
${savingsTransferSummary}
The current savings rate ${savingsRateDec.greaterThanOrEqualTo(20) ? 'meets and exceeds' : 'falls short of'} the classical 20% accumulation threshold.

### Category Velocity & Budget Analysis
- Primary Expenditure Vector: ${topCategory}
- Total Active Categories: ${summary.categoryBreakdown.length}
${summary.categoryBreakdown.slice(0, 5).map((c) => `- ${c.category}: EUR ${new Decimal(c.amount).toFixed(2)} (${new Decimal(c.percentage).toFixed(1)}%)`).join('\n')}

### Anomaly & Outlier Identification
${anomalyText}

### Tactical Directives for the Next 15 Days
1. Calibrate discretionary outlays in ${summary.categoryBreakdown[0]?.category || 'high-volume categories'} to maintain net positive liquidity.
2. Maintain emergency cash reserves at or above EUR ${emergencyReserveTarget} to cover three months of basic operational expenses.
3. Review auto-renewing subscriptions and non-essential merchant charges before the upcoming cycle reconciliation.`;
  }
}

export const healthCheckAnalyzer = new HealthCheckAnalyzer();
