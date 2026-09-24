import type { ProductOffer } from './domain';
import type {
  BasketChangeMark,
  BasketKind,
  BasketRowNote,
  BasketRowState,
  BasketStatus,
  BasketUsualState,
  ParticipantKind,
  ProductCategory,
  SettlementOutcome,
} from './enums';
import { isOpenBasket } from './enums';
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
  /**
   * When this person's visit ends, and null when it does not (backend `0140`,
   * section 8).
   *
   * Null for the owner and for a person the owner added by name. Set, to
   * {@link LINK_VISIT_HOURS} after their own join, for everybody a link let in,
   * guest or signed in alike.
   *
   * **A moment to display and never a decision.** Whether it has passed is the
   * server's answer, read by asking again, so every comparison of this with the
   * device clock chooses a sentence and none of them grants or refuses anything.
   * Read it through {@link isNamedPerson} and {@link isLinkVisitor} rather than
   * by hand, so the two words this whole series is written in have one
   * definition.
   */
  expiresAt: Date | null;
}

/**
 * How long a link accepts joins, and how long a visit it let in lasts (backend
 * `0130`, section 11, decision 6).
 *
 * A constant rather than a `12` inside a sentence, so the day the number moves
 * it moves in one place per side. The join page's offer screen is the one
 * screen that says it before there is a participant to read an `expiresAt`
 * from.
 */
export const LINK_VISIT_HOURS = 12;

/**
 * How long before a visit ends the basket stops being quiet about it (velista
 * `0094`, section 5).
 */
export const VISIT_WARNING_MINUTES = 30;

/**
 * Somebody the owner put on this basket **by name**, who stays until they are
 * removed (backend `0130`, section 3).
 *
 * The owner is not one. They arrived by owning the basket, and no screen offers
 * to keep them on it.
 */
export function isNamedPerson(participant: BasketParticipant): boolean {
  return participant.expiresAt === null && participant.kind !== 'OWNER';
}

/**
 * Somebody a link let in, whose time on this basket runs out.
 *
 * One field tells the two apart, which is why both words are derived here
 * rather than by each screen: a guest and a signed in visitor are the same case
 * to every sentence in velista `0094`, and the owner is neither.
 *
 * A **type predicate**, so the screens that go on to print the moment get it
 * narrowed rather than asserting it back. Every caller wants the date
 * immediately after asking the question, and a cast there would be the same
 * rule written twice, once in a place nothing checks.
 */
export function isLinkVisitor(
  participant: BasketParticipant
): participant is BasketParticipant & { expiresAt: Date } {
  return participant.expiresAt !== null && participant.kind !== 'OWNER';
}

/**
 * Why this reader is no longer on a basket (velista `0094`, section 2).
 *
 * `REMOVED` is somebody taking the basket back, `EXPIRED` is a visit running
 * out, and `UNKNOWN` is a refusal that named neither. `UNKNOWN` draws what
 * `REMOVED` draws, because the ordinary sentence is the safer one to be wrong
 * with: the eviction event carries no reason at all, so a socket that was swept
 * always lands here and must not claim a cause it was not told.
 */
export const BASKET_ACCESS_ENDED_REASONS = [
  'REMOVED',
  'EXPIRED',
  'UNKNOWN',
] as const;

export type BasketAccessEnded = (typeof BASKET_ACCESS_ENDED_REASONS)[number];

export const BASKET_ACCESS_ENDED_FALLBACK: BasketAccessEnded = 'UNKNOWN';

/**
 * A moment velista `0094` prints: a clock time, and the day when that time is
 * not today's.
 *
 * Two fields rather than one string because the sentences around them differ.
 * The share sheet has a key per shape ("Works until 18:40" against "Works until
 * tomorrow, 07:15") and the notices have one key that interpolates whichever
 * applies, so the join belongs to the caller and the formatting belongs here.
 */
export interface VisitMoment {
  /** "18:40", in the reader's language. */
  readonly time: string;
  /** "tomorrow", or "3 September". Null when the moment is today. */
  readonly day: string | null;
}

