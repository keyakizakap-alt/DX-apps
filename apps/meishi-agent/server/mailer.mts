// Sign-in code delivery. Production uses Resend's HTTPS API (POST /emails); the message holds the
// one-time code only (no card data). Nothing here logs the address or the code.
import type { Mailer } from './app.mts';

export interface ResendConfig {
  apiKey: string; // re_… (server-side secret; never shipped to the app)
  from: string; // e.g. "名刺管理 <no-reply@your-domain.example>" on a domain verified in Resend
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MailError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`mail provider responded ${status}`);
    this.name = 'MailError';
    this.status = status;
  }
}

export function otpMessage(code: string) {
  const subject = `名刺管理の確認コード: ${code}`;
  const text = [
    `確認コード: ${code}`,
    '',
    'このコードの有効期限は10分です。サインイン画面に入力してください。',
    'このメールに心当たりがない場合は、何もせずに破棄してください。コードを他人に伝えないでください。',
  ].join('\n');
  return { subject, text };
}

export function resendMailer(cfg: ResendConfig): Mailer {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    async sendOtp(email, code, idempotencyKey) {
      const { subject, text } = otpMessage(code);
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: JSON.stringify({ from: cfg.from, to: [email], subject, text }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
      });
      if (!res.ok) throw new MailError(res.status);
    },
  };
}
