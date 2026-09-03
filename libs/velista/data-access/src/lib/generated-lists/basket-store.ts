import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  basketTakesLines,
  outstanding,
  type BasketAddLineRequest,
  type BasketBindResult,
  type BasketLine,
  type BasketLineOrigins,
  type BasketLineTarget,
  type BasketLoad,
  type BasketOriginQuantityRequest,
  type BasketOriginQuantityResult,
  type BasketParticipant,
  type BasketPresenceEntry,
  type BasketSettleRequest,
  type BasketSettleResult,
  type BasketShareLink,
  type BasketView,
  type CatalogSuggestion,
} from '@portfolio/velista/models';
import { GatewayError, hasResponse } from '../errors';
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
 * The names on a batch of origins, candidates or targets, keyed by list id.
 *
 * The **same** composition `toBasketView` gives the basket's own `listNames`, so a
 * household adopted onto a line reads exactly as one the run drew from: "Weekly shop
 * · Flat 3B", because a list alone is ambiguous when two households both keep one
 * called "Groceries". A row with no name at all is skipped rather than given an
 * empty string, which is what a list deleted since the run looks like, and the
 * caption falls back for it.
 */
function namesOf(
  rows: readonly {
    listId: string;
    listName: string | null;
    zoneName: string | null;
  }[]
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.listName === null || row.listName === '') {
      continue;
    }
    names.set(
      row.listId,
      row.zoneName ? `${row.listName} · ${row.zoneName}` : row.listName
    );
  }
  return names;
}

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
  private readonly _lastAdded = signal<BasketLine | null>(null);
  /** Whether an add is in flight, so the composer's button can wait on it. */
  private readonly _adding = signal(false);
  /** See {@link pendingTargets}. Session local, and cleared with the basket. */
  private readonly _pendingTargets = signal<ReadonlySet<string>>(new Set());
  /** See {@link rememberListNames}. Session local, and cleared with the basket. */
  private readonly _learnedNames = signal<ReadonlyMap<string, string>>(
    new Map()
  );

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

        case 'generatedList.lineAdded':
          if (event.generatedListId !== this._id) {
            return;
          }
          // Its own case and not a fold into the two above, which is the whole
          // reason the server gave it its own name: `apply` merges by id and does
          // nothing at all for a line the basket does not hold, so an append that
          // arrived as `lineUpdated` would be silently dropped.
          this.append(event.line);
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
   * Whether an add is in flight.
   *
   * The composer's field stays usable while this is true and only its button waits,
   * which is what the run property in `0038` actually needs: somebody remembering
   * three things in an aisle types the second while the first is on its way.
   */
  readonly adding = this._adding.asReadonly();

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
   * Whether this basket still takes lines, which is what draws the composer.
   *
   * False before anything has loaded, which is the safe direction and the same one
   * {@link seesZoneData} takes: a field drawn for a frame over a basket that turns
   * out to be finished is an invitation that cannot be honoured.
   */
  readonly takesLines = computed(() =>
    basketTakesLines(this._basket()?.status ?? '')
  );

  /**
   * Whether the trip is over, which is what takes every control off the screen
   * (velista `0057`, section 6).
   *
   * **The negation of {@link takesLines} and not a status of its own**, once a basket
   * has actually been read. There is one question here — may this basket still be
   * changed — and it is asked by the composer, by every row, by the settle sheet and
   * by the banner; two readings of it would eventually disagree, and the screen would
   * draw a control beside a banner saying it cannot be used.
   *
   * The null check is what stops it claiming a finished trip during the first read,
   * where `takesLines` is false because nothing has loaded rather than because
   * anything is finished. A status this build does not recognise reads as finished,
   * which is the same safe direction `takesLines` takes for the composer: the screen
   * offers nothing it cannot promise, and the banner is a sentence rather than a
   * refusal.
   */
  readonly finished = computed(
    () => this._basket() !== null && !this.takesLines()
  );

  /**
   * How many lines still have something outstanding (velista `0057`, section 5).
   *
   * What the finish sheet warns about, and the third line of its question. Derived
   * from the lines this store already holds rather than read from anywhere: a line
   * with nothing left to get is finished however it got that way, which is exactly
   * what {@link progress} counts, and the two must not be able to disagree about how
   * many are left.
   */
  readonly unsettled = computed(() => {
    const { done, unavailable, total } = this.progress();
    return total - done - unavailable;
  });

  /**
   * The most recent line to arrive, however it arrived, for the page's live region.
   *
   * One signal rather than a queue, and that is what makes the announcement right
   * when four people add at once: a polite region reads whatever the node last held,
   * so simultaneous adds collapse into one sentence instead of talking over each
   * other for the length of a shopping trip (plan 0053, section 8).
   */
  readonly lastAdded = this._lastAdded.asReadonly();

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
  readonly listNames = computed<ReadonlyMap<string, string>>(() => {
    const learned = this._learnedNames();
    const served = this._basket()?.listNames ?? new Map<string, string>();
    if (learned.size === 0) {
      return served;
    }
    // The learned names go in **first**, so the basket's own overwrite them on a
    // shared key. This map fills a gap in what the server names and never corrects
    // it; when the gateway names every origin's list the merge is a no-op and both
    // it and `rememberListNames` can go. See that method for the gap in full.
    return new Map([...learned, ...served]);
  });

  /**
   * Lines whose bound zone line is waiting for its list to approve it.
   *
   * **A stopgap for a backend gap, and session local.** `GeneratedListLineOriginView`
   * carries no approval state, so after a reload the row cannot say a bound line is
   * waiting (velista `0056`, section 5.1). What this holds is what *this* session's
   * own bind was told, which is exactly the case where somebody is standing there
   * waiting to be told something, and is honestly empty everywhere else rather than
   * guessing. When the view carries the state the row reads the line instead and this
   * goes.
   */
  readonly pendingTargets = this._pendingTargets.asReadonly();

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
    this._lastAdded.set(null);
    this._adding.set(false);
    // Both stopgaps are about **this** basket and this session, so they go with it.
    // Carrying either into the next basket would caption its rows with a household
    // from the last one, or say a line of it is waiting for approval.
    this._pendingTargets.set(new Set());
    this._learnedNames.set(new Map());
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
   * Put a line in the basket (velista `0053`; luna `0055`, section 3).
   *
   * **Drawn from the server's answer and never optimistically**, which is the
   * opposite of the choice on the list page, and the difference is the reader: four
   * people are working this basket at once, and a row that appeared locally and then
   * reordered when the server answered is a row somebody might tap in between. The
   * wait is not felt while typing, because {@link adding} leaves the field alive and
   * only the button waits.
   *
   * The socket carries the same line to everybody else through
   * `generatedList.lineAdded`, and {@link append} is what both paths go through, so
   * the person who typed it and the person standing next to them get the same row by
   * the same route.
   *
   * **Null on failure**, and the caller has something to do with it: the text is
   * still theirs to put back in the field. Losing six characters is nothing; losing
   * the item somebody just remembered in an aisle is the failure this screen cannot
   * afford (section 7).
   */
  async addLine(body: BasketAddLineRequest): Promise<BasketLine | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }

    this._adding.set(true);
    try {
      const line = await this._service.addLine(id, body);
      this.append(line);
      return line;
    } catch (error) {
      this._fail(id, error);
      // The composer is a write like any other, and the one that most needs the
      // screen to catch up: an add refused because the owner finished the trip
      // leaves a field drawn over a basket that takes no lines (velista `0057`).
      await this._rereadIfOvertaken(error);
      return null;
    } finally {
      this._adding.set(false);
    }
  }

  /**
   * What the composer offers under the field, in the server's order.
   *
   * On the store rather than reached for directly by the page, unlike the list
   * page's catalog search: this one is **scoped to the basket**, so the id is part
   * of the question, and the store is what already holds it. Nothing here debounces
   * or counts characters, which stay the page's, for rule D1's reason.
   *
   * Empty on failure, because the service is: a dropdown is an offer, and the one
   * thing this must never do is make adding a line fail because a search did.
   */
  async suggest(query: string): Promise<readonly CatalogSuggestion[]> {
    const id = this._id;
    return id === null ? [] : this._service.suggest(id, query);
  }

  /**
   * Put a line on the end of the basket, from wherever it came.
   *
   * **Idempotent by id**, which is not decoration: the add answers a line and the
   * basket's own room broadcasts the same one, so the person who typed it appends it
   * twice unless one of the two is a no-op. A refetch landing between the two does
   * the same thing from the other direction.
   *
   * A line already held is merged rather than ignored, on {@link apply}'s reasoning:
   * the broadcast is redacted to the least privileged reader in the room, so the copy
   * that arrives second may know less than the copy already on screen.
   */
  append(line: BasketLine): void {
    const held = this._basket();
    if (held === null) {
      // Nothing to append to. The read that is on its way carries this line, so
      // dropping it here costs nothing and inventing a basket around it would put a
      // one line screen in front of somebody for a moment.
      return;
    }

    if (held.lines.some((row) => row.id === line.id)) {
      this.apply(line);
      return;
    }

    this._basket.set({ ...held, lines: [...held.lines, line] });
    // Set only for a line that was genuinely new, so the announcement follows what
    // changed on screen rather than what arrived on the wire.
    this._lastAdded.set(line);
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

  /**
   * Say how many of a line are still to get (velista `0054`).
   *
   * Through {@link _write}, so the row is busy while the request is out, and it
   * answers the same {@link BasketSettleResult} a settle does because the downward
   * move genuinely is one: it can skip an origin whose access has gone, and the
   * caller has to be told something did not land.
   *
   * ## The one thing this does that no other write here does
   *
   * **A `stale_quantity` refetches before it returns.** That code means the number
   * this gesture was moving is not where the control believed it started, which is
   * two phones in one shop dragging one line, and the honest answer is not a
   * sentence saying so over a stale number: it is the number as it now stands, with
   * the sentence beside it. So the refresh is awaited **before** null goes back, and
   * the caller can read the true amount off the line the moment it has it.
   */
  async setOutstanding(
    lineId: string,
    outstanding: number,
    from: number
  ): Promise<BasketSettleResult | null> {
    return this._write(lineId, async (id) => {
      const result = await this._service.setOutstanding(id, lineId, {
        outstanding,
        from,
      });
      this.apply(result.line);
      return result;
    });
  }

  /**
   * Which lists are on a line, and which could be (velista `0055`).
   *
   * A **read**, so it does not go through {@link _write}: nothing about the basket
   * changes, and marking the row busy would grey a line somebody is still allowed to
   * settle while a sheet is opening over it.
   *
   * Null on failure, with the failure recorded the way every other one is, so the
   * sheet draws the sentence its own operation deserves.
   *
   * It also feeds {@link rememberListNames}, which is the stopgap for a backend gap:
   * the basket read names only the run's **source** lists, so a household adopted
   * onto a line here has an origin the row's "from" caption cannot name.
   */
  async loadLineOrigins(lineId: string): Promise<BasketLineOrigins | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }

    try {
      const answer = await this._service.getLineOrigins(id, lineId);
      this.rememberListNames(
        namesOf([...answer.origins, ...answer.candidates])
      );
      return answer;
    } catch (error) {
      this._fail(id, error);
      return null;
    }
  }

  /**
   * Set what one list contributes to a line (velista `0055`).
   *
   * Through {@link _write}, and it refetches on a `stale_quantity` for
   * {@link setOutstanding}'s reason: the sheet redraws the row at the contribution
   * as it now stands rather than arguing with a number that moved.
   *
   * The origin that comes back is remembered by name, because an **adopted** list is
   * exactly the one the basket read does not name.
   */
  async setOriginQuantity(
    lineId: string,
    body: BasketOriginQuantityRequest
  ): Promise<BasketOriginQuantityResult | null> {
    return this._write(lineId, async (id) => {
      const result = await this._service.setOriginQuantity(id, lineId, body);
      this.apply(result.line);
      if (result.origin !== null) {
        this.rememberListNames(namesOf([result.origin]));
      }
      return result;
    });
  }

  /**
   * The lists this line could be sent to (velista `0056`).
   *
   * A read, like {@link loadLineOrigins}, and every target is remembered by name for
   * the same reason: the list somebody sends a line to is very often not one the run
   * drew from, so the basket read cannot name it and the row would caption an origin
   * with nothing after it.
   */
  async loadLineTargets(
    lineId: string
  ): Promise<readonly BasketLineTarget[] | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }

    try {
      const targets = await this._service.getLineTargets(id, lineId);
      this.rememberListNames(namesOf(targets));
      return targets;
    } catch (error) {
      this._fail(id, error);
      return null;
    }
  }

  /**
   * Send a line to a shopping list (velista `0056`).
   *
   * Through {@link _write}, and the answer's line is folded in, which is what turns
   * the send control off: a bound line has a `targetListId` and cannot be sent twice.
   *
   * `pendingApproval` is recorded in {@link pendingTargets} rather than read off the
   * line afterwards, because no field of the line carries it. See that signal for
   * what that costs and when it can go.
   */
  async bindLine(
    lineId: string,
    listId: string
  ): Promise<BasketBindResult | null> {
    return this._write(lineId, async (id) => {
      const result = await this._service.bindLine(id, lineId, listId);
      this.apply(result.line);
      if (result.pendingApproval) {
        this._pendingTargets.update((held) => new Set(held).add(lineId));
      }
      return result;
    });
  }

  /**
   * Learn a list's name from somewhere other than the basket read.
   *
   * **A stopgap, and it is written down as one.** `sourceNames` on the basket is
   * built from the run's own snapshot, so it names the lists the run drew from and
   * nothing else. A line adopted onto a household the run missed (`0055`) or sent to
   * one (`0056`) therefore has an origin whose list the row cannot name, and the
   * "from" caption would draw a word and then stop.
   *
   * The names are merged **under** the basket's own, so a key both know keeps the
   * server's answer: this map is only ever filling a gap, never correcting one. When
   * the gateway names every origin's list the merge becomes a no-op and this method
   * and its signal can be deleted together, with nothing else changing shape.
   */
  rememberListNames(names: ReadonlyMap<string, string>): void {
    if (names.size === 0) {
      return;
    }
    this._learnedNames.update((held) => {
      const next = new Map(held);
      for (const [listId, name] of names) {
        next.set(listId, name);
      }
      return next;
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
   *
   * ## Two failures are refetched before the caller hears about them
   *
   * `stale_quantity` says the number this write was moving is not where the control
   * believed it started, which is two phones in one shop working one line. Every
   * screen that can raise it has the same answer: redraw at the number as it now
   * stands and say so beside it. So the refresh is awaited **here**, before null goes
   * back, and the caller can read the true amount off the line the moment it has it.
   * Doing it in each caller would be the same three lines in two sheets, and the one
   * that forgot would draw a sentence over a stale number.
   *
   * `generated_list_finished` is the same shape of answer about the whole basket
   * rather than one line (velista `0057`, section 7): the owner ended the trip while
   * this phone was in a shop, so the write that just refused is one of a screenful
   * that would all refuse the same way. Refetching turns the basket into the finished
   * one it now is, and the controls that refused go with it. A refusal that left them
   * sitting there would invite the same tap again.
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
      await this._rereadIfOvertaken(error);
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
   * Read the basket again when the failure means somebody else moved first.
   *
   * Two codes, and the same treatment for both: the write refused because the world
   * is not what the control was drawn from, so the honest answer is the world as it
   * now is rather than a sentence over a stale screen. See {@link _write} for each
   * of them in full.
   *
   * The error is put back **after** the refresh, because `refresh` clears it on the
   * way to `ready`: what the caller has to read is the true basket beside a failure
   * it can still name.
   */
  private async _rereadIfOvertaken(error: unknown): Promise<void> {
    if (
      error instanceof GatewayError &&
      (error.code === 'stale_quantity' ||
        error.code === 'generated_list_finished')
    ) {
      await this.refresh();
      this._error.set(error);
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
