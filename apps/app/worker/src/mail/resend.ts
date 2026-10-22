// Transactional e-mail through Resend's HTTP API (spec 07, feature A). No SDK: one POST per message.
// Without RESEND_API_KEY nothing is sent: local dev and tests log the message (with its link) to the
// console; a deployed Worker logs a warning without the link, so a missing key shows in the logs
// without writing a live reset token into them.
import { isLocalOrigin } from '@tie/worker-core';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** Used when MAIL_FROM is unset: Resend's shared test sender (delivers only to the account owner). */
export const DEFAULT_MAIL_FROM = 'Take It Easy <onboarding@resend.dev>';
const TIMEOUT_MS = 10_000;

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Short label for logs ('auth.reset'); never the address or the body. */
  tag: string;
  /** Logged instead of the body when no key is configured in local dev (e.g. the reset link). */
  devNote?: string;
}

export type MailResult = { sent: true; id: string | null } | { sent: false; reason: string };

export interface MailEnv {
  APP_ORIGIN: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

export interface MailOptions {
  /** Override for tests. */
  fetcher?: typeof fetch;
}

/** Sends one message. Never throws: a failure is logged and returned, so callers can ignore it. */
export async function sendMail(env: MailEnv, msg: MailMessage, opts: MailOptions = {}): Promise<MailResult> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    if (isLocalOrigin(env.APP_ORIGIN)) {
      console.log(`[mail:${msg.tag}] RESEND_API_KEY is not set; not sent. ${msg.devNote ?? msg.subject}`);
    } else {
      console.warn(JSON.stringify({ level: 'warn', msg: 'mail not sent: RESEND_API_KEY is not set', tag: msg.tag }));
    }
    return { sent: false, reason: 'no_key' };
  }
  try {
    const res = await (opts.fetcher ?? fetch)(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        tags: [{ name: 'kind', value: msg.tag.replace(/[^\w-]/g, '_') }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Resend's error body names the problem (unverified domain, bad key); it never echoes the key.
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      console.error(
        JSON.stringify({ level: 'error', msg: 'mail send failed', tag: msg.tag, status: res.status, detail }),
      );
      return { sent: false, reason: `http_${res.status}` };
    }
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { sent: true, id: typeof data?.id === 'string' ? data.id : null };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'mail send failed', tag: msg.tag, error: String(err) }));
    return { sent: false, reason: 'network' };
  }
}
