import fs from 'node:fs';
import path from 'node:path';
import type { NormalizedFinancialSummary } from '../engine/types.js';
import { blobsAdapter, type ReportMetadata } from './blobsStorage.js';

export interface StoredReport {
  id: string;
  createdAt: string;
  periodDays: number;
  startDate: string;
  endDate: string;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRatePercentage: number;
  markdownContent: string;
  sourceMode: 'live';
  generatedBy: string;
}

const isServerless = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const REPORTS_DIR = isServerless ? path.join('/tmp', 'reports') : path.resolve(process.cwd(), 'data/reports');

export class ReportStorage {
  private inMemoryCache: Map<string, StoredReport> = new Map();
  private latestInMemory: StoredReport | null = null;
  private hasSeededBlobs = false;

  constructor() {
    try {
      if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
      }
    } catch {
      // Non-fatal in read-only serverless environments
    }
  }

  public async saveReport(params: {
    summary: NormalizedFinancialSummary;
    markdownContent: string;
    generatedBy: string;
  }): Promise<StoredReport> {
    const id = `report-${Date.now()}`;
    const report: StoredReport = {
      id,
      createdAt: new Date().toISOString(),
      periodDays: params.summary.periodDays,
      startDate: params.summary.startDate,
      endDate: params.summary.endDate,
      totalIncome: params.summary.totalIncome,
      totalExpenses: params.summary.totalExpenses,
      netCashFlow: params.summary.netCashFlow,
      savingsRatePercentage: params.summary.savingsRatePercentage,
      markdownContent: params.markdownContent,
      sourceMode: params.summary.sourceMode,
      generatedBy: params.generatedBy,
    };

    // 1. In-memory cache
    this.inMemoryCache.set(id, report);
    this.latestInMemory = report;

    // 2. Filesystem persistence
    try {
      const filePath = path.join(REPORTS_DIR, `${id}.json`);
      const latestPath = path.join(REPORTS_DIR, 'latest.json');
      fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
      fs.writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf-8');
    } catch {
      // In-memory ensures accessibility even if filesystem is read-only
    }

    // 3. Netlify Blobs cloud persistence (survives app updates & deploy cycles)
    await blobsAdapter.saveReport(report);

    return report;
  }

  public async getLatestReport(): Promise<StoredReport | null> {
    if (this.latestInMemory) {
      return this.latestInMemory;
    }

    // Check Netlify Blobs
    const fromBlobs = await blobsAdapter.getLatestReport();
    if (fromBlobs) {
      this.latestInMemory = fromBlobs;
      this.inMemoryCache.set(fromBlobs.id, fromBlobs);
      return fromBlobs;
    }

    // Check local filesystem
    const latestPath = path.join(REPORTS_DIR, 'latest.json');
    if (fs.existsSync(latestPath)) {
      try {
        const raw = fs.readFileSync(latestPath, 'utf-8');
        const parsed: StoredReport = JSON.parse(raw);
        this.latestInMemory = parsed;
        this.inMemoryCache.set(parsed.id, parsed);
        return parsed;
      } catch {
        // ignore invalid file
      }
    }

    return null;
  }

  public async listReports(): Promise<ReportMetadata[]> {
    const reportMap = new Map<string, ReportMetadata>();

    // 1. In-memory cache entries
    for (const report of Array.from(this.inMemoryCache.values())) {
      const { markdownContent, ...meta } = report;
      reportMap.set(meta.id, meta);
    }

    // 2. Netlify Blobs cloud entries
    const blobsReports = await blobsAdapter.listReports();
    for (const r of blobsReports) {
      if (!reportMap.has(r.id)) {
        reportMap.set(r.id, r);
      }
    }

    // 3. Local filesystem entries
    if (fs.existsSync(REPORTS_DIR)) {
      try {
        const files = fs
          .readdirSync(REPORTS_DIR)
          .filter((f) => f.startsWith('report-') && f.endsWith('.json'))
          .sort()
          .reverse();

        for (const f of files.slice(0, 30)) {
          const reportId = f.replace('.json', '');
          if (!reportMap.has(reportId)) {
            try {
              const raw = fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8');
              const parsed: StoredReport = JSON.parse(raw);
              const { markdownContent, ...meta } = parsed;
              reportMap.set(meta.id, meta);

              // Auto-seed to Blobs if Blobs is available and this item wasn't in Blobs
              if (blobsAdapter.isAvailable() && !this.hasSeededBlobs) {
                blobsAdapter.saveReport(parsed).catch(() => {});
              }
            } catch {
              // ignore invalid file
            }
          }
        }
        this.hasSeededBlobs = true;
      } catch {
        // ignore filesystem read error
      }
    }

    const results = Array.from(reportMap.values());
    results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return results;
  }

  public async getReportById(id: string): Promise<StoredReport | null> {
    if (this.inMemoryCache.has(id)) {
      return this.inMemoryCache.get(id) || null;
    }

    // Check Netlify Blobs
    const fromBlobs = await blobsAdapter.getReportById(id);
    if (fromBlobs) {
      this.inMemoryCache.set(fromBlobs.id, fromBlobs);
      return fromBlobs;
    }

    // Check local filesystem
    const safeId = path.basename(id);
    const target = path.join(REPORTS_DIR, `${safeId}.json`);
    if (fs.existsSync(target)) {
      try {
        const raw = fs.readFileSync(target, 'utf-8');
        const parsed: StoredReport = JSON.parse(raw);
        this.inMemoryCache.set(parsed.id, parsed);
        return parsed;
      } catch {
        return null;
      }
    }

    return null;
  }

  public async reconcileReports(reports: StoredReport[]): Promise<ReportMetadata[]> {
    for (const report of reports) {
      if (!report || !report.id || !report.markdownContent) continue;

      if (!this.inMemoryCache.has(report.id)) {
        this.inMemoryCache.set(report.id, report);
      }

      // Persist to disk if not exists
      try {
        const filePath = path.join(REPORTS_DIR, `${report.id}.json`);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
        }
      } catch {
        // ignore disk error
      }

      // Persist to Netlify Blobs
      await blobsAdapter.saveReport(report);
    }

    return this.listReports();
  }
}

export const reportStorage = new ReportStorage();
