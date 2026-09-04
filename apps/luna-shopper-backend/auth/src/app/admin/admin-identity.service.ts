import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AdminAuthTokens,
  AdminDevAutologinRequest,
  AdminIdentityView,
  AdminLoginRequest,
  AdminRefreshRequest,
  GetAdminRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  AccountLockedException,
  NotConfiguredException,
  RETRY_AFTER_SECONDS_DETAIL,
  UnauthorizedException,
} from '@portfolio/luna-shopper/platform';
import { randomBytes } from 'node:crypto';
import { MoreThan, Repository } from 'typeorm';
import type { AuthConfig } from '../config/app-config';
import { AdminLoginFailure, AdminUser } from '../entities';
import { PasswordService } from '../password/password.service';
import { AdminTokenService } from './admin-token.service';

/**
 * Operator authentication (plan 0071).
 *
 * Nothing here touches `users`, and nothing that touches `users` reaches this
 * class. That is section 1 in code: registration, verification, password reset,
 * Google linking, account deletion, username propagation and the orphan reaper
 * all operate on a table this service never opens.
 *
 * There is no create, update or delete in here, and no subject for one. An admin
 * is made on the server by the commands in section 6, by the person who has the
 * server, which is also the whole password recovery story.
 */
@Injectable()
export class AdminIdentityService {
  private readonly config: AuthConfig;

  /**
   * An argon2 hash of a value nothing knows, verified against when the username
   * does not exist.
   *
   * Without it a login for an unknown name returns as fast as the database can
   * say "no row", while a real name costs a full argon2 verification, and the
   * difference is measurable from the outside. For an account whose username is
   * one of very few and is the only thing an attacker is missing, that difference
   * is the secret. Hashed rather than written down as a literal, so it is a hash
   * the current argon2 parameters actually produce and the two paths cost the
   * same work rather than approximately the same work.
   */
  private dummyHash?: Promise<string>;

