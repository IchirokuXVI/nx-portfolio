import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthProvider,
  UserKind,
  type AuthTokens,
  type DeleteAccountRequest,
  type DeleteAccountResult,
  type GoogleLoginRequest,
  type LoginRequest,
  type RegisterRequest,
  type UpgradeRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
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
import { TokenService } from '../tokens/token.service';

/** Hours an email verification link stays valid. */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

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
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly events: IdentityEventsPublisher,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
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
    const user = await this.dataSource
      .getRepository(User)
      .save(
        this.dataSource.getRepository(User).create({ kind: UserKind.TEMPORARY })
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

  private async createVerification(
    manager: EntityManager,
    userId: string
  ): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await manager.getRepository(EmailVerification).save(
      manager.getRepository(EmailVerification).create({
        userId,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      })
    );
    return raw;
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

  /** Consume an email verification token (plan 0005, section 4.2). */
  async verifyEmail(rawToken: string): Promise<{ userId: string }> {
    const userId = await this.dataSource.transaction(async (manager) => {
      const record = await manager.getRepository(EmailVerification).findOne({
        where: { tokenHash: this.hashToken(rawToken) },
      });
      if (
        !record ||
        record.consumedAt ||
        record.expiresAt.getTime() <= Date.now()
      ) {
        throw new ValidationException('Invalid or expired verification link');
      }
      record.consumedAt = new Date();
      await manager.getRepository(EmailVerification).save(record);
      await manager
        .getRepository(User)
        .update({ id: record.userId }, { emailVerifiedAt: new Date() });
      return record.userId;
    });

    this.events.userEmailVerified({ userId });
    return { userId };
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

  /** In place upgrade of a temporary user to a registered one (section 4.5). */
  async upgrade(req: UpgradeRequest): Promise<AuthTokens> {
    const user = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOne({ where: { id: req.userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (user.kind !== UserKind.TEMPORARY) {
        throw new ConflictException('This account is already registered');
      }

      if (req.google) {
        await this.linkGoogle(manager, user.id, req.google.providerUserId);
        if (req.google.email && !user.email) {
          user.email = this.normalizeEmail(req.google.email);
        }
      } else if (req.email && req.password) {
        const email = this.normalizeEmail(req.email);
        const taken = await manager
          .getRepository(User)
          .findOne({ where: { email } });
        if (taken && taken.id !== user.id) {
          throw new ConflictException('That email is already registered', {
            messageArgs: { field: 'email' },
          });
        }
        user.email = email;
        const passwordHash = await this.passwords.hash(req.password);
        await manager
          .getRepository(Credential)
          .save(
            manager
              .getRepository(Credential)
              .create({ userId: user.id, passwordHash })
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
      return manager.getRepository(User).save(user);
    });

    this.events.userUpgraded({ userId: user.id });
    return this.tokens.issueTokens(user);
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
        })
      );
      await this.linkGoogle(manager, created.id, req.providerUserId);
      return created;
    });

    this.events.userRegistered({ userId: user.id });
    return this.tokens.issueTokens(user);
  }
}
