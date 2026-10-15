import cron from 'node-cron';
import { financeController } from '../engine/financeController.js';
import { healthCheckAnalyzer } from '../ai/healthCheckAnalyzer.js';
import type { StoredReport } from '../ai/reportStorage.js';

export interface CronStatus {
  schedule: string;
  active: boolean;
  lastExecutedAt: string | null;
  lastReportId: string | null;
  nextScheduledDescription: string;
}

export class CronService {
  private scheduleExpression = '0 9 1,15 * *'; // 09:00 on the 1st and 15th of every month
  private task: cron.ScheduledTask | null = null;
  private lastExecutedAt: string | null = null;
  private lastReportId: string | null = null;

  public start(): void {
    if (this.task) {
      return;
    }

    this.task = cron.schedule(this.scheduleExpression, async () => {
      console.log(`[Cron] Bimonthly financial health check triggered: ${new Date().toISOString()}`);
      try {
        await this.runRoutine();
      } catch (err) {
        console.error('[Cron] Execution error:', err);
      }
    });

    console.log(`[Cron] Routine scheduled: 1st and 15th of the month at 09:00 (${this.scheduleExpression})`);
  }

  public async runRoutine(): Promise<StoredReport> {
    console.log('[Routine] Synchronizing financial metrics...');
    const summary = await financeController.getFinancialSummary(15);
    console.log(`[Routine] Generating AI health check for period ${summary.startDate} to ${summary.endDate}...`);
    const report = await healthCheckAnalyzer.analyzeAndSave(summary);
    
    this.lastExecutedAt = new Date().toISOString();
    this.lastReportId = report.id;
    console.log(`[Routine] Health check completed and archived: ${report.id}`);
    return report;
  }

  public getStatus(): CronStatus {
    return {
      schedule: this.scheduleExpression,
      active: this.task !== null,
      lastExecutedAt: this.lastExecutedAt,
      lastReportId: this.lastReportId,
      nextScheduledDescription: '1st and 15th of each month at 09:00',
    };
  }

  public stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

export const cronService = new CronService();
