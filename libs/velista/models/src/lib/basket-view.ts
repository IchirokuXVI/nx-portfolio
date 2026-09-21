import type { ProductOffer } from './domain';
import type {
  BasketChangeMark,
  BasketKind,
  BasketRowNote,
  BasketRowState,
  BasketStatus,
  ParticipantKind,
  ProductCategory,
  SettlementOutcome,
} from './enums';
import type { LocalizedName } from './shopping-profile';

/**
 * The basket: what the person carrying it around the shop sees (plan 0044).
 *
 * Rule D4 (plan 0004, section 4.1): these are **ours**, mapped from `unknown` at
 * the boundary, never the gateway's DTOs passed through. The names are the app's
 * own — a `BasketRowView` on the wire is a {@link BasketRow} here, because the
 * screen is called the basket and nothing in the interface says "generated list".
 *
 * ## The one idea the whole file turns on
 *
 * **A basket stores none of this** (backend `0136`). It holds a header, a rule
 * saying which lists it covers and the people on it, and every number below is
 * read out of those lists on every request. So the client stores none of it
 * either: nothing here is patched, recomputed or kept in step by hand, and a
 * write answers the row it changed rather than a delta to apply to one.
 *
 * That is why {@link BasketRow.left}, {@link BasketRow.bought},
 * {@link BasketRow.asked} and {@link BasketRow.state} sit beside each other with
 * no function deriving one from another. `basketLineState` and `outstanding` were
 * exactly that arithmetic, and plan 0090 deleted them: the server counts, and a
 * second count on this side is a way for one screen to disagree with itself.
 *
 * ## A row is not a line
 *
 * One thing to buy can be asked for by two households, and it is one thing to
 * pick off one shelf. So a **row** is the covered lines that share a merge key,
 * each of them an **entry**, and a write addresses the row.
 *
 * ## Redaction is a list this reader was served
 *
 * {@link Basket.lists} holds the covered lists this reader holds `WRITE` on, and
 * no others: empty for a guest, and their own for a registered co shopper. An
 * entry whose {@link BasketRowEntry.listId} is `null` belongs to a list this
 * reader was not served, so the client knows how much and never where. There is
 * no `seesZoneData` flag any more, because the question it answered is now asked
 * per entry and answered by the data itself.
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
  /**
   * One offer per scope that lists this product, cheapest first (velista `0078`,
   * section 2; backend `0109`).
   *
   * What {@link offer} cannot answer. That one is a `DISTINCT ON (itemId)`, so it
   * says which scope is cheapest and never which scopes carry the product at all,
   * and a view of one shop's prices needs the second question answered: standing in
   * a Mercadona, what this chain charges and whether it stocks the line are two
   * different things and the cheapest price anywhere says neither.
   *
   * **Empty means unlisted everywhere**, and it means that for exactly the reason a
   * row with `available = false` never reaches here: the server excludes it, so
   * absent is the only way a product can fail to be listed and there is no third
   * state to draw. Empty is also what an older backend answers, which draws as a
   * basket nobody has priced and is the same screen staging and production already
   * show.
   */
  readonly offers: readonly ProductOffer[];
  /**
   * What aisles this product belongs to, for the category grouping (velista
   * `0077`, section 2).
   *
   * A **list** where the wire carries one value, and that costs nothing today: the
   * brief says a product will one day carry several, a pipeline written over a list
   * is the same pipeline either way, and the day the wire grows a second value
   * nothing above the mapper changes. Never empty: an unreadable value maps to
   * `OTHER` rather than dropping the product out of every section.
   */
  readonly categories: readonly ProductCategory[];
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
 * One covered list line inside a row (backend `0130`, section 3).
 *
 * The line a household actually wrote, seen through the basket that covers it.
 * A row's entries are its whole demand: two households asking for milk are two
 * entries of one row, and the numbers here are that one household's.
 *
 * ## Why an entry carries a state of its own
 *
 * A row under a list's heading is drawn for one entry (velista `0077`,
 * section 4), and whether **that** list's share is done is a different question
 * from whether the row is. The server answers both, so neither is worked out
 * here.
 */
