import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  toSupportedLocale,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import * as Handlebars from 'handlebars';

/** The copy every mail with a button needs (plan 0004, section 12). */
interface LinkCopy {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  ignore: string;
}

/** Localized copy for the confirmation email (plan 0004, section 12). */
const COPY: Record<SupportedLocale, LinkCopy> = {
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

/**
 * Localized copy for the password reset email (plan 0022, section 4). The expiry
 * line names the hour, because a link that stops working is a support question
 * unless the mail said so, and the ignore line carries more weight here than in
 * the confirmation mail: an unrequested reset mail is the first sign somebody is
 * trying the address.
 */
const RESET_COPY: Record<SupportedLocale, LinkCopy & { expiry: string }> = {
  en: {
    subject: 'Reset your Luna Shopper password',
    heading: 'Reset your password',
    body: 'Somebody asked to reset the password for this account. Choose a new one with the button below.',
    cta: 'Choose a new password',
    expiry: 'This link works for one hour and can be used once.',
    ignore:
      'If you did not ask for this, you can ignore this email. Your password stays as it is.',
  },
  es: {
    subject: 'Restablece tu contraseña de Luna Shopper',
    heading: 'Restablece tu contraseña',
    body: 'Alguien pidió restablecer la contraseña de esta cuenta. Elige una nueva con el botón de abajo.',
    cta: 'Elegir una contraseña nueva',
    expiry: 'Este enlace dura una hora y solo se puede usar una vez.',
    ignore:
      'Si no lo pediste, puedes ignorar este correo. Tu contraseña sigue igual.',
  },
};

/**
 * Localized copy for the reset request that lands on a Google account (plan
 * 0022, section 2.3). No link and no token: there is no password to reset, and
 * the only useful thing to say is which button gets them in. Sending nothing
 * would be correct and useless, because it is indistinguishable from a lost mail
 * and they would only ask again.
 */
const GOOGLE_COPY: Record<
  SupportedLocale,
  { subject: string; heading: string; body: string; ignore: string }
> = {
  en: {
    subject: 'Signing in to Luna Shopper',
    heading: 'This account signs in with Google',
    body: 'Somebody asked to reset the password for this account, but it has no password: it signs in with Google. Open Luna Shopper and use Continue with Google.',
    ignore: 'If you did not ask for this, you can ignore this email.',
  },
  es: {
    subject: 'Cómo entrar en Luna Shopper',
    heading: 'Esta cuenta entra con Google',
    body: 'Alguien pidió restablecer la contraseña de esta cuenta, pero no tiene contraseña: entra con Google. Abre Luna Shopper y usa Continuar con Google.',
    ignore: 'Si no lo pediste, puedes ignorar este correo.',
  },
};

const TEMPLATE = Handlebars.compile(
  `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
  <h1 style="font-size:20px">{{heading}}</h1>
  <p>{{body}}</p>
  <p><a href="{{link}}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">{{cta}}</a></p>
  {{#if expiry}}<p style="color:#6b7280;font-size:13px">{{expiry}}</p>{{/if}}
  <p style="color:#6b7280;font-size:13px">{{ignore}}</p>
</div>`
);

/** The same frame without a button, for a mail that must not carry a link. */
const PLAIN_TEMPLATE = Handlebars.compile(
  `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
  <h1 style="font-size:20px">{{heading}}</h1>
  <p>{{body}}</p>
  <p style="color:#6b7280;font-size:13px">{{ignore}}</p>
</div>`
);

/**
 * Sends the mail auth owns: the optional confirmation link (plan 0005, section
 * 4.2) and the password reset pair (plan 0022, section 4). Each carries a
 * tokenized link to the frontend, and auth stores only the token's hash. Every
 * message is localized to the user's locale.
 */
@Injectable()
export class MailService {
  constructor(private readonly mailer: MailerService) {}

  private locale(locale?: string): SupportedLocale {
    return toSupportedLocale(locale) ?? DEFAULT_LOCALE;
  }

  private link(baseUrl: string, rawToken: string): string {
    return `${baseUrl}?token=${encodeURIComponent(rawToken)}`;
  }

  async sendVerificationEmail(
    to: string,
    rawToken: string,
    verifyBaseUrl: string,
    locale?: string
  ): Promise<void> {
    const copy = COPY[this.locale(locale)];

    await this.mailer.sendMail({
      to,
      subject: copy.subject,
      html: TEMPLATE({ ...copy, link: this.link(verifyBaseUrl, rawToken) }),
    });
  }

  /** The reset link itself (plan 0022, section 4). */
  async sendPasswordResetEmail(
    to: string,
    rawToken: string,
    resetBaseUrl: string,
    locale?: string
  ): Promise<void> {
    const copy = RESET_COPY[this.locale(locale)];

    await this.mailer.sendMail({
      to,
      subject: copy.subject,
      html: TEMPLATE({ ...copy, link: this.link(resetBaseUrl, rawToken) }),
    });
  }

  /**
   * The answer for an address that signs in with Google (plan 0022, section
   * 2.3). Takes no token, because there is none to take.
   */
  async sendGoogleAccountEmail(to: string, locale?: string): Promise<void> {
    const copy = GOOGLE_COPY[this.locale(locale)];

    await this.mailer.sendMail({
      to,
      subject: copy.subject,
      html: PLAIN_TEMPLATE(copy),
    });
  }
}
