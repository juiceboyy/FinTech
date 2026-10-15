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

      const liveMatch = existingOnAccount.find((tx) => {
        if (tx.date !== row.date) return false;
        const txAmt = new Decimal(row.direction === 'expense' ? tx.outcome : tx.income);
        if (!txAmt.equals(rowAmtDec)) return false;
        if (tx.comment && tx.comment.includes(row.idempotencyKey.slice(0, 10))) {
          return true;
        }
        const existingPayee = (tx.payee || tx.comment || '').toLowerCase();
        const candidatePayee = row.payee.toLowerCase().slice(0, 8);
        return candidatePayee.length > 0 && existingPayee.includes(candidatePayee);
      });

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

    let settledCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let settledExpenseDec = new Decimal(0);
    let settledIncomeDec = new Decimal(0);

    const results: StagedImportItem[] = [];

    for (let i = 0; i < req.items.length; i++) {
      const item = req.items[i];
      const existingLedger = settledMap.get(item.idempotencyKey);

      if (!item.selected || existingLedger) {
        skippedCount++;
        results.push({
          rowIndex: i,
          date: item.date,
          rawPayee: item.payee,
          payee: item.payee,
          amount: item.amount,
          currency: 'EUR',
          direction: item.direction,
          comment: item.comment || '',
          isRepayment: false,
          idempotencyKey: item.idempotencyKey,
          categoryId: item.categoryId,
          isDuplicate: Boolean(existingLedger),
          duplicateReason: existingLedger ? 'Already settled (idempotency guard)' : undefined,
          selected: false,
          state: existingLedger ? 'SETTLED' : 'DRAFT',
          zenmoneyTxId: existingLedger?.zenmoneyTxId,
        });
        continue;
      }

      const staged: StagedImportItem = {
        rowIndex: i,
        date: item.date,
        rawPayee: item.payee,
        payee: item.payee,
        amount: item.amount,
        currency: 'EUR',
        direction: item.direction,
        comment: item.comment || '',
        isRepayment: false,
        idempotencyKey: item.idempotencyKey,
        categoryId: item.categoryId,
        isDuplicate: false,
        selected: true,
        state: 'PENDING',
      };

      const shortRef = item.idempotencyKey.slice(0, 10);
      const commentWithRef = item.comment
        ? `${item.comment} [ing:${shortRef}]`
        : `[ing:${shortRef}]`;

      try {
        const mutationArgs = {
          accountId: targetAccount.id,
          amount: item.amount,
          date: item.date,
          categoryId: item.categoryId || undefined,
          payee: item.payee,
          comment: commentWithRef,
        };
        const mutationRes =
          item.direction === 'expense'
            ? await mcpClient.addExpense(syncData, mutationArgs)
            : await mcpClient.addIncome(syncData, mutationArgs);

        staged.state = 'SETTLED';
        staged.zenmoneyTxId = mutationRes.id;
        settledCount++;

        const amtDec = new Decimal(item.amount);
        if (item.direction === 'expense') {
          settledExpenseDec = settledExpenseDec.plus(amtDec);
        } else {
          settledIncomeDec = settledIncomeDec.plus(amtDec);
        }

        settledMap.set(item.idempotencyKey, {
          idempotencyKey: item.idempotencyKey,
          zenmoneyTxId: mutationRes.id,
          accountId: targetAccount.id,
          settledAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        staged.state = 'FAILED';
        staged.error = err instanceof Error ? err.message : String(err);
        failedCount++;
      }

      results.push(staged);
    }

    ImportLedgerStore.saveSettledLedger(settledMap);

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
