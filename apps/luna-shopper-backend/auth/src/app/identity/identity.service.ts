import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthProvider,
  UserKind,
  UsernamePropagation,
  type AuthTokens,
  type ConsumeOAuthStateRequest,
  type DeleteAccountRequest,
  type DeleteAccountResult,
  type ForgotPasswordRequest,
  type GetProfileRequest,
  type GoogleLoginRequest,
  type LoginRequest,
  type MintOAuthStateRequest,
  type MintOAuthStateResult,
  type OAuthStatePayload,
  type RegisterRequest,
  type ResendVerificationRequest,
  type ResendVerificationResult,
  type ResetPasswordRequest,
  type RetryAfterResult,
  type SetUsernameRequest,
  type UpgradeRequest,
  type UserProfileView,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotConfiguredException,
  NotFoundException,
  THROTTLE_LIMITS,
  throttleWaitSeconds,
  UnauthorizedException,
  validateUsername,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
  AuthAuditService,
  type AuditedWrite,
} from '../audit/auth-audit.service';
import type { AuthConfig } from '../config/app-config';
import {
  Credential,
  EmailVerification,
  OAuthIdentity,
  OAuthState,
  PasswordReset,
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
 * How long a reset link lives (plan 0022, section 1). One hour: long enough to
 * survive a mail queue and a walk to a laptop, short enough that a link sitting
 * in an unattended inbox stops being a key by lunchtime.
 */
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * The one answer an unknown, expired or already spent reset token gets. Telling
 * them apart would tell an attacker which of their guesses was once real.
 */
const INVALID_RESET = 'Invalid or expired password reset link';

/**
 * How long an OAuth state lives (plan 0023, section 4.1). Ten minutes: a consent
 * screen and a password, not a lunch break. It only has to survive the time
 * between tapping the button and Google handing the browser back, and every extra
 * minute is another minute a state sits in a database being replayable.
 */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The one answer an absent, unknown, expired or already spent state gets. It
 * deliberately does not fall back to "no link" (section 4.4): proceeding without
 * the `userId` a state was carrying is exactly the data loss this plan exists to
 * stop, and a silent fallback would make it depend on a race between a token's
 * expiry and a user's typing speed.
 */
const INVALID_OAUTH_STATE = 'Invalid or expired sign in request';

/**
 * The identity domain (plan 0005, section 4). Every way a user comes to exist
 * lives here: temporary tokens, email/password registration and login, Google
 * login, in place upgrade, email verification and refresh rotation. Writes that
 * touch more than one table run in a transaction so a failure leaves no
 * half-created identity.
 *
 * ## The `AsOperator` methods
 *
 * Four methods end in `AsOperator`, and the suffix is the contract rather than
 * decoration (plan 0077, section 2). Each one is the write its user facing twin
 * makes, with the caller's own identity check replaced by an operator gate the
 * caller has already passed, and each one records what it did in the audit trail
 * inside the same transaction. Reading the method names is how somebody sees
 * which writes here can be made against a stranger's account, and a future author
 * cannot add a fifth without saying so in its name.
 */
@Injectable()
export class IdentityService {
  private readonly config: AuthConfig;

  // A field rather than a constructor dependency, so that a mail failure becomes
  // visible without every spec in this folder having to build one.
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
    private readonly grants: TokenGrantService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly events: IdentityEventsPublisher,
    private readonly usernames: UsernameGenerator,
    // The operator trail (plan 0077, section 8). Only the `AsOperator` methods
    // reach it: a person changing their own name is not an operator write, and
    // recording one would fill the trail with the ordinary use of the product.
    private readonly audit: AuthAuditService,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Refuse a flow that depends on a delivered email when no SMTP host is set
   * (plan 0026, section 3.4).
   *
   * The alternative is worse than an error: registration would accept the signup,
   * write the user, and never send the confirmation link, leaving an account
   * nobody can reach. Answering `not_configured` says what is true about the
   * deployment instead.
   */
  private requireMail(): void {
    if (!this.config.smtp.enabled) {
      throw new NotConfiguredException('No SMTP host is configured');
    }
  }

  /**
   * Refuse a Google flow when the OAuth credentials are unset (plan 0026,
   * section 3.2). The gateway rejects the interactive routes before they get
   * this far; this covers the broker patterns directly, so the answer is the
   * same whichever way the call arrives.
   */
  private requireGoogle(): void {
    if (!this.config.google.enabled) {
      throw new NotConfiguredException('Google sign in is not configured');
    }
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
    // Before the write, not after: an account created here is unreachable
    // without the confirmation mail.
    this.requireMail();
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

        const { raw: rawVerificationToken } = await this.createVerification(
          manager,
          user.id
        );
        return { user, rawVerificationToken };
      }
    );

    // Send the confirmation email outside the transaction; delivery failure must
    // not roll back a successful registration (verification is optional).
    this.sendVerification(email, rawVerificationToken, req.locale);
    this.events.userRegistered({ userId: user.id });
    return this.tokens.issueTokens(user);
  }

  /**
   * A fresh confirmation grant: the raw token to mail, and the row that stores
   * its hash.
   *
   * The row comes back because the operator path records it in the audit trail
   * (plan 0077, section 8), and a trail names the row it describes by id. The
   * two user facing callers take `raw` and drop it.
   */
  private createVerification(
    manager: EntityManager,
    userId: string
  ): Promise<{ raw: string; record: EmailVerification }> {
    return this.grants.issueRecord(
      manager,
      EmailVerification,
      { userId },
      VERIFICATION_TTL_MS
    );
  }

  /**
   * Hand a message to the mailer without holding the request open for it.
   *
   * **Catching was never enough, and that is the defect this exists for.** Every
   * send site already swallowed a rejection so that a dead mail server could not
   * fail a registration that had succeeded. A blocked port does not reject: it
   * hangs, and an awaited hang is indistinguishable from a slow request. Both
   * clusters ran for months with the SMTP port blocked outbound, so every send
   * sat on a connection that never opened until the ingress gave up at fifteen
   * seconds, and `POST /v1/auth/register` answered 504 for an account it had
   * already written. The person saw a failure, their account existed, and
   * retrying told them the address was taken.
   *
   * So the send is dispatched rather than awaited. The response no longer
   * depends on the mail server being reachable, which is the property the
   * swallow was reaching for and could not have on its own.
   *
   * **It also removes a timing signal.** `requestPasswordReset` answers the same
   * thing for an address with an account and one without, deliberately, so that
   * the response cannot be used to test whether somebody is registered. It could
   * still be timed: the branch that sent a mail waited for the SMTP round trip
   * and the branch that sent nothing did not. Neither waits now.
   *
   * A failure is logged rather than swallowed silently. The old comments claimed
   * the global logger recorded it, and nothing did: the catch blocks were empty,
   * which is part of why a total mail outage went unnoticed.
   */
  private dispatchMail(what: string, send: () => Promise<void>): void {
    // `Promise.resolve().then(send)` rather than `send().catch(...)`, so that a
    // sender which throws synchronously is caught by the same handler as one
    // that rejects, and so that a stand in returning nothing is not a crash.
    void Promise.resolve()
      .then(send)
      .catch((error: unknown) => {
        this.logger.warn(
          `${what} could not be sent: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  }

  private sendVerification(
    email: string,
    rawToken: string,
    locale?: string
  ): void {
    this.dispatchMail('the confirmation email', () =>
      this.mail.sendVerificationEmail(
        email,
        rawToken,
        this.config.smtp.verifyBaseUrl,
        locale
      )
    );
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
    this.requireMail();
    const { email, rawVerificationToken } = await this.dataSource.transaction(
      (manager) => this.issueResend(manager, req.userId)
    );

    this.sendVerification(email, rawVerificationToken, req.locale);
    return {
      retryAfterSeconds: throttleWaitSeconds(THROTTLE_LIMITS.verifyResend),
    };
  }

  /**
   * Send the confirmation mail again, on somebody else's behalf (plan 0077,
   * section 8).
   *
   * The same grant {@link resendVerification} mints, from the same helper, with
   * the role check that never existed here replaced by the operator gate the
   * caller has already passed. Auth's own refusals still apply: an account with
   * no address, or one already confirmed, is a conflict for an operator exactly
   * as it is for the person themselves, because both are statements about the
   * account rather than about the caller.
   *
   * **The grant row is what the trail records**, and it is a real answer rather
   * than a stand-in for one. `email_verifications` gains a row saying a
   * confirmation link for this user was minted and when it expires, which is
   * precisely what the operator did. Its `tokenHash` is dropped on the way in, so
   * a trail nobody prunes never holds a live link.
   */
  async resendVerificationAsOperator(
    targetUserId: string,
    actorId: string,
    locale?: string
  ): Promise<ResendVerificationResult> {
    this.requireMail();
    const { email, rawVerificationToken } = await this.audit.write(
      actorId,
      async (tx) => {
        const issued = await this.issueResend(tx.manager, targetUserId);
        await tx.recordCreate(EmailVerification, issued.verification);
        return issued;
      }
    );

    this.sendVerification(email, rawVerificationToken, locale);
    return {
      retryAfterSeconds: throttleWaitSeconds(THROTTLE_LIMITS.verifyResend),
    };
  }

  /** The refusals and the grant both resend paths share. */
  private async issueResend(
    manager: EntityManager,
    userId: string
  ): Promise<{
    email: string;
    rawVerificationToken: string;
    verification: EmailVerification;
  }> {
    const user = await manager
      .getRepository(User)
      .findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // Both refusals return a code rather than a quiet success: a wait would be a
    // lie, because no mail is coming and the client would count down to nothing.
    if (!user.email) {
      throw new ConflictException(
        'This account has no email address to confirm'
      );
    }
    if (user.emailVerifiedAt) {
      throw new ConflictException('This email is already confirmed');
    }
    const { raw, record } = await this.createVerification(manager, user.id);
    return {
      email: user.email,
      rawVerificationToken: raw,
      verification: record,
    };
  }

  /**
   * Ask for a password reset link (plan 0022, section 2).
   *
   * Every address gets the same answer: the same body, the same wait, and as
   * close to the same work as this can manage. An unknown address is not a 404
   * and a Google account is not a conflict, because `login()` already refuses to
   * say which addresses are registered and an endpoint that answered differently
   * here would hand back the enumeration oracle that decision exists to close.
   *
   * The difference lives only in the inbox of somebody who already controls the
   * address: a password account gets a link, a Google account gets the mail that
   * tells them which button signs them in (section 2.3), and an address with no
   * account gets nothing.
   */
  async forgotPassword(req: ForgotPasswordRequest): Promise<RetryAfterResult> {
    // The deliberate non disclosure below (never say whether an address has an
    // account) does not apply to this refusal: it is about the server, not about
    // the address, so it leaks nothing and answering it uniformly is right.
    this.requireMail();
    const email = this.normalizeEmail(req.email ?? '');
    const outcome = await this.dataSource.transaction(async (manager) => {
      const user = email
        ? await manager.getRepository(User).findOne({ where: { email } })
        : null;
      if (!user) {
        return null;
      }
      const credential = await manager
        .getRepository(Credential)
        .findOne({ where: { userId: user.id } });
      if (!credential) {
        // No password to reset. Section 2.3: they still hear back, because
        // silence is indistinguishable from a lost mail and they would only ask
        // again.
        return { google: true as const, rawToken: null };
      }
      return {
        google: false as const,
        rawToken: await this.grants.issue(
          manager,
          PasswordReset,
          { userId: user.id },
          RESET_TTL_MS
        ),
      };
    });

    // Outside the transaction, as registration sends its confirmation: a send
    // failure must not roll back a grant the user may still receive by another
    // route.
    //
    // Dispatched rather than awaited, which matters more here than anywhere
    // else. This method answers identically whether or not the address has an
    // account, so that the answer cannot be used to test who is registered. An
    // awaited send made the two branches take measurably different times, so the
    // secret the body withholds was readable off the clock instead.
    if (outcome?.google) {
      this.dispatchMail('the Google sign in email', () =>
        this.mail.sendGoogleAccountEmail(email, req.locale)
      );
    } else if (outcome?.rawToken) {
      this.dispatchMail('the password reset email', () =>
        this.mail.sendPasswordResetEmail(
          email,
          outcome.rawToken,
          this.config.smtp.resetBaseUrl,
          req.locale
        )
      );
    }

    // The same number for everyone, including the address with no account. A
    // shorter wait for the cases that send nothing would answer the question the
    // rest of this method refuses to answer.
    return {
      retryAfterSeconds: throttleWaitSeconds(THROTTLE_LIMITS.passwordReset),
    };
  }

  /**
   * Spend a reset link (plan 0022, section 3). Writes the new password, revokes
   * every session that existed before this call, marks the address verified if it
   * was not, and signs the caller in.
   *
   * All of it happens in the transaction that consumes the token, so a failure
   * leaves no half reset account. The new pair is issued after the transaction
   * commits, which is also after the revoke, so the person resetting keeps the
   * session this call gives them and whoever else held one does not.
   */
  async resetPassword(req: ResetPasswordRequest): Promise<AuthTokens> {
    const passwordHash = await this.passwords.hash(req.password ?? '');

    const { user, confirmed } = await this.dataSource.transaction(
      async (manager) => {
        const record = await this.grants.consume(
          manager,
          PasswordReset,
          req.token ?? '',
          INVALID_RESET
        );
        const user = await manager
          .getRepository(User)
          .findOne({ where: { id: record.userId } });
        if (!user) {
          // The cascade takes outstanding grants with a deleted user, so this is
          // unreachable in practice; it answers with the token error rather than
          // a 500 if it ever is reached.
          throw new ValidationException(INVALID_RESET);
        }

        const credential = await manager
          .getRepository(Credential)
          .findOne({ where: { userId: user.id } });
        await manager.getRepository(Credential).save(
          credential
            ? { ...credential, passwordHash }
            : // Unreachable by section 2.3, which never issues a token to an
              // account with no credential row. Creating one is the harmless
              // branch: they proved control of the mailbox to get here.
              manager
                .getRepository(Credential)
                .create({ userId: user.id, passwordHash })
        );

        // Following a link sent to the address is the same evidence the
        // confirmation flow accepts, and a strictly stronger action than
        // clicking a confirmation link. Leaving it unverified would leave a nudge
        // on screen asking for proof already given.
        const confirmed = !user.emailVerifiedAt;
        if (confirmed) {
          user.emailVerifiedAt = new Date();
          await manager
            .getRepository(User)
            .update({ id: user.id }, { emailVerifiedAt: user.emailVerifiedAt });
        }

        await this.tokens.revokeAllForUser(user.id, manager);
        return { user, confirmed };
      }
    );

    // The same announcement `verifyEmail` makes, because the same thing happened:
    // whether the address was confirmed by a confirmation link or by a reset one,
    // a consumer that tracks verified addresses learns of it exactly once.
    if (confirmed) {
      this.events.userEmailVerified({ userId: user.id });
    }
    return this.tokens.issueTokens(user);
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
    // Which requirement applies follows the branch, because the two branches
    // need different things: a Google upgrade needs the OAuth credentials and
    // sends no mail (the address is already verified), while a typed address
    // needs a confirmation link and therefore an SMTP host.
    if (req.google) {
      this.requireGoogle();
    } else {
      this.requireMail();
    }
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
          rawVerificationToken = (
            await this.createVerification(manager, user.id)
          ).raw;
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
      this.sendVerification(email, rawVerificationToken, req.locale);
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
    const deleted = await this.removeAccount(
      this.dataSource.manager,
      req.userId
    );
    if (deleted) {
      this.events.userDeleted({ userId: req.userId });
    }
    return { userId: req.userId, deleted };
  }

  /**
   * Delete somebody else's account (plan 0077, section 8).
   *
   * The same delete {@link deleteAccount} makes, so the same cascade runs and the
   * same `user.deleted` event reaches core, whose `AccountDeletionService` does
   * its half across its own database. The whole difference is the missing role
   * check, and the operator gate the caller has already passed.
   *
   * The row is read before it is removed, because a deletion whose trail says
   * only that something with this id used to exist cannot answer what was lost.
   * Nothing read there is a secret: the password hash lives on `credentials`,
   * which this never touches.
   *
   * Idempotent for the same reason the user facing one is: a repeat affects no
   * rows, emits nothing and records nothing, and answers `deleted: false`.
   */
  async deleteAccountAsOperator(
    targetUserId: string,
    actorId: string
  ): Promise<DeleteAccountResult> {
    const deleted = await this.audit.write(actorId, async (tx) => {
      const user = await tx.manager
        .getRepository(User)
        .findOne({ where: { id: targetUserId } });
      if (!user) {
        return false;
      }
      const removed = await this.removeAccount(tx.manager, targetUserId);
      if (removed) {
        await tx.recordDelete(User, user, targetUserId);
      }
      return removed;
    });

    if (deleted) {
      this.events.userDeleted({ userId: targetUserId });
    }
    return { userId: targetUserId, deleted };
  }

  /** The delete both paths make, and the only place that statement is written. */
  private async removeAccount(
    manager: EntityManager,
    userId: string
  ): Promise<boolean> {
    const result = await manager.getRepository(User).delete({ id: userId });
    return (result.affected ?? 0) > 0;
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

    const { user, oldUsername } = await this.dataSource.transaction((manager) =>
      this.renameUser(manager, req.userId, username)
    );

    this.emitUsernameChanged(user, oldUsername, req.propagation);
    return this.toProfile(user);
  }

  /**
   * Rename somebody else (plan 0077, section 3.1).
   *
   * The same write {@link setUsername} makes, through the same private helper,
   * and it matters that it is the same one. `users.username` is not a column an
   * operator may set: the change publishes `user.usernameChanged`, and core's
   * `UsernamePropagationService` rewrites the per zone `zone_memberships.username`
   * of every membership the user holds from that event. A direct column write
   * would leave the global name changed and every per zone name unchanged, and
   * nothing reconciles the two afterwards, so they would disagree forever.
   *
   * The event is emitted **after** the transaction commits, exactly as the user
   * facing path emits it. An event for a write that then rolled back would have
   * every zone calling somebody by a name the `users` row never took, which is
   * the same disagreement by a different route.
   *
   * `propagation` is defaulted where both paths default it, in
   * {@link emitUsernameChanged}. An operator renaming somebody is doing what that
   * person could do to themselves, so it behaves the same.
   */
  async setUsernameAsOperator(
    targetUserId: string,
    username: string,
    actorId: string,
    propagation?: UsernamePropagation
  ): Promise<UserProfileView> {
    const validated = validateUsername(username);

    const { user, oldUsername } = await this.audit.write(actorId, (tx) =>
      this.renameUser(tx.manager, targetUserId, validated, tx)
    );

    this.emitUsernameChanged(user, oldUsername, propagation);
    return this.toProfile(user);
  }

  /**
   * Change somebody else's display name (plan 0077, section 3.2).
   *
   * A direct column write, and **not an exception** to "write through the
   * service, never through the row". `displayName` has no service, no event and
   * no consumer: nothing derives from it, nothing copies it, and core has never
   * seen it. There is no invariant to route around, so there is nothing for a
   * service method to protect.
   *
   * Null clears it, which is a thing an operator asks for on purpose: the column
   * holds whatever an identity provider supplied, and for a Google sign in that
   * is somebody's real full name. Whether a request means "clear it" or "leave it
   * alone" is decided by the caller, before this is called at all.
   */
  async setDisplayNameAsOperator(
    targetUserId: string,
    displayName: string | null,
    actorId: string
  ): Promise<UserProfileView> {
    const user = await this.audit.write(actorId, async (tx) => {
      const user = await tx.manager
        .getRepository(User)
        .findOne({ where: { id: targetUserId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const before = { ...user };
      user.displayName = displayName;
      return tx.update(User, before, user);
    });

    return this.toProfile(user);
  }

  /**
   * The rename itself, which both paths make.
   *
   * `tx` is present only on the operator path, and it is what puts the audit row
   * in the same transaction as the change. Without it the save is the plain one
   * the user's own route has always made, because a person renaming themselves is
   * not an operator write and the trail exists for operator writes.
   */
  private async renameUser(
    manager: EntityManager,
    userId: string,
    username: string,
    tx?: AuditedWrite
  ): Promise<{ user: User; oldUsername: string }> {
    const user = await manager
      .getRepository(User)
      .findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const before = { ...user };
    const oldUsername = user.username;
    user.username = username;
    return {
      user: tx
        ? await tx.update(User, before, user)
        : await manager.getRepository(User).save(user),
      oldUsername,
    };
  }

  /**
   * The event both rename paths publish, once the write has committed.
   *
   * Emitted for every mode, GLOBAL_ONLY included, so a consumer sees every
   * rename; core records a GLOBAL_ONLY event as processed and does nothing. The
   * default lives here rather than at each caller, so the operator path cannot
   * drift from the user facing one.
   */
  private emitUsernameChanged(
    user: User,
    oldUsername: string,
    propagation?: UsernamePropagation
  ): void {
    this.events.userUsernameChanged({
      eventId: randomUUID(),
      userId: user.id,
      oldUsername,
      newUsername: user.username,
      propagation: propagation ?? UsernamePropagation.GLOBAL_ONLY,
    });
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

  /**
   * Mint an opaque OAuth state (plan 0023, section 4.1).
   *
   * The raw value goes back to the caller and is never stored; only its hash is,
   * beside what the state stands for. `userId` arrives already established by the
   * gateway's guard, so an absent one here means the caller genuinely held no
   * token, not that a stale one was quietly ignored (section 4.2).
   */
  async mintOAuthState(
    req: MintOAuthStateRequest
  ): Promise<MintOAuthStateResult> {
    const state = await this.dataSource.transaction((manager) =>
      this.grants.issue(
        manager,
        OAuthState,
        { userId: req.userId ?? null, locale: req.locale ?? null },
        OAUTH_STATE_TTL_MS
      )
    );
    return { state };
  }

  /**
   * Spend an OAuth state and read back what it carried (plan 0023, section 4.1).
   *
   * Single use, which is the property the whole design is for: a state that could
   * be replayed is a way to link an attacker's Google identity onto an account
   * that is not theirs, and unlike a stolen token that is permanent.
   */
  async consumeOAuthState(
    req: ConsumeOAuthStateRequest
  ): Promise<OAuthStatePayload> {
    const record = await this.dataSource.transaction((manager) =>
      this.grants.consume(
        manager,
        OAuthState,
        req.state ?? '',
        INVALID_OAUTH_STATE
      )
    );
    // Omitted rather than null: `OAuthStatePayload` says absent, and a `userId`
    // of null reaching `googleLogin` as `linkUserId` would read as a link
    // request for nobody.
    return {
      ...(record.userId ? { userId: record.userId } : {}),
      ...(record.locale ? { locale: record.locale } : {}),
    };
  }

  /** Google login: find, link, or create (plan 0005, section 4.4). */
  async googleLogin(req: GoogleLoginRequest): Promise<AuthTokens> {
    // Refuse rather than attempt a lookup against credentials this deployment
    // does not have (plan 0026, section 3.2).
    this.requireGoogle();
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
