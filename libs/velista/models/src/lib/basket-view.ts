import type {
  BasketLineKind,
  BasketOriginUnavailableReason,
  ParticipantKind,
  PriceSourceKind,
  SettlementOutcome,
} from './enums';
import type { LocalizedName } from './shopping-profile';

/**
 * The basket: what the person carrying it around the shop sees (plan 0044).
 *
 * Rule D4 (plan 0004, section 4.1): these are **ours**, mapped from `unknown` at
 * the boundary, never the gateway's DTOs passed through. The names are the app's
 * own — a `GeneratedListBasketLineView` on the wire is a {@link BasketLine} here,
 * because the screen is called the basket and nothing in the interface says
 * "generated list".
 *
 * ## The one idea the whole file turns on
 *
 * **The three views differ by absence, not by a flag.** Plan 0030 settled that
 * for the list page and `0044` section 4.1 holds it here: a control you may not
 * use is not drawn, and data you may not have does not arrive. So the fields the
 * server redacts are optional here too, and they are optional rather than
 * nullable because absent and null are different questions. Absent is "you may
 * not see this"; null would be "there is nothing to see".
 *
 * {@link BasketView.seesZoneData} is what the screen branches on. It is never the
 * authority for anything — the server has already removed what this reader may
 * not have, and refuses the allocation sheet on its own — it is only how the page
 * knows whether to draw a caption at all rather than inferring it from which
 * fields happened to arrive.
 */

/**
 * One person acting on a shared basket.
 *
 * `displayName` is **unverified text typed on an unauthenticated link**, so it is
 * what the screen shows and never what anything is keyed by. Two guests can both
 * type "Dani"; {@link id} is what tells them apart, which is why every attribution
 * on a line is an id resolved against this list rather than a name copied onto the
 * row (plan 0051, section 3.5).
 */
export interface BasketParticipant {
  id: string;
  kind: ParticipantKind;
  /** Null when a guest skipped the prompt; the screen renders `Guest N`. */
  displayName: string | null;
  /**
   * The account holder's own name, as it stood when they joined (luna `0054`,
   * section 2).
   *
   * Null for a guest, who has no account to take one from. **A separate field from
   * {@link displayName} and not a value written into it**, because they are different
   * facts: one is unverified text typed on an unauthenticated link and the other is an
   * account's own name, and `0051` section 3.5 rests on being able to tell them apart.
   * A guest typing "Dani" must not be indistinguishable from an account called Dani.
   *
   * A **snapshot**, like a zone membership's: somebody who renames their account keeps
   * the old name on baskets they have already joined, because the alternative is a
   * join at read time on the one screen that is refetched every time anybody settles
   * anything.
   *
   * Null on a basket generated before that plan shipped, which is what the role word
   * fallback in `participantName` still exists to draw.
   */
  username: string | null;
  /** Monotonic per basket, so the fallback label is stable. Guests only. */
  guestNumber: number | null;
  /** Set for `OWNER` and `REGISTERED`, null for a `GUEST`. */
  userId: string | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  /** Null for the owner, who arrived by owning the basket rather than by a link. */
  shareLinkId: string | null;
  /**
   * The device string, present only for a reader who passes the all or nothing
   * rule (plan 0051, section 5.2). Guests do not get to inspect each other.
   */
  device?: string | null;
}

/**
 * One participant **connected to the basket right now** (backend `0051`, section 7).
 *
 * Deliberately not a {@link BasketParticipant}, and the difference is the whole point
 * of the type. A participant is somebody who *may* open this basket; an entry here is
 * somebody who has it open. Those diverge exactly when it matters, which is after a
 * trip, when everybody has gone home and the basket still has four participants.
 *
 * One person on a phone and a laptop is two participants and appears twice, which is
 * truthful: it is two sessions. Nothing here is deduplicated by name, because a typed
 * name is not an identity (section 3.5).
 *
 * It carries **no device and no join time**. Presence says somebody is here; it does
 * not say what they are holding, and no guest learns another guest's device.
 */
export interface BasketPresenceEntry {
  participantId: string;
  kind: ParticipantKind;
  displayName: string | null;
  guestNumber: number | null;
  userId: string | null;
}

/**
 * Where one basket line came from: a zone list that wanted some of it.
 *
 * Zone data, so it reaches only a reader who passes the rule. A tin of tomatoes
 * never names its household to a guest.
 */
