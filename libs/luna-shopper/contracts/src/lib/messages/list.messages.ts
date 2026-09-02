import type {
  CommentTranscription,
  LineApprovalStatus,
  ListPermission,
  SettlementOutcome,
} from '../enums/list.enums';
import type { PageQuery, Paginated } from '../pagination';

/**
 * Shopping list, line, and comment message contracts (plan 0007). The gateway
 * calls these on core; core authorizes each against its own membership and
 * list-access tables using the resolved `userId`.
 */
export const LIST_PATTERNS = {
  create: 'list.create',
  setAccess: 'list.setAccess',
  getAccess: 'list.getAccess',
  update: 'list.update',
  delete: 'list.delete',
  list: 'list.list',
  /**
   * Which lists still want a given product (plan 0053, section 3). Answers the
   * "this is also on" indicator a line screen draws.
   *
   * It lives beside the list reads rather than beside the line ones because the
   * answer is a set of **lists**: the line that carries the product is how the
   * question is asked, not what it is about.
   */
  holdingItem: 'list.holdingItem',
} as const;

export const LINE_PATTERNS = {
  add: 'line.add',
  addMany: 'line.addMany',
  update: 'line.update',
  addQuantity: 'line.addQuantity',
  setApproval: 'line.setApproval',
  /**
   * Say what happened to a line on a trip (plan 0047, section 4). It replaced
   * `line.setStatus`, which moved a line between trip states a zone line no
   * longer carries.
   */
  settle: 'line.settle',
  /** One line's own settlements, newest first (plan 0047, section 6.1). */
  settlements: 'line.settlements',
  /**
   * One product's settlements across every list the caller can read (plan 0047,
   * section 6.2). Keyed on the settlement's own copied `itemId`, never on a join
   * through lines whose product set may have moved since.
   */
  itemSettlements: 'line.itemSettlements',
  reorder: 'line.reorder',
  delete: 'line.delete',
  list: 'line.list',
} as const;

/**
 * The bounds a line's quantity has to satisfy, stated once (plan 0040, section
 * 3.5).
 *
 * The ceiling used to live only in the gateway DTO, which was survivable while
 * every write carried an absolute value the gateway had already checked. A delta
 * is computed **inside core**, so core is now the only place that can check the
 * result, and a bound written in two files is a bound that disagrees with itself
 * the first time one of them moves.
 */
/**
 * Zero, since plan 0047: a line at zero is a line the household knows about and
 * does not currently need, and it is the state the primary gesture on the list
 * page moves lines into. It used to be one, from when a line was a thing you
 * ticked off and a quantity of nothing was meaningless.
 *
 * **Zero is not deleted** (section 2.2). Deleting is a separate, confirmed
 * gesture and it is the only thing that discards the history, which is the whole
 * reason the model works.
 */
export const LINE_QUANTITY_MIN = 0;
export const LINE_QUANTITY_MAX = 100000;

/**
 * How many lines one `line.addMany` may carry (plan 0040, section 6.1).
 *
 * A bound rather than a budget: fifty is well past any spoken sentence and past
 * any plausible paste, and its job is to stop one request writing an unbounded
 * number of rows.
 */
export const LINE_BATCH_MAX_ITEMS = 50;

/**
 * How many products one line's set may hold (plan 0048, section 1.1).
 *
 * A bound rather than a budget, like the batch above it. Picking a group copies
 * that group's members onto the line, and a group is a few dozen products at
 * most; a request naming more than this is a client bug or an attempt to write an
 * unbounded number of join rows from one call.
 */
export const LINE_ITEM_SET_MAX = 100;

export const COMMENT_PATTERNS = {
  add: 'comment.add',
  list: 'comment.list',
  /**
   * A comment that is a recording (plan 0045). Its own subject rather than a
   * second shape on `comment.add`, for the reason section 3 gives about the
   * route: the typed path is the busiest write in the product and it is left
   * untouched.
   */
  addVoice: 'comment.addVoice',
  /** The bytes back, gated on `READ` of the comment's list (plan 0045, section 5). */
  getAudio: 'comment.getAudio',
  /**
   * The transcript, once the assistant has produced one (plan 0045, section 4.1).
   *
   * Called by the gateway after it has already answered the caller, which is what
   * makes a provider outage cost a transcript and never a message.
   */
  setTranscription: 'comment.setTranscription',
} as const;

