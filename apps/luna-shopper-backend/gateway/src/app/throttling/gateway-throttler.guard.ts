import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  minutes,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import {
  ADMIN_TOKEN_AUDIENCE,
  type AdminTokenClaims,
} from '@portfolio/luna-shopper/contracts';
import {
  ProblemThrottlerGuard,
  scaleThrottleLimit,
} from '@portfolio/luna-shopper/platform';
import type { GatewayConfig } from '../config/app-config';

/**
 * What one operator may send in a minute, on every route.
 *
 * Sized for the curation CLI, which is the heaviest honest caller the gateway
 * has: every row it decides is several catalog searches, four rows are in flight
 * at once, and a walk runs for hours. The default bucket's 120 a minute was
 * sized for one person tapping a phone, and the CLI spent it in well under a
 * minute. The limit is still a limit, so a runaway loop holding a good token
 * is refused rather than served.
 */
export const ADMIN_THROTTLE_LIMIT = {
  ttl: minutes(1),
  limit: scaleThrottleLimit(1200),
};

/**
 * The global rate limit guard, with operators counted per operator.
 *
 * The default bucket keys on `req.ip`, which is one address for a whole
 * household and, behind a proxy, can be one address for everybody. An operator
 * running a curation walk would then spend the bucket every other caller at that
 * address draws on. A request carrying a verified admin token is instead counted
 * under `admin:<id>` at {@link ADMIN_THROTTLE_LIMIT}, which names one operator and
 * cannot be forged, the same reasoning `ParticipantThrottlerGuard` gives for
 * keying on a participant.
 *
 * The token is verified here, not merely decoded: the global guard runs before
 * `AdminJwtGuard`, so nothing has checked it yet, and a bucket granted to a
 * claim nobody verified would be a bypass for anybody who can write a JWT. A
 * token that is absent, expired, for another audience or signed with another key
 * leaves the request on the ordinary IP bucket. Admin login carries no token, so
 * it stays on its own strict per IP override.
 *
 * A route whose override is already looser than the operator limit keeps its
 * own number, so this only ever raises an operator's limit.
 */
@Injectable()
export class GatewayThrottlerGuard extends ProblemThrottlerGuard {
  private readonly adminJwt: JwtService;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService
  ) {
    super(options, storage, reflector);
    this.adminJwt = new JwtService({
      publicKey: config.getOrThrow<GatewayConfig>('gateway').adminJwtPublicKey,
      verifyOptions: {
        algorithms: ['RS256'],
        audience: ADMIN_TOKEN_AUDIENCE,
      },
    });
  }

  protected override async handleRequest(
    requestProps: ThrottlerRequest
  ): Promise<boolean> {
    const { req } = this.getRequestResponse(requestProps.context);
    const adminId = this.verifiedAdminId(req);
    if (adminId === null) {
      return super.handleRequest(requestProps);
    }
    return super.handleRequest({
      ...requestProps,
      limit: Math.max(requestProps.limit, ADMIN_THROTTLE_LIMIT.limit),
      ttl: ADMIN_THROTTLE_LIMIT.ttl,
      blockDuration: ADMIN_THROTTLE_LIMIT.ttl,
      getTracker: async () => `admin:${adminId}`,
    });
  }

  /** The operator id of a verified admin bearer token, or null. */
  private verifiedAdminId(req: Record<string, unknown>): string | null {
    const token = bearerToken(req);
    if (token === null) {
      return null;
    }
    // Most bearer tokens are velista access tokens. Decoding first skips the
    // signature check for them, since their audience already says no.
    const decoded = this.adminJwt.decode<Partial<AdminTokenClaims> | null>(
      token
    );
    if (decoded?.aud !== ADMIN_TOKEN_AUDIENCE) {
      return null;
    }
    try {
      const claims = this.adminJwt.verify<AdminTokenClaims>(token);
      return typeof claims.sub === 'string' && claims.sub !== ''
        ? claims.sub
        : null;
    } catch {
      return null;
    }
  }
}

function bearerToken(req: Record<string, unknown>): string | null {
  const headers = req['headers'] as Record<string, unknown> | undefined;
  const header = headers?.['authorization'];
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
