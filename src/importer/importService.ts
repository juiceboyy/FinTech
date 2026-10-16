import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { mcpClient } from '../mcp/client.js';
import type { ZenmoneyAccount, ZenmoneyCategory, ZenmoneySyncData } from '../mcp/types.js';
import { IngCsvParser } from './ingCsvParser.js';
import { ImportLedgerStore } from './importLedger.js';
import {
  CommitImportRequestSchema,
  PreviewCsvRequestSchema,
  StagedImportItemSchema,
  type CommitBatchSummary,
  type CommitImportRequest,
  type ImportBatch,
  type PreviewCsvRequest,
  type StagedImportItem,
} from './schemas.js';

export class IngImportService {
  private draftBatches = new Map<string, ImportBatch>();

  public async createPreviewBatch(rawReq: PreviewCsvRequest): Promise<{
    batch: ImportBatch;
    accounts: ZenmoneyAccount[];
    categories: ZenmoneyCategory[];
  }> {
    const req = PreviewCsvRequestSchema.parse(rawReq);
    const parsedRows = IngCsvParser.parse(req.csvContent);
    const syncData = await this.fetchLiveZenmoneyContext();

    const targetAccount = ImportLedgerStore.resolveTargetAccount(syncData.accounts, req.accountId);
    const categories = syncData.categories || [];
    const settledMap = ImportLedgerStore.loadSettledLedger();

    const uniquePayees = Array.from(new Set(parsedRows.map((r) => r.payee)));
    const suggestions = await mcpClient.suggestCategories(uniquePayees, categories);

    const existingOnAccount = syncData.transactions.filter(
      (tx) => tx.outcomeAccount === targetAccount.id || tx.incomeAccount === targetAccount.id
    );

    let selectedExpenseDec = new Decimal(0);
    let selectedIncomeDec = new Decimal(0);
    let skippedRepaymentCount = 0;
    let skippedDuplicateCount = 0;

    const stagedItems: StagedImportItem[] = parsedRows.map((row) => {
      const rowAmtDec = new Decimal(row.amount);
      const ledgerHit = settledMap.get(row.idempotencyKey);

      const shortRef = row.idempotencyKey.slice(0, 10);
      const liveMatch = ImportLedgerStore.findLiveZenmoneyMatch(
        existingOnAccount,
        row.date,
        row.direction,
        rowAmtDec,
        shortRef,
        row.payee
      );

      const isDuplicate = Boolean(ledgerHit || liveMatch);
      const duplicateReason = ledgerHit
        ? 'Already imported in previous CSV batch'
        : liveMatch
          ? 'Matching date, amount, and payee already in Zenmoney'
          : undefined;

      if (row.isRepayment) skippedRepaymentCount++;
      if (isDuplicate) skippedDuplicateCount++;

      const suggestion = suggestions.get(row.payee);
      const fallbackCat = !suggestion?.categoryId
        ? ImportLedgerStore.matchHeuristicCategory(row.payee, categories)
        : undefined;

      const categoryId = suggestion?.categoryId ?? fallbackCat?.id;
      const categoryTitle = suggestion?.categoryTitle ?? fallbackCat?.title;
      const normalizedPayee = suggestion?.normalizedPayee || row.payee;

      const selected = !row.isRepayment && !isDuplicate;
      if (selected) {
        if (row.direction === 'expense') {
          selectedExpenseDec = selectedExpenseDec.plus(rowAmtDec);
        } else {
          selectedIncomeDec = selectedIncomeDec.plus(rowAmtDec);
        }
      }

      return StagedImportItemSchema.parse({
        ...row,
        payee: normalizedPayee,
        categoryId,
        categoryTitle,
        isDuplicate,
        duplicateReason,
        selected,
        state: 'DRAFT',
        zenmoneyTxId: ledgerHit?.zenmoneyTxId ?? liveMatch?.id,
      });
    });

    const batch: ImportBatch = {
      batchId: `batch-${Date.now()}-${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      fileName: req.fileName,
      targetAccountId: targetAccount.id,
      targetAccountTitle: targetAccount.title,
      totalRows: stagedItems.length,
      selectedExpenseTotal: selectedExpenseDec.toFixed(2),
      selectedIncomeTotal: selectedIncomeDec.toFixed(2),
      skippedRepaymentCount,
      skippedDuplicateCount,
      items: stagedItems,
    };

    this.draftBatches.set(batch.batchId, batch);

    return {
      batch,
      accounts: syncData.accounts,
      categories,
    };
  }

  public async commitBatch(rawReq: CommitImportRequest): Promise<CommitBatchSummary> {
    const req = CommitImportRequestSchema.parse(rawReq);
    const syncData = await this.fetchLiveZenmoneyContext();
    const targetAccount = ImportLedgerStore.resolveTargetAccount(syncData.accounts, req.accountId);
    const settledMap = ImportLedgerStore.loadSettledLedger();

    const existingOnAccount = syncData.transactions.filter(
      (tx) => tx.outcomeAccount === targetAccount.id || tx.incomeAccount === targetAccount.id
    );

    const prepared = ImportLedgerStore.prepareCommitItems(
      req.items,
      targetAccount.id,
      existingOnAccount,
      settledMap
    );

    let settledCount = prepared.settledCount;
    let failedCount = 0;
    const skippedCount = prepared.skippedCount;
    let settledExpenseDec = prepared.settledExpenseDec;
    let settledIncomeDec = prepared.settledIncomeDec;
    const itemsToCreate = prepared.itemsToCreate;
    const itemStagingMap = prepared.itemStagingMap;

    if (itemsToCreate.length > 0) {
      try {
        const mutationResults = await mcpClient.commitTransactionsBatch(syncData, itemsToCreate);
        for (const created of itemsToCreate) {
          const res = mutationResults.get(created.idempotencyKey);
          const txId = res?.id || randomUUID();
          settledCount++;
          const amtDec = new Decimal(created.amount);
          if (created.direction === 'expense') {
            settledExpenseDec = settledExpenseDec.plus(amtDec);
          } else {
            settledIncomeDec = settledIncomeDec.plus(amtDec);
          }
          settledMap.set(created.idempotencyKey, {
            idempotencyKey: created.idempotencyKey,
            zenmoneyTxId: txId,
            accountId: targetAccount.id,
            settledAt: new Date().toISOString(),
          });
          itemStagingMap.set(created.rowIndex, {
            rowIndex: created.rowIndex,
            date: created.date,
            rawPayee: created.payee || '',
            payee: created.payee || '',
            amount: created.amount,
            currency: 'EUR',
            direction: created.direction,
            comment: created.comment || '',
            isRepayment: false,
            idempotencyKey: created.idempotencyKey,
            categoryId: created.categoryId,
            isDuplicate: false,
            selected: false,
            state: 'SETTLED',
            zenmoneyTxId: txId,
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failedCount += itemsToCreate.length;
        for (const created of itemsToCreate) {
          itemStagingMap.set(created.rowIndex, {
            rowIndex: created.rowIndex,
            date: created.date,
            rawPayee: created.payee || '',
            payee: created.payee || '',
            amount: created.amount,
            currency: 'EUR',
            direction: created.direction,
            comment: created.comment || '',
            isRepayment: false,
            idempotencyKey: created.idempotencyKey,
            categoryId: created.categoryId,
            isDuplicate: false,
            selected: true,
            state: 'FAILED',
            error: errMsg,
          });
        }
      }
    }

    ImportLedgerStore.saveSettledLedger(settledMap);
    const results: StagedImportItem[] = [];
    for (let i = 0; i < req.items.length; i++) {
      const entry = itemStagingMap.get(i);
      if (entry) results.push(entry);
    }

    return {
      batchId: req.batchId,
      accountId: targetAccount.id,
      settledCount,
      failedCount,
      skippedCount,
      settledExpenseTotal: settledExpenseDec.toFixed(2),
      settledIncomeTotal: settledIncomeDec.toFixed(2),
      items: results,
    };
  }

  private async fetchLiveZenmoneyContext(): Promise<ZenmoneySyncData> {
    let status = mcpClient.getStatus();
    if (!status.connected) {
      const ok = await mcpClient.connect();
      status = mcpClient.getStatus();
      if (!ok) {
        throw new Error(
          status.error || 'Zenmoney MCP is disconnected. Connect your token first before importing.'
        );
      }
    }

    const syncData = await mcpClient.getSyncData();
    if (!syncData) {
      throw new Error('Failed to synchronize live Zenmoney state prior to CSV import.');
    }
    return syncData;
  }
}

export const ingImportService = new IngImportService();
