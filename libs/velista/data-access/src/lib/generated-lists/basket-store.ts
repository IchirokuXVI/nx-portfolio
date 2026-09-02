import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  outstanding,
  type BasketLine,
  type BasketLoad,
  type BasketParticipant,
  type BasketPresenceEntry,
  type BasketSettleRequest,
  type BasketSettleResult,
  type BasketShareLink,
  type BasketView,
} from '@portfolio/velista/models';
import { hasResponse } from '../errors';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';
import { BasketSocket } from './basket-socket';

/**
 * How long a refetch waits, so a burst of events costs one request.
 *
 * Four people in a shop settling lines produce a stream of broadcasts, and the two
 * events that cannot be applied without asking (a participant moving, the basket
 * itself changing) would otherwise be one request each. `GeneratedListStore` coalesces
 * on the same reasoning and the same order of delay.
 */
const REFRESH_DEBOUNCE_MS = 1500;

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
 * {@link BasketSocket}, since plan `0048`: a second connection, authenticated as the
 * **participant** rather than as an account, so a guest holding a link has one too.
 * The server joins it to the basket's room on connect, so two people working through
 * one list in a shop see each other's settles with no reload and no request.
 *
 * `0044` shipped this screen refetching, on its own writes and on resume, and that is
 * still what happens when the socket will not open: it is a working screen and the
 * page says it is not live rather than pretending. Refetching also remains the answer
 * for an event that arrives without a readable line, and for the two events that say
 * something moved without saying what.
 *
 * **A line off the room is redacted to the least privileged reader in it**, because a
 * broadcast cannot be projected per socket, so it carries no `origins` even for
 * somebody entitled to them. {@link apply} merges by id and keeps what it holds, which
 * is what stops a redacted event downgrading a privileged reader's view. It was
 * written that way by `0044` so that this plan is a call rather than a redesign.
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
  private readonly _socket = inject(BasketSocket);

  private readonly _basket = signal<BasketView | null>(null);
  private readonly _state = signal<BasketLoad>('loading');
  private readonly _error = signal<unknown>(null);
  private readonly _link = signal<BasketShareLink | null>(null);
  private readonly _busyLines = signal<ReadonlySet<string>>(new Set());
  private readonly _present = signal<readonly BasketPresenceEntry[]>([]);

  /** Which basket this store is about, once it has been told. */
  private _id: string | null = null;

  /** The pending coalesced refresh, or null. See {@link _scheduleRefresh}. */
  private _refreshAt: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph. Every other
    // store in this library says the same thing.
    const subscription = this._socket.events.subscribe((event) => {
      switch (event.type) {
        case 'generatedList.lineSettled':
        case 'generatedList.lineUpdated':
          if (event.generatedListId !== this._id) {
            // The socket is pinned to one basket, so this cannot normally happen. It
            // is checked anyway, because the alternative to a cheap comparison is a
            // row from another basket appearing in this one.
            return;
          }
          if (event.line === null) {
            // The event said which basket moved and not what moved, so the only honest
            // answer is to go and look.
            this._scheduleRefresh();
            return;
          }
          this.apply(event.line);
          return;

        case 'generatedList.participantJoined':
        case 'generatedList.participantLeft':
          // The participant list is redacted per reader and carries a device for some
          // of them, so it is refetched rather than assembled from a broadcast that
          // was redacted to somebody else.
          this._scheduleRefresh();
          return;

        case 'generatedList.updated':
          // The name or the status moved. The payload is a summary and this store
          // holds the whole basket, so there is nothing here to merge.
          if (event.list.id === this._id) {
            this._scheduleRefresh();
          }
          return;

        case 'presence.generatedListUpdated':
          if (event.generatedListId === this._id) {
            this._present.set(event.present);
          }
          return;

        default:
          return;
      }
    });

    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      this._cancelRefresh();
    });
  }

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

  /**
   * Whether this basket is live, which the screen says out loud.
   *
   * A live basket and a refetching one look identical while nobody else is shopping,
   * and completely different the moment somebody is, so "nothing is moving" has to be
   * distinguishable from "nothing is happening" (plan 0048, section 5).
   */
  readonly live = this._socket.connected;

  /**
   * Whether the server has refused to renew this participant, meaning removed.
   *
   * Distinct from {@link state} being `revoked`, which is the same fact learned from a
   * write. The socket learns it sooner, at the refresh, which is the point of holding
   * one.
   */
  readonly revoked = this._socket.revoked;

  /**
   * Who has this basket **open right now**, newest broadcast wins.
   *
   * Not the participants, and the difference is why it is a separate signal rather
   * than a filter over one list. A participant is somebody who may open this basket;
   * an entry here is somebody who has. Those diverge exactly when it matters, which is
   * after a trip, when everybody has gone home and the basket still has four
   * participants.
   *
   * Empty when the socket is down rather than frozen at its last known value: a stale
   * face row is a claim about the present tense that nothing is checking.
   */
  readonly present = computed<readonly BasketPresenceEntry[]>(() =>
    this._socket.connected() ? this._present() : []
  );

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

  /**
   * The source lists by name, for the row's "from" caption.
   *
   * Empty for a reader who may not see origins, which is the same reader whose
   * lines carry no `origins` at all: the caption is gated on both sides at once,
   * so neither alone has to be got right.
   */
  readonly listNames = computed<ReadonlyMap<string, string>>(
    () => this._basket()?.listNames ?? new Map()
  );

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
    const finished = lines.filter((line) => outstanding(line) === 0);

    // **`got` is not `finished`.** A `NOT_AVAILABLE` settle closes a line's
    // outstanding amount without buying anything, so counting every finished
    // line as one somebody got would report a shop that had none as a purchase
    // — the same claim the row's caption is careful not to make.
    //
    // A summary view could not tell these apart, because the distinction is per
    // line. This one can, so it does.
    const unavailable = finished.filter(
      (line) => line.lastOutcome === 'NOT_AVAILABLE'
    ).length;

    return {
      done: finished.length - unavailable,
      unavailable,
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
    this._present.set([]);
    // Started beside the read rather than after it. The connection costs a token
    // request of its own, so waiting for the basket would delay going live by a whole
    // round trip on the screen where being live is the point; and the socket needs
    // nothing the read produces, since the credential it presents is already held.
    this._socket.open(generatedListId);
    await this.refresh();
  }

  /**
   * Let the basket go, because the screen holding it has been left.
   *
   * Called from the page's own teardown rather than from a `DestroyRef` in here, and
   * that is the point of the method rather than an incidental detail. This store and
   * its socket are provided by the basket **route**, and Angular keeps a route's
   * environment injector on the route config, destroying it only under
   * `withExperimentalAutoCleanupInjectors()`, which this app does not turn on. So the
   * `DestroyRef` this class can reach never fires at all: without this call the
   * participant socket stays connected and its room stays joined for the rest of the
   * page's life, long after the shopper has gone somewhere else. A component is
   * destroyed for certain, so the component is what says when.
   *
   * The event subscription is deliberately **left alone**. The same instance is handed
   * back on the next visit, for the same reason, so unsubscribing here would leave the
   * second basket of a session with a live socket and nothing listening to it: the bug
   * this method exists to remove, wearing a different hat.
   */
  leave(): void {
    this._socket.close();
    this._cancelRefresh();
    this._id = null;
    this._basket.set(null);
    this._link.set(null);
    this._present.set([]);
    this._busyLines.set(new Set());
    this._state.set('loading');
    this._error.set(null);
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
   * Take a finished line back to fully outstanding (luna `0054`, section 3).
   *
   * The other direction of the row's status control, and it goes through the same
   * {@link _write} as {@link settle} so the row is busy while the request is out and
   * `aria-busy` is already handled.
   *
   * It answers the same shape for the same reason: an origin whose line has been
   * deleted since cannot have its units put back, so a reopen can report a skip
   * exactly as a settle can, and the caller has to be told something did not land.
   */
  async reopen(lineId: string): Promise<BasketSettleResult | null> {
    return this._write(lineId, async (id) => {
      const result = await this._service.reopen(id, lineId);
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
   * Re-read the basket shortly, once, however many events asked for it.
   *
   * Quiet: it never moves {@link state} to `loading`, so a shop full of people
   * settling lines does not replace a readable screen with a skeleton every second.
   * A failure leaves what is on screen alone, for {@link _fail}'s reason.
   */
  private _scheduleRefresh(): void {
    this._cancelRefresh();
    this._refreshAt = setTimeout(() => {
      this._refreshAt = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private _cancelRefresh(): void {
    if (this._refreshAt !== null) {
      clearTimeout(this._refreshAt);
      this._refreshAt = null;
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
