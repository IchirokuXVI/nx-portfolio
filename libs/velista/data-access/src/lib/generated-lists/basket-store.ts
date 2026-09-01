import { computed, inject, Injectable, signal } from '@angular/core';
import {
  outstanding,
  type BasketLine,
  type BasketLoad,
  type BasketParticipant,
  type BasketSettleRequest,
  type BasketSettleResult,
  type BasketShareLink,
  type BasketView,
} from '@portfolio/velista/models';
import { hasResponse } from '../errors';
import { BasketSessionStore } from './basket-session-store';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';

/**
 * One shared basket, as the screen in a shop reads and changes it (plan 0044).
 *
 * ## Why the whole basket is one signal
 *
 * Every row on this screen is drawn from three things at once: the line, the
 * participant who last touched it, and the product it picks. Splitting them into
 * three stores would mean a row that can render with an attribution resolved and
 * a product not, which is a state the server never sends and the screen would
 * have to invent an appearance for. One read, one signal, one shape.
 *
 * ## What keeps it current
 *
 * Refetching, and deliberately so for now. The basket's own realtime room exists
 * on the server (backend `0051`, section 10) but the client cannot join it: every
 * socket in this app authenticates with an account token and a **guest has
 * none**, so a live basket needs a second, participant authenticated connection
 * that plan 0044 section 6 names and nothing in `libs/velista/data-access/realtime`
 * supports yet. Until that lands, this store reloads after each of its own writes
 * and on demand from the page (`0035`'s resume), which keeps one person's own
 * screen exactly right and leaves a second person's stale until they act or come
 * back to the app.
 *
 * The shape here does not depend on that: {@link apply} takes one line and folds
 * it in, which is precisely what a `generatedList.lineSettled` handler will call.
 *
 * ## Revocation is learned, never predicted
 *
 * A participant can be removed while their phone is in their hand, and the server
 * refuses them on the next action with no cache to wait out (backend `0051`,
 * section 3.3). So there is no local expiry check anywhere here: a 401 on any
 * participant request is what moves {@link state} to `revoked`, and the stored
 * credential is dropped at the same moment so the person is offered the join
 * screen rather than a basket that refuses every tap.
 */
// Provided by the page, not the app and not root: a basket is one screen's
// subject and two baskets are never open at once (rule D5, plan 0004 section 9).
@Injectable()
export class BasketStore {
  private readonly _service = inject<BasketServiceI>(BASKET_SERVICE);
  private readonly _sessions = inject(BasketSessionStore);

  private readonly _basket = signal<BasketView | null>(null);
  private readonly _state = signal<BasketLoad>('loading');
  private readonly _error = signal<unknown>(null);
  private readonly _link = signal<BasketShareLink | null>(null);
  private readonly _busyLines = signal<ReadonlySet<string>>(new Set());

  /** Which basket this store is about, once it has been told. */
  private _id: string | null = null;

  /** The basket, or null before the first read completes. */
  readonly basket = this._basket.asReadonly();

  /** How the read has got on, which is what the page branches its whole body on. */
  readonly state = this._state.asReadonly();

  /** The failure behind a `failed` state, for its correlation id. */
  readonly error = this._error.asReadonly();

  /**
   * The live share link, or null when the basket is not shared right now.
   *
   * Only ever populated for the owner: the routes behind it are account
   * authenticated, and nobody else's screen draws a share control at all.
   */
  readonly shareLink = this._link.asReadonly();

  /** Lines with a write in flight, so a row can show it without blocking a tap. */
  readonly busyLines = this._busyLines.asReadonly();

  /** The lines, in the order the basket holds them. */
  readonly lines = computed<readonly BasketLine[]>(
    () => this._basket()?.lines ?? []
  );

  /**
   * Whether this reader may see zone data, as the **server** decided on the last
   * read (backend `0051`, section 5.2).
   *
   * False before anything has loaded, which is the safe direction: a screen that
   * guessed true for a moment would draw a household's list name and then take it
   * away, and the flicker would be a real disclosure.
   */
  readonly seesZoneData = computed(() => this._basket()?.seesZoneData === true);

  /** Everybody on the basket, for the presence row and for attribution. */
  readonly participants = computed<readonly BasketParticipant[]>(
    () => this._basket()?.participants ?? []
  );

  /** The reader's own participant row, once the basket has loaded. */
  readonly me = computed<BasketParticipant | null>(
    () => this._basket()?.me ?? null
  );

  /** Participants by id, which is how every row resolves who touched it. */
  readonly participantsById = computed<ReadonlyMap<string, BasketParticipant>>(
    () => new Map(this.participants().map((person) => [person.id, person]))
  );

  /**
   * How much of this basket has been got, for the header's "4 of 12" line.
   *
   * Lines and not units, matching how `0047` counts a zone list: "four things
   * done out of twelve" is what somebody in a shop is tracking, and a basket of
   * one line asking for twelve tins would otherwise read as almost finished.
   */
  readonly progress = computed(() => {
    const lines = this.lines();
    return {
      done: lines.filter((line) => outstanding(line) === 0).length,
      total: lines.length,
    };
  });

  /**
   * Load a basket, deciding first whether this browser may even ask.
   *
   * No stored credential and no account token means the reader is a stranger on a
   * link, which is `needsJoin` rather than a failure: the join screen is the
   * answer, not an error.
   */
  async open(generatedListId: string): Promise<void> {
    this._id = generatedListId;
    this._state.set('loading');
    this._error.set(null);
    await this.refresh();
  }

