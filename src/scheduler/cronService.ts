import cron from 'node-cron';
import { financeController } from '../engine/financeController.js';
import { healthCheckAnalyzer } from '../ai/healthCheckAnalyzer.js';
import { morningDigestService, type MorningDigestReport } from '../ai/morningDigestService.js';
import { emailService, type EmailStatus } from '../ai/emailService.js';
import type { StoredReport } from '../ai/reportStorage.js';

export interface CronStatus {
  schedule: string;
  morningDigestSchedule: string;
  active: boolean;
  lastExecutedAt: string | null;
  lastReportId: string | null;
  lastMorningDigestAt: string | null;
  nextScheduledDescription: string;
  email: EmailStatus;
}

export class CronService {
  private scheduleExpression = '0 9 1,15 * *'; // 09:00 on the 1st and 15th of every month
  private morningDigestExpression = process.env.MORNING_DIGEST_CRON || '30 7 * * *'; // 07:30 every morning
  private task: cron.ScheduledTask | null = null;
  private morningTask: cron.ScheduledTask | null = null;
  private lastExecutedAt: string | null = null;
  private lastReportId: string | null = null;
  private lastMorningDigestAt: string | null = null;

  public start(): void {
    if (!this.task) {
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

    if (!this.morningTask) {
      this.morningTask = cron.schedule(this.morningDigestExpression, async () => {
        console.log(`[Cron] Daily morning goals email triggered: ${new Date().toISOString()}`);
        try {
          await this.runMorningDigest();
        } catch (err) {
          console.error('[Cron] Morning digest error:', err);
        }
      });
      console.log(`[Cron] Daily morning email scheduled at 07:30 (${this.morningDigestExpression})`);
    }
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

  public async runMorningDigest(): Promise<MorningDigestReport> {
    console.log('[MorningDigest] Fetching full financial dataset and savings plan...');
    const dataset = await financeController.getAdvisorDataset(15);
    const digest = await morningDigestService.generateAndSendDigest(dataset);
    this.lastMorningDigestAt = digest.generatedAt;
    console.log(
      `[MorningDigest] Digest generated (email sent: ${digest.emailResult.sent})`
    );
    return digest;
  }

  public getStatus(): CronStatus {
    return {
      schedule: this.scheduleExpression,
      morningDigestSchedule: this.morningDigestExpression,
      active: this.task !== null,
      lastExecutedAt: this.lastExecutedAt,
      lastReportId: this.lastReportId,
      lastMorningDigestAt: this.lastMorningDigestAt,
      nextScheduledDescription: 'Health Check: 1st & 15th 09:00 | Morning Goals Email: Daily 07:30',
      email: emailService.getStatus(),
    };
  }

  public stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    if (this.morningTask) {
      this.morningTask.stop();
      this.morningTask = null;
    }
  }
}

export const cronService = new CronService();
