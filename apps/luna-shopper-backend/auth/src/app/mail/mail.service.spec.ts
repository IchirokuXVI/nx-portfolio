import { MailService, recoveryLinks } from './mail.service';

/**
 * The reset mail of plan 0210 (target state 4): two links from one token, and
 * the notice of decision D2, which carries none.
 */

function build() {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const mailer = {
    sendMail: async (message: {
      to: string;
      subject: string;
      html: string;
    }) => {
      sent.push(message);
    },
  };
  return { sent, service: new MailService(mailer as never) };
}

/**
 * Every `href` in a rendered mail, with the entities Handlebars wrote decoded,
 * as a mail client decodes them.
 */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1].replace(/&#x3D;/g, '=').replace(/&amp;/g, '&')
  );
}

describe('recoveryLinks', () => {
  it('builds both links from the one token, and marks the second', () => {
    expect(
      recoveryLinks('https://velista.app/auth/reset-password', 'a+b/c')
    ).toEqual({
      resetUrl: 'https://velista.app/auth/reset-password?token=a%2Bb%2Fc',
      signInUrl:
        'https://velista.app/auth/reset-password?token=a%2Bb%2Fc&mode=sign-in',
    });
  });
});

describe('MailService', () => {
  it('renders the reset mail with two links that carry the same token', async () => {
    const { sent, service } = build();

    await service.sendPasswordResetEmail(
      'a@b.com',
      'raw-token',
      'https://x/auth/reset-password',
      'en'
    );

    expect(sent).toHaveLength(1);
    expect(hrefs(sent[0].html)).toEqual([
      'https://x/auth/reset-password?token=raw-token',
      'https://x/auth/reset-password?token=raw-token&mode=sign-in',
    ]);
    // Either link works once, using one ends both, and both last an hour.
    expect(sent[0].html).toContain('Either link works once');
    expect(sent[0].html).toContain('one hour');
    // The one line that says which link to press when the password is the
    // worry, and the ignore line, which stays.
    expect(sent[0].html).toContain('signs out every other device');
    expect(sent[0].html).toContain('you can ignore this email');
  });

  it('says the same in Spanish', async () => {
    const { sent, service } = build();

    await service.sendPasswordResetEmail('a@b.com', 't', 'https://x/r', 'es');

    expect(sent[0].subject).toBe('Restablece tu contraseña de Luna Shopper');
    expect(hrefs(sent[0].html)).toHaveLength(2);
    expect(sent[0].html).toContain('Entrar sin cambiar la contraseña');
  });

  it('sends the notice of operator links with the date and no link at all', async () => {
    const { sent, service } = build();

    await service.sendRecoveryLinksNotice(
      'a@b.com',
      new Date('2026-10-14T09:30:00Z'),
      'en'
    );

    expect(hrefs(sent[0].html)).toEqual([]);
    expect(sent[0].html).toContain(
      'A support operator created a sign in link for your account on October 14, 2026'
    );
    expect(sent[0].html).toContain('UTC');
    expect(sent[0].html).toContain(
      'If you did not ask for help, change your password.'
    );
  });
});
