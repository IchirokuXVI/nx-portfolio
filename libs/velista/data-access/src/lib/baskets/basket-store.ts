import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import {
  isOpenBasket,
  type Basket,
  type BasketAddLineRequest,
  type BasketAddress,
  type BasketDemandRequest,
  type BasketListRef,
  type BasketLoad,
  type BasketParticipant,
  type BasketPresenceEntry,
  type BasketProduct,
  type BasketProgress,
  type BasketRenameRequest,
  type BasketRenameResult,
  type BasketRevertRequest,
  type BasketRow,
  type BasketRowResult,
  type BasketSettleRequest,
  type BasketShareLink,
  type CatalogSuggestion,
} from '@portfolio/velista/models';
import { AppResumed } from '@portfolio/velista/platform';
import { GatewayError, hasResponse } from '../errors';
import { restrictRowToServedLists } from '../mapping/basket-mappers';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';
import { BasketSocket } from './basket-socket';

/**
 * How long a refetch waits, so a burst of events costs one request.
 *
 * Four people in a shop settling lines produce a stream of broadcasts, and the two
 * events that cannot be applied without asking (a participant moving, the basket
 * itself changing) would otherwise be one request each. `BasketListStore` coalesces
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
 * **Every event is a reason to read again, and none is a thing to merge.** That is
 * the change velista `0090` made, and it follows from the basket storing no rows:
 * a broadcast into a basket room is redacted to the least privileged reader in it,
 * so it carries line ids and no numbers (backend `0130`, section 6), and a row is a
 * group the server computes out of lines this client cannot see. There is nothing
 * a client holding ids can honestly do but ask.
 *
 * ## The three reasons to read again
 *
 * A **write's** answer is folded, and that is the only path that does not read: it
 * carries the row and the counts, so there is nothing to ask for.
 *
 * `basket.linesChanged`, `basket.updated` and a participant moving are **coalesced**,
 * because four people in a shop produce a stream of them and the answer to all of
 * them is the same one request.
 *
 * The socket coming **back** and the app coming back are read **at once**, because
 * each is a single edge after a gap in which anything may have happened, and a
 * second and a half of a stale basket after a phone wakes is the delay this exists
 * to remove. Both are counters rather than flags, for the reason written on
 * `AppResumed.resumes`: a reader that missed the edge cannot tell it happened.
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
  /**
   * The account socket, for the one basket event that cannot reach the basket's own
   * room: `basket.unshared` (velista `0085`, section 6). It is addressed to the
   * reader's user room, because once access has ended the basket room has already let
   * this socket go.
   */
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  /** The app coming back, which is one of the two edges that read again. */
  private readonly _resumed = inject(AppResumed);

  private readonly _basket = signal<Basket | null>(null);
  private readonly _state = signal<BasketLoad>('loading');
  private readonly _error = signal<unknown>(null);
  private readonly _link = signal<BasketShareLink | null>(null);
  private readonly _busyRows = signal<ReadonlySet<string>>(new Set());
  private readonly _present = signal<readonly BasketPresenceEntry[]>([]);
  /** See {@link rowGone}. A counter, so the same sentence can be said twice. */
  private readonly _rowGone = signal(0);
  /** See {@link adding}. */
  private readonly _adding = signal(false);
  /** See {@link chosen}. */
  private readonly _chosen = signal<ReadonlyMap<string, string>>(new Map());
  /** See {@link handedOver}. The counter is what lets one sentence be said twice. */
  private readonly _handedOver = signal<{
    readonly text: string;
    readonly seq: number;
  } | null>(null);
  private _handedOverSeq = 0;

  /** Which basket this store is about, once it has been told. */
  private _id: string | null = null;

  /** See {@link address}. A signal, because the sheets read it to build URLs. */
  private readonly _address = signal<BasketAddress | null>(null);

  /**
   * Whether the reader is leaving this basket on purpose (velista `0085`, section 7).
   *
   * Their own `unshared` arrives while the people sheet is navigating away, and the
   * revoked notice drawn under it for that moment would tell somebody who just pressed
   * Leave that they were thrown out.
   */
  private _leaving = false;

  /** The pending coalesced refresh, or null. See {@link _scheduleRefresh}. */
  private _refreshAt: ReturnType<typeof setTimeout> | null = null;

  /**
   * The counter values the resync effect last acted on.
   *
   * Compared rather than subscribed to, because both are counts of an **edge**
   * and an edge has to be noticed rather than sampled: a reader that read the
   * value alone could not tell "came back a moment ago" from "has been here all
   * along". They start at zero, which is what both counters start at, so the
   * effect's first run finds nothing moved.
   */
  private _actedOnReconnects = 0;
  private _actedOnResumes = 0;

  /**
   * How many times this store has changed the basket by any path other than a
   * read applying its answer, which is what tells {@link refresh} its answer is old.
   *
   * The failure it exists to prevent, in the order it happened. Somebody joins, the
   * burst of events that arrival makes is coalesced into one re-read a second and a
   * half later, and while that read is out the person holding the phone adds a line
   * in the aisle. The add answers first and its row is drawn. The read answers
   * second, from before the add, and it replaced the whole basket, so the row the
   * shopper had just watched appear vanished with nothing on screen to say why.
   *
   * A read that starts after the last local change cannot be old, so comparing this
   * number across the request is enough, and a read that finds it moved goes back
   * and asks again rather than applying what it has.
   */
  private _generation = 0;

  /** The read {@link refresh} has out, or null. See {@link _read}. */
  private _reading: Promise<void> | null = null;

  /** Whether somebody asked to refresh while {@link _reading} was already out. */
  private _queued = false;

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph. Every other
    // store in this library says the same thing.
    const subscription = this._socket.events.subscribe((event) => {
      switch (event.type) {
        case 'basket.linesChanged':
          // Ids and nothing else (backend `0130`, section 6), so there is nothing
          // to merge: a line id does not say which row holds it, and a row is a
          // group the server computes. Coalesced, because a shop full of people
          // settling rows is a stream of these and one read answers all of them.
          //
          // The event arrives only on a socket pinned to one basket, so it needs
          // no id check: unlike the events it replaced, it carries no basket id
          // to check against.
          this._scheduleRefresh();
          return;

        case 'basket.participantJoined':
        case 'basket.participantLeft':
          // The participant list is redacted per reader and carries a device for some
          // of them, so it is refetched rather than assembled from a broadcast that
          // was redacted to somebody else.
          this._scheduleRefresh();
          return;

        case 'basket.updated':
          // The name or the status moved. The payload is a summary and this store
          // holds the whole basket, so there is nothing here to merge.
          if (event.list.id === this._id) {
            this._scheduleRefresh();
          }
          return;

        case 'presence.basketUpdated':
          if (event.basketId === this._id) {
            this._present.set(event.present);
          }
          return;

        default:
          return;
      }
    });

    // Losing access to the basket on screen: removed, the link revoked with its
    // people, having left from another device, or the basket deleted. The screen
    // already has a treatment for exactly this, which a failed renewal reaches too,
    // so the event lands on the same state rather than on a second notice.
    const access = this._realtime.events.subscribe((event) => {
      if (
        event.type === 'basket.unshared' &&
        !this._leaving &&
        this._id !== null &&
        event.basketId === this._id
      ) {
        this._cancelRefresh();
        this._sessions.forget(this._id);
        this._state.set('revoked');
      }
    });

    // The two edges, in one effect, compared against what it last acted on
    // (velista `0090`, section 7.1).
    //
    // An `effect` and not `toObservable`: `@angular/core/rxjs-interop` is a
    // secondary entry point module federation does not dedupe, and a service
    // several remotes provide throws `NG0203` from it with a perfectly correct DI
    // graph. `effect` is core.
    //
    // The route injector is never destroyed by the router, so this outlives the
    // page. It does nothing while `_id` is null, which {@link leave} guarantees,
    // so a basket nobody is looking at is never read again.
    effect(() => {
      const reconnects = this._socket.reconnects();
      const resumes = this._resumed.resumes();
      untracked(() => {
        const moved =
          reconnects !== this._actedOnReconnects ||
          resumes !== this._actedOnResumes;
        this._actedOnReconnects = reconnects;
        this._actedOnResumes = resumes;
        // Both counters start at zero and this effect runs once on creation, so
        // the first run moves nothing and reads nothing.
        if (moved && this._id !== null) {
          void this.refresh();
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      access.unsubscribe();
      this._cancelRefresh();
    });
  }

  /** The basket, or null before the first read completes. */
  readonly basket = this._basket.asReadonly();

  /**
   * How the **URL** names the basket this store opened (velista `0091`).
   *
   * Every sheet over the basket page builds its own address and its dismissal
   * from this, and never from `paramMap`, which has no id at all under the
   * `shopping-lists/live` route. Set before either read goes out, so a sheet
   * constructed on a cold load already has it; null only before the first open
   * and after {@link leave}.
   *
   * It is about URLs and nothing else. Requests always name {@link Basket.id},
   * including under `live`, where the id arrives with the first answer.
   */
  readonly address = this._address.asReadonly();

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

  /**
   * Rows with a write in flight, by `rowKey`, so a row can show it without
   * blocking a tap.
   *
   * Keyed by the row's own key and never by a line id, which is what the sheet and
   * the reel both address a row by. A write on a row whose key changed underneath
   * it clears the old key, which is right: the busy state belongs to the request,
   * and the request named that key.
   */
  readonly busyRows = this._busyRows.asReadonly();

  /**
   * Whether an add is out (velista `0092`, section 7.4).
   *
   * Its own flag rather than a member of {@link busyRows}, because an add names
   * no row: it is a write about the basket, and which row it lands on is the
   * answer rather than the request. The composer's button waits on it and the
   * field does not, so somebody can keep typing the next thing.
   */
  readonly adding = this._adding.asReadonly();

  /**
   * Which product somebody said they got, per row (velista `0092`, section 5).
   *
   * **In memory for the visit, and never stored.** Backend `0136` deleted the
   * stored pick: a basket holds no lines, so there is nowhere to keep one, and
   * the only place a product belongs is on the purchase it was bought as. This is
   * what replaces it on the screen, and it is deliberately as short lived as the
   * page: a choice made in one aisle is not a fact about the household's list.
   *
   * Keyed on the row key, which can move under an open sheet. A choice lost to a
   * re-key is a choice somebody makes again, which is cheaper than a choice
   * quietly attached to a row it was not made on.
   */
  readonly chosen = this._chosen.asReadonly();

  /**
   * Say which product was got, for this row, for this visit.
   *
   * It writes nothing to the server, and that is the whole design: a product is
   * recorded when it is **bought**, as `itemId` on the settle, and never before
   * (velista `0092`, section 5).
   */
  choose(rowKey: string, itemId: string): void {
    const next = new Map(this._chosen());
    next.set(rowKey, itemId);
    this._chosen.set(next);
  }

  /**
   * The product id a `BOUGHT` settle on this row carries, or undefined.
   *
   * **The one place the rule lives**, because three controls send a settle: the
   * row's glyph, the row's reel and the sheet's three buttons. A rule copied
   * three times is three chances for one of them to record a purchase against no
   * product while the screen says otherwise.
   *
   * Two ways to have one. Somebody chose, and the choice is still one of the
   * row's own options, which a re-key or a refetch can end. Or the row has
   * exactly one option, which is not a choice at all: there was nothing to
   * choose between, and the row has been drawing that product all along.
   *
   * Undefined otherwise, which is a row of several options nobody has chosen
   * from, and a free text row. The settle then names no product, which is the
   * honest record: nobody said which.
   */
  itemIdFor(rowKey: string): string | undefined {
    const row = this.rowFor(rowKey);
    if (row === null) {
      return undefined;
    }

    const held = this._chosen().get(rowKey);
    if (held !== undefined && row.optionIds.includes(held)) {
      return held;
    }
    return row.optionIds.length === 1 ? row.optionIds[0] : undefined;
  }

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
   *
   * **One entry per participant.** The server keeps presence per socket, so somebody
   * with the basket open in two tabs arrives twice, and the face row counted tabs
   * while the people sheet counted people. The first entry for a participant wins.
   */
  readonly present = computed<readonly BasketPresenceEntry[]>(() => {
    if (!this._socket.connected()) {
      return [];
    }
    const seen = new Set<string>();
    return this._present().filter((entry) => {
      if (seen.has(entry.participantId)) {
        return false;
      }
      seen.add(entry.participantId);
      return true;
    });
  });

  /** The rows, in the order the server sent them, which is the order to walk. */
  readonly rows = computed<readonly BasketRow[]>(
    () => this._basket()?.rows ?? []
  );

  /**
   * The covered lists this reader was served, by list id.
   *
   * Empty for a reader served none, which is the same reader whose every entry
   * names no list: one collection answers "may this be grouped by list", "may this
   * entry be named" and "what is it called", so the three cannot disagree.
   */
  readonly lists = computed<ReadonlyMap<string, BasketListRef>>(
    () => new Map((this._basket()?.lists ?? []).map((ref) => [ref.listId, ref]))
  );

  /**
   * Every product the basket named, by id: every row's options.
   *
   * Here rather than composed again by each reader, which is what the page and
   * `BasketViewStore` were both doing: two identities for one map means a row is
   * redrawn whenever either of them is recomputed for an unrelated reason.
   */
  readonly products = computed<ReadonlyMap<string, BasketProduct>>(
    () => this._basket()?.products ?? new Map()
  );

  /** What this basket is (backend `0133`, section 2). Velista `0091` reads it. */
  readonly kind = computed(() => this._basket()?.kind ?? 'UNKNOWN');

  /**
   * Whether this basket still takes writes, which is what draws every control.
   *
   * False before anything has loaded, which is the safe direction: a control drawn
   * for a frame over a basket that turns out to be finished is an invitation that
   * cannot be honoured.
   */
  readonly isOpen = computed(() => isOpenBasket(this._basket()?.status ?? ''));

  /**
   * Whether the trip is over, which takes every control off the screen (velista
   * `0057`, section 6).
   *
   * **The negation of {@link isOpen} and not a status of its own**, once a basket has
   * actually been read. There is one question here — may this basket still be
   * changed — and it is asked by every row, by the settle sheet and by the banner;
   * two readings of it would eventually disagree, and the screen would draw a
   * control beside a banner saying it cannot be used.
   *
   * The null check is what stops it claiming a finished trip during the first read,
   * where `isOpen` is false because nothing has loaded rather than because anything
   * is finished. A status this build does not recognise reads as finished, which is
   * the same safe direction: the screen offers nothing it cannot promise.
   */
  readonly finished = computed(() => this._basket() !== null && !this.isOpen());

  /**
   * How many rows still have something to do, **by the server** (backend `0130`,
   * section 4).
   *
   * What the finish sheet warns about and what `allSettled` reads. It used to be
   * `total - done - unavailable` computed here, which is the same arithmetic the
   * server now does and sends: a `SKIPPED` row is pending, and this side has no
   * way to know that. Nothing in this scope subtracts one count from another
   * (velista `0060`, section 4).
   */
  readonly pending = computed(() => this._basket()?.pending ?? 0);

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
   * **The server's, never recounted** (backend `0130`, section 4). Rows and not
   * units, which is how `0047` counts a zone list: "four things done out of
   * twelve" is what somebody in a shop is tracking, and a basket of one row asking
   * for twelve tins would otherwise read as almost finished.
   *
   * Zeroed before the first read, which draws as a basket with nothing in it for
   * the moment there is nothing in it.
   */
  readonly progress = computed<BasketProgress>(
    () => this._basket()?.progress ?? { done: 0, unavailable: 0, total: 0 }
  );

  /**
   * How many times a sheet has closed because its row left the basket.
   *
   * A **counter** and not a flag, for `AppResumed.resumes`' reason: the page says
   * one sentence when it moves, and a boolean could not say it twice in a row for
   * two different rows. The page reads it, announces `basket.row.gone` once, and
   * nothing clears it.
   *
   * Here rather than on the sheet, because the sheet is gone by the time the
   * sentence is read: it dismisses itself and the page is what is left to say what
   * happened (velista `0069` section 3.1, `0084` section 5).
   */
  readonly rowGone = this._rowGone.asReadonly();

  /** Say that a sheet's row left the basket. See {@link rowGone}. */
  sayRowGone(): void {
    this._rowGone.update((count) => count + 1);
  }

  /**
   * A sentence a sheet composed for the **page** to say, after the sheet has
   * gone (velista `0092`, section 6.2).
   *
   * Here for {@link rowGone}'s reason and no other: a demand taken to zero takes
   * the row out of the basket, the sheet over it dismisses itself, and the page
   * is what is left with a live region to say it in. One region per screen is
   * the rule this keeps (velista `0054`, section 7); a second one on a sheet
   * that is closing would talk over it and then leave.
   *
   * **A rendered sentence and not a key.** The sheet holds the translator and
   * the name of the row it was about, so it is what can compose the sentence;
   * a store that held copy keys would be a store that has to be translated.
   *
   * The sequence number is what lets the same sentence be said twice in a row,
   * which is {@link rowGone}'s counter in another shape: two rows emptied one
   * after the other are two announcements, not one.
   */
  readonly handedOver = this._handedOver.asReadonly();

  /** Hand one sentence to the page. See {@link handedOver}. */
  handOver(text: string): void {
    this._handedOver.set({ text, seq: (this._handedOverSeq += 1) });
  }

  /**
   * The row a key addresses: by its own key, then by any entry's line id.
   *
   * **The second lookup is the whole of velista `0090` section 7.3.** A row's key
   * is its anchor's line id, and an anchor can change under an open sheet:
   * somebody adds an earlier line of the same name on another list, a rename
   * merges two, the anchor is deleted. The row is the same thing under a new key,
   * and a sheet that could not find it would dismiss itself over nothing.
   *
   * Null is the third answer and a real one: the row left the basket, and the
   * sheet says so once and closes.
   */
  rowFor(key: string): BasketRow | null {
    const rows = this.rows();
    return (
      rows.find((row) => row.rowKey === key) ??
      rows.find((row) => row.entries.some((entry) => entry.lineId === key)) ??
      null
    );
  }

  /**
   * Load a basket, deciding first whether this browser may even ask.
   *
   * No stored credential and no account token means the reader is a stranger on a
   * link, which is `needsJoin` rather than a failure: the join screen is the
   * answer, not an error.
   */
  async open(basketId: string): Promise<void> {
    this._id = basketId;
    this._address.set({ basketId });
    this._state.set('loading');
    this._error.set(null);
    this._present.set([]);
    // Started beside the read rather than after it. The connection costs a token
    // request of its own, so waiting for the basket would delay going live by a whole
    // round trip on the screen where being live is the point; and the socket needs
    // nothing the read produces, since the credential it presents is already held.
    this._socket.open(basketId);
    await this.refresh();
  }

  /**
   * Load the caller's own permanent basket (velista `0091`, section 2.4).
   *
   * **The id comes from the answer**, because the caller has none: the route is
   * a word, the server creates the basket the first time it is read, and every
   * request after this one addresses it by the id it handed back. So the socket
   * is opened after the read rather than beside it, which is the one way this
   * differs from {@link open} and is forced: there is nothing to connect to
   * until the answer arrives, and a read that failed must leave no connection
   * behind.
   *
   * {@link address} is set **before** the request goes out. A sheet over this
   * page builds its own URL from it, and on a cold load on a sheet's address the
   * sheet is constructed while this read is still out.
   *
   * There is no guard doing this instead, and that is deliberate: a guard that
   * waits on a request is a white screen with nothing to retry. A failure lands
   * on the page's own failed state, whose Try again calls {@link refresh}.
   */
  async openLive(): Promise<void> {
    this._id = null;
    this._address.set('live');
    this._state.set('loading');
    this._error.set(null);
    this._present.set([]);
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
    // Cleared beside the id, and a read still out reads both: under `live` the
    // address is the only thing that says whose read it was.
    this._address.set(null);
    this._leaving = false;
    this._basket.set(null);
    // A read that is still out was asked for the basket being let go, so it is
    // disowned here: the next `open` starts one of its own rather than waiting on
    // an answer nothing will apply, and the bump makes that answer stale even in
    // the one case the id check cannot see, which is the same basket opened again.
    this._reading = null;
    this._queued = false;
    this._changed();
    this._link.set(null);
    this._present.set([]);
    this._busyRows.set(new Set());
    this._adding.set(false);
    // The choices are about **this** basket's rows, and they were never stored:
    // they go with it rather than following the next one into a shop.
    this._chosen.set(new Map());
    // The sentence is about a row of **this** basket, so it goes with it.
    this._rowGone.set(0);
    this._handedOver.set(null);
    this._state.set('loading');
    this._error.set(null);
  }

  /**
   * Re-read the basket.
   *
   * Called after this store's own writes, and by the page when the app comes back
   * from the background (`0035`), which is the moment a shopper's screen is most
   * likely to be behind somebody else's.
   *
   * **Two calls at once collapse into one read, with at most one queued behind it.**
   * A caller that arrives while a read is out is not served by that read, because it
   * left before they asked: several writes await this method precisely so the answer
   * reflects what they just did (velista `0057`, section 6). So they join the read
   * already running and it goes round once more for them.
   *
   * The promise resolves when an answer that was not out of date has been applied, or
   * when the read failed. See {@link _generation} for what out of date means here.
   */
  async refresh(): Promise<void> {
    const id = this._id;
    // Null with a `live` address is the one read that has no id yet: the caller's
    // own basket, before the answer that names it. Null with no address at all is
    // a store nobody has opened, or one that has been let go.
    if (id === null && this._address() !== 'live') {
      return;
    }

    const reading = this._reading;
    if (reading !== null) {
      this._queued = true;
      await reading;
      return;
    }

    // Recorded here and cleared in the chained `finally`, which settles this
    // promise only after it has run. So nobody can resume from an await to find a
    // read still recorded that has in fact finished, and queue behind it forever.
    // The identity check is what lets {@link leave} disown a read: a newer one is
    // already recorded by the time an abandoned one gets here.
    const started = this._read(id).finally(() => {
      if (this._reading === started) {
        this._reading = null;
      }
    });
    this._reading = started;
    await started;
  }

  /**
   * Ask for the basket until an answer is worth applying, then apply it.
   *
   * The loop ends when the writes stop, because a read that starts after the last
   * local change cannot be out of date. There is deliberately **no cap** that gives
   * up and applies an old answer anyway: applying one is the defect this exists to
   * remove, and a screen a moment behind is better than a row that disappears.
   *
   * A failure ends it, keeping {@link _fail}'s treatment, and so does the screen
   * letting this basket go while the read was out.
   */
  private async _read(id: string | null): Promise<void> {
    for (;;) {
      const generation = this._generation;
      this._queued = false;

      let basket: Basket;
      try {
        // A null id is the caller's own basket, which this read is what names:
        // it is the first read of a `live` page and no later one, because the
        // id is recorded below and every refresh after it goes out by id.
        basket =
          id === null
            ? await this._service.getLiveBasket()
            : await this._service.getBasket(id);
      } catch (error) {
        this._fail(id, error);
        return;
      }

      if (!this._stillReading(id)) {
        // `leave` happened while this was out, so there is no screen to draw on
        // and the next visit reads for itself.
        return;
      }

      if (this._generation !== generation) {
        continue;
      }

      if (this._id === null) {
        // The answer to the only read that had no id. The socket waits for it,
        // unlike `open`'s, because there was nothing to connect to until now.
        this._id = basket.id;
        this._socket.open(basket.id);
      }

      this._basket.set(basket);
      this._state.set('ready');
      this._error.set(null);

      if (!this._queued) {
        return;
      }
    }
  }

  /**
   * Whether the screen this read was started for is still the one on the phone.
   *
   * By id for an ordinary read, and by the **address** for the first read of a
   * `live` page, which has no id to compare: {@link leave} clears both, so a
   * basket let go while a read was out answers no either way.
   */
  private _stillReading(id: string | null): boolean {
    return id === null ? this._address() === 'live' : this._id === id;
  }

  /**
   * Note that the basket changed by a path other than a read applying its answer.
   *
   * Called from the shared paths rather than from each call site, which is what
   * makes it hard to forget: every fold of a write's answer and every socket event
   * goes through {@link append}, {@link apply} or {@link drop}. See
   * {@link _generation}.
   */
  private _changed(): void {
    this._generation += 1;
  }

  /**
   * Say what happened to a row at the shelf.
   *
   * The answer is folded immediately, so the row is right before anything else
   * lands. It is answered to the caller rather than swallowed, because a sheet has
   * to know what happened: `skippedCount` is the honest report of entries a write
   * could not reach, and a rename's answer says whether the caller's own row
   * survived.
   */
  async settle(
    rowKey: string,
    body: BasketSettleRequest
  ): Promise<BasketRowResult | null> {
    return this._write(rowKey, async (id) => {
      const result = await this._service.settle(id, rowKey, body);
      this._fold(result, rowKey);
      return result;
    });
  }

  /**
   * Take units, or a close, back off a row (backend `0136`, section 5.2).
   *
   * One method for both, because they are one gesture aimed at two things, and the
   * request says which. It replaced `reopen`, which took a whole line back and had
   * no way to take back less.
   */
  async revert(
    rowKey: string,
    body: BasketRevertRequest
  ): Promise<BasketRowResult | null> {
    return this._write(rowKey, async (id) => {
      const result = await this._service.revert(id, rowKey, body);
      this._fold(result, rowKey);
      return result;
    });
  }

  /**
   * Move a row's reel, which is a settle or a revert depending on the direction.
   *
   * **The row reel's one call**, so the control has one thing to call and cannot
   * get the direction wrong. Below `from` the difference was bought; above it, the
   * difference comes back. Equal is nothing, which is what a reel dropped where it
   * was picked up means, and it costs no request.
   *
   * `next` is an **absolute** number and `from` is where it started, which is
   * velista `0054`'s bargain unchanged: a gesture whose meaning depends on where it
   * started must be refused rather than reinterpreted when the number moved
   * underneath it.
   *
   * The ceiling the reel offers is `row.asked`, which is read and never computed.
   */
  async setLeft(
    rowKey: string,
    next: number,
    from: number
  ): Promise<BasketRowResult | null> {
    if (next === from) {
      return null;
    }

    return next < from
      ? this.settle(rowKey, {
          outcome: 'BOUGHT',
          quantity: from - next,
          from,
        })
      : this.revert(rowKey, {
          target: 'UNITS',
          units: next - from,
          // A revert names the row's `bought` and not its `left`, because that is
          // the number it is taking from (backend `0136`, section 5.2). The caller
          // holds the row, so it is read here rather than passed in and possibly
          // read from a different frame than `from` was.
          from: this.rowFor(rowKey)?.bought ?? 0,
        });
  }

  /**
   * Rename a row, and every list line inside it (velista `0084`, backend `0113`).
   *
   * **From the answer and never optimistically**: a rename can merge, and a row
   * renamed in place that the server then folds into another would draw two rows of
   * one name for a moment.
   *
   * Null on failure, and the store's {@link error} holds the refusal: a
   * `line_merge_required` there is the question the sheet asks next.
   */
  async renameRow(
    rowKey: string,
    body: BasketRenameRequest
  ): Promise<BasketRenameResult | null> {
    return this._write(rowKey, async (id) => {
      const result = await this._service.renameRow(id, rowKey, body);
      this._fold(result, rowKey);
      return result;
    });
  }

  /**
   * Put a row off for now, and take that back (velista `0092`, section 3).
   *
   * Two methods and not one toggle, for the reason the screen draws two buttons:
   * a toggle is a control whose meaning depends on a state somebody has to read
   * first, and this one is pressed in an aisle at arm's length.
   *
   * **Neither patches a state.** The answer is folded whole, exactly as a
   * settle's is, so whether the row came back `SKIPPED` or `WANTED` with a note
   * is the server's answer rather than this side's arithmetic.
   */
  async skip(rowKey: string): Promise<BasketRowResult | null> {
    return this._write(rowKey, async (id) => {
      const result = await this._service.skip(id, rowKey);
      this._fold(result, rowKey);
      return result;
    });
  }

  /** The same fact, unset. See {@link skip}. */
  async unskip(rowKey: string): Promise<BasketRowResult | null> {
    return this._write(rowKey, async (id) => {
      const result = await this._service.unskip(id, rowKey);
      this._fold(result, rowKey);
      return result;
    });
  }

  /**
   * Change what one list asks for (velista `0092`, section 6).
   *
   * The one write here that changes a household's list rather than recording
   * what a trip did, and the answer is folded like any other: the row comes back
   * with new numbers, or `null` when nothing is left to buy of it and nothing
   * was bought this trip, in which case {@link _fold} drops it.
   *
   * The caller reads `result.row === null` to know which happened. It is not a
   * failure: the list now asks for nothing, which is what was asked for.
   */
  async setDemand(
    rowKey: string,
    body: BasketDemandRequest
  ): Promise<BasketRowResult | null> {
    return this._write(rowKey, async (id) => {
      const result = await this._service.setDemand(id, rowKey, body);
      this._fold(result, rowKey);
      return result;
    });
  }

  /**
   * Add a line onto one of the covered lists (velista `0092`, section 7).
   *
   * **Not optimistic**, which is the opposite of the list page and is velista
   * `0053` section 7 unchanged: four people work this screen at once, and a row
   * that appeared locally and then moved when the server answered is a row
   * somebody might tap in between.
   *
   * It is folded rather than appended, because the add goes through the target
   * list's ordinary rules and can land on a line the list already held (backend
   * `0091`). So the answer is a row that may already be on the screen, under a
   * key nobody named, and {@link _fold} puts it where it belongs. The key it is
   * folded against is the answer's own: there is no earlier row for this write
   * to replace.
   */
  async addLine(body: BasketAddLineRequest): Promise<BasketRowResult | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }

    this._adding.set(true);
    try {
      const result = await this._service.addLine(id, body);
      // Folded against the answer's **own** key, because there is no earlier row
      // this write replaces: an add either makes a row or raises one that was
      // already there, and either way the answer names it.
      this._fold(result, result.row?.rowKey ?? '');
      return result;
    } catch (error) {
      this._fail(id, error);
      await this._rereadIfOvertaken(error);
      return null;
    } finally {
      this._adding.set(false);
    }
  }

  /**
   * What a search offers, in the server's order.
   *
   * On the store rather than reached for directly by the page, unlike the list
   * page's catalog search: this one is **scoped to the basket**, so the id is part
   * of the question, and the store is what already holds it. Nothing here debounces
   * or counts characters, which stay the page's, for rule D1's reason.
   *
   * Empty on failure, because the service is: a dropdown is an offer, and the one
   * thing this must never do is make a search's failure fail something else.
   */
  async suggest(query: string): Promise<readonly CatalogSuggestion[]> {
    const id = this._id;
    return id === null ? [] : this._service.suggest(id, query);
  }

  /**
   * Fold one write's answer into the basket. **The single place a write lands.**
   *
   * It replaces the row by key and takes the counts whole. It **never patches a
   * number**: every number on this screen is one the server sent, so there is
   * nothing here to add up and nothing to get wrong.
   *
   * Three things it has to get right, and they are three:
   *
   * - **The answered row may carry a new key.** A rename that merged, or an anchor
   *   that was bought to zero, moves it. So the row named by `rowKey` is dropped
   *   and the answered row is put back in its place, which keeps the position the
   *   shopper is looking at.
   * - **`replacedRowKey` names a second row that went away**, which is the row a
   *   rename folded this one into, or out of. It is dropped too.
   * - **The row's list ids are gated here**, because the answer carries no refs to
   *   gate them against. It is the same function `toBasket` uses, so a row that
   *   arrived through a write and a row that arrived through a read cannot
   *   disagree about which lists this reader may name.
   */
  private _fold(result: BasketRowResult, rowKey: string): void {
    const held = this._basket();
    if (held === null) {
      return;
    }

    if (result.row === null) {
      // **The write took the row out of the basket**, which only a demand
      // lowered to zero can do (velista `0092`, section 6.2). It is dropped by
      // the key the request used, and by `replacedRowKey` where the server
      // named a second one, exactly as a surviving row's old keys are dropped
      // below. The counts still come from the answer: the row going away is
      // what changed them.
      const dropped = new Set(
        [rowKey, result.replacedRowKey].filter(
          (key): key is string => key !== null
        )
      );
      this._basket.set({
        ...held,
        rows: held.rows.filter((current) => !dropped.has(current.rowKey)),
        progress: result.progress,
        pending: result.pending,
      });
      this._changed();
      return;
    }

    const served = new Set(held.lists.map((ref) => ref.listId));
    const row = restrictRowToServedLists(result.row, served);
    const gone = new Set(
      [rowKey, result.replacedRowKey].filter(
        (key): key is string => key !== null
      )
    );
    gone.delete(row.rowKey);

    let placed = false;
    const rows: BasketRow[] = [];
    for (const current of held.rows) {
      if (current.rowKey === row.rowKey) {
        rows.push(row);
        placed = true;
        continue;
      }
      if (gone.has(current.rowKey)) {
        // The row the request named, under the key it had. The answered row takes
        // its place, so the position the shopper is looking at is kept.
        if (!placed) {
          rows.push(row);
          placed = true;
        }
        continue;
      }
      rows.push(current);
    }

    if (!placed) {
      // A row this basket did not hold, which a re-key can produce: the read that
      // would have carried it is still out. The end is the only honest place for
      // it, and the read that follows puts it where the server says.
      rows.push(row);
    }

    this._basket.set({
      ...held,
      rows,
      progress: result.progress,
      pending: result.pending,
    });
    this._changed();
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

  /**
   * Add one of the owner's contacts (velista `0085`, section 4).
   *
   * **False rather than a throw**, because the caller is a checkbox that has to be put
   * back by hand when the write does not land, not a sheet that stays open on an
   * error. The participant list is read again on success, so the ticks and the joined
   * count follow the answer rather than a guess.
   */
  async addParticipant(userId: string): Promise<boolean> {
    const id = this._id;
    if (id === null) {
      return false;
    }
    try {
      await this._service.addParticipant(id, userId);
    } catch {
      return false;
    }
    await this.refresh();
    return true;
  }

  /**
   * Leave this basket, as a registered participant who does not own it (velista
   * `0085`, section 7).
   *
   * The stored session goes with it, so nothing on this device still presents a
   * credential for a basket the reader walked away from. False on failure, for the
   * people sheet to stay where it is.
   */
  async leaveBasket(): Promise<boolean> {
    const id = this._id;
    if (id === null) {
      return false;
    }
    this._leaving = true;
    try {
      await this._service.leaveBasket(id);
    } catch {
      this._leaving = false;
      return false;
    }
    this._sessions.forget(id);
    return true;
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Run one row write, marking the row busy and reporting a revocation.
   *
   * Returns null rather than throwing when the write fails: the caller is a sheet
   * that has to close or stay open, and every failure this can suffer is already
   * reflected in {@link state} or is a transient the next refresh resolves.
   *
   * ## Two failures are refetched before the caller hears about them
   *
   * `stale_quantity` says the number this write was moving is not where the control
   * believed it started, which is two phones in one shop working one row. Every
   * screen that can raise it has the same answer: redraw at the number as it now
   * stands and say so beside it. So the refresh is awaited **here**, before null goes
   * back, and the caller can read the true amount off the row the moment it has it.
   * Doing it in each caller would be the same three lines in two sheets, and the one
   * that forgot would draw a sentence over a stale number.
   *
   * `basket_finished` is the same shape of answer about the whole basket
   * rather than one row (velista `0057`, section 7): the owner ended the trip while
   * this phone was in a shop, so the write that just refused is one of a screenful
   * that would all refuse the same way. Refetching turns the basket into the finished
   * one it now is, and the controls that refused go with it. A refusal that left them
   * sitting there would invite the same tap again.
   */
  private async _write<T>(
    rowKey: string,
    send: (id: string) => Promise<T>
  ): Promise<T | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }

    this._busyRows.update((busy) => new Set(busy).add(rowKey));
    try {
      return await send(id);
    } catch (error) {
      this._fail(id, error);
      await this._rereadIfOvertaken(error);
      return null;
    } finally {
      this._busyRows.update((busy) => {
        const next = new Set(busy);
        next.delete(rowKey);
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
      (error.code === 'stale_quantity' || error.code === 'basket_finished')
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
  private _fail(basketId: string | null, error: unknown): void {
    this._error.set(error);

    // A null id is the read of the caller's **own** basket, which is account
    // authenticated and holds no participant session: a 401 there is a session
    // that has ended, which the interceptor already answers for the whole app,
    // and neither of the two readings below is about this reader.
    if (
      basketId !== null &&
      hasResponse(error) &&
      (error as { status: number }).status === 401
    ) {
      // The two readings of one status, told apart by what this browser was
      // holding. A credential that has stopped working was **revoked**, and the
      // person should be told so. No credential at all is a stranger who has
      // followed a link and simply has not joined yet, which is not a failure
      // and must not be reported as one.
      const held = this._sessions.read(basketId);
      this._sessions.forget(basketId);
      this._state.set(held === null ? 'needsJoin' : 'revoked');
      return;
    }

    // Anything else is a network or a server problem, and the basket that is
    // already on screen stays on screen: a shopper in an aisle is better served
    // by a list that is a minute old than by an error page.
    this._state.set(this._basket() === null ? 'failed' : 'ready');
  }
}
