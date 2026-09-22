import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  Basket,
  BasketAddLineRequest,
  BasketChangePage,
  BasketDemandRequest,
  BasketLinkPreview,
  BasketParticipant,
  BasketRenameRequest,
  BasketRenameResult,
  BasketRevertRequest,
  BasketRowResult,
  BasketSession,
  BasketSettleRequest,
  BasketShareLink,
  CatalogSuggestion,
  LiveBasketSummary,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { anonymous, operation } from '../auth/http-context';
import {
  toBasketChangePage,
  type BasketChangeContext,
} from '../mapping/basket-change-mappers';
import {
  toBasket,
  toBasketLinkPreview,
  toBasketParticipant,
  toBasketRenameResult,
  toBasketRowResult,
  toBasketSession,
  toBasketShareLink,
  toLiveBasketSummary,
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
 * Where a basket lives: its own rows, and its sharing half too (backend `0144`).
 *
 * A constant rather than a string at each call site, because eleven template
 * literals name it. Backend `0136` served the rows from here and left the
 * participant token, the share link, the participants and leaving under the old
 * path; backend `0144` moved those here as well, so one constant answers for
 * every call this file makes.
 */
const BASKETS = '/v1/baskets';

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

  async getBasket(basketId: string): Promise<Basket> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        this._basket(basketId),
        this._participantOptions(basketId, 'basket.get')
      )
    );

    return required(toBasket(body), 'basket.get');
  }

  /**
   * The caller's own permanent basket, created by the server on the first read.
   *
   * **No participant options.** This route is account authenticated, and the
   * ordinary auth interceptor attaches the bearer token; sending a stored secret
   * here would be a credential for a different basket entirely. Every later
   * request about this basket goes out by its id, through the participant
   * surface, where the owner arrives as their own participant row.
   */
  async getLiveBasket(): Promise<Basket> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._live(), {
        context: operation('basket.live'),
      })
    );

    return required(toBasket(body), 'basket.live');
  }

  /** The three numbers the dashboard card draws, with no rows behind them. */
  async getLiveSummary(): Promise<LiveBasketSummary> {
    const body = await firstValueFrom(
      this._http.get<unknown>(`${this._live()}/summary`, {
        context: operation('basket.live.summary'),
      })
    );

    return required(toLiveBasketSummary(body), 'basket.live.summary');
  }

  /**
   * Say what happened to a row at the shelf.
   *
   * The optional fields are **omitted rather than sent undefined**, which is this
   * file's rule everywhere: the server validates `itemId` as a uuid and refuses a
   * `quantity` on a `NOT_AVAILABLE`, so a key present and empty is a refusal
   * where an absent one is the branch the caller meant.
   *
   * The allocations are copied rather than passed through, because the caller's
   * array can be a signal's value on a live pane and this request is
   * asynchronous.
   */
  async settle(
    basketId: string,
    rowKey: string,
    body: BasketSettleRequest
  ): Promise<BasketRowResult> {
    const request: Record<string, unknown> = {
      outcome: body.outcome,
      from: body.from,
    };
    if (body.quantity !== undefined) {
      request['quantity'] = body.quantity;
    }
    if (body.itemId !== undefined) {
      request['itemId'] = body.itemId;
    }
    if (body.allocations !== undefined && body.allocations.length > 0) {
      request['allocations'] = body.allocations.map((allocation) => ({
        lineId: allocation.lineId,
        quantity: allocation.quantity,
      }));
    }

    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._row(basketId, rowKey)}/settle`,
        request,
        this._participantOptions(basketId, 'basket.settle')
      )
    );

    return required(toBasketRowResult(answer), 'basket.settle');
  }

  /**
   * Take units, or a close, back off a row.
   *
   * The two branches send different bodies rather than one body with optional
   * halves, because that is what they are: the server requires `units` and `from`
   * on `UNITS` and refuses them on `CLOSE`, and a close has no number to take
   * back.
   *
   * The same participant credential as the settle, because it is the same
   * authorization: any live participant may, guests included (luna `0054`,
   * section 3.5).
   */
  async revert(
    basketId: string,
    rowKey: string,
    body: BasketRevertRequest
  ): Promise<BasketRowResult> {
    const request =
      body.target === 'UNITS'
        ? { target: 'UNITS', units: body.units, from: body.from }
        : { target: 'CLOSE' };

    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._row(basketId, rowKey)}/revert`,
        request,
        this._participantOptions(basketId, 'basket.revert')
      )
    );

    return required(toBasketRowResult(answer), 'basket.revert');
  }

  /**
   * Put a row off for now, and take that back (backend `0137`).
   *
   * **No body on either**, which is not an omission: a skip is a fact with no
   * parameters. It carries no `from` because it has no number to be stale
   * about, and `PUT` rather than `POST` because skipping an already skipped row
   * is the state that was asked for and not a second act.
   *
   * The participant credential, because every participant may skip, a guest
   * included: it is a smaller act than a settle, which every participant
   * already may.
   */
  async skip(basketId: string, rowKey: string): Promise<BasketRowResult> {
    const answer = await firstValueFrom(
      this._http.put<unknown>(
        `${this._row(basketId, rowKey)}/skip`,
        {},
        this._participantOptions(basketId, 'basket.skip')
      )
    );

    return required(toBasketRowResult(answer), 'basket.skip');
  }

  /** The same route, the opposite verb. See {@link skip}. */
  async unskip(basketId: string, rowKey: string): Promise<BasketRowResult> {
    const answer = await firstValueFrom(
      this._http.delete<unknown>(
        `${this._row(basketId, rowKey)}/skip`,
        this._participantOptions(basketId, 'basket.skip')
      )
    );

    return required(toBasketRowResult(answer), 'basket.skip');
  }

  /**
   * Change what one list asks for (velista `0092`, section 6).
   *
   * `lineId` always goes out, although the server requires it only on a row of
   * several entries: the control is drawn per entry, so there is always one to
   * name, and leaving the server to guess on a single entry row would be one
   * entry away from moving a list nobody pointed at.
   */
  async setDemand(
    basketId: string,
    rowKey: string,
    body: BasketDemandRequest
  ): Promise<BasketRowResult> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._row(basketId, rowKey)}/demand`,
        { lineId: body.lineId, quantity: body.quantity, from: body.from },
        this._participantOptions(basketId, 'basket.demand')
      )
    );

    return required(toBasketRowResult(answer), 'basket.demand');
  }

  /**
   * Add a line onto one of the basket's covered lists (velista `0092`,
   * section 7).
   *
   * `itemIds` is **omitted rather than sent empty**, this file's rule
   * everywhere: the server validates each element as a uuid, and an empty array
   * is a product set somebody chose where an absent key is free text.
   */
  async addLine(
    basketId: string,
    body: BasketAddLineRequest
  ): Promise<BasketRowResult> {
    const request: Record<string, unknown> = {
      targetListId: body.targetListId,
      content: body.content,
      quantity: body.quantity,
    };
    if (body.itemIds !== undefined && body.itemIds.length > 0) {
      request['itemIds'] = [...body.itemIds];
    }

    const answer = await firstValueFrom(
      this._http.post<unknown>(
        `${this._basket(basketId)}/lines`,
        request,
        this._participantOptions(basketId, 'basket.addLine')
      )
    );

    return required(toBasketRowResult(answer), 'basket.addLine');
  }

  /**
   * Rename a row, and every list line inside it (velista `0084`).
   *
   * `confirmMerge` is **omitted unless true**, so the first request always asks: a
   * body that carried `false` would mean the same thing today and would be one
   * refactor away from carrying `true` by accident.
   */
  async renameRow(
    basketId: string,
    rowKey: string,
    body: BasketRenameRequest
  ): Promise<BasketRenameResult> {
    const request: Record<string, unknown> = { content: body.content };
    if (body.confirmMerge === true) {
      request['confirmMerge'] = true;
    }

    const answer = await firstValueFrom(
      this._http.patch<unknown>(
        this._row(basketId, rowKey),
        request,
        this._participantOptions(basketId, 'basket.renameRow')
      )
    );

    return required(toBasketRenameResult(answer), 'basket.renameRow');
  }

  /**
   * The catalog, searched through the basket rather than through an account.
   *
   * No scope goes out with it, and that is the route's design rather than an
   * omission on this side: the ranking is the **basket's**, which the gateway
   * resolves from the basket's own pricing profile. A guest naming where to price
   * a stranger's basket is not a thing the server accepts.
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
        this._http.get<unknown>(`${this._basket(basketId)}/catalog/suggest`, {
          ...this._participantOptions(basketId, 'basket.suggest'),
          params: new HttpParams().set('q', query),
        })
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

  /**
   * What changed on the lists this basket covers, newest first (velista `0093`).
   *
   * The cursor is **omitted rather than sent empty** on the first page, this
   * file's rule everywhere: the gateway validates it as an opaque string, and a
   * present but empty one is a cursor where an absent one is the beginning.
   *
   * No limit goes out. The server's default page is what the sheet draws, and a
   * number here would be a second answer to a question the gateway already has
   * a considered one for.
   */
  async changes(
    basketId: string,
    context: BasketChangeContext,
    cursor?: string
  ): Promise<BasketChangePage> {
    const options = this._participantOptions(basketId, 'basket.changes');
    const body = await firstValueFrom(
      this._http.get<unknown>(`${this._basket(basketId)}/changes`, {
        ...options,
        ...(cursor === undefined
          ? {}
          : { params: new HttpParams().set('cursor', cursor) }),
      })
    );

    // Never `required`: a page that could not be read is an empty page with no
    // cursor, which the sheet draws as "nothing changed lately". The mapper
    // already drops one bad entry without failing the nineteen beside it.
    return toBasketChangePage(body, context);
  }

  /**
   * Say which changes this viewer has drawn (velista `0093`, section 7).
   *
   * **The answer is discarded on purpose.** It carries the count as it now
   * stands and how long the acknowledged marks stay drawn, and this client uses
   * neither: the count and the marks come from the basket read the caller makes
   * next, and a duration held here would be a clock on the client deciding what
   * is new, which is the one thing this whole plan forbids.
   */
  async acknowledgeChanges(basketId: string, through: string): Promise<void> {
    await firstValueFrom(
      this._http.post<unknown>(
        `${this._basket(basketId)}/changes/seen`,
        { through },
        this._participantOptions(basketId, 'basket.changes.seen')
      )
    );
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
      toBasketSession({
        ...(body as object),
        basketId: basketId,
      }),
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
      this._http.delete<unknown>(`${this._basket(basketId)}/share-link`, {
        // Always sent explicitly, never left to the server's default: the two
        // outcomes differ by whether three people are thrown out of a shop.
        params: new HttpParams().set('revokeParticipants', cascade),
        context: operation('basket.shareLink.revoke'),
      })
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

  /**
   * One basket's path: its rows, its catalog search and its sharing half.
   *
   * There were two helpers here while the split was real, because backend `0136`
   * moved the rows to `/v1/baskets` and left the sharing half where it was.
   * Backend `0144` moved the rest, so both halves answer to one helper.
   */
  private _basket(basketId: string): string {
    return this._urls.gateway(`${BASKETS}/${encodeURIComponent(basketId)}`);
  }

  /**
   * The caller's own permanent basket, addressed by a word rather than an id.
   *
   * The gateway registers this literal before `:id` for the same reason the route
   * table does: both match, and the first match runs.
   */
  private _live(): string {
    return this._urls.gateway(`${BASKETS}/live`);
  }

  /** One row of a basket, which every write addresses. */
  private _row(basketId: string, rowKey: string): string {
    return `${this._basket(basketId)}/rows/${encodeURIComponent(rowKey)}`;
  }

  private _link(secret: string): string {
    return this._urls.gateway(`/v1/share-links/${encodeURIComponent(secret)}`);
  }
}
