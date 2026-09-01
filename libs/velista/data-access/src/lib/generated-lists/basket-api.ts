import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  BasketLine,
  BasketLinkPreview,
  BasketParticipant,
  BasketSession,
  BasketSettleRequest,
  BasketSettleResult,
  BasketShareLink,
  BasketView,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { anonymous, operation } from '../auth/http-context';
import {
  toBasketLine,
  toBasketLinkPreview,
  toBasketParticipant,
  toBasketSession,
  toBasketSettleResult,
  toBasketShareLink,
  toBasketView,
} from '../mapping/basket-mappers';
import { mapArray } from '../mapping/primitives';
import { required } from '../mapping/required';
import { BasketSessionStore } from './basket-session-store';
import type { BasketServiceI } from './basket-service';

/**
 * The header a guest presents their session secret on.
 *
 * Matches `PARTICIPANT_SECRET_HEADER` in the gateway's `participant.guard.ts`. It
 * is written out rather than imported because the contracts barrel re-exports
 * ajv, and rule D4 keeps every contracts import in this app type only so that ajv
 * stays out of the bundle (plan 0004, section 9.3). A string constant is not a
 * type, so importing this one would pull the whole barrel in at runtime.
 */
export const PARTICIPANT_SECRET_HEADER = 'x-participant-secret';

/**
 * The shared basket over HTTP. The default behind `BASKET_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 *
 * ## The one thing this class exists to hide
 *
 * **Which credential goes out.** A guest holds a session secret and no account; a
 * registered participant and the owner hold an account token and are given no
 * second credential. Both reach the same routes, and the server accepts either.
 *
 * So {@link _participantOptions} reads the stored session for the basket being
 * addressed and sets the secret header **only when there is one**, letting the
 * ordinary auth interceptor attach a bearer token as it does everywhere else. A
 * caller never chooses, because a caller that could choose would eventually
 * choose wrongly and send a guest's secret on somebody else's basket.
 *
 * ## Why two of these routes skip auth entirely
 *
 * The preview and the join are the unauthenticated pair (backend `0051`,
 * section 4). They go out with `anonymous()` so a **stale** account token cannot
 * turn a stranger opening a link into a 401: an expired session belongs to the
 * person who left this browser signed in, and it must not stand between a
 * flatmate and the shopping list they were sent.
 */
