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

    return await reportStorage.saveReport({
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

    const planned = summary.plannedSchedule;
    const plannedItemsBreakdown =
      planned && planned.items.length > 0
        ? planned.items
            .map((pt) => {
              const incDec = new Decimal(pt.income || 0);
              const outDec = new Decimal(pt.outcome || 0);
              const flowLabel = pt.isTransfer
                ? `TRANSFER EUR ${outDec.greaterThan(0) ? outDec.toFixed(2) : incDec.toFixed(2)} (${pt.outcomeAccountTitle || 'Source'} -> ${pt.incomeAccountTitle || 'Target'})`
                : incDec.greaterThan(0)
                  ? `INCOME +EUR ${incDec.toFixed(2)} (into ${pt.incomeAccountTitle || 'Account'})`
                  : `EXPENSE -EUR ${outDec.toFixed(2)} (from ${pt.outcomeAccountTitle || 'Account'})`;
              const cleanNote = pt.comment ? ` | Note: ${pt.comment.replace(/<br\s*\/?>/gi, ', ').trim()}` : '';
              return `- ${pt.date} | ${flowLabel} | ${pt.payee} (${pt.categoryTitle})${cleanNote}`;
            })
            .join('\n')
        : 'No planned transactions scheduled in the upcoming window.';

    const liquidityAlertsBreakdown =
      planned && planned.liquidityAlerts.length > 0
        ? planned.liquidityAlerts
            .map(
              (al) =>
                `- ALERT on ${al.accountTitle}: Current Balance EUR ${new Decimal(al.currentBalance).toFixed(2)}, Scheduled Inflows +EUR ${new Decimal(al.plannedInflows).toFixed(2)}, Scheduled Outflows -EUR ${new Decimal(al.plannedOutflows).toFixed(2)} -> Projected Balance EUR ${new Decimal(al.projectedEndingBalance).toFixed(2)} (Shortfall: EUR ${new Decimal(al.shortfallAmount).toFixed(2)})`
            )
            .join('\n')
        : 'All accounts have sufficient balance to cover scheduled outflows.';

    const anomaliesBreakdown =
      summary.topAnomalies.length > 0
        ? summary.topAnomalies
            .map((a) => `- ${a.date} | ${a.payee} (${a.category}): EUR ${new Decimal(a.amount).toFixed(2)} - ${a.reason}`)
            .join('\n')
        : 'None detected.';

    const prompt = `
Generate an easy-to-understand 15-day financial health check and upcoming cash flow outlook for someone who is not a finance expert. Explain everything in plain, accessible English without confusing financial jargon or Wall Street buzzwords.

Historical 15-Day Summary (${summary.startDate} to ${summary.endDate}, ${summary.periodDays} days):
- Money In (Total Income): EUR ${new Decimal(summary.totalIncome).toFixed(2)}
- Money Out (Total Living Expenses): EUR ${new Decimal(summary.totalExpenses).toFixed(2)}
- Net Cash Flow (What is Left Over): EUR ${new Decimal(summary.netCashFlow).toFixed(2)}
- Savings Rate: ${new Decimal(summary.savingsRatePercentage).toFixed(1)}% of your income saved or set aside
- Cash on Hand (Liquid money across your checking and savings accounts): EUR ${new Decimal(summary.totalLiquidBalance).toFixed(2)}
- Transfers Between Your Own Accounts (Excluded from expenses): EUR ${new Decimal(summary.totalInternalTransfers || 0).toFixed(2)}
- Dedicated Savings / Buffer Deposits: EUR ${new Decimal(summary.savingsTransfersTotal || 0).toFixed(2)}
- Source Data Mode: ${summary.sourceMode.toUpperCase()}

Active Account Balances:
${accountsBreakdown}

Transfers Between Your Own Accounts (Savings buffer deposits or credit card payoffs - not expenses):
${transfersBreakdown}

Where Your Money Went (Categories):
${summary.categoryBreakdown.map((c) => `- ${c.category}: EUR ${new Decimal(c.amount).toFixed(2)} (${new Decimal(c.percentage).toFixed(1)}% of total spending)`).join('\n')}

Larger Purchases This Period (EUR 250 or more):
${anomaliesBreakdown}

Forward ${planned?.horizonDays || 30}-Day Schedule (${planned?.startDate || summary.endDate} to ${planned?.endDate || summary.endDate}):
- Expected Income: +EUR ${new Decimal(planned?.plannedIncomeTotal || 0).toFixed(2)}
- Expected Bills and Expenses: -EUR ${new Decimal(planned?.plannedExpenseTotal || 0).toFixed(2)}
- Planned Transfers: EUR ${new Decimal(planned?.plannedTransferTotal || 0).toFixed(2)}
- Expected Balance Change: EUR ${new Decimal(planned?.projectedNetCashFlow || 0).toFixed(2)}
${plannedItemsBreakdown}

Account Safety Alerts (Upcoming Shortfalls):
${liquidityAlertsBreakdown}

Guidelines for Writing This Report:
- Write for a financial beginner. Use simple, conversational, yet professional everyday language. Avoid jargon like "portfolio velocity", "discretionary vector", "gross outlays", "tactical directives", or "capital allocation".
- Explain what the numbers actually mean in plain words (e.g., "You brought in EUR X and spent EUR Y, leaving EUR Z in your pocket").
- Moving money between your own accounts (such as checking to savings buffer or paying your credit card) is NOT spending; it builds your savings cushion.
- When reviewing larger purchases, distinguish fixed essentials (like rent or car lease) from one-off or shopping expenses.
- If an account has upcoming scheduled bills that exceed its balance, clearly explain which account needs money transferred into it and by how much.
- Provide simple, practical, actionable next steps.

Format the report using clean Markdown with these exact sections:
1. ### Executive Cash Flow Assessment (Money In vs. Out)
2. ### Savings Rate & Liquidity Benchmark (Savings & Safety Cushion)
3. ### Category Velocity & Budget Analysis (Where Your Money Went)
4. ### Anomaly & Outlier Identification (Larger Purchases)
5. ### Tactical Directives for the Next 15 Days (Simple Action Plan)

Formatting constraints:
- Do NOT use any emojis.
- Do NOT use em-dashes (do not use '—'; use standard hyphens ' - ' or commas instead).
- Keep it encouraging, crystal clear, and easy to read.
`;

    return geminiService.generateContent(
      prompt,
      'You are a clear, friendly personal financial coach. Explain financial metrics in plain, everyday English that anyone can easily understand, without technical jargon, emojis, or em-dashes.'
    );
  }

  private generateDeterministicReport(summary: NormalizedFinancialSummary): string {
    const netFlowDec = new Decimal(summary.netCashFlow);
    const totalIncDec = new Decimal(summary.totalIncome);
    const totalExpDec = new Decimal(summary.totalExpenses);
    const savingsRateDec = new Decimal(summary.savingsRatePercentage);
    const liquidDec = new Decimal(summary.totalLiquidBalance);
    const savingsAllocDec = new Decimal(summary.savingsTransfersTotal || 0);
    const planned = summary.plannedSchedule;
    const plannedIncDec = new Decimal(planned?.plannedIncomeTotal || 0);
    const plannedExpDec = new Decimal(planned?.plannedExpenseTotal || 0);
    const plannedNetDec = new Decimal(planned?.projectedNetCashFlow || 0);

    const isPositiveFlow = netFlowDec.greaterThanOrEqualTo(0);
    const flowAssessment = isPositiveFlow
      ? `You had a positive cash flow of EUR ${netFlowDec.toFixed(2)}, which means you earned more than you spent over these 15 days. You are keeping more money in your pocket.`
      : `You spent EUR ${netFlowDec.abs().toFixed(2)} more than you brought in during these 15 days. That happens sometimes, but keep an eye on extra spending so you do not dip too far into savings.`;

    const forwardOutlook = planned
      ? `Looking ahead at the next ${planned.horizonDays || 30} days, you have +EUR ${plannedIncDec.toFixed(2)} in expected income and -EUR ${plannedExpDec.toFixed(2)} in scheduled bills and expenses (expected balance change: EUR ${plannedNetDec.toFixed(2)}).`
      : '';

    const topCategory = summary.categoryBreakdown[0]
      ? `${summary.categoryBreakdown[0].category} (EUR ${new Decimal(summary.categoryBreakdown[0].amount).toFixed(2)}, or ${new Decimal(summary.categoryBreakdown[0].percentage).toFixed(1)}% of your total spending)`
      : 'None recorded';

    const savingsTransferSummary =
      summary.internalTransfers && summary.internalTransfers.length > 0
        ? summary.internalTransfers
            .map((t) => `- Transfer on ${t.date}: Moved EUR ${new Decimal(t.amount).toFixed(2)} from ${t.fromAccount} to ${t.toAccount}${t.isSavingsAllocation ? ' (building your savings buffer)' : ' (account transfer)'}`)
            .join('\n')
        : '- No internal transfers between your own accounts this period.';

    const anomalyText = summary.topAnomalies.length > 0
      ? summary.topAnomalies.map((a) => `- ${a.date}: EUR ${new Decimal(a.amount).toFixed(2)} at ${a.payee} (${a.category}) - ${a.reason}`).join('\n')
      : 'No single purchases over EUR 250 were detected this period.';

    const plannedListText =
      planned && planned.items.length > 0
        ? planned.items
            .slice(0, 6)
            .map((pt) => {
              const amt = new Decimal(pt.outcome > 0 ? pt.outcome : pt.income).toFixed(2);
              const kind = pt.isTransfer ? 'Transfer' : pt.income > 0 ? 'Upcoming Income' : 'Upcoming Bill';
              return `- ${pt.date}: ${kind} of EUR ${amt} - ${pt.payee} (${pt.categoryTitle})`;
            })
            .join('\n')
        : '- No upcoming scheduled bills or transactions listed in Zenmoney.';

    const shortfallDirective =
      planned && planned.liquidityAlerts.length > 0
        ? `Transfer at least EUR ${new Decimal(planned.liquidityAlerts[0].shortfallAmount).toFixed(2)} into your ${planned.liquidityAlerts[0].accountTitle} account. It currently has EUR ${new Decimal(planned.liquidityAlerts[0].currentBalance).toFixed(2)}, but EUR ${new Decimal(planned.liquidityAlerts[0].plannedOutflows).toFixed(2)} in scheduled bills are coming up.`
        : `Aim to keep an emergency cushion of around EUR ${totalExpDec.times(3).toFixed(2)} (roughly three months of basic living costs) for peace of mind.`;

    const savingsComparison = savingsRateDec.greaterThanOrEqualTo(20)
      ? `Great job! Your savings rate of ${savingsRateDec.toFixed(1)}% meets or exceeds the common 20% savings rule of thumb (from the 50/30/20 guideline).`
      : `Your savings rate is ${savingsRateDec.toFixed(1)}%. Financial guidelines like the 50/30/20 rule suggest aiming for 20% into savings or buffer when possible.`;

    return `### Executive Cash Flow Assessment (Money In vs. Out)
${flowAssessment}

In plain numbers:
- Money In (Income): EUR ${totalIncDec.toFixed(2)}
- Money Out (Living Expenses): EUR ${totalExpDec.toFixed(2)}
- What is Left Over: EUR ${netFlowDec.toFixed(2)} across ${summary.transactionsCount} recorded events.

${forwardOutlook}

### Savings Rate & Liquidity Benchmark (Savings & Safety Cushion)
- Your Savings Rate: ${savingsRateDec.toFixed(1)}% of your income
- Money Set Aside into Savings/Buffer: EUR ${savingsAllocDec.toFixed(2)}
- Cash Ready to Spend (Liquid Balance): EUR ${liquidDec.toFixed(2)} across checking and savings
- Recommended Target: 20.0% (based on the popular 50/30/20 budgeting rule)

${savingsTransferSummary}

${savingsComparison} Remember that moving money into your buffer or savings account is not spending - it is putting money aside for your future.

### Category Velocity & Budget Analysis (Where Your Money Went)
- Biggest Spending Area: ${topCategory}
- Total Active Categories: ${summary.categoryBreakdown.length}

Top spending categories:
${summary.categoryBreakdown.slice(0, 5).map((c) => `- ${c.category}: EUR ${new Decimal(c.amount).toFixed(2)} (${new Decimal(c.percentage).toFixed(1)}% of total spending)`).join('\n')}

### Anomaly & Outlier Identification (Larger Purchases)
Here are your larger expenses of EUR 250 or more during this 15-day period, so you can easily review them:
${anomalyText}

### Tactical Directives for the Next 15 Days (Simple Action Plan)
1. Keep an eye on ${summary.categoryBreakdown[0]?.category || 'everyday spending'} to keep your cash flow healthy.
2. ${shortfallDirective}
3. Upcoming bills and transfers to keep on your radar:
${plannedListText}`;
  }
}

export const healthCheckAnalyzer = new HealthCheckAnalyzer();