  /**
   * Re-read the basket.
   *
   * Called after this store's own writes, and by the page when the app comes back
   * from the background (`0035`), which is the moment a shopper's screen is most
   * likely to be behind somebody else's.
   */
  async refresh(): Promise<void> {
    const id = this._id;
    if (id === null) {
      return;
    }

    try {
      const basket = await this._service.getBasket(id);
      this._basket.set(basket);
      this._state.set('ready');
      this._error.set(null);
    } catch (error) {
      this._fail(id, error);
    }
  }

  /**
   * Settle a line: the whole outstanding amount, a number, or an allocation.
   *
   * Answers the result rather than swallowing it, because the caller has to say
   * something when an origin was missed: {@link BasketSettleResult.skippedCount}
   * is the honest report a guest gets and the sheet has to render it (backend
   * `0051`, section 6.4).
   *
   * The returned line is folded in immediately, so the row is right before the
   * refresh that follows lands.
   */
  async settle(
    lineId: string,
    body: BasketSettleRequest
  ): Promise<BasketSettleResult | null> {
    return this._write(lineId, async (id) => {
      const result = await this._service.settle(id, lineId, body);
      this.apply(result.line);
      return result;
    });
  }

  /**
   * Swap a line's pick to another of its options.
   *
   * Available to everybody, guests included: the options are catalog products and
   * never zone data (backend `0051`, section 6.1).
   */
  async setPick(lineId: string, itemId: string): Promise<BasketLine | null> {
    return this._write(lineId, async (id) => {
      const line = await this._service.setPick(id, lineId, itemId);
      this.apply(line);
      return line;
    });
  }

  /**
   * Fold one changed line into the basket, in place.
   *
   * The join between a server answer and what is on screen, and the one method a
   * realtime handler will call unchanged when the basket's room becomes reachable.
   *
   * **It merges rather than replacing.** A broadcast into a basket room is
   * redacted to the least privileged reader in it, so a line arriving that way
   * carries no `origins` even for somebody entitled to them. Those fields do not
   * change when a line is settled or its pick swapped, so keeping the ones
   * already held is both correct and what stops a privileged reader's captions
   * disappearing when somebody else settles something.
   */
  apply(line: BasketLine): void {
    this._basket.update((basket) => {
      if (basket === null) {
        return basket;
      }
      return {
        ...basket,
        lines: basket.lines.map((held) =>
          held.id === line.id
            ? { ...held, ...line, origins: line.origins ?? held.origins }
            : held
        ),
      };
    });
  }

  // --- The owner's share sheet ----------------------------------------------

  /** Read the live link without minting one, for a sheet opened to check. */
  async loadShareLink(): Promise<void> {
    const id = this._id;
    if (id === null) {
      return;
    }
    this._link.set(await this._service.getShareLink(id));
  }

  /**
   * Mint the link, or hand back the one that is already live.
   *
   * Pressing share is what creates a link at all: a basket starts with zero, and
   * this is the gesture that gives it one.
   */
  async share(): Promise<BasketShareLink | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }
    const link = await this._service.ensureShareLink(id);
    this._link.set(link);
    return link;
  }

  /**
   * Revoke the link, and separately decide whether to evict the people it let in.
   *
   * `cascade` defaults to false at the service, and the sheet asks about it as a
   * distinct tick rather than folding it into the button: revoking stops the link
   * spreading, and throwing three people out of a shop is a different intention
   * that has to be stated.
   */
  async revokeLink(cascade: boolean): Promise<void> {
    const id = this._id;
    if (id === null) {
      return;
    }
    await this._service.revokeShareLink(id, cascade);
    this._link.set(null);
    await this.refresh();
  }

  /** Remove one participant and nobody else: the lost phone. */
  async removeParticipant(participantId: string): Promise<void> {
    const id = this._id;
    if (id === null) {
      return;
    }
    await this._service.revokeParticipant(id, participantId);
    await this.refresh();
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Run one line write, marking the row busy and reporting a revocation.
   *
   * Returns null rather than throwing when the write fails: the caller is a sheet
   * that has to close or stay open, and every failure this can suffer is already
   * reflected in {@link state} or is a transient the next refresh resolves.
   */
  private async _write<T>(
    lineId: string,
    send: (id: string) => Promise<T>
  ): Promise<T | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }

    this._busyLines.update((busy) => new Set(busy).add(lineId));
    try {
      return await send(id);
    } catch (error) {
      this._fail(id, error);
      return null;
    } finally {
      this._busyLines.update((busy) => {
        const next = new Set(busy);
        next.delete(lineId);
        return next;
      });
    }
  }

  /**
   * Turn a failed participant request into a state the screen has a treatment for.
   *
   * A 401 here means one thing: the credential this browser holds no longer names
   * a live participant, because it was revoked, or the link that minted it was
   * revoked with the cascade ticked. The stored secret is dropped at the same
   * moment, so the person is offered the join screen — where the link they still
   * have may let them back in — rather than a basket that refuses every tap.
   */
  private _fail(generatedListId: string, error: unknown): void {
    this._error.set(error);

    if (hasResponse(error) && (error as { status: number }).status === 401) {
      // The two readings of one status, told apart by what this browser was
      // holding. A credential that has stopped working was **revoked**, and the
      // person should be told so. No credential at all is a stranger who has
      // followed a link and simply has not joined yet, which is not a failure
      // and must not be reported as one.
      const held = this._sessions.read(generatedListId);
      this._sessions.forget(generatedListId);
      this._state.set(held === null ? 'needsJoin' : 'revoked');
      return;
    }

    // Anything else is a network or a server problem, and the basket that is
    // already on screen stays on screen: a shopper in an aisle is better served
    // by a list that is a minute old than by an error page.
    this._state.set(this._basket() === null ? 'failed' : 'ready');
  }
}
