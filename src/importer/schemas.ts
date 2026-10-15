import { z } from 'zod';

export const LedgerStateSchema = z.enum(['DRAFT', 'PENDING', 'SETTLED', 'FAILED']);
export type LedgerState = z.infer<typeof LedgerStateSchema>;

export const TransactionDirectionSchema = z.enum(['expense', 'income']);
export type TransactionDirection = z.infer<typeof TransactionDirectionSchema>;

export const ParsedCsvRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  rawPayee: z.string().min(1),
  payee: z.string().min(1),
  amount: z.string().regex(/^\d+\.\d{2}$/, 'Must be normalized 2-decimal string'),
  currency: z.string().default('EUR'),
  direction: TransactionDirectionSchema,
  comment: z.string().default(''),
  isRepayment: z.boolean(),
  idempotencyKey: z.string().min(16),
});

export type ParsedCsvRow = z.infer<typeof ParsedCsvRowSchema>;

export const StagedImportItemSchema = ParsedCsvRowSchema.extend({
  categoryId: z.string().optional(),
  categoryTitle: z.string().optional(),
  isDuplicate: z.boolean(),
  duplicateReason: z.string().optional(),
  selected: z.boolean(),
  state: LedgerStateSchema,
  zenmoneyTxId: z.string().optional(),
  error: z.string().optional(),
});

export type StagedImportItem = z.infer<typeof StagedImportItemSchema>;

export const PreviewCsvRequestSchema = z.object({
  csvContent: z.string().min(1, 'CSV file content cannot be empty'),
  fileName: z.string().optional(),
  accountId: z.string().optional(),
});

export type PreviewCsvRequest = z.infer<typeof PreviewCsvRequestSchema>;

export const ConfirmedItemInputSchema = z.object({
  idempotencyKey: z.string().min(16),
  selected: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee: z.string().min(1),
  amount: z.string().regex(/^\d+\.\d{2}$/),
  direction: TransactionDirectionSchema,
  categoryId: z.string().optional(),
  comment: z.string().optional(),
});

export type ConfirmedItemInput = z.infer<typeof ConfirmedItemInputSchema>;

export const CommitImportRequestSchema = z.object({
  batchId: z.string().min(1),
  accountId: z.string().min(1, 'Target Zenmoney account ID is required'),
  items: z.array(ConfirmedItemInputSchema).min(1),
});

export type CommitImportRequest = z.infer<typeof CommitImportRequestSchema>;

export interface ImportBatch {
  batchId: string;
  createdAt: string;
  fileName?: string;
  targetAccountId: string;
  targetAccountTitle: string;
  totalRows: number;
  selectedExpenseTotal: string;
  selectedIncomeTotal: string;
  skippedRepaymentCount: number;
  skippedDuplicateCount: number;
  items: StagedImportItem[];
}

export interface CommitBatchSummary {
  batchId: string;
  accountId: string;
  settledCount: number;
  failedCount: number;
  skippedCount: number;
  settledExpenseTotal: string;
  settledIncomeTotal: string;
  items: StagedImportItem[];
}
