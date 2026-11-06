import { createTransport } from 'nodemailer';
import {
  parseRecipients,
  type HarvestAlertConfig,
} from '../../config/app-config';
import { SMTP_TIMEOUT_MS, SmtpAlertChannel } from './alert-mailer';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

/**
 * The transport options of the SMTP channel (plan 0218, constraints): auth's
 * `MailModule` options plus three timeouts. nodemailer is mocked, so no
 * connection is opened. No value here is an address: the channel passes the
 * recipients through and never reads them (the owner, 2026-11-05).
 */

const createTransportMock = createTransport as unknown as jest.Mock;

function config(
  smtp: Partial<HarvestAlertConfig['smtp']> = {},
  recipients: string[] = ['the-recipient']
): HarvestAlertConfig {
  return {
    recipients,
    smtp: {
      host: 'smtp.example.test',
      port: 2525,
      user: '',
      pass: '',
      from: 'the-sender',
      ...smtp,
    },
    environmentName: 'slot6',
    adminAppBaseUrl: '',
  };
}

describe('SmtpAlertChannel', () => {
  let sendMail: jest.Mock;

  beforeEach(() => {
    sendMail = jest.fn(async () => ({}));
    createTransportMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail });
  });

  const optionsOf = (): Record<string, unknown> =>
    createTransportMock.mock.calls[0][0];

  it('sets secure only on port 465', async () => {
    await new SmtpAlertChannel(config({ port: 465 })).send('s', 'b');
    expect(optionsOf()).toMatchObject({ port: 465, secure: true });

    createTransportMock.mockClear();
    await new SmtpAlertChannel(config({ port: 2525 })).send('s', 'b');
    expect(optionsOf()).toMatchObject({ port: 2525, secure: false });
  });

  it('omits auth with no user, and passes it with one', async () => {
    await new SmtpAlertChannel(config()).send('s', 'b');
    expect(optionsOf()['auth']).toBeUndefined();

    createTransportMock.mockClear();
    await new SmtpAlertChannel(
      config({ user: 'the-user', pass: 'the-pass' })
    ).send('s', 'b');
    expect(optionsOf()['auth']).toEqual({
      user: 'the-user',
      pass: 'the-pass',
    });
  });

  it('sets the connection, greeting and socket timeouts to 15 seconds', async () => {
    await new SmtpAlertChannel(config()).send('s', 'b');

    expect(SMTP_TIMEOUT_MS).toBe(15_000);
    expect(optionsOf()).toMatchObject({
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
    });
  });

  it('joins the recipients of a comma separated list into one sendMail', async () => {
    const channel = new SmtpAlertChannel(
      config({}, parseRecipients('first-recipient, second-recipient'))
    );

    await channel.send('the subject', 'the body');

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'the-sender',
      to: 'first-recipient, second-recipient',
      subject: 'the subject',
      text: 'the body',
    });
  });

  it('builds the transport once, on the first send', async () => {
    const channel = new SmtpAlertChannel(config());
    expect(createTransportMock).not.toHaveBeenCalled();

    await channel.send('one', 'b');
    await channel.send('two', 'b');

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
