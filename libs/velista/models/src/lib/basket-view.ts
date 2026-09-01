import type { ParticipantKind, SettlementOutcome } from './enums';
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
 * A product a line may mean: its pick, or one of the options behind it.
 *
 * **No price, deliberately.** Backend `0050` resolves the pick to the first
 * option added rather than the cheapest, because core holds no prices and the
 * harvester is off outside development, and `0044` section 9 puts prices out of
 * scope until a second chain is harvested. A "best price" badge over a pick that
 * was chosen by insertion order would be a lie the mock cannot authorize.
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
  /** Which lists the run drew from. Absent unless {@link seesZoneData}. */
  sources?: readonly { zoneId: string; listId: string }[];
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
  skipped?: readonly { listId: string; reason: string }[];
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