export interface BasketRowEntry {
  readonly lineId: string;
  /**
   * The list this entry is on, or null for a list this reader was not served.
   *
   * Null rather than absent, unlike the optional fields the old line model
   * redacted by omission: there is one question here and it is "may I name this
   * list", so one representable answer. The mapper drops a list id that
   * {@link Basket.lists} has no ref for to null as well, so the rest of the
   * client has a single test for "served" and cannot disagree with itself.
   */
  readonly listId: string | null;
  readonly left: number;
  readonly bought: number;
  readonly asked: number;
  /** This entry's own state, by the server. Never `REMOVED` (backend `0136`). */
  readonly state: BasketRowState;
  /**
   * The line awaits the household's approval, mapped from the wire's
   * `approvalStatus`.
   *
   * A boolean because the client asks one thing of it: whether to draw the
   * caption saying the list has not agreed yet. `REJECTED` never arrives, since
   * a rejected line is not covered and so is never a row.
   */
  readonly awaitingApproval: boolean;
  /**
   * Whether this entry's demand can be changed, **by the server**.
   *
   * It asks the rule of the basket's owner rather than of the reader, and no
   * client rule can replace it: a reader never learns the owner's permissions,
   * and a guest has none of their own to ask about. Velista `0092` draws the
   * control this gates; until then it is carried and not read.
   */
  readonly demandEditable: boolean;
}

/**
 * One thing to buy, however many households asked for it.
 *
 * ## The key is a line id, and that is not an accident
 *
 * A row is recomputed on every read, so the group has no identity of its own.
 * Its anchor's line id is the closest thing to a stable name, and **any** entry's
 * id addresses the row on a write, which is what stops the next tap on a row
 * whose anchor was just bought to zero from being a not found.
 *
 * It follows that the key can change under an open sheet: somebody adds an
 * earlier "Milk" on another list, a rename merges two lines, the anchor is
 * deleted. `BasketStore.rowFor` is how a sheet finds its row again, by key and
 * then by any entry's line id (velista `0090`, section 7.3).
 */
export interface BasketRow {
  /** The anchor's list line id. The key on the wire and in a sheet's URL. */
  readonly rowKey: string;
  readonly content: string;
  readonly left: number;
  readonly bought: number;
  readonly asked: number;
  readonly state: BasketRowState;
  /** A fact about the row's past worth a caption, or null. */
  readonly note: BasketRowNote | null;
  /** When the fact behind {@link note} happened. Null exactly when `note` is. */
  readonly noteAt: Date | null;
  /**
   * What changed about this row since this viewer last looked.
   *
   * Carried by the model here and drawn by velista `0093`, so the mapper and the
   * store are written once. Null on every row until backend `0138` produces it.
   */
  readonly mark: BasketChangeMark | null;
  /**
   * True while any entry awaits its household's approval.
   *
   * **Never named `pending`**: that word is the count on {@link Basket.pending},
   * and one word for two facts is how a screen comes to say the wrong number.
   */
  readonly awaitingApproval: boolean;
  /** The union of the entries' product sets, in the server's order, anchor first. */
  readonly optionIds: readonly string[];
  /**
   * The participant behind the newest standing act on this row, or null.
   *
   * An id and never a name, for {@link BasketParticipant.displayName}'s reason:
   * a typed name is not an identity, so every attribution is resolved against
   * {@link Basket.participants}.
   */
  readonly touchedBy: string | null;
  readonly touchedAt: Date | null;
  /** Oldest first, the anchor at index 0. */
  readonly entries: readonly BasketRowEntry[];
}

/**
 * A covered list this **reader** holds `WRITE` on (backend `0130`, section 6).
 *
 * The whole of the client's redaction rule, and it is a list rather than a flag:
 * a guest is served an empty array, a registered co shopper is served the lists
 * they write themselves, and the owner is served all of them. An entry naming a
 * list that is not here is an entry this reader may not place.
 *
 * The name is reused on purpose. Today's `BasketListRef` described the send
 * picker of velista `0068`, which has nothing left to pick: a line is on a list
 * or it does not exist.
 */
export interface BasketListRef {
  readonly listId: string;
  readonly name: string;
  readonly zoneId: string;
  readonly zoneName: string;
}

/**
 * What one scope charges for a product, or null when that scope does not list it
 * (velista `0078`, section 2).
 *
 * The one place the lookup lives, so the row that draws a price and the pipeline
 * that decides a line has sunk cannot answer the question differently. A product
 * this basket has no entry for at all answers null too, which is the same null: to
 * the reader, a pick the catalog cannot resolve and a pick this chain does not
 * stock are both "no price from here".
 *
 * Null rather than the cheapest offer as a fallback. Quoting Dia's price under a
 * heading that says Mercadona is the defect this whole plan exists to remove.
 */
