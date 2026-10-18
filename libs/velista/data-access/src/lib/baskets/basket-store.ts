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
  applyBasketMarks,
  applyBasketPatch,
  BASKET_ACCESS_ENDED_FALLBACK,
  BASKET_PATCH_READ,
  basketEntryPatchOf,
  basketProgressOf,
  foldBasketEntries,
  isOpenBasket,
  regroupBasketEntries,
  withHeldChoices,
  type Basket,
  type BasketAccessEnded,
  type BasketAddLineRequest,
  type BasketAddress,
  type BasketDemandRequest,
  type BasketEntryPatch,
  type BasketListRef,
  type BasketLoad,
  type BasketParticipant,
  type BasketPresenceEntry,
  type BasketProduct,
  type BasketProductChangeRequest,
  type BasketProductList,
  type BasketProgress,
  type BasketRenameRequest,
  type BasketRevertRequest,
  type BasketRow,
  type BasketRowResult,
  type BasketRowTarget,
  type BasketSettleRequest,
  type BasketShareLink,
  type CatalogSuggestion,
} from '@portfolio/velista/models';
import { AppResumed } from '@portfolio/velista/platform';
import { SessionStore } from '../auth/session-store';
import { endedReasonOf, GatewayError, hasResponse } from '../errors';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import { BASKET_SERVICE, type BasketServiceI } from './basket-service';
import { BasketSessionStore } from './basket-session-store';
import { BasketSocket } from './basket-socket';
import { CoalescedRead } from './coalesced-read';
import {
  HeldProductChoices,
  type HeldProductChoice,
} from './held-product-choices';

/**
 * How long the reads that events ask for gather after a read (velista `0143`,
 * section 5). The first ask after this much quiet reads at once.
 */
const EVENT_READ_QUIET_MS = 1500;

/** The most a read that an event asked for waits, however many follow. */
const EVENT_READ_CEILING_MS = 3000;

/** How long a marks read waits, so the marks of a burst cost one request. */
const MARKS_WAIT_MS = 300;

/**
 * The full read, or the rows read of backend `0205`, which leaves out the
 * products, the scopes and the shop.
 */
type BasketReadKind = 'full' | 'rows';

/** The lines of one event or write answer, kept while a read is out. */
interface HeldPatch {
  readonly lineIds: readonly string[];
  readonly entries: readonly BasketEntryPatch[];
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
 * **An event that carries the state of its lines is applied, with no request**
 * (velista `0143`, which reverses the rule of velista `0090` that every event is a
 * reason to read again). Since backend `0204` an envelope addressed to one basket
 * carries each line as that basket reads it, with nothing a guest does not already
 * read. `applyBasketPatch` puts the lines into the rows held and rebuilds each row
 * it touched with `@portfolio/luna-shopper/basket-rules`, the rules core calls, and
 * counts the header with them. The held choices of velista `0140` are applied over
 * the result in {@link rows}, in the order a read uses.
 *
 * Only this socket's events are applied. It joined one basket's room and no other,
 * while the owner's account room hears the envelopes of every basket they own with
 * no basket named (backend `0204`, "What the build decided", point 7).
 *
 * ## When it still reads
 *
 * A **write's** answer is applied with the same function as an event, and no read
 * follows it (velista `0143`, section 6). A rename, an add and a change of product
 * can move a line between rows, so their answer is folded as before and read after.
 *
 * An event with no entries, an event the patch cannot apply, `basket.updated` and a
 * participant moving read the **rows** (backend `0205`): the first after a quiet
 * time at once, the rest gathered, never more than 3000 ms late. See
 * {@link CoalescedRead}.
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
  /**
   * Whether the reader is signed in, which splits a refusal with no credential
   * behind it in two (velista `0154`). Optional because the sheet specs build this
   * store with no account at all, and absent reads as signed out.
   */
  private readonly _account = inject(SessionStore, { optional: true });
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

  /** The products chosen for this trip on this device (velista `0140`). */
  private readonly _choices = inject(HeldProductChoices);

  private readonly _basket = signal<Basket | null>(null);
  private readonly _state = signal<BasketLoad>('loading');
  private readonly _error = signal<unknown>(null);
  private readonly _link = signal<BasketShareLink | null>(null);
  /** See {@link accessEnded}. */
  private readonly _accessEnded = signal<BasketAccessEnded | null>(null);
  private readonly _busyRows = signal<ReadonlySet<string>>(new Set());
  private readonly _present = signal<readonly BasketPresenceEntry[]>([]);
  /** See {@link rowGone}. A counter, so the same sentence can be said twice. */
  private readonly _rowGone = signal(0);
  /** See {@link adding}. */
  private readonly _adding = signal(false);
  /** See {@link chosen}. */
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

