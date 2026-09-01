import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AccessTokenClaims,
  ParticipantKind,
  ParticipantTokenClaims,
} from '@portfolio/luna-shopper/contracts';
import { UnauthorizedException } from '@portfolio/luna-shopper/platform';

/**
 * Who a verified socket token says its holder is (plan 0051, section 9).
 *
 * Two kinds since sharing landed, and they are genuinely different rather than
 * one with an optional field. A `user` token names an account and admits its
 * holder to zone, list and user rooms. A `participant` token names **no user at
 * all** and admits its holder to exactly one basket's two rooms.
 */
/**
 * A verified token before it is known which of the two kinds it is.
 *
 * Every field optional, because exactly which are present is the question
 * {@link TokenVerifierService.verifyIdentity} is about to answer.
 */
interface VerifiedClaims {
  sub?: string;
  participantId?: string;
  aud?: string | string[];
  kind?: string;
}

export type SocketIdentity =
  | { kind: 'user'; userId: string }
  | {
      kind: 'participant';
      participantId: string;
      generatedListId: string;
      participantKind: ParticipantKind;
    };

/**
 * Offline token verification for the realtime service (plan 0009, section 3).
 *
 * Like the gateway it checks the RS256 signature with auth's public key alone
 * (configured on {@link JwtService} in the module), never calling auth per
 * connection. Both transports authenticate the same way: the socket verifies the
 * handshake token, the SSE endpoint verifies the bearer header.
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

  /**
   * Verify a socket token of either kind, and say which it is (plan 0051,
   * section 9).
   *
   * ## The rule this amends
   *
   * Plan 0035 established that **a token that names nobody is an invalid token**.
   * That was correct, and it was written when the only thing a token could name
   * was a user. A participant token is the one legitimate token naming no user,
   * so the rule becomes "names neither a user nor a live participant", and the
   * last clause below is where it is enforced: a verified signature with neither
   * a `sub` nor a `participantId` is still refused.
   *
   * The signature is checked first and the shape second, in that order, so a
   * forged token never reaches the discrimination at all. Nothing here consults
   * the database: liveness is the room check's job, which is a single indexed
   * read in core (section 3.3), and doing it twice would not make it truer.
   */
  async verifyIdentity(token: string | undefined): Promise<SocketIdentity> {
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    // Read loosely rather than as `AccessTokenClaims & ParticipantTokenClaims`:
    // the two disagree on `kind` (a `UserKind` against a `ParticipantKind`), so
    // that intersection is `never` and nothing can be read off it. What arrives
    // here is one of two shapes and the next few lines are what decide which, so
    // the type has to admit both until they have.
    let claims: VerifiedClaims;
    try {
      claims = await this.jwt.verifyAsync<VerifiedClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    if (claims.sub) {
      return { kind: 'user', userId: claims.sub };
    }
    // `aud` is required alongside the participant id rather than optional: a
    // participant token without one would be good on every basket, which is the
    // single property that makes handing it to a guest acceptable.
    if (claims.participantId && typeof claims.aud === 'string' && claims.aud) {
      return {
        kind: 'participant',
        participantId: claims.participantId,
        generatedListId: claims.aud,
        participantKind: claims.kind as ParticipantKind,
      };
    }
    // Plan 0035's rule, as amended: it names neither.
    throw new UnauthorizedException('Token names nobody');
  }
}
