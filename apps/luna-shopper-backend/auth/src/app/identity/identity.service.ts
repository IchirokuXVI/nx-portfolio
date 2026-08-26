import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthProvider,
  UserKind,
  UsernamePropagation,
  type AuthTokens,
  type DeleteAccountRequest,
  type DeleteAccountResult,
  type GetProfileRequest,
  type GoogleLoginRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResendVerificationRequest,
  type ResendVerificationResult,
  type SetUsernameRequest,
  type UpgradeRequest,
  type UserProfileView,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  THROTTLE_LIMITS,
  throttleWaitSeconds,
  UnauthorizedException,
  validateUsername,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthConfig } from '../config/app-config';
import {
  Credential,
  EmailVerification,
  OAuthIdentity,
  User,
} from '../entities';
import { IdentityEventsPublisher } from '../events/identity-events.publisher';
import { MailService } from '../mail/mail.service';
import { PasswordService } from '../password/password.service';
import { TokenGrantService } from '../tokens/token-grant.service';
import { TokenService } from '../tokens/token.service';
import { UsernameGenerator } from '../username/username-generator.service';

/** Hours an email verification link stays valid. */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** The message every failed consume answers with, whatever actually went wrong. */
const INVALID_VERIFICATION = 'Invalid or expired verification link';

/**
 * The identity domain (plan 0005, section 4). Every way a user comes to exist
 * lives here: temporary tokens, email/password registration and login, Google
 * login, in place upgrade, email verification and refresh rotation. Writes that
 * touch more than one table run in a transaction so a failure leaves no
 * half-created identity.
 */
@Injectable()
export class IdentityService {
  private readonly config: AuthConfig;

  constructor(
    private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
    private readonly grants: TokenGrantService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly events: IdentityEventsPublisher,
    private readonly usernames: UsernameGenerator,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Mint a temporary identity (plan 0005, section 4.1). Called by the gateway
   * only when a client actually creates or joins a zone, so a browsing visitor
   * leaves no account behind.
   */
  async createTemporaryUser(): Promise<AuthTokens> {
    const user = await this.dataSource.getRepository(User).save(
      this.dataSource.getRepository(User).create({
        kind: UserKind.TEMPORARY,
        // A guest is named from the moment they exist (plan 0018, section 3.4),
        // so the zone they are about to create or join has a name to record.
        username: this.usernames.generate(),
      })
    );
    return this.tokens.issueTokens(user);
  }

  /** Email + password registration (plan 0005, section 4.2). */
  async register(req: RegisterRequest): Promise<AuthTokens> {
    if (!req.email || !req.password) {
      throw new ValidationException('Email and password are required');
    }
    const email = this.normalizeEmail(req.email);

    const { user, rawVerificationToken } = await this.dataSource.transaction(
      async (manager) => {
        const existing = await manager.getRepository(User).findOne({
          where: { email },
        });
        if (existing) {
          throw new ConflictException('That email is already registered', {
            messageArgs: { field: 'email' },
          });
        }

        const user = await manager.getRepository(User).save(
          manager.getRepository(User).create({
            kind: UserKind.REGISTERED,
            email,
            displayName: req.displayName ?? null,
            // Generated regardless of any supplied `displayName`: the username is
            // a public, cross zone handle and the display name is not (0018, s1).
            username: this.usernames.generate(req.locale),
          })
        );

        const passwordHash = await this.passwords.hash(req.password);
        await manager
          .getRepository(Credential)
          .save(
            manager
              .getRepository(Credential)
              .create({ userId: user.id, passwordHash })
          );

        const rawVerificationToken = await this.createVerification(
          manager,
          user.id
        );
        return { user, rawVerificationToken };
      }
    );

    // Send the confirmation email outside the transaction; delivery failure must
    // not roll back a successful registration (verification is optional).
    await this.sendVerification(email, rawVerificationToken, req.locale);
    this.events.userRegistered({ userId: user.id });
    return this.tokens.issueTokens(user);
  }

  private createVerification(
    manager: EntityManager,
    userId: string
  ): Promise<string> {
    return this.grants.issue(
      manager,
      EmailVerification,
      { userId },
      VERIFICATION_TTL_MS
    );
  }

  private async sendVerification(
    email: string,
    rawToken: string,
    locale?: string
  ): Promise<void> {
    try {
      await this.mail.sendVerificationEmail(
        email,
        rawToken,
        this.config.smtp.verifyBaseUrl,
        locale
      );
    } catch {
      // Deliverability is a known risk (plan 0005, section 4.2); a send failure
      // is swallowed so registration still succeeds. The global logger records it.
    }
  }

  /** Email + password login (plan 0005, section 4.3). */
  async login(req: LoginRequest): Promise<AuthTokens> {
    const email = this.normalizeEmail(req.email ?? '');
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { email } });
    const credential = user
      ? await this.dataSource
          .getRepository(Credential)
          .findOne({ where: { userId: user.id } })
      : null;