/** The counts shown alongside a full list (plan 0017, section 3.4). */
export interface ListCounts {
  /** Every line, whatever its approval or its quantity. */
  lineCount: number;
  /**
   * Lines with a quantity above zero: what the household wants right now (plan
   * 0047, section 2.3).
   *
   * It was `readyCount`, counting lines marked ready on some trip, and that is
   * the number a zone card should never have been showing: "four things needed"
   * is the useful figure and "four things already bought" never was. **Lines and
   * not units**, because a card has room for "4 things needed" and not for "17
   * units needed" (section 9).
   */
  wantedCount: number;
}

export interface ListView {
  id: string;
  zoneId: string;
  name: string;
  createdByUserId: string;
  /**
   * The line totals. Field names match `ZoneListPreview` deliberately, so the
   * frontend maps one shape whichever endpoint it came from (plan 0017, 3.4).
   */
  counts: ListCounts;
  /**
   * Whether a new line on this list is approved the moment it is added (plan
   * 0037, section 3). Configuration rather than a preference: changing it needs
   * `MANAGE`, and it governs only what a **new** line starts as.
   */
  autoApproveLines: boolean;
  /**
   * Whether every approved member of the zone may use this list, including
   * people who join later (plan 0042, section 2.1).
   *
   * State on the list rather than the one time action `shareWithZone` used to
   * be. `create` stores it, `update` may change it with `MANAGE`, and it is what
   * the approval path reads to decide what a new member is granted. Turning it
   * off revokes nobody: it governs who arrives next, and removing one person is
   * a row in the share sheet (section 2.2).
   */
  sharedWithZone: boolean;
  /**
   * What the **caller** may do on this list (plan 0036, section 7), including the
   * derived grant a zone OWNER or ADMIN holds on every list in the zone.
   *
   * It rides here rather than on a request of its own because it is per caller
   * data about a resource the caller is already fetching, and two round trips
   * could disagree for exactly as long as it took. It is what lets the client
   * stop offering controls and discovering from a refusal which of them existed.
   */
  myPermissions: ListPermission[];
  /** ISO 8601 UTC (plan 0017, section 7). */
  createdAt: string;
  /** ISO 8601 UTC (plan 0017, section 7). */
  updatedAt: string;
}

/**
 * One membership's stored permissions on one list.
 *
 * An **empty array means no access**, and `setAccess` stores it by deleting the
 * row rather than by writing an empty set (plan 0036, section 2.2). Group staff
 * never appear as an entry: their grant is derived from `ZoneRole` and there is
 * nothing stored to return or to revoke (section 2.4).
 */
export interface ListAccessEntry {
  membershipId: string;
  permissions: ListPermission[];
}

/** The stored access table for one list, as `GET /v1/lists/:id/access` returns it. */
export interface ListAccessView {
  listId: string;
  entries: ListAccessEntry[];
}