/**
 * The product a row means, or undefined for a row that means none.
 *
 * The **first** of {@link BasketRow.optionIds}, which backend `0136` orders anchor
 * first: a row has no `pickId` any more, because a pick was a column on the line
 * the basket stored and a basket stores no lines. What is left is the union of its
 * entries' product sets, and the first of them is what the anchor line named.
 *
 * One function so the search, the price mark and the row itself all resolve the
 * same product. Undefined for a free text row, and undefined for a product the
 * catalog can no longer name, which are the same nothing to draw.
 */
export function basketRowPick(
  row: Pick<BasketRow, 'optionIds'>,
  products: ReadonlyMap<string, BasketProduct>
): BasketProduct | undefined {
  const first = row.optionIds[0];
  return first === undefined ? undefined : products.get(first);
}

export function offerAt(
  product: BasketProduct | undefined,
  priceScopeId: string
): ProductOffer | null {
  if (product === undefined) {
    return null;
  }
  return (
    product.offers.find((offer) => offer.priceScopeId === priceScopeId) ?? null
  );
}

/** How a run of lines is progressing: got, had none, and how many there are. */
export interface BasketProgress {
  readonly done: number;
  readonly unavailable: number;
  readonly total: number;
}

/**
 * A basket, everybody on it, and what this reader may see of it.
 *
 * `participants` and `rows` arrive together because the screen cannot draw a
 * single row without both: an attribution is a participant id, so the people are
 * this screen's vocabulary rather than a second screen's data.
 *
 * Named `Basket` and not `BasketView` since plan 0090, because there is nothing
 * left for the word "view" to distinguish it from: the server stores no basket
 * rows at all, so every basket anybody holds is a view of the lists it covers.
 */