    // Same error whether the email is unknown or the password is wrong, so the
    // response does not reveal which emails are registered.
    if (
      !user ||
      !credential ||
      !(await this.passwords.verify(
        credential.passwordHash,
        req.password ?? ''
      ))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.tokens.issueTokens(user);
  }

  /**
   * Consume an email verification token (plan 0005, section 4.2).
   *
   * A resend does not invalidate the link it supersedes (plan 0021, section 4.5),
   * so more than one live grant can exist and the second one to be consumed finds
   * the address already confirmed. That is a success, not a conflict: the token is
   * marked spent and nothing is emitted, because the state it would announce has
   * already been announced.
   */
  async verifyEmail(rawToken: string): Promise<{ userId: string }> {
    const { userId, confirmed } = await this.dataSource.transaction(
      async (manager) => {
        const record = await this.grants.consume(
          manager,
          EmailVerification,
          rawToken,
          INVALID_VERIFICATION
        );
        const alreadyVerified = await manager.getRepository(User).findOne({
          where: { id: record.userId },
        });
        if (alreadyVerified?.emailVerifiedAt) {
          return { userId: record.userId, confirmed: false };
        }
        await manager
          .getRepository(User)
          .update({ id: record.userId }, { emailVerifiedAt: new Date() });
        return { userId: record.userId, confirmed: true };
      }
    );

    if (confirmed) {
      this.events.userEmailVerified({ userId });
    }
    return { userId };
  }

  /**
   * Send a fresh confirmation link to the caller's own address (plan 0021,
   * section 4). Without it a lost or filtered first mail leaves an account that
   * can never be confirmed.
   *
   * The wait comes back on the success path too, so the client's "you can ask for
   * another in 0:52" state reads one field rather than inventing a number. It is
   * read from the gateway bucket that actually enforces the limit, so the two
   * cannot drift apart; a refusal carries the real remainder instead, which is
   * smaller.
   */
  async resendVerification(
    req: ResendVerificationRequest
  ): Promise<ResendVerificationResult> {
    const { email, rawVerificationToken } = await this.dataSource.transaction(
      async (manager) => {
        const user = await manager
          .getRepository(User)
          .findOne({ where: { id: req.userId } });
        if (!user) {
          throw new NotFoundException('User not found');
        }
        // Both refusals return a code rather than a quiet success: a wait would
        // be a lie, because no mail is coming and the client would count down to
        // nothing.
        if (!user.email) {
          throw new ConflictException(
            'This account has no email address to confirm'
          );
        }
        if (user.emailVerifiedAt) {
          throw new ConflictException('This email is already confirmed');
        }
        return {
          email: user.email,
          rawVerificationToken: await this.createVerification(manager, user.id),
        };
      }
    );

    await this.sendVerification(email, rawVerificationToken, req.locale);
    return {
      retryAfterSeconds: throttleWaitSeconds(THROTTLE_LIMITS.verifyResend),
    };
  }