@Injectable()
export class BasketApi implements BasketServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _sessions = inject(BasketSessionStore);

  // --- The unauthenticated pair ---------------------------------------------

  async previewLink(secret: string): Promise<BasketLinkPreview> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._link(secret), {
        context: anonymous('basket.preview'),
      })
    );

    // Never `required`: the mapper cannot fail, because "this build could not
    // read the answer" and "this link is dead" have the same right answer, which
    // is to offer nothing to try.
    return toBasketLinkPreview(body);
  }

  async join(secret: string, displayName?: string): Promise<BasketSession> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._link(secret)}/join`,
        // Absent rather than an empty string when they skipped it: the server
        // reads absence as "give them Guest N", and `''` would be a name.
        displayName === undefined || displayName.trim() === ''
          ? {}
          : { displayName: displayName.trim() },
        { context: anonymous('basket.join') }
      )
    );

    const session = required(toBasketSession(body), 'basket.join');
    // Persisted here rather than by the caller, because the secret exists once
    // and a caller that forgot would make the person a stranger to this basket
    // with no way to recover.
    this._sessions.write(session);
    return session;
  }

  // --- The participant surface ----------------------------------------------

  async getBasket(generatedListId: string): Promise<BasketView> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        `${this._basket(generatedListId)}/basket`,
        this._participantOptions(generatedListId, 'basket.get')
      )
    );

    return required(toBasketView(body), 'basket.get');
  }

  async settle(
    generatedListId: string,
    lineId: string,
    body: BasketSettleRequest
  ): Promise<BasketSettleResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(generatedListId, lineId)}/settle`,
        body,
        this._participantOptions(generatedListId, 'basket.settle')
      )
    );

    return required(toBasketSettleResult(answer), 'basket.settle');
  }

  async setPick(
    generatedListId: string,
    lineId: string,
    itemId: string
  ): Promise<BasketLine> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(generatedListId, lineId)}/pick`,
        { itemId },
        this._participantOptions(generatedListId, 'basket.setPick')
      )
    );

    return required(toBasketLine(body), 'basket.setPick');
  }

  async listParticipants(
    generatedListId: string
  ): Promise<readonly BasketParticipant[]> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        `${this._basket(generatedListId)}/participants/mine`,
        this._participantOptions(generatedListId, 'basket.participants')
      )
    );

    return mapArray(
      (body as { participants?: unknown } | null)?.participants,
      toBasketParticipant
    );
  }

  async refreshSocketToken(generatedListId: string): Promise<BasketSession> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._basket(generatedListId)}/participant-token`,
        {},
        this._participantOptions(generatedListId, 'basket.socketToken')
      )
    );

    const held = this._sessions.read(generatedListId);
    const refreshed = required(
      toBasketSession({ ...(body as object), generatedListId }),
      'basket.socketToken'
    );
    // The refresh answers a token and a participant, never a session secret:
    // that one exists once, at join. Carrying the held one forward is what keeps
    // a guest able to make their *next* request after the token is renewed.
    const session: BasketSession = {
      ...refreshed,
      secret: held?.secret ?? null,
    };
    this._sessions.write(session);
    return session;
  }

  // --- The owner's share sheet ----------------------------------------------

  async ensureShareLink(generatedListId: string): Promise<BasketShareLink> {
    const body = await firstValueFrom(
      this._http.put<unknown>(
        `${this._basket(generatedListId)}/share-link`,
        {},
        { context: operation('basket.shareLink.ensure') }
      )
    );

    return required(toBasketShareLink(body), 'basket.shareLink.ensure');
  }

  async getShareLink(generatedListId: string): Promise<BasketShareLink | null> {
    const body = await firstValueFrom(
      this._http.get<unknown>(`${this._basket(generatedListId)}/share-link`, {
        context: operation('basket.shareLink.get'),
      })
    );

    // Null is an ordinary answer and not a failure: a basket has zero links or
    // one, and zero is where every basket starts.
    return toBasketShareLink(body);
  }

  async revokeShareLink(
    generatedListId: string,
    cascade = false
  ): Promise<{ revoked: number }> {
    const body = await firstValueFrom(
      this._http.delete<unknown>(
        `${this._basket(generatedListId)}/share-link`,
        {
          // Always sent explicitly, never left to the server's default: the two
          // outcomes differ by whether three people are thrown out of a shop.
          params: new HttpParams().set('revokeParticipants', cascade),
          context: operation('basket.shareLink.revoke'),
        }
      )
    );

    const revoked = (body as { revoked?: unknown } | null)?.revoked;
    return { revoked: typeof revoked === 'number' ? revoked : 0 };
  }

  async revokeParticipant(
    generatedListId: string,
    participantId: string
  ): Promise<void> {
    await firstValueFrom(
      this._http.delete<unknown>(
        `${this._basket(generatedListId)}/participants/${encodeURIComponent(
          participantId
        )}`,
        { context: operation('basket.participant.revoke') }
      )
    );
  }

  // --- Internals -------------------------------------------------------------

  /**
   * The credential for this basket, whichever kind the reader holds.
   *
   * A guest's secret goes on the header and nothing else is sent; everybody else
   * sends nothing here and the ordinary auth interceptor attaches their bearer
   * token. Both are accepted by the same guard, so no route needs two versions.
   */
  private _participantOptions(
    generatedListId: string,
    name: string
  ): { headers?: HttpHeaders; context: ReturnType<typeof operation> } {
    const secret = this._sessions.read(generatedListId)?.secret;
    return secret
      ? {
          headers: new HttpHeaders().set(PARTICIPANT_SECRET_HEADER, secret),
          context: operation(name),
        }
      : { context: operation(name) };
  }

  private _basket(generatedListId: string): string {
    return this._urls.gateway(
      `/v1/generated-lists/${encodeURIComponent(generatedListId)}`
    );
  }

  private _line(generatedListId: string, lineId: string): string {
    return `${this._basket(generatedListId)}/lines/${encodeURIComponent(lineId)}`;
  }

  private _link(secret: string): string {
    return this._urls.gateway(`/v1/share-links/${encodeURIComponent(secret)}`);
  }
}
