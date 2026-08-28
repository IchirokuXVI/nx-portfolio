import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenClaims } from '@portfolio/luna-shopper/contracts';
import { UnauthorizedException } from '@portfolio/luna-shopper/platform';

/**
 * Offline access-token verification for the realtime service (plan 0009,
 * section 3). Like the gateway it checks the RS256 signature with auth's public
 * key alone (configured on {@link JwtService} in the module), never calling auth
 * per connection. Both transports authenticate the same way: the socket verifies
 * the handshake token, the SSE endpoint verifies the bearer header.
 */
@Injectable()
export class TokenVerifierService {
  constructor(private readonly jwt: JwtService) {}

  /** Verify a raw token, throwing when it is missing, expired, or forged. */
  async verify(token: string | undefined): Promise<AccessTokenClaims> {
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }
    try {
      return await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  /** Verify a token carried in an `Authorization: Bearer <token>` header. */
  verifyAuthHeader(header: string | undefined): Promise<AccessTokenClaims> {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : header;
    return this.verify(token);
  }
}
