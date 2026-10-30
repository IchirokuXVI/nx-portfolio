import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCOUNT_ROLES,
  AUTH_USERNAMES_MAX,
  AuthProvider,
  RecoverySignInOutcome,
  UserKind,
  UsernamePropagation,
  type AcceptTermsRequest,
  type AccountRole,
  type AuthTokens,
  type ConsumeOAuthStateRequest,
  type CreateAdminRecoveryLinksResult,
  type CreateTemporaryUserRequest,
  type DeleteAccountRequest,
  type DeleteAccountResult,
  type ExchangeGoogleSignInRequest,
  type ForgotPasswordRequest,
  type GetProfileRequest,
  type GetUsernamesRequest,
  type GoogleLoginRequest,
  type ImpersonationEndedEvent,
  type LoginRequest,
  type MintOAuthStateRequest,
  type MintOAuthStateResult,
  type OAuthStatePayload,
  type RecoverySignInRequest,
  type RecoverySignInResult,
  type RegisterRequest,
  type ResendVerificationRequest,
  type ResendVerificationResult,
  type ResetPasswordRequest,
  type RetryAfterResult,
  type SendAdminPasswordResetResult,
  type SetUsernameRequest,
  type StageGoogleSignInRequest,
  type StageGoogleSignInResult,
  type TermsAcceptanceView,
  type UpgradeRequest,
  type UserProfileView,
  type UserUsernameView,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  GuestHasNoRolesException,
  ImpersonationEndedException,
  ImpersonationNotAllowedException,
  NotConfiguredException,
  NotFoundException,
  RecoveryNeedsEmailException,
  RecoveryNeedsPasswordException,
  RecoveryOtherAccountException,
  THROTTLE_LIMITS,
  throttleWaitSeconds,
  UnauthorizedException,
  validateUsername,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource, In, type EntityManager } from 'typeorm';
import {
  AuthAuditService,
  type AuditedWrite,
} from '../audit/auth-audit.service';
import type { AuthConfig } from '../config/app-config';
import {
  AccountDeletion,
  Credential,
  EmailVerification,
  OAuthHandoff,
  OAuthIdentity,
  OAuthState,
  PasswordReset,
  PasswordResetChannel,
  PasswordResetSpentAs,
  TermsAcceptanceVia,
  User,
} from '../entities';
import { AccountDeletionPublisher } from '../events/account-deletion.publisher';
import { IdentityEventsPublisher } from '../events/identity-events.publisher';
import { ImpersonationService } from '../impersonation/impersonation.service';
import { MailService, recoveryLinks } from '../mail/mail.service';
import { PasswordService } from '../password/password.service';
import { TokenGrantService } from '../tokens/token-grant.service';
import { TokenService, type RecordedTokens } from '../tokens/token.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { TermsService } from './terms.service';

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
 * How long the links an operator creates by hand live (plan 0210, decision
 * D1). A day rather than an hour: an operator who shares a link in a chat
 * often waits for the person to read it, and an hour would run out first. A
 * mailed grant keeps the hour of {@link RESET_TTL_MS}, whoever asked for it.
 */
const OPERATOR_LINK_TTL_MS = 24 * 60 * 60 * 1000;

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
 * How long a staged Google sign in waits to be redeemed (plan 0230, section
 * 3.2). Two minutes: the callback page of the app spends the code within one
 * page load of the redirect, and two minutes is that load on a slow phone plus
 * a retry. A longer life only widens the time in which a profile staged through
 * a forwarded link sits in the table, waiting for a verifier that never comes.
 */
const OAUTH_HANDOFF_TTL_MS = 2 * 60 * 1000;

/**
 * The one answer an exchange refusal gets: a missing, spent or expired code, a
 * wrong verifier, or a bearer that is not the link target. On the wire it is
 * 401 `unauthorized`, as a state is (plan 0023, section 4.4).
 */
const INVALID_GOOGLE_CODE = 'Invalid or expired sign in code';

