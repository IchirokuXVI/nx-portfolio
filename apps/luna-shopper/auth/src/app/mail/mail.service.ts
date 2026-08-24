import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  toSupportedLocale,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import * as Handlebars from 'handlebars';

/** Localized copy for the confirmation email (plan 0004, section 12). */
const COPY: Record<
  SupportedLocale,
  {
    subject: string;
    heading: string;
    body: string;
    cta: string;
    ignore: string;
  }
> = {
  en: {
    subject: 'Confirm your Luna Shopper email',
    heading: 'Confirm your email',
    body: 'Thanks for signing up. Confirm your email address to secure your account.',
    cta: 'Confirm email',
    ignore: 'If you did not create this account, you can ignore this email.',
  },
  es: {
    subject: 'Confirma tu correo de Luna Shopper',
    heading: 'Confirma tu correo',
    body: 'Gracias por registrarte. Confirma tu dirección de correo para asegurar tu cuenta.',
    cta: 'Confirmar correo',
    ignore: 'Si no creaste esta cuenta, puedes ignorar este correo.',
  },
};

const TEMPLATE = Handlebars.compile(
  `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
  <h1 style="font-size:20px">{{heading}}</h1>
  <p>{{body}}</p>
  <p><a href="{{link}}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">{{cta}}</a></p>
  <p style="color:#6b7280;font-size:13px">{{ignore}}</p>
</div>`
);

/**
 * Sends the optional confirmation email (plan 0005, section 4.2). The email
 * carries a tokenized link to the frontend's verify page; auth stores only the
 * token's hash. The message is localized to the user's locale.
 */
@Injectable()
export class MailService {
  constructor(private readonly mailer: MailerService) {}

  async sendVerificationEmail(
    to: string,
    rawToken: string,
    verifyBaseUrl: string,
    locale?: string
  ): Promise<void> {
    const resolved = toSupportedLocale(locale) ?? DEFAULT_LOCALE;
    const copy = COPY[resolved];
    const link = `${verifyBaseUrl}?token=${encodeURIComponent(rawToken)}`;

    await this.mailer.sendMail({
      to,
      subject: copy.subject,
      html: TEMPLATE({ ...copy, link }),
    });
  }
}
