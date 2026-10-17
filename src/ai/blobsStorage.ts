import { getStore } from '@netlify/blobs';
import type { StoredReport } from './reportStorage.js';

export interface ReportMetadata {
  id: string;
  createdAt: string;
  periodDays: number;
  startDate: string;
  endDate: string;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRatePercentage: number;
  sourceMode: 'live';
  generatedBy: string;
}

export class NetlifyBlobsAdapter {
  private storeName = 'reports';
  private warnedUnavailable = false;

  private getStoreInstance() {
    try {
      const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID;
      const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

      if (siteID && token) {
        return getStore({
          name: this.storeName,
          siteID,
          token,
          consistency: 'strong',
        });
      }

      return getStore({
        name: this.storeName,
        consistency: 'strong',
      });
    } catch (err: unknown) {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
      }
      return null;
    }
  }

  public isAvailable(): boolean {
    const store = this.getStoreInstance();
    return store !== null;
  }

  public async saveReport(report: StoredReport): Promise<boolean> {
    const store = this.getStoreInstance();
    if (!store) return false;

    try {
      const { markdownContent, ...meta } = report;

      // 1. Save specific report JSON
      await store.setJSON(report.id, report);

      // 2. Save latest report JSON
      await store.setJSON('latest', report);

      // 3. Update report index for fast listing
      const currentIndex = await this.listReports();
      const filtered = currentIndex.filter((r) => r.id !== report.id);
      const updatedIndex: ReportMetadata[] = [meta, ...filtered].slice(0, 50);

      await store.setJSON('index', updatedIndex);
      return true;
    } catch {
      return false;
    }
  }

  public async getReportById(id: string): Promise<StoredReport | null> {
    const store = this.getStoreInstance();
    if (!store) return null;

    try {
      const data = await store.get(id, { type: 'json' });
      return (data as StoredReport) || null;
    } catch {
      return null;
    }
  }

  public async getLatestReport(): Promise<StoredReport | null> {
    const store = this.getStoreInstance();
    if (!store) return null;

    try {
      const data = await store.get('latest', { type: 'json' });
      return (data as StoredReport) || null;
    } catch {
      return null;
    }
  }

  public async listReports(): Promise<ReportMetadata[]> {
    const store = this.getStoreInstance();
    if (!store) return [];

    try {
      const indexData = await store.get('index', { type: 'json' });
      if (Array.isArray(indexData) && indexData.length > 0) {
        return indexData as ReportMetadata[];
      }

      // Fallback: list individual report blobs
      const { blobs } = await store.list({ prefix: 'report-' });
      const results: ReportMetadata[] = [];

      for (const b of blobs.slice(0, 20)) {
        try {
          const item = (await store.get(b.key, { type: 'json' })) as StoredReport;
          if (item && item.id) {
            const { markdownContent, ...meta } = item;
            results.push(meta);
          }
        } catch {
          // ignore broken blob
        }
      }

      results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return results;
    } catch {
      return [];
    }
  }
}

export const blobsAdapter = new NetlifyBlobsAdapter();