/**
 * The identity domain (plan 0005, section 4). Every way a user comes to exist
 * lives here: temporary tokens, email/password registration and login, Google
 * login, in place upgrade, email verification and refresh rotation. Writes that
 * touch more than one table run in a transaction so a failure leaves no
 * half-created identity.
 *
 * ## The `AsOperator` methods
 *
 * Several methods end in `AsOperator`, and the suffix is the contract rather
 * than decoration (plan 0077, section 2). Each one is the write its user facing
 * twin makes, with the caller's own identity check replaced by an operator gate
 * the caller has already passed, and each one records what it did in the audit
 * trail inside the same transaction. Reading the method names is how somebody
 * sees which writes here can be made against a stranger's account, and a future
 * author cannot add another without saying so in its name.
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
    configService: ConfigService,
    // Last, so that no positional caller moves (plan 0194). Only `refresh`
    // reaches it, and only for the row of a support session.
    private readonly impersonation: ImpersonationService,
    // Last, for the same reason (plan 0231). Every path that creates an
    // account checks and records the Terms through it.
    private readonly terms: TermsService,
    // Last, for the same reason (plan 0232). Both delete paths wake it after
    // their transaction commits, and nothing else reaches it.
    private readonly deletions: AccountDeletionPublisher
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
   *
   * The Terms version the notice beside the zone buttons named is checked
   * first and recorded in the transaction that writes the user (plan 0231,
   * section 4.2), so a refused version leaves no guest behind.
   */
  async createTemporaryUser(
    req: CreateTemporaryUserRequest = {}
  ): Promise<AuthTokens> {
    this.terms.assertAcceptable(req.acceptedTermsVersion);
    const user = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(User).save(
        manager.getRepository(User).create({
          kind: UserKind.TEMPORARY,
          // A guest is named from the moment they exist (plan 0018, section
          // 3.4), so the zone they are about to create or join has a name to
          // record.
          username: this.usernames.generate(),
        })
      );
      await this.recordTerms(
        manager,
        saved.id,
        req.acceptedTermsVersion,
        TermsAcceptanceVia.GUEST
      );
      return saved;
    });
    return this.tokens.issueTokens(user);
  }

  /**
   * Record the supplied version when it is the current one, inside the
   * caller's transaction (plan 0231, section 4.2). A path that refuses a stale
   * version has already called {@link TermsService.assertAcceptable}, so this
   * skips only an absent version there. The Google exchange, which never
   * refuses over the Terms, relies on it to skip a version that went stale
   * inside the state's ten minutes.
   */
  private async recordTerms(
    manager: EntityManager,
    userId: string,
    version: string | null | undefined,
    via: TermsAcceptanceVia
  ): Promise<void> {
    if (this.terms.isCurrent(version)) {
      await this.terms.record(manager, userId, version, via);
    }
  }

  /** Email + password registration (plan 0005, section 4.2). */
  async register(req: RegisterRequest): Promise<AuthTokens> {
    // Before the write, not after: an account created here is unreachable
    // without the confirmation mail.
    this.requireMail();
    if (!req.email || !req.password) {
      throw new ValidationException('Email and password are required');
    }
    // Before the transaction, so a refused version writes nothing (plan 0231).
    this.terms.assertAcceptable(req.acceptedTermsVersion);
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
        await this.recordTerms(
          manager,
          user.id,
          req.acceptedTermsVersion,
          TermsAcceptanceVia.REGISTER
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
   *
   * The grant ends as `RESET`, and every other live grant of the account ends
   * with it (plan 0210, target state 3): a reset is meant to close every way
   * in, and an older mail with a sign in link on it is one.
   */
  async resetPassword(req: ResetPasswordRequest): Promise<AuthTokens> {
    const passwordHash = await this.passwords.hash(req.password ?? '');

    const { user, confirmed } = await this.dataSource.transaction(
      async (manager) => {
        const record = await this.grants.consume(
          manager,
          PasswordReset,
          req.token ?? '',
          INVALID_RESET,
          { spentAs: PasswordResetSpentAs.RESET }
        );
        await this.endOtherGrants(manager, record);
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

        const confirmed = await this.confirmAddress(manager, user);

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

  /**
   * Sign in with a reset grant and keep the password (plan 0210, target state
   * 5).
   *
   * The same grant as {@link resetPassword}, spent another way. Which way is
   * the choice of whoever holds the token, so the row never records the link
   * that was sent, only how the grant ended. The order of the checks below is
   * the decision table of the plan, row by row:
   *
   * 1. **A support session is refused**, whatever the grant. The gateway
   *    refuses it first (the route carries `@RefuseImpersonation`); this holds
   *    the rule if the list there ever drifts.
   * 2. **The owner of the grant, already signed in**, is told so and keeps the
   *    session. A live grant is spent as `ALREADY_SIGNED_IN` all the same: the
   *    person has shown which link they meant, and a link left live in an inbox
   *    is a key. A spent or expired one writes nothing and still answers the
   *    same, because the person is where the link would have taken them.
   * 3. **A grant that cannot be spent** is the one refusal of `0022`, for
   *    anybody who is not its owner: unknown, spent and expired stay one
   *    answer.
   * 4. **Somebody else, signed in**, is refused with `recovery_other_account`
   *    and nothing is spent, until they agree to leave with `switchAccount`.
   * 5. **Everybody else is signed in**, and the grant ends as `SIGN_IN`.
   *
   * **The owner is read before the spend, and the spend decides.** The row is
   * read by hash whatever its state, because rule 2 needs to know whose it is
   * even when it is spent. The read never spends: the conditional statement of
   * {@link TokenGrantService.spend} does, so two requests at the same instant
   * cannot both pass. A request that loses that race answers as the row reads
   * after it: the owner is still told they are signed in, and anybody else gets
   * the refusal of rule 3.
   *
   * **No session is revoked** (decision D4). Only a reset does that, and the
   * mail says which link to press when the password is the worry. The address
   * is marked verified, as a reset marks it: following a link sent to it is the
   * same proof.
   */
  async recoverySignIn(
    req: RecoverySignInRequest
  ): Promise<RecoverySignInResult> {
    if (req.supportSession === true) {
      throw new ImpersonationNotAllowedException(
        'A support session cannot use this route'
      );
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      const grant = await this.grants.find(
        manager,
        PasswordReset,
        req.token ?? ''
      );
      if (!grant) {
        throw new ValidationException(INVALID_RESET);
      }

      if (req.callerUserId !== undefined && grant.userId === req.callerUserId) {
        if (this.grants.isLive(grant)) {
          const spent = await this.grants.spend(
            manager,
            PasswordReset,
            grant.tokenHash,
            { spentAs: PasswordResetSpentAs.ALREADY_SIGNED_IN }
          );
          // Null only when another request spent it first, which ended the
          // other grants too. The answer is the same either way.
          if (spent) {
            await this.endOtherGrants(manager, spent);
          }
        }
        return { signedIn: null };
      }

      if (!this.grants.isLive(grant)) {
        throw new ValidationException(INVALID_RESET);
      }
      if (req.callerUserId !== undefined && req.switchAccount !== true) {
        throw new RecoveryOtherAccountException(
          'This link belongs to another account than the one signed in'
        );
      }

      const spent = await this.grants.spend(
        manager,
        PasswordReset,
        grant.tokenHash,
        { spentAs: PasswordResetSpentAs.SIGN_IN }
      );
      if (!spent) {
        throw new ValidationException(INVALID_RESET);
      }
      await this.endOtherGrants(manager, spent);

      const user = await manager
        .getRepository(User)
        .findOne({ where: { id: spent.userId } });
      if (!user) {
        // Unreachable for the reason `resetPassword` gives: the cascade takes
        // the grants with the account.
        throw new ValidationException(INVALID_RESET);
      }
      const confirmed = await this.confirmAddress(manager, user);
      return { signedIn: { user, confirmed } };
    });

    if (!outcome.signedIn) {
      return { outcome: RecoverySignInOutcome.ALREADY_SIGNED_IN };
    }
    const { user, confirmed } = outcome.signedIn;
    if (confirmed) {
      this.events.userEmailVerified({ userId: user.id });
    }
    return {
      outcome: RecoverySignInOutcome.SIGNED_IN,
      tokens: await this.tokens.issueTokens(user),
    };
  }

  /**
   * Mark the address of an account verified, if it was not, and say whether
   * this call did it.
   *
   * Following a link sent to the address is the same evidence the confirmation
   * flow accepts, and a strictly stronger action than clicking a confirmation
   * link. Leaving it unverified would leave a nudge on screen asking for proof
   * already given. A reset and a sign in with the same grant both reach here.
   */
  private async confirmAddress(
    manager: EntityManager,
    user: User
  ): Promise<boolean> {
    if (user.emailVerifiedAt) {
      return false;
    }
    user.emailVerifiedAt = new Date();
    await manager
      .getRepository(User)
      .update({ id: user.id }, { emailVerifiedAt: user.emailVerifiedAt });
    return true;
  }

  /**
   * End every other live reset grant of the account that just spent one (plan
   * 0210, target state 3), in the same transaction.
   */
  private async endOtherGrants(
    manager: EntityManager,
    spent: PasswordReset
  ): Promise<void> {
    await this.grants.endOthers(manager, PasswordReset, spent, {
      spentAs: PasswordResetSpentAs.SUPERSEDED,
    });
  }

  /**
   * Mail somebody the reset grant, on their behalf (plan 0210, target state
   * 7).
   *
   * The grant {@link forgotPassword} mints and the mail it sends, with both
   * links and the same hour, issued as `OPERATOR_EMAIL` with the operator on
   * the row and recorded in the audit trail in the same transaction. The trail
   * drops `tokenHash` on the way in, as it does for a confirmation grant.
   *
   * Refused for an account with no address and for one with no password (see
   * {@link issueOperatorGrant}). Unlike `forgotPassword` it says so: the caller
   * is an operator looking at the account, not somebody testing addresses.
   */
  async sendPasswordResetAsOperator(
    targetUserId: string,
    actorId: string,
    locale?: string
  ): Promise<SendAdminPasswordResetResult> {
    this.requireMail();
    const { email, raw, grant } = await this.audit.write(
      actorId,
      async (tx) => {
        const issued = await this.issueOperatorGrant(
          tx.manager,
          targetUserId,
          actorId,
          PasswordResetChannel.OPERATOR_EMAIL,
          RESET_TTL_MS
        );
        await tx.recordCreate(PasswordReset, issued.grant);
        return issued;
      }
    );

    this.dispatchMail('the password reset email', () =>
      this.mail.sendPasswordResetEmail(
        email,
        raw,
        this.config.smtp.resetBaseUrl,
        locale
      )
    );
    return { expiresAt: grant.expiresAt.toISOString() };
  }

  /**
   * Create the two links of a reset grant and hand them to the operator, with
   * no mail of the links (plan 0210, target state 8).
   *
   * **The answer is the only place the raw token goes.** Not a log line, not
   * the audit row (which drops `tokenHash` and never sees the raw value), not
   * an event. The grant lives a day (decision D1) and ends on first use like
   * any other.
   *
   * **The person is told** (decision D2). A sign in link from an operator is a
   * full session as the person, with none of the limits of a support session,
   * so a short notice goes to the address, with the date and no link. It is
   * dispatched outside the transaction like every other mail here, and SMTP is
   * required up front for the same reason registration requires it: a key made
   * without the notice is the thing D2 exists to prevent.
   */
  async createRecoveryLinksAsOperator(
    targetUserId: string,
    actorId: string,
    locale?: string
  ): Promise<CreateAdminRecoveryLinksResult> {
    this.requireMail();
    const { email, raw, grant } = await this.audit.write(
      actorId,
      async (tx) => {
        const issued = await this.issueOperatorGrant(
          tx.manager,
          targetUserId,
          actorId,
          PasswordResetChannel.OPERATOR_LINK,
          OPERATOR_LINK_TTL_MS
        );
        await tx.recordCreate(PasswordReset, issued.grant);
        return issued;
      }
    );

    this.dispatchMail('the recovery link notice', () =>
      this.mail.sendRecoveryLinksNotice(email, grant.createdAt, locale)
    );
    return {
      ...recoveryLinks(this.config.smtp.resetBaseUrl, raw),
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  /**
   * The refusals and the grant both operator routes share (plan 0210, target
   * states 7 and 8).
   *
   * **A guest is refused**, because it has no address to mail and no password
   * to reset, and a link that moved a guest to a new device would be a feature
   * of its own (section 1). **A Google only account is refused** (decision
   * D3): the reset half would give it a first password, through the branch of
   * `resetPassword` that nothing reaches today, and the sign in half would be
   * a passwordless way in it has never had. Both refusals carry codes of their
   * own, so the back office can say which.
   *
   * Issuing ends no other grant (decision D5). The person may still be holding
   * a mail they asked for, and it keeps working until one of the two is used.
   */
  private async issueOperatorGrant(
    manager: EntityManager,
    targetUserId: string,
    actorId: string,
    channel: PasswordResetChannel,
    ttlMs: number
  ): Promise<{ email: string; raw: string; grant: PasswordReset }> {
    const user = await manager
      .getRepository(User)
      .findOne({ where: { id: targetUserId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.email) {
      throw new RecoveryNeedsEmailException(
        'This account has no email address'
      );
    }
    const credential = await manager
      .getRepository(Credential)
      .findOne({ where: { userId: user.id } });
    if (!credential) {
      throw new RecoveryNeedsPasswordException('This account has no password');
    }

    const { raw, record } = await this.grants.issueRecord(
      manager,
      PasswordReset,
      { userId: user.id, channel, issuedByAdminId: actorId },
      ttlMs
    );
    return { email: user.email, raw, grant: record };
  }

  /**
   * Exchange a refresh token for a fresh pair (plan 0005, section 3).
   *
   * **One rotation is one transaction** (plan 0229, section 3). The spend, the
   * user load, the insert of the successor and the pointer from the spent row
   * to it all run on one manager. A failure anywhere after the spend rolls the
   * spend back, so the presented row stays live and the client's retry works.
   * Before, a failure after the spend left a revoked row and nothing live.
   *
   * A support session that is over is a refusal and not a failure. It is
   * returned out of the transaction rather than thrown inside it, so the end
   * of the session and the revoke of its rows commit, as they did before the
   * rotation had a transaction. A session that this refresh ended (its
   * operator is disabled or gone) is announced after the commit, never inside
   * the transaction: an event for a rotation that then rolled back would drop
   * the sockets of a live session.
   */
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const outcome = await this.dataSource.transaction(
      async (
        manager
      ): Promise<
        | { tokens: AuthTokens }
        | {
            ended: ImpersonationEndedException;
            endedNow: ImpersonationEndedEvent | null;
          }
      > => {
        const spent = await this.tokens.rotate(rawRefreshToken, manager);
        const user = await manager
          .getRepository(User)
          .findOne({ where: { id: spent.userId } });
        if (!user) {
          throw new UnauthorizedException('Invalid or expired refresh token');
        }
        // The row of a support session renews under that session's deadline
        // (plan 0194). Every other row takes the ordinary pair.
        let issued: RecordedTokens;
        if (spent.impersonationSessionId) {
          const renewal = await this.impersonation.refresh(
            spent.impersonationSessionId,
            user,
            manager
          );
          if ('over' in renewal) {
            return { ended: renewal.over, endedNow: renewal.endedNow };
          }
          issued = renewal.issued;
        } else {
          issued = await this.tokens.issueTokensRecorded(user, manager);
        }
        await this.tokens.recordSuccessor(
          spent.id,
          issued.refreshRowId,
          manager
        );
        return { tokens: issued.tokens };
      }
    );
    if ('ended' in outcome) {
      this.impersonation.announceEnded(outcome.endedNow);
      throw outcome.ended;
    }
    return outcome.tokens;
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
    // Before the transaction, so a refused version writes nothing (plan 0231).
    this.terms.assertAcceptable(req.acceptedTermsVersion);
    const { user, email, rawVerificationToken } =
      await this.dataSource.transaction((manager) =>
        this.upgradeIn(manager, req)
      );

    // Sent outside the transaction, for the reason registration gives: delivery
    // must not roll back an upgrade that succeeded, verification is optional, and
    // the global logger records a failed send.
    if (email && rawVerificationToken) {
      this.sendVerification(email, rawVerificationToken, req.locale);
    }

    this.events.userUpgraded({ userId: user.id });
    return this.tokens.issueTokens(user);
  }

  /**
   * The writes of an upgrade, on the caller's transaction. Split from
   * {@link upgrade} so the Google exchange can run it inside the transaction
   * that spends its code (plan 0230, section 4.2).
   *
   * **Every other session of the account ends here** (plan 0230). The account
   * is now somebody's for good, and whatever held the guest's refresh token
   * before this moment must not keep it. The caller issues its own pair after
   * the commit, so the person upgrading stays signed in and nobody else does,
   * the same order a password reset keeps.
   *
   * The Terms version is recorded here, on the same transaction, under `via`:
   * `UPGRADE` for a typed address, `GOOGLE` when the exchange upgrades a guest
   * in place (plan 0231, section 4.2).
   */
  private async upgradeIn(
    manager: EntityManager,
    req: UpgradeRequest,
    via: TermsAcceptanceVia = TermsAcceptanceVia.UPGRADE
  ): Promise<{
    user: User;
    email: string | null;
    rawVerificationToken: string | null;
  }> {
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
      rawVerificationToken = (await this.createVerification(manager, user.id))
        .raw;
    } else {
      throw new ValidationException(
        'Provide a Google identity or an email and password to upgrade'
      );
    }

    user.kind = UserKind.REGISTERED;
    if (req.displayName) {
      user.displayName = req.displayName;
    }
    const saved = await manager.getRepository(User).save(user);
    await this.tokens.revokeAllForUser(saved.id, manager);
    await this.recordTerms(manager, saved.id, req.acceptedTermsVersion, via);
    return { user: saved, email, rawVerificationToken };
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
   * already gone the delete affects no rows and nothing is published.
   *
   * One transaction since plan 0232 (section 4): the delete, the outbox row
   * that carries `user.deleted` to core and catalog, and the scrub of the audit
   * trail commit together or not at all.
   */
  async deleteAccount(req: DeleteAccountRequest): Promise<DeleteAccountResult> {
    const deleted = await this.dataSource.transaction((manager) =>
      this.removeAccount(manager, req.userId)
    );
    if (deleted) {
      this.deletions.publishSoon();
    }
    return { userId: req.userId, deleted };
  }

  /**
   * Delete somebody else's account (plan 0077, section 8).
   *
   * The same delete {@link deleteAccount} makes, so the same cascade runs and the
   * same `user.deleted` event reaches core and catalog, which do their half
   * across their own databases. The whole difference is the missing role check,
   * and the operator gate the caller has already passed.
   *
   * The trail records the deletion with the account's `kind`, `roles` and
   * `createdAt` only (plan 0232, section 4). That answers what kind of account
   * was lost and who removed it, and names nothing that identifies the person.
   * The scrub that follows then takes the person out of every earlier row,
   * this one included, inside the same transaction.
   *
   * Idempotent for the same reason the user facing one is: a repeat affects no
   * rows, publishes nothing and records nothing, and answers `deleted: false`.
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
      return this.removeAccount(tx.manager, targetUserId, () =>
        tx.recordDelete(User, user, targetUserId, [
          'kind',
          'roles',
          'createdAt',
        ])
      );
    });

    if (deleted) {
      this.deletions.publishSoon();
    }
    return { userId: targetUserId, deleted };
  }

  /**
   * The delete both paths make, and the only place that statement is written.
   *
   * Inside the caller's transaction, in this order (plan 0232, sections 4 and
   * 5): the `users` row and its cascade, the outbox row, the caller's own audit
   * record if it has one, then the scrub, so the record just written is
   * scrubbed with the rest. Nothing after the delete runs when it removed
   * nothing.
   */
  private async removeAccount(
    manager: EntityManager,
    userId: string,
    record?: () => Promise<void>
  ): Promise<boolean> {
    const result = await manager.getRepository(User).delete({ id: userId });
    if ((result.affected ?? 0) === 0) {
      return false;
    }
    await manager.getRepository(AccountDeletion).insert({ userId });
    await record?.();
    await this.audit.scrubUser(manager, userId);
    return true;
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
    return this.profileOf(user);
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
    return this.profileOf(user);
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

    return this.profileOf(user);
  }

  /**
   * Replace somebody's roles (plan 0175). Only an operator reaches this: no
   * subject an account can send touches `users.roles`.
   *
   * **A guest holds no role**, so a guest is refused with
   * {@link GuestHasNoRolesException} whatever the set, an empty one included:
   * the refusal is about the account, and an operator who meets it learns the
   * rule rather than a no op that looks like success. The database says the
   * same with `ck_users_guest_has_no_roles`.
   *
   * The set is stored once per role and in `ACCOUNT_ROLES` order, so the same
   * grants always read the same and a repeated request records no audit row.
   *
   * **The refresh tokens are not revoked**, although the plan asked for it (see
   * the pull request). Every refresh reads the row again and signs the new
   * permissions, which is what makes a grant reach the account within one access
   * token lifetime; revoking would instead sign the person out of every device
   * and make the grant arrive only at their next sign in.
   */
  async setRolesAsOperator(
    targetUserId: string,
    roles: readonly AccountRole[],
    actorId: string
  ): Promise<void> {
    const wanted = ACCOUNT_ROLES.filter((role) => roles.includes(role));
    await this.audit.write(actorId, async (tx) => {
      const user = await tx.manager
        .getRepository(User)
        .findOne({ where: { id: targetUserId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (user.kind !== UserKind.REGISTERED) {
        throw new GuestHasNoRolesException('A guest account holds no role');
      }
      const before = { ...user };
      user.roles = wanted;
      return tx.update(User, before, user);
    });
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
    return this.profileOf(user);
  }

  /**
   * Several accounts' global usernames at once (plan 0114, section 9).
   *
   * For the gateway, which names people core knows only by id: the owner of a
   * basket somebody was given, and a person being added to one. An id that names
   * no account, or is not an id at all, is left out of the answer rather than
   * refused or answered with a blank name, because every caller already has a
   * fallback to draw and none of them should fail for want of one name.
   */
  async getUsernames(req: GetUsernamesRequest): Promise<UserUsernameView[]> {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = [...new Set(req.userIds ?? [])].filter((id) => uuid.test(id));
    if (ids.length > AUTH_USERNAMES_MAX) {
      throw new ValidationException(
        `at most ${AUTH_USERNAMES_MAX} accounts can be named at once`,
        { messageArgs: { field: 'userIds' } }
      );
    }
    if (ids.length === 0) {
      return [];
    }
    const users = await this.dataSource.getRepository(User).find({
      where: { id: In(ids) },
      select: { id: true, username: true },
    });
    return users.map((user) => ({ userId: user.id, username: user.username }));
  }

  /**
   * The profile every write and read of it answers, with a Terms acceptance
   * beside it (plan 0231, section 4.4). Read after the caller's transaction has
   * committed, through the pool.
   *
   * The acceptance is the row for the current version when the account has
   * one, and the newest row otherwise. The newest row alone is wrong when the
   * current version moves back to one the account already accepted (a rollback
   * past a template bump, or the operator clearing the revision): the gateway
   * would ask again, and accepting again would change nothing, because the
   * insert keeps the old row and the newer version stays the newest.
   */
  private async profileOf(user: User): Promise<UserProfileView> {
    const accepted =
      (await this.terms.find(
        this.dataSource.manager,
        user.id,
        this.terms.currentVersion
      )) ?? (await this.terms.latest(user.id));
    return {
      userId: user.id,
      kind: user.kind,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      displayName: user.displayName,
      termsAcceptedVersion: accepted?.version ?? null,
      termsAcceptedAt: accepted?.acceptedAt.toISOString() ?? null,
    };
  }

  /**
   * Accept the current Terms from the prompt (plan 0231, section 4.4).
   *
   * Refuses a version that is not the current one, and records `PROMPT`
   * otherwise. Idempotent: a repeat answers the row already recorded, with the
   * time it was first accepted. An account that is gone answers not found,
   * which the gateway turns into a 401 like every other read about the caller.
   */
  async acceptTerms(req: AcceptTermsRequest): Promise<TermsAcceptanceView> {
    if (!req.version) {
      throw new ValidationException('A version is required', {
        messageArgs: { field: 'version' },
      });
    }
    this.terms.assertAcceptable(req.version);
    const accepted = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOne({ where: { id: req.userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      await this.terms.record(
        manager,
        user.id,
        req.version,
        TermsAcceptanceVia.PROMPT
      );
      return this.terms.find(manager, user.id, req.version);
    });
    if (!accepted) {
      // The insert above either wrote the row or met it, so this cannot happen
      // short of a delete racing the accept, which the cascade makes possible.
      throw new NotFoundException('User not found');
    }
    return {
      version: accepted.version,
      acceptedAt: accepted.acceptedAt.toISOString(),
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
   *
   * The challenge is required (plan 0230, section 2). It is what ties the code
   * the callback stages to the browser that minted this state, and a state
   * without one could be finished by any browser a link reached.
   */
  async mintOAuthState(
    req: MintOAuthStateRequest
  ): Promise<MintOAuthStateResult> {
    if (!isPkceValue(req.codeChallenge)) {
      throw new ValidationException(
        'A codeChallenge is required to start a Google sign in'
      );
    }
    // At the start and not at the finish (plan 0231, section 4.2). The start is
    // a JSON POST, so a refusal here reaches the app as a problem it can show;
    // the finish is a redirect, where a refusal costs the whole sign in.
    this.terms.assertAcceptable(req.acceptedTermsVersion);
    const state = await this.dataSource.transaction((manager) =>
      this.grants.issue(
        manager,
        OAuthState,
        {
          userId: req.userId ?? null,
          locale: req.locale ?? null,
          codeChallenge: req.codeChallenge,
          termsVersion: req.acceptedTermsVersion ?? null,
        },
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
   *
   * A row with no challenge is refused like an unknown one (plan 0230, section
   * 2). Only a state minted before that plan lacks one, it is at most ten
   * minutes old, and nobody holds a verifier for it.
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
    if (!record.codeChallenge) {
      throw new ValidationException(INVALID_OAUTH_STATE);
    }
    // Omitted rather than null: `OAuthStatePayload` says absent, and a `userId`
    // of null reaching the handoff as `linkUserId` would read as a link
    // request for nobody.
    return {
      ...(record.userId ? { userId: record.userId } : {}),
      ...(record.locale ? { locale: record.locale } : {}),
      codeChallenge: record.codeChallenge,
      ...(record.termsVersion
        ? { acceptedTermsVersion: record.termsVersion }
        : {}),
    };
  }

  /**
   * Stage what Google said at the callback (plan 0230, section 3.3).
   *
   * One handoff row and nothing else. No identity is looked up here, so the
   * callback has no branch that depends on the state of an account, and a
   * profile staged through a link somebody forwarded changes nothing until a
   * browser holding the verifier redeems it, which never happens.
   */
  async stageGoogleSignIn(
    req: StageGoogleSignInRequest
  ): Promise<StageGoogleSignInResult> {
    this.requireGoogle();
    if (!isPkceValue(req.codeChallenge)) {
      throw new ValidationException(INVALID_OAUTH_STATE);
    }
    const code = await this.dataSource.transaction((manager) =>
      this.grants.issue(
        manager,
        OAuthHandoff,
        {
          userId: req.linkUserId ?? null,
          providerUserId: req.providerUserId,
          email: req.email ?? null,
          displayName: req.displayName ?? null,
          codeChallenge: req.codeChallenge,
          locale: req.locale ?? null,
          termsVersion: req.acceptedTermsVersion ?? null,
        },
        OAUTH_HANDOFF_TTL_MS
      )
    );
    return { code };
  }

  /**
   * Trade a staged code for the pair (plan 0230, section 4.2). This is where a
   * Google sign in creates or links an account, and the only place.
   *
   * One transaction spends the code, checks the verifier against the challenge,
   * checks the bearer against the link target, and runs {@link googleLogin}.
   * A refusal is returned out of the transaction rather than thrown inside it,
   * so the spend commits: a code that met a wrong verifier is burnt, and it
   * cannot be tried again. A failure of the login itself rolls the spend back
   * with it.
   *
   * The verifier proves the browser and the bearer proves the account. A link
   * needs both. A handoff with no link target ignores the bearer, so a caller
   * cannot turn a sign in from scratch into a link onto themselves.
   */
  async exchangeGoogleSignIn(
    req: ExchangeGoogleSignInRequest
  ): Promise<AuthTokens> {
    this.requireGoogle();
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<ExchangeOutcome> => {
        const handoff = await this.grants.spend(
          manager,
          OAuthHandoff,
          this.grants.hash(req.code ?? '')
        );
        if (!handoff) {
          return { refused: 'unknown_code' };
        }
        if (!verifierMatches(req.codeVerifier, handoff.codeChallenge)) {
          return { refused: 'verifier_mismatch', handoffId: handoff.id };
        }
        if (handoff.userId && req.callerUserId !== handoff.userId) {
          return { refused: 'caller_mismatch', handoffId: handoff.id };
        }
        return {
          login: await this.googleLogin(manager, {
            providerUserId: handoff.providerUserId,
            ...(handoff.email ? { email: handoff.email } : {}),
            ...(handoff.displayName
              ? { displayName: handoff.displayName }
              : {}),
            ...(handoff.userId ? { linkUserId: handoff.userId } : {}),
            ...(handoff.termsVersion
              ? { acceptedTermsVersion: handoff.termsVersion }
              : {}),
          }),
        };
      }
    );

    if ('refused' in outcome) {
      // The reason and the row, and never the code, the verifier or the
      // challenge: a log line is not a place to keep a credential.
      this.logger.warn(
        `Google sign in exchange refused: ${outcome.refused}` +
          (outcome.handoffId ? ` (handoff ${outcome.handoffId})` : '')
      );
      throw new UnauthorizedException(INVALID_GOOGLE_CODE);
    }

    const { user, created, upgraded } = outcome.login;
    if (created) {
      this.events.userRegistered({ userId: user.id });
    }
    if (upgraded) {
      this.events.userUpgraded({ userId: user.id });
    }
    return this.tokens.issueTokens(user);
  }

  /**
   * Google login: find, link, or create (plan 0005, section 4.4), on the
   * caller's transaction.
   *
   * The one place that knows the branches. An address that already has an
   * account links onto that account rather than creating a second one, which
   * the unique index on `users.email` would refuse ({@link claimByEmail}).
   * Since plan 0230 its one
   * caller is {@link exchangeGoogleSignIn}, after the verifier and the bearer
   * were checked. It answers the user and what happened to it, and the caller
   * publishes the events and issues the pair after the commit, because a pair
   * issued inside the transaction would name a user that may not exist yet.
   *
   * Every branch records the Terms version the sign in page drew, under
   * `GOOGLE` (plan 0231, section 4.2): continuing with Google is accepting. A
   * version that went stale inside the state's ten minutes records nothing,
   * and the sign in still succeeds; `GET /v1/account/me` then asks.
   */
  private async googleLogin(
    manager: EntityManager,
    req: GoogleLoginRequest
  ): Promise<GoogleLoginOutcome> {
    const identity = await manager.getRepository(OAuthIdentity).findOne({
      where: {
        provider: AuthProvider.GOOGLE,
        providerUserId: req.providerUserId,
      },
    });

    if (identity) {
      const user = await manager
        .getRepository(User)
        .findOneOrFail({ where: { id: identity.userId } });
      await this.recordTerms(
        manager,
        user.id,
        req.acceptedTermsVersion,
        TermsAcceptanceVia.GOOGLE
      );
      return { user, created: false, upgraded: false };
    }

    // No linked user yet: either link onto the caller's temporary user (upgrade
    // in place) or create a fresh registered user.
    if (req.linkUserId) {
      const { user } = await this.upgradeIn(
        manager,
        {
          userId: req.linkUserId,
          google: {
            providerUserId: req.providerUserId,
            email: req.email,
            displayName: req.displayName,
          },
          acceptedTermsVersion: req.acceptedTermsVersion,
        },
        TermsAcceptanceVia.GOOGLE
      );
      return { user, created: false, upgraded: true };
    }

    const owner = req.email
      ? await this.claimByEmail(manager, this.normalizeEmail(req.email))
      : null;
    if (owner) {
      await this.linkGoogle(manager, owner.id, req.providerUserId);
      await this.recordTerms(
        manager,
        owner.id,
        req.acceptedTermsVersion,
        TermsAcceptanceVia.GOOGLE
      );
      return { user: owner, created: false, upgraded: false };
    }

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
    await this.recordTerms(
      manager,
      created.id,
      req.acceptedTermsVersion,
      TermsAcceptanceVia.GOOGLE
    );
    return { user: created, created: true, upgraded: false };
  }

  /**
   * The account that already holds the address Google verified, ready for the
   * Google identity to be linked onto it, or null when no account holds it.
   *
   * Google proved the address, so its holder is the person signing in. An
   * account that never confirmed the address is not proof that whoever made
   * it owns the address: somebody could have registered it first with a
   * password of their own. So that account loses its password and every
   * session, and its address counts as confirmed from now on. The person
   * keeps the account and can set a password again through a reset link.
   */
  private async claimByEmail(
    manager: EntityManager,
    email: string
  ): Promise<User | null> {
    const user = await manager
      .getRepository(User)
      .findOne({ where: { email } });
    if (!user || user.emailVerifiedAt) {
      return user;
    }
    await manager.getRepository(Credential).delete({ userId: user.id });
    await this.tokens.revokeAllForUser(user.id, manager);
    user.emailVerifiedAt = new Date();
    return manager.getRepository(User).save(user);
  }
}

/** What {@link IdentityService.googleLogin} did, for the caller to finish. */
interface GoogleLoginOutcome {
  user: User;
  created: boolean;
  upgraded: boolean;
}

/** The answer of the exchange's transaction: a login, or why there is none. */
type ExchangeOutcome =
  | { login: GoogleLoginOutcome }
  | {
      refused: 'unknown_code' | 'verifier_mismatch' | 'caller_mismatch';
      handoffId?: string;
    };

/** base64url of 32 bytes or of a SHA-256: 43 characters, no padding. */
function isPkceValue(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Whether `base64url(sha256(verifier))` is the stored challenge (plan 0230,
 * section 4.2), compared in constant time over buffers of equal length.
 */
function verifierMatches(verifier: unknown, challenge: string): boolean {
  if (!isPkceValue(verifier)) {
    return false;
  }
  const actual = Buffer.from(
    createHash('sha256').update(verifier).digest('base64url')
  );
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
