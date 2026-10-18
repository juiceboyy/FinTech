import { Resend, type CreateEmailOptions } from 'resend';

export interface EmailStatus {
  configured: boolean;
  recipient: string | null;
  sender: string;
  templateId: string | null;
  provider: 'resend' | 'unconfigured';
}

export interface EmailSendResult {
  sent: boolean;
  recipient: string | null;
  messageId?: string;
  idempotencyKey?: string;
  error?: string;
}

export interface SendEmailParams {
  subject: string;
  markdownBody: string;
  idempotencyKey?: string;
  templateVariables?: Record<string, string | number>;
}

export class EmailService {
  private getApiKey(): string | null {
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key || key === 'your_resend_api_key_here') {
      return null;
    }
    return key;
  }

  private getRecipient(): string | null {
    const to = process.env.MORNING_EMAIL_TO?.trim();
    if (to && to !== 'jouw@email.nl') {
      return to;
    }
    return 'halfhide@gmail.com';
  }

  private getSender(): string {
    return process.env.MORNING_EMAIL_FROM?.trim() || 'Fintech Coach <onboarding@resend.dev>';
  }

  private getTemplateId(): string {
    return (
      process.env.RESEND_MORNING_TEMPLATE_ID?.trim() ||
      '0aa0d86f-90d6-4da7-9572-f3fdab64ca51'
    );
  }

  public getStatus(): EmailStatus {
    const apiKey = this.getApiKey();
    const recipient = this.getRecipient();
    const configured = Boolean(apiKey && recipient);

    return {
      configured,
      recipient,
      sender: this.getSender(),
      templateId: this.getTemplateId(),
      provider: configured ? 'resend' : 'unconfigured',
    };
  }

  public async sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
    const apiKey = this.getApiKey();
    const recipient = this.getRecipient();

    if (!apiKey || !recipient) {
      return {
        sent: false,
        recipient,
        error: 'E-mail is nog niet geconfigureerd. Stel RESEND_API_KEY en MORNING_EMAIL_TO in je .env of Netlify variabelen in.',
      };
    }

    const resend = new Resend(apiKey);
    const sender = this.getSender();
    const templateId = this.getTemplateId();
    const vars = params.templateVariables ?? {};
    const sections = this.splitMarkdownSections(params.markdownBody);

    const payload: CreateEmailOptions = {
      from: sender,
      to: [recipient],
      subject: params.subject,
      template: {
        id: templateId,
        variables: {
          SUBJECT: params.subject,
          REFERENCE_DATE: String(vars.REFERENCE_DATE ?? new Date().toISOString().slice(0, 10)),
          TODAY_SPEND_LIMIT: String(vars.TODAY_SPEND_LIMIT ?? '0.00'),
          TODAY_SAVINGS_GOAL: String(vars.TODAY_SAVINGS_GOAL ?? '0.00'),
          WEEK_SPEND_LIMIT: String(vars.WEEK_SPEND_LIMIT ?? '0.00'),
          WEEK_SAVINGS_GOAL: String(vars.WEEK_SAVINGS_GOAL ?? '0.00'),
          MONTH_SAVINGS_GOAL: String(vars.MONTH_SAVINGS_GOAL ?? '0.00'),
          SECTION_TODAY: sections.today,
          SECTION_WEEK: sections.week,
          SECTION_MONTH: sections.month,
        },
      },
    };

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data, error, headers } = await resend.emails.send(
          payload,
          params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
        );

        if (!error && data) {
          console.log(`[Resend] Email sent successfully (id: ${data.id})`);
          return {
            sent: true,
            recipient,
            messageId: data.id,
            idempotencyKey: params.idempotencyKey,
          };
        }

        const statusCode = error?.statusCode ?? 400;
        const isRetryable = statusCode === 429 || statusCode >= 500;
        if (!isRetryable || attempt === maxAttempts) {
          return {
            sent: false,
            recipient,
            idempotencyKey: params.idempotencyKey,
            error: `Resend API fout (${error?.name ?? statusCode}): ${error?.message ?? 'Kon e-mail niet verzenden'}`,
          };
        }

        const retryAfterSec = Number(headers?.['retry-after']);
        const delayMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000
            : 500 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (err: unknown) {
        if (attempt === maxAttempts) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            sent: false,
            recipient,
            idempotencyKey: params.idempotencyKey,
            error: `E-mail netwerkfout: ${msg}`,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
      }
    }

    return {
      sent: false,
      recipient,
      idempotencyKey: params.idempotencyKey,
      error: 'Kon e-mail niet verzenden na meerdere pogingen.',
    };
  }

  private splitMarkdownSections(markdown: string): {
    today: string;
    week: string;
    month: string;
  } {
    const parts = markdown
      .split(/(?=^###\s+)/m)
      .map((part) => part.trim())
      .filter(Boolean);

    return {
      today: (parts[0] ?? markdown).slice(0, 1950),
      week: (parts[1] ?? '').slice(0, 1950),
      month: parts.slice(2).join('\n\n').slice(0, 1950),
    };
  }
}

export const emailService = new EmailService();
