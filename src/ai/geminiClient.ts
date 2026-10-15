import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL = 'gemini-3.8-flash';

export class GeminiService {
  private client: GoogleGenAI | null = null;
  private hasValidKey = false;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.trim().length > 0 && apiKey !== 'your_gemini_api_key_here') {
      this.client = new GoogleGenAI({ apiKey: apiKey.trim() });
      this.hasValidKey = true;
    }
  }

  public isAvailable(): boolean {
    return this.hasValidKey && this.client !== null;
  }

  public async generateContent(prompt: string, systemInstruction?: string): Promise<string> {
    if (!this.client || !this.hasValidKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment.');
    }

    const response = await this.client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: systemInstruction || 'You are an elite quantitative financial analyst providing crisp, high-density financial health audits. Strictly avoid emojis and em-dashes.',
        temperature: 0.0,
      },
    });

    return response.text || '';
  }
}

export const geminiService = new GeminiService();