  /** See {@link readAt}. */
  private readonly _readAt = signal<string | null>(null);

  /**
   * Whether the reader is leaving this basket on purpose (velista `0085`, section 7).
   *
   * Their own `unshared` arrives while the people sheet is navigating away, and the
   * revoked notice drawn under it for that moment would tell somebody who just pressed
   * Leave that they were thrown out.
   */
  private _leaving = false;

  /** The reads events ask for (velista `0143`, section 5). */
  private readonly _eventReads = new CoalescedRead(
    () => this._eventRead(),
    EVENT_READ_QUIET_MS,
    EVENT_READ_CEILING_MS
  );

  /**
   * The patches applied while a read is out, oldest first, or null when no read
   * is out. The answer of that read can be older than they are, so they are
   * applied to it again when it lands, by the version rule (velista `0143`,
   * section 5).
   */
  private _heldPatches: HeldPatch[] | null = null;

  /** How many reads have applied their answer. A marks read checks it. */
  private _landed = 0;

  /** The marks read waiting to go out, or null. See {@link _askMarks}. */
  private _marksAt: ReturnType<typeof setTimeout> | null = null;
  /** Whether a marks read is out. */
  private _marksOut = false;
  /** Whether marks moved again while a marks read was out. */
  private _marksAgain = false;

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