  /** Exchange a refresh token for a fresh pair (plan 0005, section 3). */
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const userId = await this.tokens.rotate(rawRefreshToken);
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    return this.tokens.issueTokens(user);
  }

  /**
   * In place upgrade of a temporary user to a registered one (section 4.5). The
   * userId never changes, so every zone, list and line the guest owns stays theirs.
   *
   * Which branch a user took is invisible to them, so the two branches end in the
   * same place (plan 0021, section 5): an address Google already verified is
   * recorded as verified and gets no mail, and an address the user typed gets a
   * confirmation link, the way registration does.
   */
  async upgrade(req: UpgradeRequest): Promise<AuthTokens> {
    const { user, email, rawVerificationToken } =
      await this.dataSource.transaction(async (manager) => {
        const user = await manager
          .getRepository(User)
          .findOne({ where: { id: req.userId } });
        if (!user) {
          throw new NotFoundException('User not found');
        }
        if (user.kind !== UserKind.TEMPORARY) {
          throw new ConflictException('This account is already registered');
        }

        let email: string | null = null;
        let rawVerificationToken: string | null = null;

        if (req.google) {
          await this.linkGoogle(manager, user.id, req.google.providerUserId);
          if (req.google.email && !user.email) {
            const googleEmail = this.normalizeEmail(req.google.email);
            // The same check the email branch makes. Without it the partial
            // unique index on `users.email` surfaces as a raw 500 for the
            // situation the other branch answers with a conflict.
            await this.assertEmailFree(manager, googleEmail, user.id);
            user.email = googleEmail;
            // Google verified this address; asking the person to confirm it
            // again is a nudge with nothing behind it. Matches what the create
            // branch of `googleLogin` already does.
            user.emailVerifiedAt = new Date();
          }
        } else if (req.email && req.password) {
          email = this.normalizeEmail(req.email);
          await this.assertEmailFree(manager, email, user.id);
          user.email = email;
          const passwordHash = await this.passwords.hash(req.password);
          await manager
            .getRepository(Credential)
            .save(
              manager
                .getRepository(Credential)
                .create({ userId: user.id, passwordHash })
            );
          rawVerificationToken = await this.createVerification(
            manager,
            user.id
          );
        } else {
          throw new ValidationException(
            'Provide a Google identity or an email and password to upgrade'
          );
        }

        user.kind = UserKind.REGISTERED;
        if (req.displayName) {
          user.displayName = req.displayName;
        }
        return {
          user: await manager.getRepository(User).save(user),
          email,
          rawVerificationToken,
        };
      });

    // Sent outside the transaction, for the reason registration gives: delivery
    // must not roll back an upgrade that succeeded, verification is optional, and
    // the global logger records a failed send.
    if (email && rawVerificationToken) {
      await this.sendVerification(email, rawVerificationToken, req.locale);
    }

    this.events.userUpgraded({ userId: user.id });
    return this.tokens.issueTokens(user);
  }

  /** Refuses an address that already belongs to somebody else. */
  private async assertEmailFree(
    manager: EntityManager,
    email: string,
    userId: string
  ): Promise<void> {
    const taken = await manager
      .getRepository(User)
      .findOne({ where: { email } });
    if (taken && taken.id !== userId) {
      throw new ConflictException('That email is already registered', {
        messageArgs: { field: 'email' },
      });
    }
  }

  /**
   * Delete the caller's account and all personal identity data (plan 0011,
   * section 1). Deleting the `users` row cascades its credentials, OAuth
   * identities, email verifications and refresh tokens (every child FK is
   * `ON DELETE CASCADE`), so this one delete satisfies the right to be forgotten
   * for the identity data, which lives only in auth. Idempotent: if the user is
   * already gone the delete affects no rows and no event is emitted.
   */
  async deleteAccount(req: DeleteAccountRequest): Promise<DeleteAccountResult> {
    const result = await this.dataSource
      .getRepository(User)
      .delete({ id: req.userId });
    const deleted = (result.affected ?? 0) > 0;
    if (deleted) {
      this.events.userDeleted({ userId: req.userId });
    }
    return { userId: req.userId, deleted };
  }

  /**
   * Change the caller's global username (plan 0018, section 4). The column change
   * commits synchronously; the zone names follow when core consumes the event, so
   * there is a brief window where a client that already refreshed its profile
   * still sees the old name in a zone list. That is accepted: the realtime events
   * close it without a refetch, and the alternative is a distributed transaction
   * across two databases, which is the thing this architecture exists to avoid.
   */
  async setUsername(req: SetUsernameRequest): Promise<UserProfileView> {
    const username = validateUsername(req.username);
    const propagation = req.propagation ?? UsernamePropagation.GLOBAL_ONLY;

    const { user, oldUsername } = await this.dataSource.transaction(
      async (manager) => {
        const user = await manager
          .getRepository(User)
          .findOne({ where: { id: req.userId } });
        if (!user) {
          throw new NotFoundException('User not found');
        }
        const oldUsername = user.username;
        user.username = username;
        return {
          user: await manager.getRepository(User).save(user),
          oldUsername,
        };
      }
    );

    // Emitted for every mode, GLOBAL_ONLY included, so a consumer sees every
    // rename; core records a GLOBAL_ONLY event as processed and does nothing.
    this.events.userUsernameChanged({
      eventId: randomUUID(),
      userId: user.id,
      oldUsername,
      newUsername: user.username,
      propagation,
    });
    return this.toProfile(user);
  }

  /** The caller's own profile (plan 0018, section 12). */
  async getProfile(req: GetProfileRequest): Promise<UserProfileView> {
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: req.userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toProfile(user);
  }

  private toProfile(user: User): UserProfileView {
    return {
      userId: user.id,
      kind: user.kind,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      displayName: user.displayName,
    };
  }

  private async linkGoogle(
    manager: EntityManager,
    userId: string,
    providerUserId: string
  ): Promise<void> {
    const existing = await manager.getRepository(OAuthIdentity).findOne({
      where: { provider: AuthProvider.GOOGLE, providerUserId },
    });
    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        'That Google account is already linked to another user'
      );
    }
    if (!existing) {
      await manager.getRepository(OAuthIdentity).save(
        manager.getRepository(OAuthIdentity).create({
          userId,
          provider: AuthProvider.GOOGLE,
          providerUserId,
        })
      );
    }
  }

  /** Google login: find, link, or create (plan 0005, section 4.4). */
  async googleLogin(req: GoogleLoginRequest): Promise<AuthTokens> {
    const identity = await this.dataSource
      .getRepository(OAuthIdentity)
      .findOne({
        where: {
          provider: AuthProvider.GOOGLE,
          providerUserId: req.providerUserId,
        },
      });

    if (identity) {
      const user = await this.dataSource
        .getRepository(User)
        .findOneOrFail({ where: { id: identity.userId } });
      return this.tokens.issueTokens(user);
    }

    // No linked user yet: either link onto the caller's temporary user (upgrade
    // in place) or create a fresh registered user.
    if (req.linkUserId) {
      return this.upgrade({
        userId: req.linkUserId,
        google: {
          providerUserId: req.providerUserId,
          email: req.email,
          displayName: req.displayName,
        },
      });
    }

    const user = await this.dataSource.transaction(async (manager) => {
      const created = await manager.getRepository(User).save(
        manager.getRepository(User).create({
          kind: UserKind.REGISTERED,
          email: req.email ? this.normalizeEmail(req.email) : null,
          displayName: req.displayName ?? null,
          emailVerifiedAt: req.email ? new Date() : null,
          // Specifically NOT the Google profile name (plan 0018, section 1):
          // that is the person's real name, which they never chose to publish.
          username: this.usernames.generate(),
        })
      );
      await this.linkGoogle(manager, created.id, req.providerUserId);
      return created;
    });

    this.events.userRegistered({ userId: user.id });
    return this.tokens.issueTokens(user);
  }
}
