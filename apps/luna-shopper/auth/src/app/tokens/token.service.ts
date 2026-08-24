import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { AuthTokens } from '@portfolio/luna-shopper/contracts';
import { UnauthorizedException } from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
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

  /** Issues a full token pair for a user (used by every successful flow). */
  async issueTokens(user: Pick<User, 'id' | 'kind'>): Promise<AuthTokens> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(user),
      this.issueRefreshToken(user.id),
    ]);
    return { userId: user.id, kind: user.kind, accessToken, refreshToken };
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
