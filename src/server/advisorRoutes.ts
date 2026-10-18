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
