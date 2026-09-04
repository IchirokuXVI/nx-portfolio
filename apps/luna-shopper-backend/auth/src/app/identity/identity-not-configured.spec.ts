import { NotConfiguredException } from '@portfolio/luna-shopper/platform';
import { fakeAudit } from '../audit/auth-audit.testing';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';

/**
 * What auth does when Google or SMTP is unset (plan 0026).
 *
 * The point of these is that the refusal happens BEFORE any work: no user row,
 * no token, no lookup against credentials that do not exist. A registration that
 * got as far as writing the user would leave an account whose confirmation link
 * is never sent, which is unreachable rather than merely failed.
 */
describe('IdentityService with a feature unconfigured', () => {
  /**
   * Every collaborator is a bare mock that throws if touched, so a test passes
   * only if the guard refused before reaching any of them.
   */
  function makeService(config: {
    google: { enabled: boolean };
    smtp: { enabled: boolean };
  }) {
    const dataSource = {
      transaction: jest.fn(async () => {
        throw new Error(
          'the guard should have refused before any database work'
        );
      }),
      getRepository: jest.fn(() => {
        throw new Error(
          'the guard should have refused before any database work'
        );
      }),
    };
    const mail = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
      sendOAuthAccountNotice: jest.fn(),
    };

    const service = new IdentityService(
      dataSource as never,
      { issueTokens: jest.fn(), revokeAllForUser: jest.fn() } as never,
      new TokenGrantService(),
      { hash: jest.fn(), verify: jest.fn() } as never,
      mail as never,
      {} as never,
      new UsernameGenerator(),
      fakeAudit([]).service,
      { getOrThrow: () => config } as never
    );

    return { service, dataSource, mail };
  }

  describe('with no SMTP host', () => {
    const config = { google: { enabled: true }, smtp: { enabled: false } };

    it('refuses to register', async () => {
      const { service, mail } = makeService(config);

      await expect(
        service.register({ email: 'a@example.com', password: 'hunter22!' })
      ).rejects.toBeInstanceOf(NotConfiguredException);
      expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('refuses to resend a verification', async () => {
      const { service } = makeService(config);

      await expect(
        service.resendVerification({ userId: 'u1' })
      ).rejects.toBeInstanceOf(NotConfiguredException);
    });

    it('refuses to start a password reset', async () => {
      const { service } = makeService(config);

      await expect(
        service.forgotPassword({ email: 'a@example.com' })
      ).rejects.toBeInstanceOf(NotConfiguredException);
    });

    it('still allows a Google upgrade, which sends no mail', async () => {
      // The address Google returns is already verified, so this branch never
      // needed SMTP. Refusing it would make an SMTP-less cluster unable to sign
      // anyone in at all, which is the opposite of the point.
      const { service } = makeService(config);

      // It gets past the configuration guard and fails at the database double
      // instead, which is how this asserts "not refused for configuration".
      await expect(
        service.upgrade({
          userId: 'u1',
          google: { providerUserId: 'g1', email: 'a@example.com' },
        })
      ).rejects.not.toBeInstanceOf(NotConfiguredException);
    });
  });

  describe('with no Google credentials', () => {
    const config = { google: { enabled: false }, smtp: { enabled: true } };

    it('refuses a Google login', async () => {
      const { service } = makeService(config);

      await expect(
        service.googleLogin({ providerUserId: 'g1', email: 'a@example.com' })
      ).rejects.toBeInstanceOf(NotConfiguredException);
    });

    it('refuses a Google upgrade', async () => {
      const { service } = makeService(config);

      await expect(
        service.upgrade({
          userId: 'u1',
          google: { providerUserId: 'g1', email: 'a@example.com' },
        })
      ).rejects.toBeInstanceOf(NotConfiguredException);
    });

    it('still allows an email upgrade', async () => {
      // Google being off says nothing about the password flow.
      const { service } = makeService(config);

      await expect(
        service.upgrade({
          userId: 'u1',
          email: 'a@example.com',
          password: 'hunter22!',
        })
      ).rejects.not.toBeInstanceOf(NotConfiguredException);
    });
  });
});