/**
 * When something ends, written the way section 9 asks for it.
 *
 * The day is included whenever it is not today's, so "07:15" is never ambiguous
 * to somebody who cannot glance at a clock. Tomorrow is named rather than
 * dated, through `Intl.RelativeTimeFormat` with `numeric: 'auto'`, which is the
 * one form of it a language writes as a word; anything further out takes the
 * date, because "in 2 days" is harder to act on than "5 September".
 *
 * **`Intl` and never `DatePipe`**, for `formatGeneratedDate`'s reason: the pipe
 * needs `registerLocaleData` and a `LOCALE_ID` this app never sets, because its
 * language is runtime state rather than the shell's build time locale.
 *
 * Comparing this with the device's clock decides a sentence and nothing else.
 * Whether the visit or the link has actually ended is the server's answer.
 *
 * @param now Passed in rather than read from the clock, so "tomorrow" is
 *   testable without waiting for midnight.
 */
export function formatVisitMoment(
  at: Date,
  locale: string,
  now: Date = new Date()
): VisitMoment {
  const time = formatOrIso(at, () =>
    new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(at)
  );

  const days = calendarDaysBetween(now, at);
  if (days === 0) {
    return { time, day: null };
  }

  const day =
    days === 1
      ? formatOrIso(at, () =>
          new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
            1,
            'day'
          )
        )
      : formatOrIso(at, () =>
          new Intl.DateTimeFormat(locale, {
            day: 'numeric',
            month: 'long',
          }).format(at)
        );

  return { time, day };
}

/**
 * Whole calendar days from one moment to another, in the device's own zone.
 *
 * By the calendar and not by elapsed hours, which is `isSameDay`'s reason: a
 * visit ending at one in the morning ends tomorrow even though it is four hours
 * away, and one ending at eleven tonight ends today even though it is eleven.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Format, or fall back to something ugly and true.
 *
 * `Intl` throws a `RangeError` on a tag it does not recognise, and this feeds a
 * notice drawn over a working screen: a throw here would take the screen with
 * it over a language tag.
 */
