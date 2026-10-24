// Environment → server settings shared by the Node entry (main.mts) and the Vercel function
// (vercel.mts). Fails closed: production refuses to start without a secret, a real mailer and
// explicit origins. Storage is chosen by the caller.
import { randomBytes } from 'node:crypto';
import { providerFromEnv, type AiProvider } from './ai-provider.mts';
import type { Mailer } from './app.mts';
import { resendMailer } from './mailer.mts';

export type Env = Record<string, string | undefined>;

export interface EnvSettings {
  production: boolean;
  secret: string;
  mailer: Mailer;
  mailerKind: 'resend' | 'dev-console';
  ai?: AiProvider;
  aiReason: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  warnings: string[];
}

function maskEmail(email: string) {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

export function settingsFromEnv(env: Env, defaults: { origins: string[]; extraHosts?: string[] }): EnvSettings {
  const production = env.NODE_ENV === 'production';
  const warnings: string[] = [];

  let secret = env.MEISHI_SERVER_SECRET ?? '';
  if (secret.length < 32) {
    if (production) throw new Error('MEISHI_SERVER_SECRET (>= 32 chars) is required in production');
    secret = randomBytes(32).toString('hex');
    warnings.push('[dev] MEISHI_SERVER_SECRET is not set; using an ephemeral secret (OTP/e-mail hashes reset on restart).');
  }

  let mailer: Mailer;
  let mailerKind: EnvSettings['mailerKind'];
  if (env.RESEND_API_KEY) {
    if (!env.MEISHI_MAIL_FROM) throw new Error('MEISHI_MAIL_FROM is required with RESEND_API_KEY (sender on a domain verified in Resend)');
    mailer = resendMailer({ apiKey: env.RESEND_API_KEY, from: env.MEISHI_MAIL_FROM });
    mailerKind = 'resend';
  } else {
    if (production && env.MEISHI_ALLOW_DEV_MAILER !== '1') throw new Error('No production mailer is configured: set RESEND_API_KEY and MEISHI_MAIL_FROM (see docs/USER_ACTIONS.md)');
    // Development: prints the code to the server console. Never used in production.
    mailer = {
      async sendOtp(email, code) {
        console.log(`[dev-mailer] 確認コード ${code} → ${maskEmail(email)}（開発用。本番ではメール送信サービスを設定してください）`);
      },
    };
    mailerKind = 'dev-console';
  }

  const selected = providerFromEnv(env);
  const origins = (env.MEISHI_ALLOWED_ORIGINS ? env.MEISHI_ALLOWED_ORIGINS.split(',') : defaults.origins).map((s) => s.trim()).filter(Boolean);
  if (production && origins.length === 0) throw new Error('MEISHI_ALLOWED_ORIGINS is required in production');
  for (const o of origins) {
    const u = new URL(o);
    if (u.origin !== o) throw new Error(`MEISHI_ALLOWED_ORIGINS entry must be a bare origin: ${o}`);
    if (production && u.protocol !== 'https:') throw new Error(`MEISHI_ALLOWED_ORIGINS must be https in production: ${o}`);
  }
  const allowedHosts = [...new Set([...origins.map((o) => new URL(o).host.toLowerCase()), ...(defaults.extraHosts ?? [])])];
  return { production, secret, mailer, mailerKind, ai: selected.provider, aiReason: selected.reason, allowedOrigins: origins, allowedHosts, warnings };
}