  constructor(
    @InjectRepository(AdminUser)
    private readonly admins: Repository<AdminUser>,
    @InjectRepository(AdminLoginFailure)
    private readonly failures: Repository<AdminLoginFailure>,
    private readonly passwords: PasswordService,
    private readonly tokens: AdminTokenService,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  /**
   * Username and password, in (plan 0071, sections 5 and 7).
   *
   * The order is lockout, then credentials, then the row's own state, and it is
   * that order on purpose: a locked username is refused before a password is even
   * hashed, so the lockout is also what stops an attacker turning argon2 into a
   * denial of service against the one account that matters.
   */
  async login(req: AdminLoginRequest): Promise<AdminAuthTokens> {
    const username = (req.username ?? '').trim();
    await this.assertNotLockedOut(username);

    const admin = await this.admins.findOne({ where: { username } });
    // The password is verified even for a disabled account, and even against the
    // dummy hash below for a username that does not exist, so all three paths
    // cost one argon2 verification and the response time says nothing.
    const passwordMatches = await this.passwords.verify(
      admin?.passwordHash ?? (await this.unmatchableHash()),
      req.password ?? ''
    );

    // One answer for an unknown username, a wrong password and a disabled
    // account. A disabled admin is a person who has been removed, and telling
    // them apart from a typo tells an attacker which names are real.
    if (!admin || !passwordMatches || admin.disabledAt !== null) {
      await this.recordFailure(username, req);
      throw new UnauthorizedException('Invalid username or password');
    }

    // The success is what makes the failure count *consecutive*: everything
    // recorded before this moment stops being counted, without a single row being
    // deleted. The record is the point of section 7 and outlives every session.
    admin.lastLoginAt = new Date();
    await this.admins.save(admin);

    return this.tokens.issue(admin);
  }

  /**
   * Renew a live token (plan 0071, section 4).
   *
   * The gateway has already verified the signature, so this is not a second
   * authentication: it is the read that carries revocation. Disabling an admin
   * cannot invalidate a token already signed, so what it does instead is stop the
   * next renewal, which bounds the damage to one token lifetime rather than to
   * the whole session. That read is the only reason this is a round trip to auth
   * at all rather than the gateway re-signing.
   */
  async refresh(req: AdminRefreshRequest): Promise<AdminAuthTokens> {
    const admin = await this.requireActive(req.adminId);
    return this.tokens.issue(admin);
  }

  /** Read one operator back, for `GET /v1/admin/auth/me`. */
  async getAdmin(req: GetAdminRequest): Promise<AdminIdentityView> {
    const admin = await this.requireActive(req.adminId);
    return AdminIdentityService.toView(admin);
  }

  /**
   * Sign in with no password, for development (plan 0071, section 8).
   *
   * Reachable only because the boot already decided it was safe: `adminConfig`
   * throws when the switch is on against a non local database, so a service that
   * answers this subject at all is a service pointed at a developer's own
   * Postgres. The guard below is the second lock on a door that could not be
   * built in production, and it is here because a switch this dangerous should
   * refuse in more than one place.
   *
   * It issues a token for a **named existing** admin rather than inventing one,
   * so a development session has a real actor id and the audit rows of plan 0075
   * are attributable locally too.
   */
  async devAutologin(req: AdminDevAutologinRequest): Promise<AdminAuthTokens> {
    if (!this.config.admin.devAutologin) {
      throw new NotConfiguredException(
        'The admin development autologin is off in this deployment'
      );
    }

    const username = (req.username ?? '').trim();
    const admin = await this.admins.findOne({ where: { username } });
    if (!admin || admin.disabledAt !== null) {
      // A configuration mistake rather than a failed login: the developer named
      // an admin that does not exist, and the answer is to create one with the
      // command in section 6, not to try a different password.
      throw new NotConfiguredException(
        `ADMIN_DEV_AUTOLOGIN_USERNAME names '${username}', which is not an ` +
          `enabled admin. Create one with the auth admin:create command.`
      );
    }

    admin.lastLoginAt = new Date();
    await this.admins.save(admin);
    return this.tokens.issue(admin);
  }

  /**
   * Refuse a username that has failed too many times too recently (section 7).
   *
   * Separate from the gateway's throttling because the two limit different
   * things: throttling limits a source, and this protects an account. One admin
   * username is a far better brute force target than a user base, because the
   * attacker knows the name is one of very few.
   *
   * It counts by username whether or not that username exists, so the answer
   * leaks nothing: a caller only ever meets the lockout for a name they
   * themselves have already failed against.
   *
   * It answers with its own code rather than the throttler's, because the back
   * office has to say a different sentence for each
   * (`apps/luna-shopper-admin/plans/0002`, section 2). An operator told to slow
   * down when the account is locked will keep trying and keep failing; the two
   * states resolve differently and have to read differently.
   */
  private async assertNotLockedOut(username: string): Promise<void> {
    const { threshold, windowMs } = this.config.admin.lockout;
    const since = await this.countingFrom(username, windowMs);
    const recent = await this.failures.count({
      where: { username, createdAt: MoreThan(since) },
    });
    if (recent < threshold) {
      return;
    }

    throw new AccountLockedException('Too many failed sign in attempts', {
      details: {
        [RETRY_AFTER_SECONDS_DETAIL]: Math.ceil(windowMs / 1000),
      },
    });
  }

  /**
   * The moment failures start counting from: the later of the window's start and
   * this account's last successful login.
   *
   * The last login is what makes the count consecutive without deleting a single
   * row. Clearing the failures on success is the obvious alternative and it
   * destroys exactly the history section 7 created the table to keep.
   */
  private async countingFrom(
    username: string,
    windowMs: number
  ): Promise<Date> {
    const windowStart = new Date(Date.now() - windowMs);
    const admin = await this.admins.findOne({
      where: { username },
      select: { id: true, lastLoginAt: true },
    });
    const lastLogin = admin?.lastLoginAt ?? null;
    return lastLogin && lastLogin > windowStart ? lastLogin : windowStart;
  }

  /**
   * Write the failed attempt down (section 7). Username attempted, address, user
   * agent and the time, on failure only.
   *
   * The user agent is capped at the column width rather than trusted: it is a
   * header, and a header long enough to matter is somebody trying something.
   */
  private async recordFailure(
    username: string,
    req: AdminLoginRequest
  ): Promise<void> {
    await this.failures.save(
      this.failures.create({
        username,
        ip: req.ip ?? null,
        userAgent: req.userAgent ? req.userAgent.slice(0, 512) : null,
      })
    );
  }

  /** The row, or the same 401 a bad password gets, for a missing or disabled admin. */
  private async requireActive(adminId: string): Promise<AdminUser> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin || admin.disabledAt !== null) {
      throw new UnauthorizedException('Not an enabled administrator');
    }
    return admin;
  }

  /** The dummy hash, made once per process and reused. */
  private unmatchableHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }

  /** The row as it leaves auth. The password hash is not in this shape at all. */
  private static toView(admin: AdminUser): AdminIdentityView {
    return {
      adminId: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      disabledAt: admin.disabledAt?.toISOString() ?? null,
    };
  }
}