export interface LineView {
  id: string;
  listId: string;
  content: string;
  /**
   * How many of this the household wants **right now** (plan 0047, section 1).
   *
   * The line's only state: buying decrements it, zero means you are stocked, and
   * the line stays where it is until somebody deletes it on purpose. There is no
   * trip status beside it any more, because `READY` was a fact about one shopping
   * trip written onto a record that outlives every trip.
   */
  quantity: number;
  /**
   * The products this line stands for (plan 0048, section 1.1), in the order they
   * were attached. Empty for a free text line, which stays first class.
   *
   * It replaced a single nullable `itemId` that was null on every line ever
   * created. Picking a group in the composer **copies the group's members here**
   * and the line references no group afterwards, so removing a product the
   * household never buys is an ordinary edit: a line is its own hand made group.
   */
  itemIds: string[];
  /**
   * A digest of the sorted distinct {@link itemIds}, or null while the set is
   * empty (plan 0048, section 1.1).
   *
   * What makes the hand made sets legible. Two lines carrying the same products
   * carry the same hash **however the products got there**, which is what the
   * dedup rule in `0050` merges on and what the cross list indicator in velista
   * `0043` matches on.
   */
  itemSetHash: string | null;
  position: number;
  approvalStatus: LineApprovalStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  version: number;
  /**
   * How many `BOUGHT` settlements this line has ever had (plan 0047, section 5).
   *
   * Here, on the line, because it is half of an indicator the list page draws on
   * every row and neither half is computable from anything else the line carries.
   * `quantity = 0` alone cannot tell a thing the household has just bought from a
   * thing somebody typed and has never needed, and those two rows are drawn
   * differently on purpose (velista `0043`, section 3.2). The alternative was a
   * settlements read per row, which is a request per line to answer a question the
   * page asks about all of them at once.
   *
   * A **count** rather than a boolean, because the two readings are the same width
   * on the wire and the number is the one that survives the next question. It is
   * cumulative and never resets: a line bought, run down to zero and bought again
   * has two, and a settled line put back up to three still has them.
   */
  boughtCount: number;
  /**
   * The outcome of this line's most recent settlement, or null when it has none.
   *
   * The other half of the indicators, and the reason it is the **most recent** one
   * rather than a flag: "they did not have it" is a fact about the last trip and
   * expires the moment somebody does buy it, so it cannot be stored and has to be
   * read off the top of the history (plan 0047, section 5).
   */
  lastSettlementOutcome: SettlementOutcome | null;
  /**
   * Whether somebody is out buying this right now (plan 0052, section 4).
   *
   * The third indicator plan 0047 section 5 lists, and the one that could not be
   * derived from the line's own history: the line is carried by a basket that has
   * been composed and not yet finished, so putting it in a second trolley buys the
   * household two of it.
   *
   * It is **state on the line and not only an event**, which is the correction
   * plan 0052 makes to plan 0051. An event tells a connected client what changed
   * and tells a client that connects afterwards nothing at all, and a shopping
   * trip lasts an hour while a phone sleeps in a pocket. Announced as well as
   * read, exactly like {@link boughtCount}, so a reconnect and a live socket agree.
   *
   * **Derived on read and stored nowhere.** A flag on the line would have to stay
   * correct across basket deletion, account deletion, a trip nobody ever took and
   * a line carried by two baskets at once, and every one of those is a way to
   * leave a line claimed by a basket that no longer exists.
   */
  claimed: boolean;
  /**
   * Who is out buying it: the basket's **owner**, or null.
   *
   * The owner and never the participant holding the line (plan 0052, section 2). A
   * basket shared with three guests is still one person's trip from the
   * household's point of view, and naming a guest to a zone member would disclose
   * a participant of a private basket to somebody who is not on it. "Ana is buying
   * this" is true when Ana's guest is the one in the shop.
   *
   * Null on an unclaimed line, and **also** null on a claimed one whose owner has
   * since left the zone (section 6): the line still reports `claimed`, without a
   * name. Access is resolved at request time everywhere else here and this is the
   * same rule, so a zone a person left takes their name with it.
   */
  claimedByUserId: string | null;
  /** ISO 8601 UTC (plan 0017, section 7). */
  createdAt: string;
  /** ISO 8601 UTC (plan 0017, section 7). */
  updatedAt: string;
}

/**
 * What one line's settlements say about it, as the line read derives it.
 *
 * The two fields {@link LineView} carries, named together so the query that
 * computes them for a whole page and the mapper that writes them onto one line
 * agree by type rather than by argument order.
 */
export interface LineSettlementSummary {
  boughtCount: number;
  lastOutcome: SettlementOutcome | null;
}

/** A line with no settlements at all, which is every line the moment it is added. */
export const NO_LINE_SETTLEMENTS: LineSettlementSummary = {
  boughtCount: 0,
  lastOutcome: null,
};

