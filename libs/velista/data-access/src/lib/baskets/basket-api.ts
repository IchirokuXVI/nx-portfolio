import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  BasketAddLineRequest,
  BasketLine,
  BasketLineOrigins,
  BasketLinkPreview,
  BasketOriginQuantityRequest,
  BasketOriginQuantityResult,
  BasketOriginSettledRequest,
  BasketOriginSettledResult,
  BasketOutstandingRequest,
  BasketParticipant,
  BasketRenameRequest,
  BasketRenameResult,
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
  toBasketOriginSettledResult,
  toBasketParticipant,
  toBasketRenameResult,
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
 * ## Why the preview skips auth entirely
 *
 * The preview is the one route here that goes out with `anonymous()`, so a
 * **stale** account token cannot turn a stranger opening a link into a 401: an
 * expired session belongs to the person who left this browser signed in, and it
 * must not stand between a flatmate and the shopping list they were sent.
 *
 * The join reaches the same guard from the other side and does **not** skip auth,
 * because what it answers depends on who is asking. See {@link join}.
 */
@Injectable()
export class BasketApi implements BasketServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _sessions = inject(BasketSessionStore);

  // --- What a link reaches ---------------------------------------------------

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

  /**
   * Take the link up, as whoever is holding this browser.
   *
   * **`operation` and not `anonymous`, and that is the whole substance of the
   * call.** The route runs under the gateway's optional JWT guard: a request with
   * no bearer mints a guest, and a bearer the guard resolves attaches that account
   * as a `REGISTERED` participant, which is what plan `0044` section 3 promises
   * somebody who is already signed in. `anonymous` suppresses the bearer, so a
   * member opening their own household's link landed on it as Guest 3.
   *
   * A visitor with no account still sends nothing, because the interceptor attaches
   * a token only when the token store holds a session, and still joins as a guest.
   * A signed in person whose token has gone stale gets the interceptor's ordinary
   * refresh, and the ordinary one retry after a 401. That is right rather than
   * unfortunate: the gateway refuses a present but bad token on purpose, so that an
   * expired session cannot quietly become a second identity on somebody's basket.
   *
   * So this is not the sibling of {@link previewLink}, and it must not be "fixed"
   * back to `anonymous` for the reason login and register use it. Those two have no
   * token to send; this one answers differently depending on whether there is one.
   */
  async join(secret: string, displayName?: string): Promise<BasketSession> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._link(secret)}/join`,
        // Absent rather than an empty string when they skipped it: the server
        // reads absence as "give them Guest N", and `''` would be a name.
        displayName === undefined || displayName.trim() === ''
          ? {}
          : { displayName: displayName.trim() },
        { context: operation('basket.join') }
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

  async getBasket(basketId: string): Promise<BasketView> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        `${this._basket(basketId)}/basket`,
        this._participantOptions(basketId, 'basket.get')
      )
    );

    return required(toBasketView(body), 'basket.get');
  }

  async settle(
    basketId: string,
    lineId: string,
    body: BasketSettleRequest
  ): Promise<BasketSettleResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(basketId, lineId)}/settle`,
        body,
        this._participantOptions(basketId, 'basket.settle')
      )
    );

    return required(toBasketSettleResult(answer), 'basket.settle');
  }

  async reopen(
    basketId: string,
    lineId: string
  ): Promise<BasketSettleResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(basketId, lineId)}/reopen`,
        {},
        // The same participant credential as the settle, because it is the same
        // authorization: any live participant may reopen a line, guests included
        // (luna `0054`, section 3.5).
        this._participantOptions(basketId, 'basket.reopen')
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
    basketId: string,
    lineId: string,
    body: BasketOutstandingRequest
  ): Promise<BasketSettleResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(basketId, lineId)}/outstanding`,
        body,
        this._participantOptions(basketId, 'basket.outstanding')
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
    basketId: string,
    lineId: string
  ): Promise<BasketLineOrigins> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        `${this._line(basketId, lineId)}/origins`,
        this._participantOptions(basketId, 'basket.origins')
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
    basketId: string,
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
        `${this._line(basketId, lineId)}/origins`,
        request,
        this._participantOptions(basketId, 'basket.setOriginQuantity')
      )
    );

    return required(
      toBasketOriginQuantityResult(answer),
      'basket.setOriginQuantity'
    );
  }

  /**
   * Set how many of a line one list has got (velista `0073`, backend `0104`).
   *
   * A second route beside the one above rather than a flag on it, because the two
   * are opposite acts: that one changes what a household asked for and buys
   * nothing, and this one records or takes back a purchase for one list.
   *
   * The zone line is sent plainly, without the sibling's omit dance: it is required
   * here, and a list holding no line of this cannot have got any of it.
   */
  async setOriginSettled(
    basketId: string,
    lineId: string,
    body: BasketOriginSettledRequest
  ): Promise<BasketOriginSettledResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(basketId, lineId)}/origins/settled`,
        { lineId: body.lineId, settled: body.settled, from: body.from },
        this._participantOptions(basketId, 'basket.setOriginSettled')
      )
    );

    return required(
      toBasketOriginSettledResult(answer),
      'basket.setOriginSettled'
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
    basketId: string,
    lineId: string,
    body: BasketSplitRequest
  ): Promise<BasketSplitResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._line(basketId, lineId)}/products`,
        {
          from: body.from,
          shares: body.shares.map((share) => ({
            itemId: share.itemId,
            quantity: share.quantity,
          })),
        },
        this._participantOptions(basketId, 'basket.splitLine')
      )
    );

    return required(toBasketSplitResult(answer), 'basket.splitLine');
  }

  /**
   * Rename a basket line, and the zone lines it came from (velista `0084`).
   *
   * `confirmMerge` is **omitted unless true**, so the first request always asks: a
   * body that carried `false` would mean the same thing today and would be one
   * refactor away from carrying `true` by accident.
   */
  async renameLine(
    basketId: string,
    lineId: string,
    body: BasketRenameRequest
  ): Promise<BasketRenameResult> {
    const request: Record<string, unknown> = { content: body.content };
    if (body.confirmMerge === true) {
      request['confirmMerge'] = true;
    }

    const answer = await firstValueFrom(
      this._http.patch<unknown>(
        `${this._basket(basketId)}/basket/lines/${encodeURIComponent(
          lineId
        )}`,
        request,
        this._participantOptions(basketId, 'basket.renameLine')
      )
    );

    return required(toBasketRenameResult(answer), 'basket.renameLine');
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
    basketId: string,
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
        `${this._basket(basketId)}/basket/lines`,
        request,
        this._participantOptions(basketId, 'basket.addLine')
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
    basketId: string,
    query: string
  ): Promise<readonly CatalogSuggestion[]> {
    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(
          `${this._basket(basketId)}/catalog/suggest`,
          {
            ...this._participantOptions(basketId, 'basket.suggest'),
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
    basketId: string
  ): Promise<readonly BasketParticipant[]> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        `${this._basket(basketId)}/participants/mine`,
        this._participantOptions(basketId, 'basket.participants')
      )
    );

    return mapArray(
      (body as { participants?: unknown } | null)?.participants,
      toBasketParticipant
    );
  }

  async refreshSocketToken(basketId: string): Promise<BasketSession> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._basket(basketId)}/participant-token`,
        {},
        this._participantOptions(basketId, 'basket.socketToken')
      )
    );

    const held = this._sessions.read(basketId);
    const refreshed = required(
      toBasketSession({ ...(body as object), basketId }),
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

  async ensureShareLink(basketId: string): Promise<BasketShareLink> {
    const body = await firstValueFrom(
      this._http.put<unknown>(
        `${this._basket(basketId)}/share-link`,
        {},
        { context: operation('basket.shareLink.ensure') }
      )
    );

    return required(toBasketShareLink(body), 'basket.shareLink.ensure');
  }

  async getShareLink(basketId: string): Promise<BasketShareLink | null> {
    const body = await firstValueFrom(
      this._http.get<unknown>(`${this._basket(basketId)}/share-link`, {
        context: operation('basket.shareLink.get'),
      })
    );

    // Null is an ordinary answer and not a failure: a basket has zero links or
    // one, and zero is where every basket starts.
    return toBasketShareLink(body);
  }

  async revokeShareLink(
    basketId: string,
    cascade = false
  ): Promise<{ revoked: number }> {
    const body = await firstValueFrom(
      this._http.delete<unknown>(
        `${this._basket(basketId)}/share-link`,
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
    basketId: string,
    participantId: string
  ): Promise<void> {
    await firstValueFrom(
      this._http.delete<unknown>(
        `${this._basket(basketId)}/participants/${encodeURIComponent(
          participantId
        )}`,
        { context: operation('basket.participant.revoke') }
      )
    );
  }

  async addParticipant(
    basketId: string,
    userId: string
  ): Promise<BasketParticipant> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._basket(basketId)}/participants`,
        { userId },
        { context: operation('basket.participant.add') }
      )
    );

    return required(toBasketParticipant(body), 'basket.participant.add');
  }

  async leaveBasket(basketId: string): Promise<void> {
    await firstValueFrom(
      this._http.delete<unknown>(
        `${this._basket(basketId)}/participants/mine`,
        this._participantOptions(basketId, 'basket.participant.leave')
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
    basketId: string,
    name: string
  ): { headers?: HttpHeaders; context: ReturnType<typeof operation> } {
    const secret = this._sessions.read(basketId)?.secret;
    return secret
      ? {
          headers: new HttpHeaders().set(PARTICIPANT_SECRET_HEADER, secret),
          context: operation(name),
        }
      : { context: operation(name) };
  }

  private _basket(basketId: string): string {
    return this._urls.gateway(
      `/v1/baskets/${encodeURIComponent(basketId)}`
    );
  }

  private _line(basketId: string, lineId: string): string {
    return `${this._basket(basketId)}/lines/${encodeURIComponent(lineId)}`;
  }

  private _link(secret: string): string {
    return this._urls.gateway(`/v1/share-links/${encodeURIComponent(secret)}`);
  }
}
