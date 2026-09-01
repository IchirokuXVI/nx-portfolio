import {
  Injectable,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  GENERATED_LIST_SHARING_PATTERNS,
  type AccessTokenClaims,
  type GeneratedListParticipantContext,
  type ResolveParticipantRequest,
} from '@portfolio/luna-shopper/contracts';
import { UnauthorizedException } from '@portfolio/luna-shopper/platform';
import { JwtService } from '@nestjs/jwt';
import { NatsClient } from '../messaging/nats-client';

/** The header a guest presents their session secret on. */
export const PARTICIPANT_SECRET_HEADER = 'x-participant-secret';

/**
 * Authorizes the participant surface of a shared basket (plan 0051,
 * section 3.3).
 *
 * ## Two credentials, one answer
 *
 * A guest presents the session secret they were given at join, on
 * {@link PARTICIPANT_SECRET_HEADER}. A registered participant or the owner
 * presents an ordinary account token, because they have one and section 3
 * therefore gives them no second credential. Either way core answers with the
 * same {@link GeneratedListParticipantContext}, so nothing downstream has to know
 * which arrived.
 *
 * ## Why the resolution happens in core and not here
 *
 * The check is **one indexed lookup** on the participant row, reading `revokedAt`
 * on it, with no cache, because revocation has to bite immediately. Core owns
 * that table, and it also owns the `seesZoneData` question in section 5.2, which
 * is about access at request time rather than about the credential. Splitting
 * them would put half a security rule in each service.
 *
 * ## Why the account token is verified here rather than by JwtAuthGuard
 *
 * Because presenting one is **optional** on these routes: a guest has none, and
 * an absent Authorization header is the ordinary case rather than a 401. That is
 * the same reasoning `OptionalJwtAuthGuard` uses on the zone entry points, and
 * like that guard this treats a header that is present but bad as a 401 rather
 * than quietly falling through to the guest path, where an expired token would
 * otherwise look like somebody with no account at all.
 */
@Injectable()
export class ParticipantGuard implements CanActivate {
  constructor(
    private readonly nats: NatsClient,
    private readonly jwt: JwtService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const generatedListId = request.params?.id;
    if (!generatedListId) {
      throw new UnauthorizedException('Not a participant of this basket');
    }

    const secret = request.headers?.[PARTICIPANT_SECRET_HEADER];
    const authorization = request.headers?.authorization;

    const req: ResolveParticipantRequest = { generatedListId };
    if (typeof secret === 'string' && secret) {
      req.sessionSecret = secret;
    } else if (authorization !== undefined) {
      req.userId = await this.userOf(authorization);
    } else {
      throw new UnauthorizedException('Not a participant of this basket');
    }

    // Core throws when the credential names no live participant, which the
    // global filter turns into the house 401 envelope.
    const participant =
      await this.nats.send<GeneratedListParticipantContext>(
        GENERATED_LIST_SHARING_PATTERNS.participantResolve,
        req
      );
    request.participant = participant;
    return true;
  }

  private async userOf(authorization: string): Promise<string> {
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization;
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      if (!claims.sub) {
        // Plan 0035, as plan 0051 section 9 amends it: a token naming neither a
        // user nor a live participant is refused. A participant token is not an
        // account token and is not accepted here; it is for the socket.
        throw new UnauthorizedException('Token names nobody');
      }
      return claims.sub;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid access token');
    }
  }
}

/**
 * Injects the resolved participant (set by {@link ParticipantGuard}) into a
 * handler parameter. The analogue of `AuthUser` for the participant surface.
 */
export const Participant = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext
  ): GeneratedListParticipantContext => {
    const request = context.switchToHttp().getRequest();
    return request.participant as GeneratedListParticipantContext;
  }
);