export interface BasketLineOrigin {
  id: string;
  zoneId: string;
  listId: string;
  lineId: string;
  /** What this origin contributed to the line's summed quantity. */
  quantity: number;
}

/**
 * What one product costs, at the cheapest scope this basket was priced against
 * (velista `0062`, section 3; `ItemOfferView` on the wire).
 *
 * A fact and not a recommendation. The pick is still the first option added
 * and not the cheapest, so a row quoting this is quoting what its product
 * costs, and the pick sheet is where two of them are put next to each other.
 */
export interface ProductOffer {
  /** In {@link currency}. Null is a scope that carries the product with no price on it. */
  readonly price: number | null;
  readonly currency: string | null;
  /** The source's own figure, never recomputed here. Null when it published none. */
  readonly unitPrice: number | null;
  /** "EUR/L", "EUR/lv". Text for a human, not a unit to parse. */
  readonly unitPriceLabel: string | null;
  /** Without it a price has no age. */
  readonly observedAt: Date | null;
  readonly sourceKind: PriceSourceKind;
  /** Which scope quoted it. Opaque, and resolved against {@link BasketView.scopes}. */
  readonly priceScopeId: string;
}

/**
 * A product a line may mean: its pick, or one of the options behind it.
 *
 * ## The price, and what it is not
 *
 * {@link offer} is the cheapest price at the run's scopes, and it is **null
 * wherever nothing was harvested there**, which is every product in staging and
 * production, where the harvester is off on purpose. No layout may depend on it
 * existing: a row with a price and a row without are the same shape.
 *
 * **The pick is still the first option added and not the cheapest.** Backend
 * `0050` resolves it by insertion order and `0066` section 6 keeps it that way,
 * so nothing here marks the pick as the best buy. What the pick sheet does
 * instead is mark which option *is* the cheapest, so a shopper can see that the
 * default is not it and change it in one tap.
 */
export interface BasketProduct {
  id: string;
  /**
   * Both languages, resolved by the component with `inLocale`, not here.
   *
   * A mapper has no locale: it runs at the HTTP boundary, and the reader's
   * language can change under a rendered page without a refetch. This follows
   * `Supermarket.name`, which is the same catalog field on the same reasoning.
   */
  name: LocalizedName;
  brand: string | null;
  /** e.g. `1` with {@link BasketProduct.unit} `LITER`. Null when catalog does not know. */
  size: number | null;
  unit: string | null;
  /** The cheapest price at the run's scopes, or null where there is none. */
  readonly offer: ProductOffer | null;
}

/**
 * One price scope the basket was priced against, described for a person
 * (velista `0062`, section 3; `BasketPriceScopeView` on the wire).
 *
 * A scope is the set of stores a chain charges the same in: the right key for a
 * price and not something to show anybody, so a row resolves the id here and
 * draws the chain, and the pick sheet draws the shop too when there is one.
 */
export interface BasketPriceScope {
  readonly priceScopeId: string;
  /** Both locales, resolved with `inLocale` where drawn. Never flattened in the mapper. */
  readonly supermarketName: LocalizedName;
  /**
   * The shops. **Empty for a reader the server withheld them from**, per
   * backend `0066` section 5, and empty for a scope whose stores catalog cannot
   * place. Both draw the chain and no address, and no control anywhere is
   * offered over the distinction, which is why this is an empty array and not
   * an optional field like `origins`: a second representable state would exist
   * only to be collapsed at every call site.
   */
  readonly locations: readonly ScopeLocation[];
}

/** One shop of a scope, as much of it as the pick sheet draws. */
export interface ScopeLocation {
  readonly id: string;
  /** The shop's own name, both locales. Null where catalog has none. */
  readonly label: LocalizedName | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
}

/**
 * One line of a basket: a thing to buy, how many, and how many are already got.
 *
 * There is no tick and no status. `0043` made the quantity the state and `0047`
 * made settling cumulative, so a line is finished when {@link settled} reaches
 * {@link quantity} and stays exactly where it is either way.
 */
