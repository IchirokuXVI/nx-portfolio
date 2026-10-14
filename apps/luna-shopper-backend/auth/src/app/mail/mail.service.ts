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
 * Localized copy for the password reset email (plan 0022, section 4; plan
 * 0210, target state 4). The expiry line names the hour, because a link that
 * stops working is a support question unless the mail said so, and the ignore
 * line carries more weight here than in the confirmation mail: an unrequested
 * reset mail is the first sign somebody is trying the address.
 *
 * **Two buttons, one grant.** The second signs in and keeps the password, for
 * the person who only lost their way in. The expiry line says that either link
 * works one time and that using one ends both, because that is what the token
 * does, and `trust` says which one to press when the password itself is the
 * worry: only the reset signs every other device out.
 */
const RESET_COPY: Record<
  SupportedLocale,
  LinkCopy & { expiry: string; signInCta: string; trust: string }
> = {
  en: {
    subject: 'Reset your Luna Shopper password',
    heading: 'Reset your password',
    body: 'Somebody asked to reset the password for this account. Choose a new one, or sign in and keep the one you have.',
    cta: 'Choose a new password',
    signInCta: 'Sign in and keep my password',
    expiry:
      'Either link works once, and using one ends both. Both stop working in one hour.',
    trust:
      'If you think somebody else knows your password, choose a new one: that also signs out every other device.',
    ignore:
      'If you did not ask for this, you can ignore this email. Your password stays as it is.',
  },
  es: {
    subject: 'Restablece tu contraseña de Luna Shopper',
    heading: 'Restablece tu contraseña',
    body: 'Alguien pidió restablecer la contraseña de esta cuenta. Elige una nueva, o entra y conserva la que tienes.',
    cta: 'Elegir una contraseña nueva',
    signInCta: 'Entrar sin cambiar la contraseña',
    expiry:
      'Cada enlace se puede usar una vez, y usar uno anula los dos. Los dos dejan de funcionar en una hora.',
    trust:
      'Si crees que otra persona conoce tu contraseña, elige una nueva: así también se cierra la sesión en todos los demás dispositivos.',
    ignore:
      'Si no lo pediste, puedes ignorar este correo. Tu contraseña sigue igual.',
  },
};

/**
 * Localized copy for the notice an account gets when an operator creates its
 * recovery links (plan 0210, decision D2). No link: the links went to the
 * operator, and the point of this mail is that the person knows a key to their
 * account exists and who to blame if they did not ask for one.
 */
const RECOVERY_NOTICE_COPY: Record<
  SupportedLocale,
  { subject: string; heading: string; body: string; ignore: string }
> = {
  en: {
    subject: 'A sign in link was created for your Luna Shopper account',
    heading: 'A sign in link was created for your account',
    body: 'A support operator created a sign in link for your account on {date}.',
    ignore: 'If you did not ask for help, change your password.',
  },
  es: {
    subject: 'Se creó un enlace de acceso para tu cuenta de Luna Shopper',
    heading: 'Se creó un enlace de acceso para tu cuenta',
    body: 'Una persona del equipo de soporte creó un enlace de acceso para tu cuenta el {date}.',
    ignore: 'Si no pediste ayuda, cambia tu contraseña.',
  },
};

/**
 * The two links of one reset grant (plan 0210, target state 4): the same
 * token, and `mode=sign-in` on the second. One base URL and one parameter
 * rather than a second variable (decision D6), so the two links cannot point
 * at two deployments.
 *
 * Exported because the operator route answers the same pair, and a second
 * copy of the format is a place for the mail and the admin panel to disagree.
 */
export function recoveryLinks(
  resetBaseUrl: string,
  rawToken: string
): { resetUrl: string; signInUrl: string } {
  const resetUrl = `${resetBaseUrl}?token=${encodeURIComponent(rawToken)}`;
  return { resetUrl, signInUrl: `${resetUrl}&mode=sign-in` };
}

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

/**
 * The reset mail (plan 0210, target state 4): the frame of {@link TEMPLATE}
 * with a second, quieter button. The reset is the filled one because it is the
 * one that closes every other way in.
 */
const RESET_TEMPLATE = Handlebars.compile(
  `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
  <h1 style="font-size:20px">{{heading}}</h1>
  <p>{{body}}</p>
  <p><a href="{{resetUrl}}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">{{cta}}</a></p>
  <p><a href="{{signInUrl}}" style="display:inline-block;padding:9px 17px;border:1px solid #4f46e5;color:#4f46e5;border-radius:6px;text-decoration:none">{{signInCta}}</a></p>
  <p style="color:#6b7280;font-size:13px">{{expiry}}</p>
  <p style="color:#6b7280;font-size:13px">{{trust}}</p>
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

  /**
   * The reset grant itself (plan 0022, section 4): both of its links, from the
   * one token (plan 0210, target state 4).
   */
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
      html: RESET_TEMPLATE({
        ...copy,
        ...recoveryLinks(resetBaseUrl, rawToken),
      }),
    });
  }

  /**
   * Tell a person that an operator created recovery links for their account
   * (plan 0210, decision D2). Takes no token: the mail must not carry one.
   *
   * The date is written out in UTC and says so, because the server does not
   * know where the person is, and a time that is silently in the wrong zone is
   * worse than one that names its zone.
   */
  async sendRecoveryLinksNotice(
    to: string,
    createdAt: Date,
    locale?: string
  ): Promise<void> {
    const supported = this.locale(locale);
    const copy = RECOVERY_NOTICE_COPY[supported];
    const date = `${new Intl.DateTimeFormat(supported, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(createdAt)} UTC`;

    await this.mailer.sendMail({
      to,
      subject: copy.subject,
      html: PLAIN_TEMPLATE({
        ...copy,
        body: copy.body.replace('{date}', date),
      }),
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