/**
 * Whether a line is in somebody's live basket, as the line read derives it.
 *
 * The two fields {@link LineView} carries, named together for the same reason
 * {@link LineSettlementSummary} is: the query that answers them for a whole page
 * and the mapper that writes them onto one line agree by type rather than by
 * argument order.
 *
 * The pair is not one nullable field, and that is section 6 of plan 0052 rather
 * than an oversight. `claimed` without a `claimedByUserId` is a real state, and
 * collapsing the two would make a claim whose owner has left the zone
 * indistinguishable from no claim at all.
 */
export interface LineClaim {
  claimed: boolean;
  claimedByUserId: string | null;
}

/** A line nobody is out buying, which is every line most of the time. */
export const NO_LINE_CLAIM: LineClaim = {
  claimed: false,
  claimedByUserId: null,
};

/** One zone line named by a claim change, with the list that holds it. */
export interface LineClaimRef {
  lineId: string;
  listId: string;
}

/**
 * A line is, or is no longer, in somebody's live basket (plan 0052), on the
 * **zone** room. The payload of {@link RealtimeEvent.LineClaimChanged}.
 *
 * ## What it may say, which is very little
 *
 * That a line is claimed and whose it is. Not what else is in the basket, not
 * where they are shopping, not what it costs, and **not the generated list id**.
 * That last omission is the load bearing one: an id in a payload is an invitation
 * for a client to fetch it, and the refusal would then be the only thing standing
 * between a zone member and somebody else's basket. The event names a person, not
 * a basket.
 *
 * ## Why it names many lines and not one
 *
 * A run takes every wanted line of every list it drew from, and a per line fan out
 * of a hundred events into a household room is a self inflicted problem (section
 * 3.1). One event per zone room carries the whole burst, and the single line
 * transitions use the same shape with one entry rather than a second payload that
 * could drift from this one.
 *
 * The zone is the room's own addressing and rides the envelope as well; the list
 * is per line, because one basket draws from several lists of one zone at once.
 */
export interface LineClaimChangedEvent {
  zoneId: string;
  /** Whether the lines named are now claimed. False is a release. */
  claimed: boolean;
  /** The basket's owner, or null on a release and on a name the reader may not have. */
  claimedByUserId: string | null;
  lines: LineClaimRef[];
}

/**
 * What a recording on a comment weighs and how long it runs (plan 0045).
 *
 * It lives on the comment and not on the audio row, so a comment listing can draw
 * a player without the bytes ever entering the query: the whole point of keeping
 * `comment_audio` in its own table (section 2).
 */
export interface CommentRecording {
  /** What the browser recorded in, from the accepted list. */
  contentType: string;
  /** The stored size. The only number anything enforces on. */
  byteLength: number;
  /**
   * What the client said it lasts, or null when it said nothing.
   *
   * **Never trusted** (section 6). It is metadata for drawing a row before the
   * file is fetched; nothing authorizes on it and nothing rejects on it.
   */
  durationSeconds: number | null;
}

export interface CommentView {
  id: string;
  lineId: string;
  authorUserId: string;
  /**
   * The comment's text, which for a voice comment is its transcript.
   *
   * **It can be empty**, which every reader has to hold (plan 0045, section 4.2):
   * a comment whose transcription failed is a valid comment, and the client draws
   * a neutral phrase in its place rather than an empty bubble.
   */
  body: string;
  /** The recording, when this comment is one. Null for a typed comment. */
  recording: CommentRecording | null;
  /** How far the transcript got. Null for a typed comment, which has no transcript. */
  transcription: CommentTranscription | null;
  createdAt: string;
}

/** The bytes, base64 encoded for the broker (plan 0045, section 3). */
export interface CommentAudioView {
  commentId: string;
  contentType: string;
  /** Base64. It is decoded once, at the gateway, on the way to the caller. */
  audio: string;
}

export interface CreateListRequest {
  userId: string;
  zoneId: string;
  name: string;
  /**
   * Give every approved member of the zone access to the new list (plan 0034).
   *
   * **Optional, and absent means true.** A list nobody but its creator can open is
   * the rarer thing somebody chooses on purpose, and the field was added after
   * clients existed that do not send it; both point the default the same way. So an
   * older client keeps getting the shared list it has no way to ask for, rather than
   * silently starting to create private ones the moment this shipped.
   */
  shareWithZone?: boolean;
}