export interface BasketLine {
  id: string;
  content: string;
  /** How many the basket is asking for, summed across its origins. */
  quantity: number;
  /** How many have been settled so far, across however many shops. */
  settled: number;
  /** The exact product this line means. Null for a free text line. */
  pickId: string | null;
  /** The products the pick may be switched between. Catalog data, never zone data. */
  optionIds: readonly string[];
  position: number;
  /**
   * Who **put this line here**, as a participant id, written once and never
   * afterwards (luna `0055`, section 4).
   *
   * A separate field from {@link BasketLine.touchedBy} rather than a reading of
   * it, because that one moves: the moment anybody settles the line, or edits its
   * quantity, or swaps its product, `touchedBy` becomes them. "Who put this here"
   * is the question a shop asks about a line nobody recognises, and after one
   * settle the other field can no longer answer it.
   *
   * Null for every line the run composed, which is honest rather than missing: a
   * derived line was put there by the generation, and the person who ran it is the
   * owner, who is already named on the basket. Null too on a basket served by a
   * backend from before that plan, which reads the same way and draws the same
   * nothing.
   */
  createdBy: string | null;
  /**
   * Who last edited or settled this line, as a participant id.
   *
   * An id and never a name, for {@link BasketParticipant.displayName}'s reason.
   * Null when nobody has touched it since it was generated.
   */
  touchedBy: string | null;
  touchedAt: Date | null;
  /**
   * What the most recent settle on this line said, or null if there has been
   * none.
   *
   * **The numbers cannot say this.** `NOT_AVAILABLE` closes the outstanding
   * amount exactly as a purchase does, so a row without this would caption a
   * shop that had none as somebody who bought it, which claims a purchase that
   * never happened.
   */
  lastOutcome: SettlementOutcome | null;
  /** Absent for a reader who does not pass the rule, rather than empty. */
  origins?: readonly BasketLineOrigin[];
  /**
   * Where this line came from (`origin` on the wire).
   *
   * `DERIVED` when the run composed it out of the zone lists it drew from, `ADDED`
   * when somebody typed it into the basket in an aisle. It falls back to `DERIVED`
   * when the wire omits it, which is a backend from before luna `0055`, and that
   * reads correctly: every line such a backend serves was composed by a run.
   *
   * Not optional, unlike {@link origins} and {@link targetListId}, because it is not
   * redacted. Every reader is told what kind of line they are looking at; what is
   * gated is which household it touches.
   */
  kind: BasketLineKind;
  /**
   * The zone list this line was sent to, once somebody has sent it (`targetListId`).
   *
   * Three states, and they are three because the row and the send sheet each read a
   * different pair of them. **Absent** is zone data withheld from a reader who does
   * not pass the rule, exactly as {@link origins} is. **Null** is a line that has
   * been sent nowhere, which is where every `ADDED` line starts and is the one state
   * the send control is offered over. A **list id** is a line already bound, which
   * cannot be bound again.
   *
   * Mapped with an `in` check for that reason: collapsing absent onto null would
   * offer a guest a control the server refuses, and offer it on a line that may
   * already be bound.
   */
  targetListId?: string | null;
}

/**
 * One list already on a basket line, with everything the units sheet draws
 * (velista `0055`; `LineOriginDetail` on the wire).
 *
 * Zone data throughout, so the whole read is refused to anybody who does not pass the
 * all or nothing rule. A guest never learns that a tin of tomatoes is on a
 * household's list, let alone how many of it that household wanted.
 *
 * It is **not** a {@link BasketLineOrigin} with more fields, though it holds the same
 * origin. That one is what the basket read carries on every line, kept to the four ids
 * and a quantity because it is drawn on every row; this is what one sheet asks for
 * about one line, and it costs a request and a join per list to compose.
 */
export interface BasketLineOriginDetail {
  originId: string;
  listId: string;
  lineId: string;
  zoneId: string;
  /** Null where the list no longer has a name to give, meaning it was deleted. */
  listName: string | null;
  /** The group it sits in, for the reader who has two lists called "Food". */
  zoneName: string | null;
  /** What this list put into the basket line (`contributed`). */
  contributed: number;
  /** What the zone line asks for now (`listQuantity`). */
  listQuantity: number;
  /**
   * How many of this line's units this basket has already bought against this list,
   * which is the **floor** a contribution cannot go under (`settledHere`).
   *
   * Two of the flat's milk having been bought means the flat cannot retroactively
   * have wanted one, and the server refuses that with `below_settled` rather than
   * quietly unbuying something.
   */
  settledHere: number;
  /** Whether the basket owner still holds `WRITE` on the list. */
  writable: boolean;
}

