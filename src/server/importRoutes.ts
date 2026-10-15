import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { ingImportService } from '../importer/importService.js';
import { CommitImportRequestSchema, PreviewCsvRequestSchema } from '../importer/schemas.js';

export const importRouter = Router();

importRouter.post('/ing-csv/preview', async (req: Request, res: Response) => {
  try {
    const validated = PreviewCsvRequestSchema.parse(req.body);
    const preview = await ingImportService.createPreviewBatch(validated);
    res.json({
      success: true,
      ...preview,
    });
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: `Validation error: ${err.issues.map((issue) => issue.message).join(', ')}`,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

importRouter.post('/ing-csv/commit', async (req: Request, res: Response) => {
  try {
    const validated = CommitImportRequestSchema.parse(req.body);
    const summary = await ingImportService.commitBatch(validated);
    res.json({
      success: true,
      summary,
    });
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: `Validation error: ${err.issues.map((issue) => issue.message).join(', ')}`,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