export interface SetListAccessRequest {
  userId: string;
  listId: string;
  entries: ListAccessEntry[];
}

export interface UpdateListRequest {
  userId: string;
  listId: string;
  name?: string;
  /** Turn approval on a new line on or off (plan 0037, section 3). `MANAGE`. */
  autoApproveLines?: boolean;
  /**
   * Open the list to its zone, or stop opening it (plan 0042, section 2.1).
   * `MANAGE`.
   *
   * Turning it **on** grants `{READ, WRITE, DECIDE}` to every currently approved
   * non staff member, exactly as creation does, widening rather than replacing
   * what anybody already holds. Turning it **off** revokes nobody.
   */
  sharedWithZone?: boolean;
}

/** Read a list's stored access table (plan 0036, section 6). `MANAGE` only. */
export interface GetListAccessRequest {
  userId: string;
  listId: string;
}

/**
 * The caller's own permissions on one list changed (plan 0036, section 8).
 *
 * Addressed to the person behind the membership rather than to the list room,
 * because the room event names nobody and, by construction, cannot reach the one
 * person it most needs to: somebody who has just been **granted** access was
 * never in the room to hear it.
 *
 * An empty `permissions` is somebody who has just lost the list entirely.
 */
export interface ListMyAccessChangedEvent {
  listId: string;
  zoneId: string;
  permissions: ListPermission[];
}

export interface ListIdRequest {
  userId: string;
  listId: string;
}

export interface ListListsRequest extends PageQuery {
  userId: string;
  zoneId: string;
}

export interface AddLineRequest {
  userId: string;
  listId: string;
  content: string;
  quantity?: number;
  /**
   * The products this line stands for (plan 0048, section 1.1). Opaque references
   * into the catalog, validated as UUIDs in application code and never a database
   * foreign key: catalog is a separate service with its own database and core
   * never joins to it.
   *
   * Absent or empty is a free text line, which is deliberately still the ordinary
   * case: typing something and ignoring the dropdown adds a plain line.
   */
  itemIds?: string[];
}

/** One line of a {@link AddLinesRequest} batch (plan 0040, section 6.5). */
export interface AddLinesItem {
  content: string;
  quantity?: number;
  /** The same product set {@link AddLineRequest} carries. */
  itemIds?: string[];
}

/**
 * Add up to {@link LINE_BATCH_MAX_ITEMS} lines in one transaction (plan 0040,
 * section 6).
 *
 * **All or nothing**, and the response is the created lines in request order.
 * Nothing that can fail for one item can succeed for its neighbour: access is a
 * property of the list and the caller, the approval rules are a property of their
 * permissions and the list's `autoApproveLines`, and the per item bounds have
 * already produced a 400 for the whole request at the gateway. So a per item
 * result envelope would be a new response idiom describing a partial failure the
 * design cannot produce.
 *
 * **It adds, and it does not merge** (section 6.3). Two items naming the same
 * thing produce two lines: merging is a decision about a person's intention, and
 * the caller pasting a list may well have meant two entries. The upsert rule
 * belongs to the assistant, which is where it lives.
 */
export interface AddLinesRequest {
  userId: string;
  listId: string;
  items: AddLinesItem[];
}

export interface UpdateLineRequest {
  userId: string;
  lineId: string;
  content?: string;
  quantity?: number;
  /**
   * Replace the line's product set (plan 0048, section 1.1). An empty array
   * clears it and returns the line to free text.
   *
   * A whole set and not an add or a remove, for the same reason `reorder` takes
   * the whole order: the client holds the set it is drawing, and two callers
   * trimming different products from one line should race over a value somebody
   * chose rather than compose into a set neither of them meant.
   */
  itemIds?: string[];
}