/**
 * A list holding the same thing that is **not** on the line yet (`OriginCandidate`).
 *
 * What makes the units sheet an editor rather than a report: the run matched what it
 * could, and this is everything it did not take, so somebody can put a household back
 * on a line the generation missed.
 */
export interface BasketOriginCandidate {
  listId: string;
  lineId: string;
  zoneId: string;
  listName: string | null;
  zoneName: string | null;
  listQuantity: number;
  /** That list's own wording of the line, which is often not this basket's. */
  content: string;
  /**
   * Whether the run reached this one on normalized text alone.
   *
   * The last resort of the matcher, so it is the one class of candidate that can be
   * wrong: "butter" and "peanut butter" normalize apart, but a shorter pair may not.
   * The sheet says so rather than presenting a text match as an identity.
   */
  matchedOnText: boolean;
  /** Null when it can be adopted, which is the ordinary case. */
  unavailable: BasketOriginUnavailableReason | null;
}

/** What `GET .../lines/:lineId/origins` answers: what is on, and what could be. */
export interface BasketLineOrigins {
  lineId: string;
  origins: readonly BasketLineOriginDetail[];
  candidates: readonly BasketOriginCandidate[];
}

/**
 * Setting how many of a line are still to get (velista `0054`).
 *
 * **Absolute rather than a delta, and `from` is why.** Two phones in one shop moving
 * one line is the ordinary case, and a gesture whose meaning depends on where it
 * started must be refused rather than reinterpreted: raising the outstanding amount
 * buys more, lowering it records a purchase, and applying either against a number
 * that moved underneath inverts what somebody meant. A mismatch answers
 * `stale_quantity` and the screen redraws at the number as it stands.
 */
export interface BasketOutstandingRequest {
  /** How many are still to get after this. Zero finishes the line. */
  outstanding: number;
  /** What the control believed was outstanding when it was picked up. */
  from: number;
}

/**
 * Setting what one list contributes to a line (velista `0055`).
 *
 * The same `from` bargain as {@link BasketOutstandingRequest}, and for a sharper
 * reason: two people editing one split must not silently overwrite each other's
 * arithmetic. `from` is 0 for a candidate being adopted, which has contributed
 * nothing yet.
 */
export interface BasketOriginQuantityRequest {
  listId: string;
  /** The zone line: an existing origin of this basket line, or one being adopted. */
  lineId: string;
  /** What this list should contribute. Zero takes the list off the line. */
  quantity: number;
  from: number;
}

/** What one contribution write did. */
export interface BasketOriginQuantityResult {
  line: BasketLine;
  /** Null when the contribution was set to zero and the origin dropped. */
  origin: BasketLineOriginDetail | null;
  /** The zone line's own quantity after the write. */
  listQuantity: number;
}

/**
 * One list this line could be sent to (velista `0056`; `LineTarget` on the wire).
 *
 * Every list both the reader and the basket's owner can write, because the owner's
 * access is what authorizes every later settle against it.
 */
export interface BasketLineTarget {
  listId: string;
  zoneId: string;
  listName: string | null;
  zoneName: string | null;
  /**
   * Whether the run drew from this list, which is what the picker draws first.
   *
   * Somebody adding bread in an aisle almost always means the list the basket came
   * from, and ordering by it is the difference between a picker and a form.
   */
  fromRun: boolean;
}

/** What sending a line to a list did. */
export interface BasketBindResult {
  line: BasketLine;
  listId: string;
  zoneId: string;
  /** The zone line the bind created, which is a real line on somebody's list. */
  createdLineId: string;
  /** What that line asks for: the outstanding amount, which may be zero. */
  quantity: number;
  /**
   * True when the list does not accept lines automatically and this one is waiting.
   *
   * The one thing the row has to say afterwards, because a line waiting for approval
   * is not yet on the household's list in the way the person who sent it expects.
   */
  pendingApproval: boolean;
}

/** How far this line has got, which is what the row's indicator draws. */
export type BasketLineState =
  /** Nothing settled yet. The ordinary state of a line in a full basket. */
  | 'wanted'
  /** Some settled, some outstanding. The row shows both numbers. */
  | 'partly'
  /** Settled up to the asked quantity. Drawn quietly, still present, still tappable. */
  | 'done';

