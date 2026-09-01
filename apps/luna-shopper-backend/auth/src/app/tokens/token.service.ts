import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { AuthTokens } from '@portfolio/luna-shopper/contracts';
import { UnauthorizedException } from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository, type EntityManager } from 'typeorm';
import type { AuthConfig } from '../config/app-config';
import { RefreshToken, type User } from '../entities';
import { parseDurationMs } from './duration';

/**
 * Token issuance and rotation (plan 0005, section 3).
 *
 * The access token is a short lived JWT signed RS256 with the private key and a
 * `kid` header, verified offline everywhere by the public key (plan 0004,
 * section 10). The refresh token is opaque and high entropy, stored only as a
 * SHA-256 hash and rotated on every use, so a leaked database row never yields a
 * usable token and a stolen refresh token is single use.
 */
@Injectable()
export class TokenService {
  private readonly config: AuthConfig;

  constructor(
    private readonly jwt: JwtService,
    configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  /** Signs an access token carrying the user id and kind. */
  private signAccessToken(user: Pick<User, 'id' | 'kind'>): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, kind: user.kind },
      {
        privateKey: this.config.jwt.privateKey,
        algorithm: 'RS256',
        keyid: this.config.jwt.kid,
        // The TTL is a validated duration string ('15m'); cast to the ms-typed
        // property jsonwebtoken accepts at runtime.
        expiresIn: this.config.jwt
          .accessTokenTtl as JwtSignOptions['expiresIn'],
      }
    );
  }

  /**
   * Sign a basket scoped socket token for a participant (plan 0051, section 9).
   *
   * The one token this service issues that **names no user**, and the reason plan
   * 0035's rule becomes "a token that names neither a user nor a live
   * participant". Three properties make that safe, and all three are here rather
   * than in a comment somewhere else:
   *
   * - **No `sub`.** Deliberately absent rather than null or empty: a participant
   *   is not a user, and a guard that reads `sub` and asks no further questions
   *   must fail to find one rather than find something it will mistake for an
   *   account.
   * - **`aud` is the one basket**, so the token is worthless anywhere else, and a
   *   socket presenting it is checked against the room it asks for.
   * - **Short lived, and refreshed by presenting the participant credential**,
   *   which is the database read that carries revocation. That is what keeps
   *   section 3.3's promise honest: the token itself cannot be revoked, so it
   *   does not live long enough to matter, and the thing that renews it can be.
   *
   * It is signed with the same key and `kid` as an access token, on purpose: the
   * realtime service already verifies with that public key, so a guest's socket
   * needs no second trust root.
   */
  async signParticipantToken(req: {
    participantId: string;
    generatedListId: string;
    kind: string;
  }): Promise<{ socketToken: string; socketTokenExpiresAt: string }> {
    const ttl = this.config.jwt.participantTokenTtl;
    const socketToken = await this.jwt.signAsync(
      {
        participantId: req.participantId,
        kind: req.kind,
      },
      {
        privateKey: this.config.jwt.privateKey,
        algorithm: 'RS256',
        keyid: this.config.jwt.kid,
        audience: req.generatedListId,
        expiresIn: ttl as JwtSignOptions['expiresIn'],
      }
    );
    return {
      socketToken,
      socketTokenExpiresAt: new Date(
        Date.now() + parseDurationMs(ttl)
      ).toISOString(),
    };
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Mints and persists a fresh refresh token, returning the raw value once. */
  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + parseDurationMs(this.config.jwt.refreshTokenTtl)
    );
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId,
        tokenHash: this.hash(raw),
        expiresAt,
      })
    );
    return raw;
  }

  /**
   * Issues a full token pair for a user (used by every successful flow). The
   * global username rides in the response body, never in the signed claims (plan
   * 0018, section 9): every caller already has the user row loaded, so filling it
   * costs nothing, and the client learns its own name on each sign in and refresh
   * without a claim that would go stale for the token's whole lifetime.
   */
  async issueTokens(
    user: Pick<User, 'id' | 'kind' | 'username'>
  ): Promise<AuthTokens> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(user),
      this.issueRefreshToken(user.id),
    ]);
    return {
      userId: user.id,
      kind: user.kind,
      username: user.username,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Revokes every live refresh token a user holds (plan 0022, section 3.2).
   *
   * A password reset is usually somebody saying another person has their
   * password, so leaving that person's sessions alive means the reset changed
   * nothing for up to a refresh lifetime. The caller issues its own pair *after*
   * this, so the person doing the resetting stays signed in and everybody else
   * does not; doing it the other way round is the mistake this ordering exists to
   * avoid.
   *
   * Already revoked rows are left alone, so the update touches only what is live.
   * A `manager` joins the caller's transaction, so a reset that fails half way
   * does not leave a user signed out of everything with their old password still
   * working.
   */
  async revokeAllForUser(
    userId: string,
    manager?: EntityManager
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;
    await repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );
  }

  /**
   * Validates and rotates a refresh token: the presented token is revoked and
   * the caller's user id returned so a fresh pair can be issued. An unknown,
   * revoked or expired token is rejected.
   */
  async rotate(rawToken: string): Promise<string> {
    const record = await this.refreshTokens.findOne({
      where: { tokenHash: this.hash(rawToken) },
    });
    if (
      !record ||
      record.revokedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    record.revokedAt = new Date();
    await this.refreshTokens.save(record);
    return record.userId;
  }
}