function formatOrIso(at: Date, format: () => string): string {
  try {
    return format();
  } catch {
    return at.toISOString();
  }
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
   * What the shop the basket was read at says about this product (velista `0102`;
   * backend `0163`, section 2), or null when the read named no shop.
   *
   * **The server decides the price at a shop**, from that shop's own stack of
   * scopes, so nothing here picks a scope out of {@link offers} for a shop: a row
   * with a shop chosen draws this and nothing else.
   */
  readonly atShop: BasketProductAtShop | null;
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

/**
 * One product at one shop (velista `0102`; `BasketProductAtShopView` on the wire).
 *
 * Every field can be null on its own, and each null means something different. A
 * null {@link price} is a shop that has no price for the product, which is what
 * sinks a row as "not listed" (`0078`). A null {@link available} is a shop nobody
 * has said anything about, which is most shops today and is never drawn.
 */
export interface BasketProductAtShop {
  /**
   * The scope whose price won at this shop, which is what a settle made here sends
   * as its `priceScopeId`. Null exactly when {@link price} is.
   */
  readonly priceScopeId: string | null;
  readonly price: number | null;
  readonly currency: string | null;
  /**
   * What catalog has stored about this product at this shop: true, false, or null
   * for nothing stored. **Read and never inferred**, so a chain that stocks the
   * product says nothing about this door.
   */
  readonly available: boolean | null;
}

/**
 * A shop, named for a person (velista `0102`; `BasketShopView` on the wire).
 *
 * The one model for "where somebody is buying", whichever read named it: the
 * basket's own shop, or a shop picked from the basket's scopes on this device.
 * The chain and the shop's own name stay {@link LocalizedName}s, for the reason
 * `BasketProduct.name` gives: the reader's language can change under an open page.
 */
export interface BasketShop {
  /** The `supermarket_locations` id, which is what a read and a settle send. */
  readonly id: string;
  /** The chain's id, or null where the read named the chain and not its id. */
  readonly supermarketId: string | null;
  readonly chain: LocalizedName;
  /** The shop's own name, which most shops of a chain do not have. */
  readonly label: LocalizedName | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  /**
   * Whether the shop's postal code is one of the basket owner's areas (backend
   * `0163`, section 3), or null where no read said.
   *
   * False draws "Outside your areas" wherever the shop is named. Null draws
   * nothing: a shop picked from the basket's own scopes is one of the profile's
   * shops, and the server states the fact only for a shop it was asked about.
   */
  readonly inProfile: boolean | null;
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
  /**
   * How often this row's lines were bought at the chain of the shop the read was
   * made at, or null (backend `0165`; velista `0104`).
   *
   * Null on a read with no shop, and on the row a write answers, which carries
   * none: `BasketStore` keeps the value of its last read for such a row. The
   * numbers are the server's and **never recounted here**.
   */
  readonly usual: BasketRowUsual | null;
}

/**
 * Whether and how often a row was bought at the read's chain (backend `0165`,
 * section 2).
 *
 * `bought` and `of` are averages over the row's lines, rounded by the server, so
 * a row merging three lines still says a number from 0 to 6. "Here" is the
 * **chain**: a purchase at any shop of it counts, so nothing about this names a
 * street.
 */
export interface BasketRowUsual {
  readonly state: BasketUsualState;
  /** Purchases at the read's chain, 0 to 6. Never 0 on `HERE`. */
  readonly bought: number;
  /** Purchases counted, 0 to 6. 0 only on `NEVER_BOUGHT`. */
  readonly of: number;
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

/**
 * The rows every count on the basket page is over: everything but `REMOVED`.
 *
 * **One selector, read by every count**, which is the whole of it (velista
 * `0093`, section 4). A row whose lines all left the coverage is information
 * about the basket rather than a thing to buy, so the tools bar's total, its
 * shown, the chip row's pair and "all done" each leave it out; before this each
 * of them counted array elements, and an arriving `REMOVED` row made an
 * unfiltered basket report more rows than it holds.
 *
 * It does **not** touch the progress numbers. Those are the server's
 * {@link Basket.progress}, which already excludes these rows, and this side
 * never recounts them (velista `0060`, section 4).
 *
 * By identity when nothing is dropped, which is the ordinary case: no basket
 * carries a `REMOVED` row until somebody edits a list under it, so a page that
 * asks this on every render re-renders nothing.
 */
export function countableBasketRows(
  rows: readonly BasketRow[]
): readonly BasketRow[] {
  return rows.some((row) => row.state === 'REMOVED')
    ? rows.filter((row) => row.state !== 'REMOVED')
    : rows;
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

/**
 * The product a basket row prices: what is in the trolley.
 *
 * A choice that is still one of the row's options, or the row's only option, or none.
 * One function, so the row that draws a price and the settle that names its scope
 * resolve the same product.
 */
export function basketRowProduct(
  row: Pick<BasketRow, 'optionIds'>,
  products: ReadonlyMap<string, BasketProduct>,
  chosenId: string | null
): BasketProduct | null {
  if (chosenId !== null && row.optionIds.includes(chosenId)) {
    return products.get(chosenId) ?? null;
  }
  return row.optionIds.length === 1
    ? (basketRowPick(row, products) ?? null)
    : null;
}

/**
 * A price a row draws, and the scope it was read at.
 *
 * Narrower than {@link ProductOffer} because it has two sources: the cheapest offer
 * anywhere, and a product's price at one shop, which carries a number and a scope and
 * nothing else. The row draws the number and a settle sends the scope.
 */
export interface ShownPrice {
  readonly price: number;
  readonly currency: string | null;
  readonly priceScopeId: string;
}

/**
 * The price a basket row draws for its product (velista `0078`, section 5; `0102`).
 *
 * **The shop's**, when the rows are priced at one: the product's `atShop`, which the
 * server decided from that shop's stack. The cheapest at the run's scopes otherwise.
 * Null when there is no price, which draws the same blank either way.
 *
 * @param atShop Whether the rows are priced at a chosen shop, which is
 *   `basketPricedAtShop` and never a test of this product alone.
 */
export function shownOffer(
  product: BasketProduct | null | undefined,
  atShop: boolean
): ShownPrice | null {
  if (product === null || product === undefined) {
    return null;
  }
  if (atShop) {
    const here = product.atShop;
    return here === null || here.price === null || here.priceScopeId === null
      ? null
      : {
          price: here.price,
          currency: here.currency,
          priceScopeId: here.priceScopeId,
        };
  }
  const offer = product.offer;
  return offer === null || offer.price === null
    ? null
    : {
        price: offer.price,
        currency: offer.currency,
        priceScopeId: offer.priceScopeId,
      };
}

/**
 * The price scope a settle names (velista `0095`, section 6): exactly the scope of the
 * price the row drew, or undefined when it drew no price.
 *
 * Read through {@link shownOffer}, which the row draws from, so what is sent is what
 * was drawn by construction.
 */
export function shownPriceScope(
  product: BasketProduct | null | undefined,
  atShop: boolean
): string | undefined {
  return shownOffer(product, atShop)?.priceScopeId ?? undefined;
}

/**
 * Where a settle says it happened, as a body fragment to spread (velista `0102`).
 *
 * **The one place a settle body learns about a shop**, used by the row, its reel and
 * the settle sheet alike, so the three cannot disagree.
 *
 * - With a shop chosen, the shop and the scope of the price the row drew, which is
 *   the product's `atShop.priceScopeId`. The server copies the chain beside them.
 * - In "any of your shops" mode, **no shop, ever**: the scope of the cheapest price
 *   is not where the person stood, and a guess here would be counted by `0104` as a
 *   place something was bought. The scope of the price shown still travels, which
 *   is `0095`.
 *
 * @param shop The chosen shop's id, the basket's own on a basket started at one, or
 *   null for any of your shops.
 * @param atShop Whether the rows are priced at that shop (`basketPricedAtShop`).
 */
export function basketSettleShop(
  product: BasketProduct | null | undefined,
  shop: string | null,
  atShop: boolean
): { readonly priceScopeId?: string; readonly supermarketLocationId?: string } {
  const priceScopeId = shownPriceScope(product, shop !== null && atShop);
  return {
    ...(priceScopeId === undefined ? {} : { priceScopeId }),
    ...(shop === null ? {} : { supermarketLocationId: shop }),
  };
}

/**
 * What a row says about the shelf at the chosen shop (velista `0102`), or nothing.
 *
 * - `unavailable`: **every** product the row offers is known missing at this shop.
 * - `instead`: the product the row buys by default is known missing and another of
 *   its options is not, so the row offers that one and a settle buys it.
 *
 * A mark and never a move: the row keeps its place and its controls, because the
 * shelf may be restocked and the person is the one looking at it.
 */
export type BasketShelfMark =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'instead';
      /** The option the row offers in place of its default. */
      readonly optionId: string;
      /** The default it replaced, which the caption names. */
      readonly replacedId: string;
    };

/**
 * The shelf mark for one row, from the products' `atShop.available` (velista `0102`).
 *
 * **Only a stored false counts.** Unknown is never marked, because availability is
 * read and never inferred, and most shops have no record at all yet: a row with one
 * option whose shop said nothing is an ordinary row.
 *
 * Only products the read named are asked, and a product it could not name is
 * neither missing nor present. The replacement prefers an option known to be there,
 * and then one nobody has said anything about, in the server's option order.
 *
 * @param atShop Whether the products' `atShop` describes the chosen shop. False
 *   answers null for every row, which is "any of your shops" and a read in flight.
 */
export function basketShelfMark(
  row: Pick<BasketRow, 'optionIds'>,
  products: ReadonlyMap<string, BasketProduct>,
  atShop: boolean
): BasketShelfMark | null {
  if (!atShop) {
    return null;
  }

  const options = row.optionIds
    .map((id) => products.get(id))
    .filter((product): product is BasketProduct => product !== undefined);
  if (options.length === 0) {
    return null;
  }

  const missing = (product: BasketProduct) =>
    product.atShop?.available === false;
  if (options.every(missing)) {
    return { kind: 'unavailable' };
  }

  const fallback = row.optionIds[0];
  const first = fallback === undefined ? undefined : products.get(fallback);
  if (first === undefined || !missing(first)) {
    return null;
  }

  const other =
    options.find((product) => product.atShop?.available === true) ??
    options.find((product) => !missing(product));
  return other === undefined
    ? null
    : { kind: 'instead', optionId: other.id, replacedId: first.id };
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
   * The shop this basket was started at, or null (velista `0102`; backend `0163`,
   * section 1).
   *
   * **The lock is the server's fact.** It is {@link lockedShopId}, which core
   * always answers; this is that shop named, and null when catalog could not name
   * it this time. Never set on a `LIVE` basket, whose shop is a choice of the
   * device.
   */
  readonly shop: BasketShop | null;
  /**
   * The id of the shop this basket was started at, or null for a basket nobody
   * started anywhere. Set only by the request that created it, and never changed
   * by anybody after, the owner included.
   */
  readonly lockedShopId: string | null;
  /**
   * The shop this read was made at, which is the shop every product's `atShop`
   * describes, or null for a read at no shop.
   *
   * The mapper cannot know the request, so it answers {@link lockedShopId} (the
   * server always reads a started basket at its own shop), and `BasketStore`
   * stamps the device's choice on an answer it asked for with one. A view that
   * compares this with the shop it wants is how a row avoids quoting the last
   * shop's prices while the read at the next one is still out.
   */
  readonly readAt: string | null;
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
  /**
   * How many changes to the covered lists this **viewer** has not seen
   * (velista `0093`, section 5; backend `0138`, section 7).
   *
   * The banner's whole input, and the server's number: capped at 99 by the
   * gateway, where it means "this many or more", and never counting a change
   * this reader made themselves. Zero draws no banner, and it reaches zero
   * because a read said so and never because the client decremented it.
   */
  readonly unseenChangeCount: number;
  /**
   * The newest unseen change's id, which is what an acknowledgement sends as
   * `through`. Null when there is nothing unseen.
   *
   * An **id** and never a time, which is the whole of velista `0093` section 7:
   * a change that arrives between the render and the request stays unseen,
   * because the request names what was drawn rather than when it was drawn.
   */
  readonly newestUnseenChangeId: string | null;
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
  /**
   * When the link stops accepting people: {@link LINK_VISIT_HOURS} after
   * {@link createdAt} (backend `0140`, section 4).
   *
   * **Required**, unlike every other moment on this type, because the server no
   * longer mints a link without one. A link carrying no date is malformed
   * rather than open ended, and the mapper refuses it, so the share sheet can
   * never draw a URL whose end it cannot say.
   */
  expiresAt: Date;
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
  /**
   * The price scope of the offer the row was drawing (velista `0095`, section 6).
   * Absent when it drew no price, and on every `NOT_AVAILABLE`.
   *
   * **Never an amount.** No settle body carries money: the gateway reads the price
   * itself, as the basket's owner, at this scope (backend `0143`).
   */
  readonly priceScopeId?: string;
  /**
   * The shop the person is standing in (velista `0102`; backend `0163`, section 5).
   *
   * Sent on every settle made while a shop is chosen, and absent in "any of your
   * shops" mode, always. On a basket started at a shop it is that shop, and the
   * server records it when this is absent too.
   */
  readonly supermarketLocationId?: string;
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
 * Changing what one list asks for, from the basket (velista `0092`, section 6).
 *
 * **It writes to a household's list and not to this basket**, which is what
 * separates it from every other write on this screen. A settle records what the
 * shopper put in the trolley; this one says the household wants a different
 * number from now on, for everybody, on every screen the list appears on.
 *
 * So the permission behind it is the list's, asked of the **basket's owner**
 * rather than of whoever is holding the phone, and the client cannot compute it:
 * see {@link BasketRowEntry.demandEditable}.
 *
 * **Zero is allowed and is not a removal.** The line stays on its list asking
 * for nothing, which is backend `0047`'s "stocked".
 */
export interface BasketDemandRequest {
  /**
   * Which household's ask to move.
   *
   * Always sent, although the server requires it only on a row of several
   * entries: the control is drawn per entry, so the caller always knows which
   * one it is about, and a request that left it to the server's single entry
   * rule would be one entry away from moving the wrong list.
   */
  readonly lineId: string;
  /** What that list asks for from now on. Zero is allowed. */
  readonly quantity: number;
  /** The entry's `left` the person was looking at. */
  readonly from: number;
}

/**
 * A new line, added from the basket onto one of its covered lists (velista
 * `0092`, section 7).
 *
 * **`targetListId` is required, and that is the whole change from velista
 * `0053`.** A line added from the basket used to live in the basket alone, which
 * is what let a guest add one: it changed nothing shared. Every line has a list
 * now, so the add goes through that list's ordinary rules — its approval rule,
 * its audit and its merge — and the answer is whichever row it landed on, which
 * may be a row the list already held.
 */
export interface BasketAddLineRequest {
  /** A list from {@link Basket.lists}, which is one this reader holds `WRITE` on. */
  readonly targetListId: string;
  readonly content: string;
  readonly quantity: number;
  /** The product set a suggestion carried, as the list's own add takes it. */
  readonly itemIds?: readonly string[];
}

/**
 * What every write on a row answers (backend `0136`, `BasketRowResult`).
 *
 * One shape for all of them, because a client redraws one row after any of them.
 * The store folds {@link row} by its key and takes {@link progress} whole; **it
 * never patches a number**, which is the rule the whole row model rests on.
 */
export interface BasketRowResult {
  /**
   * The row as it now stands, under whatever key it now has, or null when the
   * write took it out of the basket altogether (velista `0092`, section 6.2).
   *
   * A row bought to zero is **not** that case: it stays in the view as `DONE`,
   * because the purchase that emptied it is in scope. The one write that can
   * empty a basket of a row is {@link BasketDemandRequest}, which lowers what a
   * list asks for: a row nothing asks for and nothing was bought of is not a
   * thing to buy, so it leaves the view.
   *
   * **The wire says it with a row rather than with a null.** The server answers
   * a row carrying the requested key, an empty `entries` array and zeros, which
   * `toBasketRowResult` reads as this null: the client has one question here,
   * "is there still a row", so it has one representable answer. Reading a row
   * whose every number is zero and whose state is `WANTED` as a real row would
   * put an empty line on the screen with nothing to say and nothing to press.
   */
  readonly row: BasketRow | null;
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

// --- The two surfaces one basket page draws (velista `0091`) ---------------

/**
 * Which basket a URL names: the caller's own `LIVE` one, or one by id.
 *
 * It lives in `models` rather than beside the paths that build from it, because
 * `BasketStore` holds the address of the basket it opened and a store in
 * `data-access` cannot import a feature library. The segments themselves stay in
 * `feature-shopping-lists`, where the route table's paths are written down.
 *
 * `'live'` is not an id and never becomes one. Every **request** uses
 * {@link Basket.id}, which the server hands back on the first read; this type is
 * about URLs and nothing else.
 */
export type BasketAddress = 'live' | { readonly basketId: string };

/**
 * What to put in the basket page's heading.
 *
 * Two shapes rather than a resolved string, because one of them cannot be
 * resolved without a locale: a `GENERATED` basket with no name is titled by its
 * date, which `Intl` formats in the reader's language, and this file is pure so
 * that it needs neither a translator nor a clock.
 */
export type BasketTitle =
  /** The basket's own name, and its date where it has none. */
  | { readonly kind: 'basket' }
  /** Words this app owns, with whatever they interpolate. */
  | {
      readonly kind: 'key';
      readonly key: string;
      readonly args?: Record<string, string>;
    };

/**
 * The sentence above the rows, as a key and its arguments.
 *
 * `unavailable` is carried beside them rather than folded in, because it is a
 * different claim from a purchase and the template appends it as its own clause:
 * a sentence that merged the two would report a shop that had none of something
 * as shopping done. Zero draws no clause.
 */
export interface BasketProgressSentence {
  readonly key: string;
  readonly args: Record<string, number>;
  readonly unavailable: number;
}

/** Where the back chevron goes when there is nothing to pop. */
export type BasketBackFallback = 'history' | 'home';

/**
 * Everything the basket page draws differently for a `LIVE` basket (velista
 * `0091`, section 3).
 *
 * **One computed, read by the template**, and never a `kind` check scattered
 * through it. There is one basket page and there will be one: the two kinds
 * differ in a heading, a sentence, four absent controls and two words of an
 * empty state, which is a view model rather than a second screen.
 */
export interface BasketSurface {
  readonly title: BasketTitle;
  /** One line under the heading, or null where the kind has nothing to explain. */
  readonly hintKey: string | null;
  readonly progress: BasketProgressSentence;
  /** Whether to offer ending the trip. Never on a basket that is never finished. */
  readonly finish: boolean;
  /** Whether to ask "all done?", which is all the last settle does. */
  readonly allDone: boolean;
  /** Whether to draw the finished banner and, for the owner, Reopen. */
  readonly finishedBanner: boolean;
  /** Whether faces and the people glyph are drawn at all. */
  readonly presence: boolean;
  /** Whether the share and people entries are offered. The owner's, on both. */
  readonly share: boolean;
  readonly emptyTitleKey: string;
  readonly emptyBodyKey: string;
  readonly back: BasketBackFallback;
}

/**
 * The sentence above the rows, for either kind (section 4).
 *
 * A `GENERATED` basket counts a trip that has an end, so "3 of 12 got" is the
 * progress through it. A `LIVE` basket has no end: its `done` runs over the
 * current shopping session alone (backend `0130`, section 4), so "3 of 40 got"
 * would be true and would read as a failure. It says what is **left** first,
 * because that is the question the screen exists to answer.
 *
 * Every number is the server's. "This trip" is the session the server computed,
 * by the six hour gap and by its own clock, and nothing here decides where one
 * session ends.
 *
 * The fourth case, nothing left and nothing got, is a basket whose every row the
 * shop had none of. It says "0 to buy" beside the unavailable clause, which is
 * the honest pair: "nothing got this trip" would be a sentence about a trip that
 * did happen.
 */
export function basketProgressSentence(
  kind: BasketKind,
  progress: BasketProgress,
  pending: number
): BasketProgressSentence {
  const unavailable = progress.unavailable;

  if (kind === 'GENERATED') {
    return {
      key: 'basket.progress',
      args: { done: progress.done, total: progress.total },
      unavailable,
    };
  }

  const done = progress.done;

  if (pending > 0) {
    return done > 0
      ? { key: 'basket.live.leftAndGot', args: { pending, done }, unavailable }
      : { key: 'basket.live.left', args: { pending }, unavailable };
  }

  return done > 0
    ? { key: 'basket.live.allGot', args: { done }, unavailable }
    : { key: 'basket.live.left', args: { pending }, unavailable };
}

/**
 * The page, by the kind of basket it is drawing (section 3).
 *
 * `me` is the reader's own participant row, which decides the three things that
 * are the owner's: finishing, the prompt that offers it, and sharing.
 *
 * **A kind this build does not recognise is drawn as `LIVE`**, with the
 * `GENERATED` title. That is rule D4's least capable surface: everything it
 * withholds is a control that would change a basket, and a heading falling back
 * to a name the basket may not have is a heading rather than a write.
 */
export function selectBasketSurface(
  basket: Basket,
  me: BasketParticipant
): BasketSurface {
  const generated = basket.kind === 'GENERATED';
  const owner = me.kind === 'OWNER';
  const open = isOpenBasket(basket.status);

  return {
    // The one column an unrecognised kind does **not** take from `LIVE`: a
    // heading is not a control, and a basket's own name is the more useful of
    // the two whenever the basket has one.
    title:
      basket.kind === 'LIVE' ? liveTitle(basket, owner) : { kind: 'basket' },
    hintKey: generated ? null : 'basket.live.hint',
    progress: basketProgressSentence(
      basket.kind,
      basket.progress,
      basket.pending
    ),
    finish: generated && owner && open,
    allDone:
      generated &&
      owner &&
      open &&
      // The rows somebody is working through, which is what "all done" is
      // about: a basket holding nothing but rows that left its coverage has
      // nothing to congratulate anybody for (velista `0093`, section 4).
      countableBasketRows(basket.rows).length > 0 &&
      // The server's count, never a subtraction here: a `SKIPPED` row is
      // pending, and this side has no way to know that.
      basket.pending === 0,
    finishedBanner: generated && !open,
    presence: generated,
    share: owner,
    emptyTitleKey: generated ? 'basket.empty' : 'basket.live.empty',
    emptyBodyKey: generated ? 'basket.emptyHint' : 'basket.live.emptyHint',
    back: generated && owner ? 'history' : 'home',
  };
}

/**
 * "Everything to buy", or whose everything it is.
 *
 * The owner's name comes from their **participant row**, which is the only place
 * this screen has one, and a basket whose owner has neither a display name nor a
 * username is titled as though the reader owned it: a heading reading
 * "undefined: everything to buy" is worse than one that is merely less specific.
 */
function liveTitle(basket: Basket, owner: boolean): BasketTitle {
  if (owner) {
    return { kind: 'key', key: 'basket.live.title' };
  }

  const holder = basket.participants.find((person) => person.kind === 'OWNER');
  const name = holder?.displayName ?? holder?.username ?? '';

  return name === ''
    ? { kind: 'key', key: 'basket.live.title' }
    : { kind: 'key', key: 'basket.live.titleOf', args: { name } };
}

/**
 * The three numbers the dashboard card draws, with no rows behind them
 * (`GET /v1/baskets/live/summary`).
 *
 * Its own read rather than the whole basket with its rows dropped, because the
 * card must not pay for a thousand rows and a catalog composition to draw one
 * sentence.
 */
export interface LiveBasketSummary {
  readonly id: string;
  readonly progress: BasketProgress;
  /** `total - done - unavailable`, by the server, as {@link Basket.pending} is. */
  readonly pending: number;
}