/**
 * How far a line has got. One function so the row and the header agree.
 *
 * A `NOT_AVAILABLE` settle closes the outstanding amount without buying
 * anything, so it lands on `done` here like any other finished line. The
 * difference between "got it" and "they had none" is in the attribution caption,
 * which is where a person actually reads it.
 */
export function basketLineState(line: BasketLine): BasketLineState {
  if (line.settled <= 0) {
    return 'wanted';
  }
  return line.settled >= line.quantity ? 'done' : 'partly';
}

/** How many are still to get. Never negative, however the numbers arrived. */
export function outstanding(line: BasketLine): number {
  return Math.max(0, line.quantity - line.settled);
}

/**
 * A basket, everybody on it, and what this reader may see of it.
 *
 * `participants` and `lines` arrive together because the screen cannot draw a
 * single row without both: a line's attribution is a participant id, so the
 * people are this screen's vocabulary rather than a second screen's data.
 */
export interface BasketView {
  id: string;
  /** Null is not missing: an unnamed basket is displayed as its generation date. */
  name: string | null;
  status: string;
  generatedAt: Date | null;
  lines: readonly BasketLine[];
  participants: readonly BasketParticipant[];
  /** The reader's own row, so the screen can tell "you" from everybody else. */
  me: BasketParticipant;
  /**
   * Whether this reader holds `WRITE` on every source list of the run, as the
   * server evaluated it on this request.
   *
   * The screen branches on it to decide what to **draw**. It is all or nothing
   * today and the cliff is known: one source where the reader holds only `READ`
   * collapses their view to a guest's. Plan 0051 section 11 keeps the per line
   * version as the target, and nothing here would have to be redesigned for it.
   */
  seesZoneData: boolean;
  /** Every product any line names, by id. Empty when catalog was unreachable. */
  products: ReadonlyMap<string, BasketProduct>;
  /**
   * The scopes the products' offers name, by scope id (velista `0062`).
   *
   * A map for the same reason {@link products} is one: a row resolves an id and
   * should not scan an array. Empty when nothing is priced, and empty too when
   * the gateway priced the read but could not name the scopes; an offer whose
   * scope is not here resolves to no place and is still a price.
   */
  readonly scopes: ReadonlyMap<string, BasketPriceScope>;
  /** Which lists the run drew from. Absent unless {@link seesZoneData}. */
  sources?: readonly { zoneId: string; listId: string }[];
  /**
   * Those lists by name, keyed by list id, for the row's "from" caption.
   *
   * Empty for a reader who may not have them, which is the same reader for whom
   * every line's `origins` is absent, so the caption has nothing to draw from on
   * both sides at once.
   */
  listNames: ReadonlyMap<string, string>;
}

/**
 * What the join screen may know **before** anybody joins (plan 0051, section 4).
 *
 * The whole of it, and it is deliberately almost nothing: no lines, no zone
 * names, no list names, no members. Somebody who finds a link in a chat log
 * learns that a shopping list exists and nothing else.
 *
 * A link that never existed, one that was revoked, one that expired and one whose
 * basket is finished all answer `joinable: false` and nothing else, so the screen
 * gets an honest sentence while the four cases stay indistinguishable. The screen
 * must therefore **not** try to say which it was.
 */
export interface BasketLinkPreview {
  joinable: boolean;
  /** The basket's name, or null when unnamed. Only when joinable. */
  name?: string | null;
  /** How many people are already on it. Only when joinable. */
  participantCount?: number;
}

/**
 * The credential a participant holds, and the only thing that gets them back in.
 *
 * Stored per basket in this browser, because it is per person: two people sharing
 * a phone are two participants, and the same URL opened in another browser is
 * somebody else. `secret` is null for a registered participant and for the owner,
 * who authenticate with their account token instead and need no second credential.
 */
export interface BasketSession {
  generatedListId: string;
  participantId: string;
  /** Returned exactly once, at join. Null when an account token stands in for it. */
  secret: string | null;
  socketToken: string;
  socketTokenExpiresAt: Date | null;
}

