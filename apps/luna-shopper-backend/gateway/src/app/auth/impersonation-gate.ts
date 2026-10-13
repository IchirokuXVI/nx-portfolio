import { Injectable } from '@nestjs/common';
import {
  IMPERSONATION_PATTERNS,
  type CheckImpersonationResult,
  type ImpersonationActorClaim,
} from '@portfolio/luna-shopper/contracts';
import { ImpersonationEndedException } from '@portfolio/luna-shopper/platform';
import { NatsClient } from '../messaging/nats-client';

/** The support session a verified token belongs to (plan 0194). */
export interface CurrentImpersonation {
  /** The operator behind the session: an `admin_users.id`. */
  adminId: string;
  sessionId: string;
}

/**
 * Reads the `act` claim as the gateway trusts it (plan 0194).
 *
 * Absent reads as "not a support session", which is every ordinary token. A
 * claim that is present and malformed is refused and not ignored: reading it as
 * absent would turn a token of a support session into an ordinary token, with
 * no deadline and no refused routes.
 */
export function impersonationFromClaim(
  claim: unknown
): CurrentImpersonation | undefined {
  if (claim === undefined || claim === null) {
    return undefined;
  }
  const act = claim as Partial<ImpersonationActorClaim>;
  if (
    typeof claim !== 'object' ||
    typeof act.sub !== 'string' ||
    !act.sub ||
    typeof act.sid !== 'string' ||
    !act.sid
  ) {
    throw new ImpersonationEndedException('Malformed support session claim');
  }
  return { adminId: act.sub, sessionId: act.sid };
}

/**
 * The one question the gateway asks auth on each request of a support session
 * (plan 0194): is the session live right now?
 *
 * The signature and the `exp` of the token say that auth issued it and that it
 * has not lapsed. They cannot say that the operator pressed "End" a second ago,
 * that the two hours ran out, or that the operator was disabled. The session
 * row can, so the gateway asks. Only a token with `act` pays for this hop, and
 * support sessions are rare.
 *
 * It fails closed. An answer that is not "live" is a 401 `impersonation_ended`,
 * and an auth service that does not answer is an error and never a pass.
 */
@Injectable()
export class ImpersonationGate {
  constructor(private readonly nats: NatsClient) {}

  async assertLive(sessionId: string): Promise<void> {
    const answer = await this.nats.send<CheckImpersonationResult>(
      IMPERSONATION_PATTERNS.check,
      { sessionId }
    );
    if (answer?.live !== true) {
      throw new ImpersonationEndedException('The support session is over');
    }
  }
}
