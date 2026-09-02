import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  POSTAL_CODE_EVENTS,
  POSTAL_CODE_PATTERNS,
  type ListNearbyPostalCodesRequest,
  type NearbyPostalCodesView,
  type PostalCodeDistanceView,
  type PostalCodesAddedEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  getRequestContext,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';

/** Injection token for core's outbound client for postal code geography. */
export const POSTAL_CODE_NATS_CLIENT = 'POSTAL_CODE_NATS_CLIENT';

/**
 * The two things core says to the rest of the backend about postal codes (plan
 * 0062, sections 3 and 5).
 *
 * Core owns the profile and catalog owns the centroids, so "which codes are near
 * this one" is a question and not a lookup. It is asked over the broker against a
 * table catalog ships with its image: no third party, no rate limit, and nothing
 * in it that can be slow for a reason outside this backend.
 *
 * The two halves fail in opposite directions on purpose:
 *
 * - **{@link nearby} throws.** Its answer is what the write is about, and a
 *   profile saved with the neighbours quietly missing is a screen that looks
 *   finished and is wrong. Only an expanding code asks it, so a profile that
 *   never expands never depends on catalog being up.
 * - **{@link announceAdded} cannot.** It is fire and forget by section 5: a
 *   discovery run takes minutes, so it may not hold up a profile save, and a
 *   failure to enqueue one must not fail the write that caused it.
 */
@Injectable()
export class PostalCodeClient {
  constructor(
    @Inject(POSTAL_CODE_NATS_CLIENT) private readonly client: ClientProxy,
    private readonly logger: Logger
  ) {}

  /**
   * The codes whose centroid is within `radiusMetres` of this one, nearest
   * first, never the code asked about.
   *
   * A code catalog has never heard of answers empty rather than failing, which is
   * the right shape here: somebody who typed a code we do not ship a centroid for
   * gets the code they typed and no neighbours, and plan 0063 is what eventually
   * goes and looks at it.
   */
  async nearby(
    country: string,
    postalCode: string,
    radiusMetres: number
  ): Promise<PostalCodeDistanceView[]> {
    const request: ListNearbyPostalCodesRequest = {
      country,
      postalCode,
      radiusMetres,
    };
    const view = await this.send<NearbyPostalCodesView>(
      POSTAL_CODE_PATTERNS.nearby,
      { ...request }
    );
    return view.postalCodes;
  }

  /**
   * Tell whoever is listening which codes a write put on a profile (section 5).
   *
   * Nothing consumes it until plan 0063, and that is why it is an `emit` rather
   * than a `send`: a published event with no subscriber is a no op, where a
   * request with no responder is a timeout on the profile save's critical path.
   * The try/catch is the second half of the same rule, for the case where the
   * broker itself is unreachable.
   */
  announceAdded(country: string, postalCodes: string[]): void {
    if (postalCodes.length === 0) {
      return;
    }
    const payload: PostalCodesAddedEvent = { country, postalCodes };
    try {
      this.client.emit(POSTAL_CODE_EVENTS.postalCodesAdded, payload);
    } catch (err) {
      this.logger.warn(
        { err, country, postalCodes },
        'could not announce new postal codes; the profile write stands'
      );
    }
  }

  private send<TResponse>(
    subject: string,
    payload: Record<string, unknown>
  ): Promise<TResponse> {
    const context = getRequestContext();
    return traceNatsSend(subject, () => {
      const record = new NatsRecordBuilder(payload)
        .setHeaders(
          buildNatsHeaders({
            correlationId: context?.correlationId,
            locale: context?.locale,
          })
        )
        .build();
      return firstValueFrom(this.client.send<TResponse>(subject, record));
    });
  }
}