export interface Basket {
  readonly id: string;
  /** What this basket is (backend `0133`, section 2). */
  readonly kind: BasketKind;
  /** Null on a `LIVE` basket, and on a `GENERATED` one shown as its date. */
  readonly name: string | null;
  readonly status: BasketStatus;
  readonly createdAt: Date | null;
  readonly rows: readonly BasketRow[];
  /**
   * The covered lists this reader writes themselves, and no others.
   *
   * What replaced `seesZoneData`, `sources` and `listNames` at once. "May this
   * reader be offered the grouping by list" is `lists.length > 0`; "may this
   * entry be named" is `entry.listId !== null`; and the heading's words are this
   * ref's `name`. One collection answers all three, so they cannot disagree.
   */
  readonly lists: readonly BasketListRef[];
  readonly participants: readonly BasketParticipant[];
  /** The reader's own row, so the screen can tell "you" from everybody else. */
  readonly me: BasketParticipant;
  /** Every product any row names, by id. Empty when catalog was unreachable. */
  readonly products: ReadonlyMap<string, BasketProduct>;
  /**
   * The scopes the products' offers name, by scope id (velista `0062`).
   *
   * A map for the same reason {@link products} is one: a row resolves an id and
   * should not scan an array. Empty when nothing is priced, and empty too when
   * the gateway priced the read but could not name the scopes; an offer whose
   * scope is not here resolves to no place and is still a price.
   */
  readonly scopes: ReadonlyMap<string, BasketPriceScope>;
  /**
   * Over the rows that are not `REMOVED`. **The server's, never recounted.**
   *
   * `basketLinesProgress` used to compute it here, and computing it here is what
   * let the heading of a section and the sentence above it answer the same
   * question differently. `basketRowsProgress` counts a **section**, over states
   * the server wrote, and a spec asserts the two agree over a whole basket.
   */
  readonly progress: BasketProgress;
  /**
   * `total - done - unavailable`, by the server. A `SKIPPED` row is pending.
   *
   * It arrives inside `progress` on the wire and is lifted here because the
   * finish sheet and the home card read it on its own, and reading
   * `progress.pending` at one call site and subtracting at another is exactly
   * the drift this plan removed.
   */
  readonly pending: number;
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
  basketId: string;
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
 * What one settling act asked for (velista `0090`, section 3.5).
 *
 * ## `from` is on every write on a row
 *
 * Two phones in one shop moving one row is the ordinary case, and a gesture
 * whose meaning depends on where it started must be refused rather than
 * reinterpreted. A mismatch answers `stale_quantity`, and the screen reads the
 * basket again and says so (velista `0054`, section 4.1).
 *
 * ## Every `BOUGHT` carries its quantity
 *
 * The server used to cap an absent quantity at what the row still asked for,
 * which is what made a double tap safe. It does not any more: buying three of a
 * row that says two records three, because the extra unit is real. So the
 * quantity is explicit and {@link from} is what catches the second tap.
 */
export interface BasketSettleRequest {
  readonly outcome: SettlementOutcome;
  /** Required for `BOUGHT`. Absent for `NOT_AVAILABLE`, which buys nothing. */
  readonly quantity?: number;
  /** The row's `left` the person was looking at. */
  readonly from: number;
  /** The product actually in the trolley, when it is not the row's first option. */
  readonly itemId?: string;
  /**
   * Units per entry, for a reader who named them. Served entries only.
   *
   * Absent is not "none": the server divides the units oldest entry first, which
   * is what a settle from the row itself means. This is what the entries pane
   * sends when somebody says which household got what.
   */
  readonly allocations?: readonly { lineId: string; quantity: number }[];
}

/**
 * Taking part of a row back (velista `0090`; backend `0136`, section 5.2).
 *
 * Two targets rather than two requests, because they are one gesture with two
 * things it can be aimed at: the units somebody said they bought, or the close
 * somebody said the shop could not supply. A close holds no units, so that
 * branch has no number to take back and no `from` to check it against.
 */
export type BasketRevertRequest =
  | {
      readonly target: 'UNITS';
      readonly units: number;
      /** The row's `bought` the person was looking at. */
      readonly from: number;
    }
  | { readonly target: 'CLOSE' };

/**
 * What every write on a row answers (backend `0136`, `BasketRowResult`).
 *
 * One shape for all of them, because a client redraws one row after any of them.
 * The store folds {@link row} by its key and takes {@link progress} whole; **it
 * never patches a number**, which is the rule the whole row model rests on.
 */
export interface BasketRowResult {
  /**
   * The row as it now stands, under whatever key it now has.
   *
   * Never null: a row bought to zero stays in the view as `DONE`, because the
   * purchase that emptied it is in scope.
   */
  readonly row: BasketRow;
  readonly progress: BasketProgress;
  /**
   * `total - done - unavailable`, by the server, lifted out of the wire's
   * `progress` exactly as {@link Basket.pending} is.
   *
   * It is here rather than left inside {@link progress} because the store has to
   * put it back on the basket after every write, and the alternative is to work
   * it out from the three numbers beside it. Nothing in this scope subtracts one
   * count from another (velista `0060`, section 4), so the server sends it.
   */
  readonly pending: number;
  /**
   * Set by a rename that folded this row into another: the key the request used.
   *
   * The store drops that row and redraws {@link row} without reading the basket
   * again.
   */
  readonly replacedRowKey: string | null;
  /** Set by a revert: entries whose line was deleted since, so no units went back. */
  readonly skippedCount: number;
}

/**
 * A new name for a basket row (velista `0084`, backend `0113`).
 *
 * The server renames every entry of the row on its own list in the same write, so
 * this is the one basket write that changes what a household's own list says.
 */
export interface BasketRenameRequest {
  content: string;
  /**
   * Whether a name already taken may merge. Absent or false asks first: the server
   * refuses with `line_merge_required` and writes nothing.
   */
  confirmMerge?: boolean;
}

/**
 * What a rename did.
 *
 * {@link row} is the surviving row, and its key differs from the one the request
 * named when that row was the one absorbed: the earliest line survives a merge,
 * and the anchor moves with it. {@link absorbedRowKey} is the row that went
 * away, which the store drops.
 */
export interface BasketRenameResult extends BasketRowResult {
  /**
   * The row a merge took away, or null when no row merged.
   *
   * The same value the wire calls `replacedRowKey`, named for what a rename did
   * with it. A rename is the only write that produces one today, and the sheet
   * reads it to know whether its own row survived.
   */
  readonly absorbedRowKey: string | null;
}

/**
 * Every place a rename's new name is already taken, from a `line_merge_required`
 * refusal (backend `0113`, section 4).
 *
 * One confirmation covers all of them, so the sheet draws one row per place rather
 * than one question per place.
 */
export interface BasketMergeRequired {
  readonly lists: readonly BasketMergeRequiredList[];
  /** The basket's own line with that name, or null when only lists collide. */
  readonly basket: BasketMergeRequiredBasket | null;
}

/** One list whose own line already carries the new name. */
export interface BasketMergeRequiredList {
  readonly listId: string;
  readonly listName: string;
  readonly zoneName: string;
  /** What that other line asks for. */
  readonly otherQuantity: number;
}

/** The basket row that already carries the new name. */
export interface BasketMergeRequiredBasket {
  readonly otherRowKey: string;
  /** The other line's whole quantity, as the refusal states it. */
  readonly otherQuantity: number;
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
