import { createTransport, type Transporter } from 'nodemailer';
import type { HarvestAlertConfig } from '../../config/app-config';

/**
 * Where an alert mail goes (plan 0218, section 9). One method, so a chat
 * webhook can be a second class and a configuration key later rather than a
 * redesign. The owner chose email first (2026-11-05), and no webhook exists.
 */
export interface AlertChannel {
  /** Deliver one message, or throw with the transport's answer. */
  send(subject: string, body: string): Promise<void>;
}

/** The DI token of the one channel the worker sends through. */
export const ALERT_CHANNEL = Symbol('ALERT_CHANNEL');

/**
 * How long a connection, the server's greeting and an idle socket may each
 * take. A blocked port hangs rather than fails (`values.yaml`, the SMTP
 * note), and a worker that hangs sends nothing else.
 */
export const SMTP_TIMEOUT_MS = 15_000;

/** Whether this deployment can send at all: a host and a sender. */
export function smtpConfigured(config: HarvestAlertConfig): boolean {
  return Boolean(config.smtp.host) && Boolean(config.smtp.from);
}

/**
 * The SMTP relay auth already uses, with nodemailer directly (plan 0218,
 * constraints). The transport options are auth's `MailModule` ones:
 * `secure` only on port 465, and no auth block when no user is configured,
 * which is how Mailpit on a slot takes a mail. The three timeouts are added.
 *
 * The transport is built on the first send, so a deployment that never
 * alerts never opens a connection.
 */
export class SmtpAlertChannel implements AlertChannel {
  private transport?: Transporter;

  constructor(private readonly config: HarvestAlertConfig) {}

  async send(subject: string, body: string): Promise<void> {
    const { smtp, recipients } = this.config;
    this.transport ??= createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
    await this.transport.sendMail({
      from: smtp.from,
      to: recipients.join(', '),
      subject,
      text: body,
    });
  }
}
