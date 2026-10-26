import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { financeController } from '../engine/financeController.js';
import { financialChatService } from '../ai/financialChatService.js';
import { cronService } from '../scheduler/cronService.js';

export const advisorRouter = Router();

const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, 'Bericht mag niet leeg zijn').max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .max(20)
    .optional(),
});

const ApplyBudgetsRequestSchema = z.object({
  monthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/, 'Datum moet formaat YYYY-MM-01 hebben')
    .optional(),
  budgets: z
    .array(
      z.object({
        categoryId: z.string().min(1, 'Category ID is verplicht'),
        categoryTitle: z.string().optional(),
        amount: z.union([
          z.number().min(0, 'Budgetbedrag mag niet negatief zijn'),
          z.string().regex(/^\d+(\.\d{1,2})?$/, 'Ongeldig bedrag'),
        ]),
      })
    )
    .min(1, 'Minimaal één budgetdoel vereist'),
});

// Get Daily, Weekly & Monthly Savings Plan + Zenmoney Category Budget Recommendations
advisorRouter.get('/savings-plan', async (_req: Request, res: Response) => {
  try {
    const savingsPlan = await financeController.getSavingsGoals();
    res.json(savingsPlan);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Apply AI Financial Coach Recommended Budgets to Zenmoney with One Click
advisorRouter.post('/apply-budgets', async (req: Request, res: Response) => {
  try {
    const parsed = ApplyBudgetsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Ongeldige budgetaanvraag',
        details: parsed.error.format(),
      });
      return;
    }

    const { monthDate, budgets } = parsed.data;
    const items = budgets.map((b) => ({
      categoryId: b.categoryId,
      amount: b.amount,
      monthDate,
    }));

    const result = await financeController.applyBudgetGoals(items);
    res.json({
      success: true,
      appliedCount: result.appliedCount,
      updatedBudgets: result.updatedBudgets,
      savingsPlan: result.savingsPlan,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Interactive Chat with AI Financial Coach (Full Zenmoney Data in Prompt)
advisorRouter.post('/chat', async (req: Request, res: Response) => {
  try {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Ongeldig chatverzoek',
        details: parsed.error.format(),
      });
      return;
    }

    const dataset = await financeController.getAdvisorDataset(15);
    const result = await financialChatService.chatWithAdvisor({
      message: parsed.data.message,
      history: parsed.data.history,
      dataset,
    });

    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Trigger & Send Daily Morning Goals Email
advisorRouter.post('/morning-digest', async (_req: Request, res: Response) => {
  try {
    const digest = await cronService.runMorningDigest();
    res.json({
      success: true,
      digest,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