/**
 * Add units to a line, or take them off, without reading it first (plan 0040,
 * section 3).
 *
 * `delta` is a non zero integer and the **resulting** quantity is what
 * {@link LINE_QUANTITY_MIN} and {@link LINE_QUANTITY_MAX} apply to. It is
 * arithmetic in front of the edit that already exists, so it introduces no new
 * permission, no new transition and no new event: an approved line's quantity
 * still moves only for a caller holding `DECIDE`, adding to a rejected line still
 * returns it to `PENDING`, and a negative delta on an approved line still splits
 * the remainder exactly as an absolute lowering does.
 *
 * A negative delta is allowed on purpose (section 3.3). Refusing one would leave
 * "one less" as the single thing a caller still has to do with a read and a
 * write, which is precisely the lost update this message exists to remove.
 */
export interface AddLineQuantityRequest {
  userId: string;
  lineId: string;
  delta: number;
}

export interface SetLineApprovalRequest {
  userId: string;
  lineId: string;
  approvalStatus: LineApprovalStatus;
}

/**
 * Say what happened to one line on a trip (plan 0047, section 4).
 *
 * `BOUGHT` writes a settlement for the units bought and decrements the line by
 * that many, floored at zero. `NOT_AVAILABLE` writes a settlement of quantity
 * zero and moves nothing. Skipping is **not a value here**: it writes nothing at
 * all, so it is the absence of a call rather than an outcome.
 *
 * Nothing about settling is terminal (section 4.1). Asking for three and buying
 * two decrements to one and leaves the line wanted, and a second settle later
 * takes it the rest of the way, which is what lets a basket be worked through two
 * shops in one afternoon.
 */
export interface SettleLineRequest {
  userId: string;
  lineId: string;
  outcome: SettlementOutcome;
  /**
   * The units bought. Required for `BOUGHT`, and refused for `NOT_AVAILABLE`,
   * whose settlement is always zero.
   *
   * It may exceed what the line asks for (section 4.2): buying three of a line
   * that says two decrements to zero and records a settlement of three, because
   * the extra unit is real and belongs in the consumption history even though it
   * has no demand left to satisfy. A settlement clamped to the outstanding demand
   * would quietly under report what the household goes through.
   */
  quantity?: number;
  /**
   * The product actually bought, when the caller said which (plan 0047, section
   * 3.2). It is **copied onto the settlement** rather than joined later, because
   * a line's product set can change afterwards and the settlement must not move
   * with it.
   *
   * It has to be one of the line's own products. Absent is the honest answer for
   * a free text line and for a caller that did not say.
   */
  itemId?: string;
}

/**
 * One origin line, touched by one settling act (plan 0047, section 3).
 *
 * `generatedListLineId` is stored and **never served**: which basket a purchase
 * came out of is the one thing a settlement does not tell the list (section 3.1).
 * The purchase itself is a zone fact, readable by anybody who can read the list.
 */
export interface LineSettlementView {
  id: string;
  lineId: string;
  listId: string;
  /** The exact product bought, or null for a free text line (section 3.2). */
  itemId: string | null;
  outcome: SettlementOutcome;
  /** Units bought, and 0 for `NOT_AVAILABLE`. */
  quantity: number;
  /**
   * Who settled it, and **null when a shared basket did** (plan 0051,
   * section 6).
   *
   * Null does not mean nobody. It means the settle came off a basket, where the
   * actor is a participant rather than a user and may be a guest with no account
   * at all. The participant id is deliberately **not** served here, for the same
   * reason `generatedListLineId` is not: a participant id is meaningless to a
   * zone reader who cannot resolve it, and serving one would hand the zone a
   * handle on a private basket's membership in exchange for nothing.
   *
   * What a zone reader learns from a null is that somebody shopping on a basket
   * got it, which is the disclosure plan 0051 section 5.3 already makes
   * deliberately and plan 0050 section 8 already called acceptable.
   */
  settledByUserId: string | null;
  /** ISO 8601 UTC. */
  settledAt: string;
  /**
   * When somebody took this settlement back, or null while it stands (plan
   * 0054, section 3.3).
   *
   * A reopen does not delete the row. A reverted settlement is **excluded from
   * every consumption total** and is **still served here, marked**, because
   * "somebody said they got this and then took it back" is a truer history than
   * a gap. The alternative, a compensating row with a negative quantity, would
   * make every existing sum over `quantity` wrong until it was taught about
   * signs; a nullable timestamp changes each of those by one `WHERE` clause.
   *
   * Null on every row written before that plan, and on every row a settle
   * writes. Who reverted it is a participant id and is deliberately not served,
   * for the reason {@link settledByUserId} explains: it is meaningless to a zone
   * reader who cannot resolve it.
   */
  revertedAt: string | null;
}

