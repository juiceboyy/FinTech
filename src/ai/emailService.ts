export interface EmailStatus {
  configured: boolean;
  recipient: string | null;
  sender: string;
  provider: 'resend' | 'unconfigured';
}

export interface EmailSendResult {
  sent: boolean;
  recipient: string | null;
  messageId?: string;
  error?: string;
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
    if (!to || to === 'jouw@email.nl') {
      return null;
    }
    return to;
  }

  private getSender(): string {
    return process.env.MORNING_EMAIL_FROM?.trim() || 'Fintech Coach <onboarding@resend.dev>';
  }

  public getStatus(): EmailStatus {
    const apiKey = this.getApiKey();
    const recipient = this.getRecipient();
    const configured = Boolean(apiKey && recipient);

    return {
      configured,
      recipient,
      sender: this.getSender(),
      provider: configured ? 'resend' : 'unconfigured',
    };
  }

  public async sendEmail(params: {
    subject: string;
    markdownBody: string;
  }): Promise<EmailSendResult> {
    const apiKey = this.getApiKey();
    const recipient = this.getRecipient();

    if (!apiKey || !recipient) {
      return {
        sent: false,
        recipient,
        error: 'E-mail is nog niet geconfigureerd. Stel RESEND_API_KEY en MORNING_EMAIL_TO in je .env of Netlify variabelen in.',
      };
    }

    const htmlBody = this.markdownToEditorialHtml(params.subject, params.markdownBody);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.getSender(),
          to: [recipient],
          subject: params.subject,
          html: htmlBody,
          text: params.markdownBody,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return {
          sent: false,
          recipient,
          error: `Resend API fout (HTTP ${response.status}): ${errText || 'Kon e-mail niet verzenden'}`,
        };
      }

      const data = (await response.json()) as { id?: string };
      return {
        sent: true,
        recipient,
        messageId: data.id,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        sent: false,
        recipient,
        error: `E-mail netwerkfout: ${msg}`,
      };
    }
  }

  private markdownToEditorialHtml(title: string, markdown: string): string {
    const escaped = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const lines = escaped.split('\n');
    const htmlLines: string[] = [];
    let inList = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (inList) {
          htmlLines.push('</ul>');
          inList = false;
        }
        continue;
      }

      const formattedInline = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

      if (formattedInline.startsWith('### ')) {
        if (inList) {
          htmlLines.push('</ul>');
          inList = false;
        }
        htmlLines.push(
          `<h2 style="font-size:16px;font-weight:600;color:#111827;margin:24px 0 8px 0;padding-bottom:6px;border-bottom:1px solid #e5e7eb;">${formattedInline.slice(4)}</h2>`
        );
      } else if (formattedInline.startsWith('#### ')) {
        if (inList) {
          htmlLines.push('</ul>');
          inList = false;
        }
        htmlLines.push(
          `<h3 style="font-size:14px;font-weight:600;color:#1f2937;margin:16px 0 6px 0;">${formattedInline.slice(5)}</h3>`
        );
      } else if (formattedInline.startsWith('- ') || formattedInline.startsWith('* ')) {
        if (!inList) {
          htmlLines.push('<ul style="margin:8px 0 16px 0;padding-left:20px;color:#374151;">');
          inList = true;
        }
        htmlLines.push(`<li style="margin-bottom:6px;line-height:1.5;">${formattedInline.slice(2)}</li>`);
      } else {
        if (inList) {
          htmlLines.push('</ul>');
          inList = false;
        }
        htmlLines.push(`<p style="margin:8px 0;line-height:1.6;color:#374151;">${formattedInline}</p>`);
      }
    }

    if (inList) {
      htmlLines.push('</ul>');
    }

    return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0;padding:24px;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:4px;">Zenmoney Financial Intelligence</div>
    <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 16px 0;">${title}</h1>
    ${htmlLines.join('\n')}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
      Automatische dagelijkse ochtendbriefing door Fintech Engine (Gemini 3.8 Flash).
    </div>
  </div>
</body>
</html>`;
  }
}

export const emailService = new EmailService();