  /**
   * What somebody asked for while {@link _reading} was already out: nothing, the
   * rows, or the full read. A full read answers an ask for the rows too.
   */
  private _queued: 'none' | BasketReadKind = 'none';

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph. Every other
    // store in this library says the same thing.
    const subscription = this._socket.events.subscribe((event) => {
      switch (event.type) {
        case 'basket.linesChanged':
          // The event arrives only on a socket pinned to one basket, so it needs
          // no id check, and its entries are this basket's (velista `0143`).
          this._linesChanged(event.lineIds, event.entries, event.marksMoved);
          return;

        case 'basket.participantJoined':
        case 'basket.participantLeft':
          // The participant list is redacted per reader and carries a device for some
          // of them, so it is read again rather than assembled from a broadcast that
          // was redacted to somebody else.
          this._eventReads.ask();
          return;

        case 'basket.updated':
          // The name or the status moved. The payload is the header and this store
          // holds the whole basket, so it reads the basket rather than merging.
          if (event.basketId === this._id) {
            this._eventReads.ask();
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
        this._cancelReads();
        // A marker in the credential's place, so a reload says the same thing.
        this._sessions.end(this._id, BASKET_ACCESS_ENDED_FALLBACK);
        // The event says the reader is off the basket and never why: its
        // payload is the basket id alone (backend `0140`, section 7 emits it
        // from the same `announceEnded` a removal does). So the reason is
        // `UNKNOWN`, which draws the sentence a removal draws. Guessing
        // `EXPIRED` from a clock here is the one thing section 5 forbids.
        this._accessEnded.set(BASKET_ACCESS_ENDED_FALLBACK);
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
      this._cancelReads();
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
   * Why this reader stopped being on the basket, or null while they still are
   * (velista `0094`, section 2).
   *
   * Beside {@link state} being `revoked` rather than inside it, because the
   * state answers "what does this screen draw" and this answers "which sentence
   * does it draw there". The two ended states are the same screen: what is on
   * it stays readable and there is nothing to retry.
   *
   * The reason is whatever the refusal said. A 401 carries an error code, and
   * `participant_expired` is the one that means a visit ran out; the eviction
   * event carries no reason at all, so a socket that was swept lands on
   * `UNKNOWN`, which draws the ordinary sentence. Under reporting the cause
   * costs a reader the more precise of two true sentences. Over reporting it
   * tells somebody who was removed that they can come back in twelve hours.
   *
   * The socket's own refusal is read here rather than copied into the signal,
   * for the reason {@link revoked} exists beside `state`: the token refresh
   * learns this first, ahead of the reader's next tap, and a screen drawing the
   * sentence from one source and the state from another would say "removed"
   * over a basket the socket already knows expired. The request's answer wins
   * where there is one, because it carried a code about the act somebody just
   * performed.
   */
  readonly accessEnded = computed<BasketAccessEnded | null>(
    () => this._accessEnded() ?? this._socket.revokedReason()
  );

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
   * The product id a `BOUGHT` settle on this row carries, or undefined.
   *
   * **The one place the rule lives**, because three controls send a settle: the
   * row's glyph, the row's reel and the sheet's buttons. Since backend `0201` it
   * is the row's own product: a row is one product, so there is nothing left to
   * choose between, and a row whose lines hold none names none.
   */
  itemIdFor(rowKey: string): string | undefined {
    return this.rowFor(rowKey)?.productId ?? undefined;
  }

  /**
   * What a write on a row names: its key and **every line it gathers** (backend
   * `0201`, section 4; velista `0139`, section 4).
   *
   * Every entry, served or not. A guest is served no list, and the server reads
   * "a line of the actor" as "a covered line" so that who may settle does not
   * change (backend `0201`, "What the build decided", point 10). Naming only the
   * served entries would leave a guest nothing to send.
   *
   * Null for a row this store does not hold, which is a write with nothing to
   * name: the caller sends nothing.
   */
  targetOf(rowKey: string): BasketRowTarget | null {
    const row = this.rowFor(rowKey);
    if (row === null || row.entries.length === 0) {
      return null;
    }
    return {
      rowKey: row.rowKey,
      lineIds: row.entries.map((entry) => entry.lineId),
    };
  }

  /**
   * The shop this device asks every read to be made at, or null for none
   * (velista `0102`; `0091` section 7).
   *
   * A **device's** choice and never the basket's: two people in one household
   * stand in two shops, so it reaches the server only as the read parameter and
   * on each settle. `BasketViewStore` sets it and remembers it. A basket started
   * at a shop ignores it, because the server reads that basket at its own shop.
   */
  readonly readAt = computed(() => this._readAt());

  /**
   * The shop the products' `atShop` describes **and** this screen is asking
   * about, or null (velista `0102`).
   *
   * The basket's own shop on a basket started at one. Otherwise the device's
   * choice, once a read at it has answered: while the read at a newly chosen shop
   * is out, the products still describe the last one, and this says null rather
   * than let a row quote one shop's price under another's name.
   */
  readonly shopRead = computed<string | null>(() => {
    const basket = this._basket();
    if (basket === null) {
      return null;
    }
    const wanted = basket.lockedShopId ?? this._readAt();
    return wanted !== null && basket.readAt === wanted ? wanted : null;
  });

  /**
   * Read the basket at this shop from now on, or at none (velista `0102`).
   *
   * Every read after this sends it, the socket's refetches included, which is
   * what keeps a row's `atShop` from reverting to nothing the next time somebody
   * else settles a line. A change reads again at once. A basket started at a shop
   * is read at that shop whatever this says, so nothing is sent for one.
   */
  async readAtShop(locationId: string | null): Promise<void> {
    if (this._readAt() === locationId || this._basket()?.lockedShopId != null) {
      return;
    }
    this._readAt.set(locationId);
    await this.refresh();
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

  /** The choices this device holds on this basket, by line id. */
  private readonly _held = computed<ReadonlyMap<string, HeldProductChoice>>(
    () => this._choices.heldOn(this._basket()?.id ?? null)
  );

  /**
   * The rows, in the order the server sent them, which is the order to walk.
   *
   * With the products this device chose for this trip put on their lines and the
   * lines grouped again by the shared rule (velista `0140`, section 4). The row is
   * drawn under the chosen product here and nowhere else, and every write and
   * settle of the page reads the row from here, so the next buy names it.
   */
  readonly rows = computed<readonly BasketRow[]>(() => {
    const basket = this._basket();
    if (basket === null) {
      return [];
    }
    const held = this._held();
    if (held.size === 0) {
      return basket.rows;
    }
    return withHeldChoices(
      basket.rows,
      new Map([...held].map(([lineId, choice]) => [lineId, choice.itemId])),
      new Set(basket.lists.map((ref) => ref.listId))
    );
  });

  /** Whether {@link rows} differ from the read, because a held choice moved a line. */
  private readonly _regrouped = computed(
    () => this.rows() !== (this._basket()?.rows ?? [])
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
  readonly products = computed<ReadonlyMap<string, BasketProduct>>(() => {
    const read = this._basket()?.products ?? new Map<string, BasketProduct>();
    // A product held for this trip that no row of the read draws is drawn from
    // what the change sheet had to hand. The read's own wins wherever it has one.
    const missing = [...this._held().values()].filter(
      (choice) => choice.product !== null && !read.has(choice.itemId)
    );
    if (missing.length === 0) {
      return read;
    }
    const products = new Map(read);
    for (const choice of missing) {
      if (choice.product !== null) {
        products.set(choice.itemId, choice.product);
      }
    }
    return products;
  });

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
   * How many rows still have something to do (backend `0130`, section 4).
   *
   * What the finish sheet warns about and what `allSettled` reads. The read's
   * number, and after a write the same rule counted over the rows held
   * (`progressOf` of `@portfolio/luna-shopper/basket-rules`, backend `0201`), so a
   * `SKIPPED` row is pending here exactly as it is on the server.
   */
  readonly pending = computed(() =>
    this._regrouped()
      ? basketProgressOf(this.rows()).pending
      : (this._basket()?.pending ?? 0)
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
   * The read's count, and after a write the shared rule's count over the rows
   * held (backend `0201`, "What the build decided", point 1): the progress a
   * write answers is core's count with no prices, and can be one off. Rows and not
   * units, which is how `0047` counts a zone list: "four things done out of
   * twelve" is what somebody in a shop is tracking, and a basket of one row asking
   * for twelve tins would otherwise read as almost finished.
   *
   * Zeroed before the first read, which draws as a basket with nothing in it for
   * the moment there is nothing in it.
   */
  readonly progress = computed<BasketProgress>(() =>
    this._regrouped()
      ? basketProgressOf(this.rows()).progress
      : (this._basket()?.progress ?? { done: 0, unavailable: 0, total: 0 })
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
   * link, which is `needsSignIn` rather than a failure: signing in is the answer,
   * not an error.
   */
  async open(basketId: string): Promise<void> {
    this._id = basketId;
    this._address.set({ basketId });
    this._state.set('loading');
    this._error.set(null);
    this._accessEnded.set(null);
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
    this._accessEnded.set(null);
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
    this._cancelReads();
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
    this._queued = 'none';
    this._heldPatches = null;
    this._changed();
    this._link.set(null);
    this._accessEnded.set(null);
    this._present.set([]);
    this._busyRows.set(new Set());
    this._adding.set(false);
    // The shop is the device's and outlives the basket in `BasketViewStore`'s
    // record, which puts it back on the next one. This store asks nothing of a
    // basket it has let go.
    this._readAt.set(null);
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
    await this._refresh('full');
  }

  /**
   * {@link refresh}, for either read. `rows` is the read of backend `0205`, which
   * an event asks for (velista `0143`, section 5).
   */
  private async _refresh(kind: BasketReadKind): Promise<void> {
    const id = this._id;
    // Null with a `live` address is the one read that has no id yet: the caller's
    // own basket, before the answer that names it. Null with no address at all is
    // a store nobody has opened, or one that has been let go.
    if (id === null && this._address() !== 'live') {
      return;
    }

    const reading = this._reading;
    if (reading !== null) {
      if (this._queued !== 'full') {
        this._queued = kind;
      }
      await reading;
      return;
    }

    // Recorded here and cleared in the chained `finally`, which settles this
    // promise only after it has run. So nobody can resume from an await to find a
    // read still recorded that has in fact finished, and queue behind it forever.
    // The identity check is what lets {@link leave} disown a read: a newer one is
    // already recorded by the time an abandoned one gets here.
    const started = this._read(id, kind).finally(() => {
      if (this._reading === started) {
        this._reading = null;
        this._heldPatches = null;
      }
    });
    this._reading = started;
    await started;
  }

  /**
   * The read an event asked for: the rows, once a basket is held to keep the
   * products of. See {@link CoalescedRead} for when it goes out.
   */
  private async _eventRead(): Promise<void> {
    await this._refresh(this._basket() === null ? 'full' : 'rows');
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
  private async _read(id: string | null, first: BasketReadKind): Promise<void> {
    let kind = first;
    for (;;) {
      const generation = this._generation;
      this._queued = 'none';
      // The patches applied from here on are put on this answer when it lands.
      this._heldPatches = [];

      // The device's shop, unless the basket held is one started at a shop: the
      // server reads that one at its own, and sending anything else is refused.
      const at =
        this._basket()?.lockedShopId == null
          ? (this._readAt() ?? undefined)
          : undefined;

      let basket: Basket;
      try {
        // A null id is the caller's own basket, which this read is what names:
        // it is the first read of a `live` page and no later one, because the
        // id is recorded below and every refresh after it goes out by id.
        if (id === null) {
          basket = await this._service.getLiveBasket(at);
        } else if (kind === 'rows') {
          const rows = await this._service.getBasketRows(id, at);
          const kept = this._withCatalog(rows);
          if (kept === null) {
            // A row names a product this store does not hold: one a line that
            // somebody added since counts as. Only the full read names it.
            kind = 'full';
            continue;
          }
          basket = kept;
        } else {
          basket = await this._service.getBasket(id, at);
        }
      } catch (error) {
        if (at !== undefined && isShopLocked(error)) {
          // The basket turned out to be started at a shop of its own (velista
          // `0102`). The device's choice is dropped and the basket read again at
          // its own shop, which is what the screen then draws, locked.
          this._readAt.set(null);
          continue;
        }
        this._fail(id, error);
        return;
      }

      // Which shop this answer describes, since the mapper cannot know the
      // request. A basket started at a shop already says so for itself.
      if (basket.lockedShopId === null && at !== undefined) {
        basket = { ...basket, readAt: at };
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

      // The patches that arrived while this was out, by the version rule: one
      // older than what the answer holds is dropped. When the rule cannot tell,
      // the answer is drawn and read once more.
      let applied = basket;
      let again = false;
      for (const held of this._heldPatches ?? []) {
        const next = applyBasketPatch(applied, held.lineIds, held.entries);
        if (next === BASKET_PATCH_READ) {
          again = true;
          break;
        }
        applied = next;
      }

      this._basket.set(again ? basket : applied);
      this._pruneHeld(again ? basket : applied);
      this._landed += 1;
      this._state.set('ready');
      this._error.set(null);

      if (again && this._queued === 'none') {
        this._queued = 'rows';
      }
      if (this._queued === 'none') {
        return;
      }
      kind = this._queued;
    }
  }

  /**
   * A rows answer with the products, the scopes and the shop this store holds, or
   * null when a row names a product it does not hold (backend `0205`).
   */
  private _withCatalog(rows: Basket): Basket | null {
    const held = this._basket();
    if (held === null) {
      return null;
    }
    const missing = rows.rows.some(
      (row) => row.productId !== null && !held.products.has(row.productId)
    );
    if (missing) {
      return null;
    }
    return {
      ...rows,
      products: held.products,
      scopes: held.scopes,
      shop: held.shop,
    };
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
    return this._rowWrite(rowKey, (id, target) =>
      this._service.settle(id, target, body)
    );
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
    return this._rowWrite(rowKey, (id, target) =>
      this._service.revert(id, target, body)
    );
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
   *
   * `at` is where the purchase happened and what was bought: the scope of the price
   * the row drew (velista `0095`, section 6), the shop the person is buying at
   * (velista `0102`) and the row's product (velista `0139`). Only the settling
   * direction sends it: a revert names no scope and no shop.
   */
  async setLeft(
    rowKey: string,
    next: number,
    from: number,
    at: Pick<
      BasketSettleRequest,
      'priceScopeId' | 'supermarketLocationId' | 'itemId'
    > = {}
  ): Promise<BasketRowResult | null> {
    if (next === from) {
      return null;
    }

    return next < from
      ? this.settle(rowKey, {
          outcome: 'BOUGHT',
          quantity: from - next,
          from,
          ...(at.priceScopeId === undefined
            ? {}
            : { priceScopeId: at.priceScopeId }),
          ...(at.supermarketLocationId === undefined
            ? {}
            : { supermarketLocationId: at.supermarketLocationId }),
          ...(at.itemId === undefined ? {} : { itemId: at.itemId }),
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
  ): Promise<BasketRowResult | null> {
    // A rename changes a name a patch does not carry, and can merge two rows.
    return this._rowWrite(
      rowKey,
      (id, target) => this._service.renameRow(id, target, body),
      false
    );
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
    return this._rowWrite(rowKey, (id, target) =>
      this._service.skip(id, target)
    );
  }

  /** The same fact, unset. See {@link skip}. */
  async unskip(rowKey: string): Promise<BasketRowResult | null> {
    return this._rowWrite(rowKey, (id, target) =>
      this._service.unskip(id, target)
    );
  }

  /**
   * Change what one list asks for (velista `0092`, section 6).
   *
   * The one write here that changes a household's list rather than recording
   * what a trip did, and the answer is folded like any other: the line comes
   * back with new numbers, or is absent when nothing is left to buy of it and
   * nothing was bought this trip, in which case {@link _fold} takes it off its
   * row. The caller reads {@link lineLeft} to know which happened. It is not a
   * failure: the list now asks for nothing, which is what was asked for.
   *
   * Named by its line alone (backend `0201`, section 4), which need not be a row
   * of this basket: a list that holds the product at zero is raised this way,
   * and its line then joins the row of the product.
   */
  async setDemand(body: BasketDemandRequest): Promise<BasketRowResult | null> {
    const busyKey = this.rowFor(body.lineId)?.rowKey ?? body.lineId;
    return this._write(busyKey, async (id) => {
      const result = await this._service.setDemand(id, body);
      this._fold(result, [body.lineId]);
      return result;
    });
  }

  /**
   * Whether the server states a buy of this line in this trip (backend `0201`,
   * section 1): its latest standing buy named a product. Read off the basket as it
   * was read, never off a choice this device holds.
   */
  hasTripBuy(lineId: string): boolean {
    return (this._basket()?.rows ?? []).some((row) =>
      row.entries.some(
        (entry) => entry.lineId === lineId && entry.tripItemId !== null
      )
    );
  }

  /**
   * Take another product on these lines (velista `0140`, section 4).
   *
   * - **`keep`**: one write, and each line holds the product as its favourite.
   * - **No `keep`**: the lines with a buy in this trip are written, so the buys
   *   take the new product and the lines follow it until the trip ends. The rest
   *   are held on this device, with nothing sent, until their first buy names it.
   *
   * The answer moves each line to the row of its product with the shared rule,
   * and the basket is read again as after every write. False when the write
   * failed: nothing is held then either, so the row stays as it was, and
   * {@link error} holds the refusal.
   *
   * @param product What the row draws for a held choice, see `HeldProductChoice`.
   */
  async changeProduct(
    rowKey: string,
    body: BasketProductChangeRequest,
    product: BasketProduct | null
  ): Promise<boolean> {
    const id = this._basket()?.id ?? null;
    if (id === null || body.lineIds.length === 0) {
      return false;
    }
    const sent = body.keep
      ? body.lineIds
      : body.lineIds.filter((lineId) => this.hasTripBuy(lineId));
    const kept = body.lineIds.filter((lineId) => !sent.includes(lineId));

    if (sent.length > 0) {
      const result = await this._write(rowKey, (basketId) =>
        this._service.changeProduct(basketId, { ...body, lineIds: sent })
      );
      if (result === null) {
        return false;
      }
      this._choices.release(id, sent);
      this._regroup(result, sent);
    }
    // A line taken back to the product the read already draws for it holds
    // nothing: the row is the server's again (velista `0149`).
    const rows = this._basket()?.rows ?? [];
    const home = kept.filter((lineId) =>
      rows.some(
        (row) =>
          row.productId === body.itemId &&
          row.entries.some(
            (entry) => entry.lineId === lineId && entry.tripItemId === null
          )
      )
    );
    this._choices.release(id, home);
    this._choices.hold(
      id,
      kept.filter((lineId) => !home.includes(lineId)),
      { itemId: body.itemId, product }
    );
    return true;
  }

  /**
   * Let go of every choice held on this basket that the stored read has spent
   * (velista `0149`): a line the read no longer names, or a line whose entry
   * carries a buy of its own, which the server answers from now on.
   *
   * Reads `basket.rows`, the server's answer, and never {@link rows}, whose
   * entries carry the held product as their `tripItemId`.
   */
  private _pruneHeld(basket: Basket): void {
    if (this._choices.heldOn(basket.id).size === 0) {
      return;
    }
    const unbought = new Set<string>();
    const bought = new Set<string>();
    for (const row of basket.rows) {
      for (const entry of row.entries) {
        (entry.tripItemId === null ? unbought : bought).add(entry.lineId);
      }
    }
    this._choices.retain(
      basket.id,
      (lineId) => unbought.has(lineId) && !bought.has(lineId)
    );
  }

  /**
   * The covered lists that could take a product, or null when the read failed
   * (backend `0201`, section 5; velista `0139`, section 3).
   *
   * A read and not a write, so a failure here moves nothing: the basket on screen
   * stays, and the sheet says the lists did not load with a retry beside it.
   */
  async productLists(
    itemId: string
  ): Promise<readonly BasketProductList[] | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }
    try {
      const lists = await this._service.productLists(id, itemId);
      // A basket let go or switched while the read was out answers for none.
      return this._id === id ? lists : null;
    } catch {
      return null;
    }
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
   * `0091`). So the answer is a line that may already be on the screen, and
   * {@link _fold} puts it into the row of its product, or makes it a row.
   */
  async addLine(body: BasketAddLineRequest): Promise<BasketRowResult | null> {
    const id = this._id;
    if (id === null) {
      return null;
    }

    this._adding.set(true);
    try {
      const result = await this._service.addLine(id, body);
      // An add makes a line this client does not hold, which only a read names.
      this._fold(result, [], false);
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
   * Whether a write's answer took this line out of the basket: it named the line,
   * and the line is not among the lines it answered (backend `0201`, section 4).
   * A demand taken to zero on a line nothing was bought of is the one write that
   * does it.
   */
  lineLeft(result: BasketRowResult, lineId: string): boolean {
    return !result.entries.some((entry) => entry.lineId === lineId);
  }

  /**
   * One write on a row, by the lines of the row this store holds.
   *
   * Null without a write when the store holds no such row, which is a row that
   * left under an open sheet: there is nothing to name.
   */
  private async _rowWrite(
    rowKey: string,
    send: (id: string, target: BasketRowTarget) => Promise<BasketRowResult>,
    patchable = true
  ): Promise<BasketRowResult | null> {
    const target = this.targetOf(rowKey);
    if (target === null) {
      return null;
    }
    return this._write(target.rowKey, async (id) => {
      const result = await send(id, target);
      this._fold(result, target.lineIds, patchable);
      return result;
    });
  }

  /**
   * Fold one write's answer into the basket. **The single place a write lands.**
   *
   * The answer is lines and no row (backend `0201`, section 4), so
   * `foldBasketEntries` puts each line back into the row that holds it and
   * rebuilds that row with the rules core uses. **It never works out a number of
   * its own**: every sum and state is `@portfolio/luna-shopper/basket-rules`'s
   * answer over the entries the server sent.
   *
   * The header is counted here over the rows held, with the same rules
   * (`progressOf`), and not taken from the answer: the write's progress is
   * core's count with no prices and can be one off the read (backend `0201`,
   * "What the build decided", point 1).
   *
   * A write that only moves numbers is applied as a patch and is not followed by
   * a read (velista `0143`, section 6). Any other answer, or one the patch cannot
   * apply, is folded as above and the rows are read after it: the read is where a
   * row the client cannot place comes from, with its product named.
   *
   * @param patchable False for a write that can change a name or a row, which a
   *   patch does not carry: a rename and an add.
   */
  private _fold(
    result: BasketRowResult,
    named: readonly string[],
    patchable = true
  ): void {
    const held = this._basket();
    if (held === null) {
      return;
    }

    // The answer of a write that only moves numbers is applied with the same
    // function as an event, so the row and the count are right before the event
    // of the same write lands and changes nothing. No read follows it (velista
    // `0143`, section 6).
    if (patchable) {
      const lineIds = [
        ...new Set([...named, ...result.entries.map((entry) => entry.lineId)]),
      ];
      if (this._applyPatch(lineIds, result.entries.map(basketEntryPatchOf))) {
        return;
      }
    }

    const served = new Set(held.lists.map((ref) => ref.listId));
    const rows = foldBasketEntries(held.rows, result.entries, named, served);
    const { progress, pending } = basketProgressOf(rows);
    const stored = { ...held, rows, progress, pending };
    this._basket.set(stored);
    this._pruneHeld(stored);
    this._changed();
    this._eventReads.ask();
  }

  /**
   * Fold the answer of a change of product: the lines move to the rows of the
   * products they count as now (`regroupBasketEntries`), which {@link _fold}
   * does not do, because no other write changes a product. The rest is
   * {@link _fold}'s.
   */
  private _regroup(result: BasketRowResult, named: readonly string[]): void {
    const held = this._basket();
    if (held === null) {
      return;
    }

    const served = new Set(held.lists.map((ref) => ref.listId));
    const rows = regroupBasketEntries(held.rows, result.entries, served, named);
    const { progress, pending } = basketProgressOf(rows);
    const stored = { ...held, rows, progress, pending };
    this._basket.set(stored);
    this._pruneHeld(stored);
    this._changed();
    this._eventReads.ask();
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
    if (isShopLocked(error)) {
      // A settle named a shop this basket was not started at (velista `0102`):
      // the device's choice goes, and the basket is drawn at its own shop.
      this._readAt.set(null);
    }
    if (
      error instanceof GatewayError &&
      (error.code === 'stale_quantity' ||
        error.code === 'basket_finished' ||
        error.code === 'basket_shop_locked')
    ) {
      await this.refresh();
      this._error.set(error);
    }
  }

  /**
   * A `basket.linesChanged` of this basket's room (velista `0143`).
   *
   * With entries, they are applied to the rows held, with no request. Without
   * them, or when the patch cannot be applied, the rows are read: see
   * {@link CoalescedRead}. Quiet either way: neither moves {@link state} to
   * `loading`, and a failed read leaves what is on screen alone.
   *
   * A read that is out when the patch lands gets it again on its answer, which can
   * be older than the patch.
   */
  private _linesChanged(
    lineIds: readonly string[],
    entries: readonly BasketEntryPatch[] | null,
    marksMoved: boolean
  ): void {
    if (entries === null) {
      // The read brings the marks too.
      this._eventReads.ask();
      return;
    }
    if (!this._applyPatch(lineIds, entries)) {
      this._eventReads.ask();
      return;
    }
    if (marksMoved) {
      this._askMarks();
    }
  }

  /**
   * Apply one patch to the basket held, and keep it for a read that is out.
   * False when only a read can say what is true.
   */
  private _applyPatch(
    lineIds: readonly string[],
    entries: readonly BasketEntryPatch[]
  ): boolean {
    const held = this._basket();
    if (held === null) {
      // The first read is out, and it gets this patch when it lands.
      this._heldPatches?.push({ lineIds, entries });
      return this._heldPatches !== null;
    }
    const next = applyBasketPatch(held, lineIds, entries);
    if (next === BASKET_PATCH_READ) {
      return false;
    }
    this._heldPatches?.push({ lineIds, entries });
    if (next !== held) {
      this._basket.set(next);
      this._pruneHeld(next);
    }
    return true;
  }

  /**
   * Read the marks shortly, once for a burst (velista `0143`, section 4).
   *
   * A failure is silent: the next read brings them.
   */
  private _askMarks(): void {
    if (this._marksOut) {
      this._marksAgain = true;
      return;
    }
    this._marksAt ??= setTimeout(() => {
      this._marksAt = null;
      void this._readMarks();
    }, MARKS_WAIT_MS);
  }

  private async _readMarks(): Promise<void> {
    const id = this._id;
    if (id === null) {
      return;
    }
    const landed = this._landed;
    this._marksOut = true;
    this._marksAgain = false;
    try {
      const marks = await this._service.getMarks(id);
      const held = this._basket();
      // A read that landed meanwhile brought marks at least as new.
      if (this._id === id && this._landed === landed && held !== null) {
        this._basket.set(applyBasketMarks(held, marks));
      }
    } catch {
      // Silent, by section 4: the next read brings the marks.
    } finally {
      this._marksOut = false;
    }
    if (this._marksAgain && this._id === id) {
      this._askMarks();
    }
  }

  /** Forget every read and marks read that was waiting. One that is out lands. */
  private _cancelReads(): void {
    this._eventReads.cancel();
    if (this._marksAt !== null) {
      clearTimeout(this._marksAt);
      this._marksAt = null;
    }
    this._marksAgain = false;
  }

  /**
   * Turn a failed participant request into a state the screen has a treatment for.
   *
   * A 401 here means one thing: the credential this browser holds no longer names
   * a live participant, because it was revoked, or the link that minted it was
   * revoked with the cascade ticked. The stored secret is replaced by an ended
   * marker at the same moment, so the person is told what happened, on this load
   * and the next, rather than shown a basket that refuses every tap.
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
      // The readings of one status, told apart by what this browser was holding
      // and by whether the reader is signed in, all read before anything is
      // dropped (velista `0154`). A credential that has stopped working was
      // **revoked**, and the person should be told so. A marker left by an
      // earlier refusal says the same after a reload. With neither, a signed out
      // reader is asked to sign in, and a signed in one is told the list is not
      // theirs.
      const held = this._sessions.read(basketId);
      const endedBefore = this._sessions.ended(basketId);
      const signedIn = this._account?.isAuthenticated() ?? false;
      if (held === null && this._state() === 'revoked') {
        // The credential is gone because an earlier refusal of this basket just
        // dropped it, not because this is a stranger. A revoked guest's tap and the
        // read their own removal's event asked for both come back 401, in either
        // order, and the second must not turn "You are no longer on this list"
        // into the join screen's "This link is no longer accepting people".
        return;
      }
      if (held !== null) {
        // Which of the two endings it was, from the code the server put on the
        // refusal (backend `0140`, section 8). Anything else, including a 401
        // with no readable body, falls back to the reason that draws the
        // ordinary sentence.
        const reason = endedReasonOf(error);
        this._sessions.end(basketId, reason);
        this._accessEnded.set(reason);
        this._state.set('revoked');
        return;
      }
      if (endedBefore !== null) {
        this._accessEnded.set(endedBefore);
        this._state.set('revoked');
        return;
      }
      if (endedReasonOf(error) === 'EXPIRED') {
        // A visit that ran out names itself, credential or not.
        this._accessEnded.set('EXPIRED');
        this._state.set('revoked');
        return;
      }
      this._state.set(signedIn ? 'notYours' : 'needsSignIn');
      return;
    }

    // Anything else is a network or a server problem, and the basket that is
    // already on screen stays on screen: a shopper in an aisle is better served
    // by a list that is a minute old than by an error page.
    this._state.set(this._basket() === null ? 'failed' : 'ready');
  }
}

/**
 * Whether a refusal says this basket was started at another shop (velista `0102`).
 *
 * The one refusal a read answers by trying again, without the device's shop, so it
 * is named once rather than tested inline in two places.
 */
function isShopLocked(error: unknown): boolean {
  return error instanceof GatewayError && error.code === 'basket_shop_locked';
}
