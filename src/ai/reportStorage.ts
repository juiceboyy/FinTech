import fs from 'node:fs';
import path from 'node:path';
import type { NormalizedFinancialSummary } from '../engine/types.js';

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
  sourceMode: 'live' | 'mock';
  generatedBy: string;
}

const REPORTS_DIR = path.resolve(process.cwd(), 'data/reports');

export class ReportStorage {
  constructor() {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
  }

  public saveReport(params: {
    summary: NormalizedFinancialSummary;
    markdownContent: string;
    generatedBy: string;
  }): StoredReport {
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

    const filePath = path.join(REPORTS_DIR, `${id}.json`);
    const latestPath = path.join(REPORTS_DIR, 'latest.json');

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf-8');

    return report;
  }

  public getLatestReport(): StoredReport | null {
    const latestPath = path.join(REPORTS_DIR, 'latest.json');
    if (!fs.existsSync(latestPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(latestPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public listReports(): Array<Omit<StoredReport, 'markdownContent'>> {
    if (!fs.existsSync(REPORTS_DIR)) {
      return [];
    }
    const files = fs.readdirSync(REPORTS_DIR)
      .filter((f) => f.startsWith('report-') && f.endsWith('.json'))
      .sort()
      .reverse();

    const results: Array<Omit<StoredReport, 'markdownContent'>> = [];
    for (const f of files.slice(0, 20)) {
      try {
        const raw = fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8');
        const parsed: StoredReport = JSON.parse(raw);
        const { markdownContent, ...meta } = parsed;
        results.push(meta);
      } catch {
        // ignore broken files
      }
    }
    return results;
  }

  public getReportById(id: string): StoredReport | null {
    const safeId = path.basename(id);
    const target = path.join(REPORTS_DIR, `${safeId}.json`);
    if (!fs.existsSync(target)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(target, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

export const reportStorage = new ReportStorage();