/**
 * The live share link, as the owner's share sheet reads it.
 *
 * **A basket has zero links or one.** It starts with zero, pressing share mints
 * one, revoking returns it to zero, and sharing again mints a fresh one. The one
 * link can be copied again at any time and handed to any number of people.
 */
export interface BasketShareLink {
  id: string;
  /** The invitation itself, served on every read so it can be copied tomorrow. */
  secret: string;
  createdAt: Date | null;
  expiresAt: Date | null;
  /** How many people arrived through it, so the sheet can say so. */
  participantCount: number;
}

/**
 * What one add asks for (velista `0053`; luna `0055`, section 3).
 *
 * **No `targetListId`**, and its absence is the design rather than an omission: a
 * line added here has no target, so it changes nothing any household shares, which
 * is what makes the gesture safe to hand to somebody who arrived on a forwarded
 * link. Binding one to a list is a separate gesture with a list picker in front of
 * it, and the server refuses the field on this surface outright.
 */
export interface BasketAddLineRequest {
  content: string;
  /** Defaults to one at the server. A line you do not want is not a gesture. */
  quantity?: number;
  /** The pick: the exact product this line means, when one was chosen. */
  itemId?: string;
  /** The products the pick may be switched between: what a group attaches. */
  options?: readonly string[];
}

/**
 * Whether this basket still takes lines, which is what decides the composer.
 *
 * The server refuses an add to a basket that is finished, and a field that cannot
 * submit is the invitation `0038` section 2.1 refuses to draw. So the question is
 * asked here once and the page has no second reading of it.
 *
 * **It names the live statuses rather than the finished ones**, which is the safe
 * direction and the same one the server's own `LIVE_GENERATED_LIST_STATUSES` takes.
 * A status this build has never heard of costs a composer; the other way round it
 * would draw a field over a basket the server considers closed, and every line
 * typed into it would come back refused.
 */
export function basketTakesLines(status: string): boolean {
  return status === 'DRAFT' || status === 'ACTIVE';
}

/** What one settling act asked for. The three gestures of section 4.2. */
export interface BasketSettleRequest {
  outcome: SettlementOutcome;
  /** Absent settles the whole outstanding amount, which is the common case. */
  quantity?: number;
  /** Per source list, by hand. Only for a reader who passes the rule. */
  allocations?: readonly { listId: string; quantity: number }[];
  /** The product actually in the trolley, when it is not the line's pick. */
  itemId?: string;
}

/**
 * What one settle did, as this actor is told it.
 *
 * {@link skippedCount} is present for everybody and {@link skipped} only for a
 * reader who passes the rule, which is how `0051` section 6.4 (report a partial
 * settle honestly) and section 5.2 (never name a list to a guest) both hold: the
 * fact is the actor's business and only the names are gated.
 */
export interface BasketSettleResult {
  line: BasketLine;
  /** How many origins this act could not reach. Zero is the ordinary answer. */
  skippedCount: number;
  /** Which ones, and why. Absent for a reader who does not pass the rule. */
  skipped?: readonly BasketSettleSkip[];
}

/**
 * One origin a settle could not reach, **named** (plan 0049, section 1.2).
 *
 * The names arrive on the report rather than being looked up, and that is the
 * whole of the design. The basket screen reaches no zone list store and must not
 * grow one: a screen that can name a household is a screen a template mistake
 * could show one to a guest. So the gateway composes the names for a reader
 * entitled to them, in the same way it already composes the basket's own
 * `listNames`, and a guest's report carries no `skipped` at all.
 *
 * {@link listName} is nullable **inside** that entitled report, and the two
 * nulls are different questions. Absent `skipped` is "you may not have this";
 * a null name is "there is no longer a name to give", which is a list deleted
 * since the run. The screen falls back to the bare count for the second, because
 * a count is at least true where an empty name would read as a missing word.
 */
export interface BasketSettleSkip {
  listId: string;
  reason: string;
  /** The list's own name, or null where it no longer has one to give. */
  listName: string | null;
  /** The group it sits in, for the reader who has two lists called "Food". */
  zoneName: string | null;
}

/** How the basket screen's one read has got on. */
export type BasketLoad =
  | 'loading'
  /** No participant session for this basket, so the join screen is the answer. */
  | 'needsJoin'
  | 'ready'
  | 'failed'
  /** The participant was revoked, or the link they held was cascaded. */
  | 'revoked';