/**
 * What one settle did: the line as it now stands, and the settlement that moved
 * it (plan 0047, section 8).
 *
 * Both halves, because neither is derivable from the other: the line carries the
 * new quantity and the settlement carries an id and a time nothing else can
 * guess. A phone in the shop and a phone at home agree from this without a
 * refetch, which is why it is also the payload of
 * {@link RealtimeEvent.LineSettled}.
 */
export interface LineSettlementResult {
  line: LineView;
  settlement: LineSettlementView;
}

/** One line's own settlements, newest first (plan 0047, section 6.1). `READ`. */
export interface ListLineSettlementsRequest extends PageQuery {
  userId: string;
  lineId: string;
}

/**
 * One product's settlements across every list the caller can read (plan 0047,
 * section 6.2).
 *
 * Restricted to those lists **at request time**, the same rule everything else
 * here uses: a zone you have left takes its history with it (section 9). It is
 * what makes "you buy this about every eleven days" a useful number rather than a
 * per list fragment, and it is what pays for the settlement's own copied
 * `itemId`.
 */
export interface ListItemSettlementsRequest extends PageQuery {
  userId: string;
  itemId: string;
}

/** How much one {@link LIST_PATTERNS.holdingItem} read may answer with. */
export const LIST_HOLDING_ITEM_LIMITS = {
  /**
   * A ceiling, not a page size, and the read is deliberately not paginated.
   *
   * What it feeds is an indicator on a line screen: "also on Weekly shop and
   * Flat 3B". Nobody reads the twenty first entry, and a cursor would turn a
   * caption into a listing of every list a person can read that happens to want
   * milk, which is the search this is not. Past the cap the answer says there are
   * more rather than offering to enumerate them.
   */
  maxLists: 20,
} as const;

/**
 * Which lists still want a product, for one caller (plan 0053, section 3).
 *
 * Restricted to the lists this caller may read **at request time**, the same rule
 * {@link ListItemSettlementsRequest} applies and for the same reason: a zone you
 * have left takes its lists with it (plan 0047, section 9). It is the same
 * privacy question and it gets the same answer.
 *
 * **Items only, never groups** (plan 0053, section 6). A line references no group
 * once the composer has copied its members, and answering for a group would need
 * a rule for partial overlap that nothing yet asks for. A client holding a line
 * with several products asks once per product and merges.
 *
 * The item id is required and must name a product. A line carrying **no** product
 * has no question to ask here and is refused rather than answered with an empty
 * array: "this is on no other list" and "there was nothing to look for" are
 * different, and velista `0047` section 5 draws them differently.
 */
export interface ListsHoldingItemRequest {
  userId: string;
  itemId: string;
  /**
   * The list the caller is asking *from*, left out of the answer.
   *
   * Null or absent asks about every readable list, which is what a basket line
   * wants: it belongs to no single list, so there is nothing to exclude.
   */
  excludeListId?: string | null;
}

/** One list that still wants the product, named for a caption. */
export interface ListHoldingItemView {
  listId: string;
  /** The list's own name, e.g. "Weekly shop". */
  name: string;
  zoneId: string;
  /** The zone it belongs to, e.g. "Flat 3B". */
  zoneName: string;
  /** How many of the product that list is still asking for. */
  quantity: number;
}

/**
 * The lists holding the product, most recently touched first.
 *
 * An explicit `hasMore` rather than a cursor, because
 * {@link LIST_HOLDING_ITEM_LIMITS.maxLists} is a ceiling and not a page: the
 * caption says "and 3 more" and stops. An **empty** `lists` is a real answer and
 * means no other readable list wants this, which is exactly the thing the client
 * could not previously tell apart from not having asked.
 */
