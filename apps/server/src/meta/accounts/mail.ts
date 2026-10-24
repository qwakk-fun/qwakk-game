/**
 * Sending the account emails.
 *
 *   SMTP (SMTP_HOST set): nodemailer, implicit TLS on 465 (Hostinger), STARTTLS
 *     required on any other port, short timeouts, one connection per email.
 *     Errors are logged by code only (an SMTP reply can quote the address).
 *   Dev mail sink (no SMTP_HOST, outside production): prints the code with a
 *     masked address to the server console and keeps the last mail per
 *     address in memory, which the e2e reads through GET /api/test/mail
 *     (test hooks only).
 *   Production without SMTP_HOST: no mailer; sign-in by email answers 503.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { SmtpConfig } from '../config.ts';
import type { CodePurpose } from './codes.ts';
import type { MailContent } from './mailText.ts';

export interface MailMessage extends MailContent {
  to: string;
  /** What the mail carries, for the dev sink only (never sent or logged in production). */
  code?: string;
  purpose?: CodePurpose | 'deleted';
}

export interface Mailer {
  readonly kind: 'smtp' | 'sink';
  send(m: MailMessage): Promise<void>;
}

/** a***@example.com: enough to tell test addresses apart in a dev console, never the full address. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** The bare address of a From header ("Qwakk <noreply@qwakk.fun>" or "noreply@qwakk.fun"). */
export function senderAddress(from: string): string | null {
  const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from) ?? /^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(from);
  return m?.[1] ?? null;
}

export class SmtpMailer implements Mailer {
  readonly kind = 'smtp' as const;
  private readonly transport: Pick<Transporter, 'sendMail'>;
  private readonly from: string;
  private readonly envelopeFrom: string;

  /** `transport`: tests pass their own; default the SMTP connection below. */
  constructor(cfg: SmtpConfig, from: string, transport?: Pick<Transporter, 'sendMail'>) {
    this.from = from;
    this.envelopeFrom = senderAddress(from) ?? cfg.user;
    this.transport = transport ?? nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      requireTLS: cfg.port !== 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: 'TLSv1.2', servername: cfg.host },
      // nodemailer logs nothing unless asked; keep it that way (it would print addresses).
      logger: false,
      debug: false,
    });
  }

  async send(m: MailMessage): Promise<void> {
    try {
      // The recipient as an address object and an explicit envelope: nodemailer never re-parses
      // it, so nothing in it can turn into a display name or a second recipient.
      await this.transport.sendMail({
        from: this.from,
        to: { name: '', address: m.to },
        envelope: { from: this.envelopeFrom, to: [m.to] },
        subject: m.subject,
        text: m.text,
        html: m.html,
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
    } catch (err) {
      const e = err as { code?: string; responseCode?: number };
      console.error(`[mail] send failed: ${e.code ?? 'error'}${e.responseCode ? ` ${e.responseCode}` : ''}`);
      throw new Error('mail_failed');
    }
  }
}

export interface SinkEntry {
  code: string | null;
  purpose: string;
  subject: string;
  at: number;
}

/** Dev and tests only: nothing leaves the machine. */
export class DevMailSink implements Mailer {
  readonly kind = 'sink' as const;
  private readonly last = new Map<string, SinkEntry>();
  private readonly quiet: boolean;

  constructor(opts: { quiet?: boolean } = {}) {
    this.quiet = opts.quiet === true;
  }

  async send(m: MailMessage): Promise<void> {
    if (this.last.size > 1000) this.last.clear();
    this.last.set(m.to, { code: m.code ?? null, purpose: m.purpose ?? 'mail', subject: m.subject, at: Date.now() });
    if (!this.quiet) console.log(`[mail:dev] ${maskEmail(m.to)}: ${m.code ? `code ${m.code} (${m.purpose})` : m.subject}`);
  }

  /** The last mail to this address (test hooks). */
  lastTo(email: string): SinkEntry | null {
    return this.last.get(email) ?? null;
  }
}

/** The mailer for this configuration: SMTP, the dev sink, or none (production without SMTP). */
export function createMailer(cfg: { production: boolean; smtp: SmtpConfig | null; mailFrom: string }, quietSink = false): Mailer | null {
  if (cfg.smtp) {
    // Hostinger (and most hosts) refuse unauthenticated mail: say so at start instead of at the first sign-in.
    if (!cfg.smtp.user || !cfg.smtp.pass) console.warn('[mail] SMTP_HOST is set but SMTP_USER or SMTP_PASS is missing: the mail server will likely refuse every sign-in code. See docs/deploy.md.');
    return new SmtpMailer(cfg.smtp, cfg.mailFrom);
  }
  if (cfg.production) {
    console.warn('[mail] SMTP_HOST is not set in production: sign-in by email is off (POST /api/auth/code answers 503). See docs/deploy.md.');
    return null;
  }
  return new DevMailSink({ quiet: quietSink });
}
