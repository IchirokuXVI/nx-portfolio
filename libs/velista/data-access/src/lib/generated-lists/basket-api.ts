import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  BasketAddLineRequest,
  BasketLine,
  BasketLineOrigins,
  BasketLinkPreview,
  BasketOriginQuantityRequest,
  BasketOriginQuantityResult,
  BasketOutstandingRequest,
  BasketParticipant,
  BasketSession,
  BasketSettleRequest,
  BasketSettleResult,
  BasketShareLink,
  BasketSplitRequest,
  BasketSplitResult,
  BasketView,
  CatalogSuggestion,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { anonymous, operation } from '../auth/http-context';
import {
  toBasketLine,
  toBasketLineOrigins,
  toBasketLinkPreview,
  toBasketOriginQuantityResult,
  toBasketParticipant,
  toBasketSession,
  toBasketSettleResult,
  toBasketShareLink,
  toBasketSplitResult,
  toBasketView,
} from '../mapping/basket-mappers';
import { toCatalogSuggestion } from '../mapping/mappers';
import { isRecord, mapArray } from '../mapping/primitives';
import { required } from '../mapping/required';
import type { BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';

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

  async reopen(
    generatedListId: string,
    lineId: string
  ): Promise<BasketSettleResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(generatedListId, lineId)}/reopen`,
        {},
        // The same participant credential as the settle, because it is the same
        // authorization: any live participant may reopen a line, guests included
        // (luna `0054`, section 3.5).
        this._participantOptions(generatedListId, 'basket.reopen')
      )
    );

    return required(toBasketSettleResult(answer), 'basket.reopen');
  }

  /**
   * Say how many are still to get (velista `0054`).
   *
   * The participant credential, like every other write on this surface: the gesture
   * is made in an aisle by whoever is holding the phone, which is very often not the
   * person who wrote the list.
   */
  async setOutstanding(
    generatedListId: string,
    lineId: string,
    body: BasketOutstandingRequest
  ): Promise<BasketSettleResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(generatedListId, lineId)}/outstanding`,
        body,
        this._participantOptions(generatedListId, 'basket.outstanding')
      )
    );

    return required(toBasketSettleResult(answer), 'basket.outstanding');
  }

  /**
   * Which lists are on this line, and which could be (velista `0055`).
   *
   * The same participant credential, and the server is what refuses it to a guest.
   * There is no check here, on purpose: a client side gate would be a second answer
   * to a question the gateway already answers per request, against the database, and
   * the two would eventually disagree.
   */
  async getLineOrigins(
    generatedListId: string,
    lineId: string
  ): Promise<BasketLineOrigins> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        `${this._line(generatedListId, lineId)}/origins`,
        this._participantOptions(generatedListId, 'basket.origins')
      )
    );

    return required(toBasketLineOrigins(body), 'basket.origins');
  }

  /**
   * Set what one list contributes to this line (velista `0055`).
   *
   * The zone line is **omitted rather than sent undefined** when there is none,
   * which is `addLine`'s rule and matters for the same reason: the gateway validates
   * `lineId` as a uuid, so a key present and empty is a refusal where an absent one
   * is the create branch that raising a list with no such line depends on.
   */
  async setOriginQuantity(
    generatedListId: string,
    lineId: string,
    body: BasketOriginQuantityRequest
  ): Promise<BasketOriginQuantityResult> {
    const request: Record<string, unknown> = {
      listId: body.listId,
      quantity: body.quantity,
      from: body.from,
    };
    if (body.lineId !== undefined) {
      request['lineId'] = body.lineId;
    }

    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(generatedListId, lineId)}/origins`,
        request,
        this._participantOptions(generatedListId, 'basket.setOriginQuantity')
      )
    );

    return required(
      toBasketOriginQuantityResult(answer),
      'basket.setOriginQuantity'
    );
  }

  /**
   * Give units of a line to other products, which splits the line.
   *
   * `…/products` and not `…/pick`, which this replaces: moving every outstanding
   * unit to one other product is this write with one share, and two routes would
   * be two rules about which product a settlement records.
   *
   * The shares are copied rather than passed through, because the caller's array
   * is a signal's value on a live pane and this request is asynchronous.
   */
  async splitLine(
    generatedListId: string,
    lineId: string,
    body: BasketSplitRequest
  ): Promise<BasketSplitResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(generatedListId, lineId)}/products`,
        {
          from: body.from,
          shares: body.shares.map((share) => ({
            itemId: share.itemId,
            quantity: share.quantity,
          })),
        },
        this._participantOptions(generatedListId, 'basket.splitLine')
      )
    );

    return required(toBasketSplitResult(answer), 'basket.splitLine');
  }

  /**
   * Put a line in the basket, as whichever kind of participant is holding it.
   *
   * `basket/lines` and not `lines`: the second is the **owner's** add on the account
   * surface, resolved by `ownerUserId`, and a guest with a perfectly valid session
   * gets a not found from it. See {@link BasketServiceI.addLine}.
   *
   * The optional fields are **omitted rather than sent undefined**, which is
   * `LineApi.addLine`'s rule and matters more here: the server validates `itemId` as
   * a uuid and `options` as an array of them, so a key present and empty is a
   * refusal where an absent one is a free text line.
   */
  async addLine(
    generatedListId: string,
    body: BasketAddLineRequest
  ): Promise<BasketLine> {
    const request: Record<string, unknown> = { content: body.content };
    if (body.quantity !== undefined) {
      request['quantity'] = body.quantity;
    }
    if (body.itemId !== undefined) {
      request['itemId'] = body.itemId;
    }
    if (body.options !== undefined && body.options.length > 0) {
      request['options'] = [...body.options];
    }

    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._basket(generatedListId)}/basket/lines`,
        request,
        this._participantOptions(generatedListId, 'basket.addLine')
      )
    );

    return required(toBasketLine(answer), 'basket.addLine');
  }

  /**
   * The catalog, searched through the basket rather than through an account.
   *
   * No scope goes out with it, and that is the route's design rather than an
   * omission on this side: the ranking is the **run's**, which the gateway resolves
   * from the basket's own snapshot. A guest naming where to price a stranger's
   * basket is not a thing the server accepts.
   *
   * **Empty rather than thrown**, exactly as `CatalogApi.suggest` is: a dropdown is
   * an offer, and the one thing this must never do is make adding a line fail
   * because a search did.
   */
  async suggest(
    generatedListId: string,
    query: string
  ): Promise<readonly CatalogSuggestion[]> {
    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(
          `${this._basket(generatedListId)}/catalog/suggest`,
          {
            ...this._participantOptions(generatedListId, 'basket.suggest'),
            params: new HttpParams().set('q', query),
          }
        )
      );

      // The order is the server's and is never re-sorted here, for the reason
      // written on `CatalogApi.suggest`: the client holds none of the prices,
      // scopes or synonyms that decided it.
      return isRecord(body)
        ? mapArray(body['suggestions'], toCatalogSuggestion)
        : [];
    } catch {
      return [];
    }
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