export interface ListsHoldingItemResult {
  lists: ListHoldingItemView[];
  /** Whether the cap cut the answer short. */
  hasMore: boolean;
}

export interface ReorderLinesRequest {
  userId: string;
  listId: string;
  orderedLineIds: string[];
}

export interface DeleteLineRequest {
  userId: string;
  lineId: string;
}

export interface ListLinesRequest extends PageQuery {
  userId: string;
  listId: string;
}

export interface AddCommentRequest {
  userId: string;
  lineId: string;
  body: string;
}

export interface ListCommentsRequest extends PageQuery {
  userId: string;
  lineId: string;
}

/**
 * Leave a comment that is a recording (plan 0045, section 4).
 *
 * There is no `body`: the transcript arrives later through
 * {@link COMMENT_PATTERNS.setTranscription}, and a comment with no body is a
 * valid comment in the meantime. Sending a guess at the words here would be the
 * one thing section 4 forbids.
 */
export interface AddVoiceCommentRequest {
  userId: string;
  lineId: string;
  /** Base64, because this crosses the broker (plan 0041, section 4.2). */
  audio: string;
  contentType: string;
  /** What the client claims it lasts, or null. Metadata only (section 6). */
  durationSeconds: number | null;
}

export interface GetCommentAudioRequest {
  userId: string;
  commentId: string;
}

/**
 * Fill in a voice comment's transcript, or record that it has none.
 *
 * `userId` is the comment's author and core checks it, so this cannot be used to
 * write words into somebody else's message even from inside the cluster. It only
 * ever moves a comment out of {@link CommentTranscription.PENDING}: a second call
 * on a settled comment changes nothing, which makes the gateway's retry safe.
 */
export interface SetCommentTranscriptionRequest {
  userId: string;
  commentId: string;
  /** Empty for every state but {@link CommentTranscription.READY}. */
  body: string;
  transcription: CommentTranscription;
}

/**
 * What a deployment accepts for a voice comment, unless its configuration says
 * otherwise (plan 0045, section 6; plan 0041, section 3.3).
 *
 * These are the defaults and the single place the numbers are written down; the
 * gateway and core both read their own configuration and fall back to here, so a
 * deployment can tighten them and neither service can hold a different idea of
 * what the other enforces.
 *
 * The list is what browsers actually produce through `MediaRecorder` (Chrome
 * gives WebM/Opus and will not negotiate Ogg, Firefox gives Ogg/Opus, Safari
 * gives MP4/AAC) plus the plain containers a provider documents. Anything else is
 * refused with a sentence rather than a stack trace, because "your browser
 * recorded in a format we cannot read" is a real thing that happens on some
 * device nobody tested.
 *
 * Parameters are stripped before the check, so `audio/webm;codecs=opus` is
 * `audio/webm`. The codec inside the container is not something this layer can
 * verify from a header anyway, so matching on it would be theatre.
 */
export const VOICE_COMMENT_CONTENT_TYPES: readonly string[] = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
  'audio/flac',
] as const;

/**
 * The byte cap, matching plan 0041's ceiling so one number governs both voice
 * features. Speech grade Opus is roughly two kilobytes a second, so this is a
 * long way past the sixty seconds velista 0039 lets somebody record.
 *
 * Enforced twice, at the multipart interceptor and again in core, for plan 0041
 * section 5's reason: a cap that is not on the interceptor is not a cap.
 */
export const VOICE_COMMENT_MAX_BYTES = 2 * 1024 * 1024;

/** Normalises a content type for the allowlist check: lowercase, no parameters. */
export function baseContentType(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

export type ListPage = Paginated<ListView>;
export type LineSettlementPage = Paginated<LineSettlementView>;
export type LinePage = Paginated<LineView>;
export type CommentPage = Paginated<CommentView>;

/** Orders a caller may choose for lists and lines (plan 0007, section 3). */
export const LIST_ORDERS = ['name', 'created', 'updated'] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

export const LINE_ORDERS = ['position', 'created', 'updated'] as const;
export type LineOrder = (typeof LINE_ORDERS)[number];
