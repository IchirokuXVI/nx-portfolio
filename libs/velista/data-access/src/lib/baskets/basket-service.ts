import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  Basket,
  BasketAddLineRequest,
  BasketChangePage,
  BasketDemandRequest,
  BasketLinkPreview,
  BasketParticipant,
  BasketRenameRequest,
  BasketRenameResult,
  BasketRevertRequest,
  BasketRowResult,
  BasketSession,
  BasketSettleRequest,
  BasketShareLink,
  CatalogSuggestion,
  LiveBasketSummary,
} from '@portfolio/velista/models';
import type { BasketChangeContext } from '../mapping/basket-change-mappers';
import { BasketApi } from './basket-api';

/**
 * The shared basket, over the wire (plan 0044, section 6).
 *
 * ## Two credentials, and the interface hides which
 *
 * Everything below {@link previewLink} and {@link join} is authenticated by the
 * **participant** rather than by an account. A guest presents the session secret
 * they were handed at join, on a header; the owner and a registered participant
 * present their ordinary account token, because they have one and backend `0051`
 * section 3 therefore gives them no second credential.
 *
 * That difference is entirely `BasketApi`'s business. Nothing here takes a
 * secret, and no caller decides which credential to send, because a caller that
 * could get it wrong eventually would.
 *
 * ## No method takes a participant id
 *
 * The server resolves the actor from the credential on every request, against the
 * database, with no cache, so revocation bites on the next action (backend `0051`,
 * section 3.3). A client supplied participant id would be a second answer to a
 * question the server has already answered better.
 *
 * ## Every write addresses a row, and answers one
 *
 * A basket stores no lines since backend `0136`, so there is nothing to address
 * one by. A write names a `rowKey` and answers a {@link BasketRowResult}, which
 * is the row as it now stands and the basket's counts. The store folds that whole
 * and patches nothing.
 */
export interface BasketServiceI {
  /**
   * What a link discloses before anybody joins (`GET /v1/share-links/:secret`).
   *
   * **Unauthenticated, and it never fails.** A link that never existed, one that
   * was revoked, one that expired and one whose basket is finished all answer
   * `joinable: false` and nothing else, so the join screen gets an honest
   * sentence while the four stay indistinguishable. The screen must not try to
   * tell them apart, and this signature is what stops it: there is nothing in the
   * answer to tell them apart by.
   */
  previewLink(secret: string): Promise<BasketLinkPreview>;

  /**
   * Become a participant (`POST /v1/share-links/:secret/join`).
   *
   * One route for both cases. Somebody signed in is attached as themselves, with
   * no name prompt and no second credential; everybody else becomes a guest, with
   * the name they typed or `Guest N` if they skipped it.
   *
   * The returned {@link BasketSession.secret} exists **once**, here. Nothing can
   * ask for it again, so a caller that does not persist it has silently made the
   * person a stranger to that basket.
   *
   * @param displayName what a guest typed. Absent means they skipped the prompt,
   *   which is a first class outcome and not a validation failure.
   */
  join(secret: string, displayName?: string): Promise<BasketSession>;

  /**
   * The basket, its rows and everybody on it (`GET /v1/baskets/:id`).
   *
   * One request for the whole screen, including the products every row names,
   * because an attribution is a participant id and a product is a product id: a
   * basket without both is a page of identifiers.
   *
   * The answer is **redacted per reader** by the server (backend `0130`,
   * section 6), and the redaction is `Basket.lists`: a guest is served no list
   * refs, so every entry they receive names no list.
   *
   * `locationId` reads it at one shop (velista `0102`; backend `0163`, section 2):
   * every product carries `atShop`. On a basket started at a shop the server
   * reads at that shop whatever is sent, and a different id is refused with
   * `basket_shop_locked`.
   */
  getBasket(basketId: string, locationId?: string): Promise<Basket>;

  /**
   * The caller's own permanent basket (`GET /v1/baskets/live`), velista `0091`.
   *
   * **The server creates it on the first read**, so this never answers "there is
   * none": one basket per person, holding every line of every list they can
   * write, never finished and never named. Two tabs opening the app at once make
   * one basket, through a unique index rather than through a lock.
   *
   * Account authenticated, unlike everything else on the participant surface: a
   * guest holding a link has no basket of their own to ask for. The id comes
   * back on the answer and every later request names it, which is why nothing
   * else here takes a `'live'`.
   */
  getLiveBasket(locationId?: string): Promise<Basket>;

  /**
   * The three numbers the dashboard card draws (`GET /v1/baskets/live/summary`).
   *
   * A read of its own so the card does not pay for a thousand rows and a catalog
   * composition to draw one sentence. It creates the basket exactly as
   * {@link getLiveBasket} does, so the card is the first thing to make one for
   * an account that has never opened the screen.
   */
  getLiveSummary(): Promise<LiveBasketSummary>;

  /**
   * Say what happened to a row at the shelf
   * (`POST /v1/baskets/:id/rows/:rowKey/settle`).
   *
   * The gestures of velista `0052` section 4.2 in one call, because they are the
   * same act with progressively more of it supplied. Available to everybody; an
   * `allocations` array naming a list this reader was not served is refused by
   * the server, which is why the pane that produces one is drawn only over
   * entries whose list the basket served.
   *
   * **Every `BOUGHT` carries its quantity**, and `from` is what makes a double
   * tap safe. The server no longer caps an absent quantity at what the row asks
   * for: buying three of a row that says two records three, because the extra
   * unit is real and belongs in the consumption history.
   */
  settle(
    basketId: string,
    rowKey: string,
    body: BasketSettleRequest
  ): Promise<BasketRowResult>;

  /**
   * Take part of a row back (`POST /v1/baskets/:id/rows/:rowKey/revert`),
   * backend `0136` section 5.2.
   *
   * Two targets rather than two routes, because they are one gesture with two
   * things it can be aimed at: the units somebody said they bought, or the close
   * somebody said the shop could not supply. A close holds no units, so that
   * branch carries no number and no `from`.
   *
   * It replaced `reopen`, which took a whole line back and nothing less. **Any
   * live participant may, guests included** (luna `0054`, section 3.5): a revert
   * is not a wider act than a settle, and refusing it to the person who just made
   * the mistake would leave the mistake standing.
   *
   * `skippedCount` on the answer is how many entries could not have units put
   * back because their line was deleted since, which is why the caller is told
   * rather than left to infer it from a number that did not move.
   */
  revert(
    basketId: string,
    rowKey: string,
    body: BasketRevertRequest
  ): Promise<BasketRowResult>;

  /**
   * Put a row off for now (`PUT /v1/baskets/:id/rows/:rowKey/skip`), backend
   * `0137`.
   *
   * **A state of the row on this trip, never an outcome of a settle.** Nothing
   * is bought, nothing is closed and no list moves: the shopper walked past the
   * bread today. `SETTLEMENT_OUTCOMES` deliberately has no `SKIPPED` member for
   * exactly this reason (backend `0130`, section 11, decision 3).
   *
   * Every participant may, a guest included (backend `0130`, section 5): it is
   * a smaller act than a settle, which every participant already may.
   *
   * **It carries no `from`.** Every other row write names the number it started
   * from, because its meaning depends on where the number was. A skip has no
   * number, so there is nothing to be stale about; what the server refuses
   * instead is a row with nothing left to get, which is the case a `from` would
   * have caught (backend `0137`, section 5).
   *
   * `PUT` because it is "ensure": skipping a row that is already skipped is the
   * state it asked for, not a second skip.
   */
  skip(basketId: string, rowKey: string): Promise<BasketRowResult>;

  /**
   * Put a skipped row back (`DELETE` on the same route).
   *
   * The same route and the opposite verb, because it is the same fact being set
   * and unset. A purchase ends a skip too, and the server does that itself: a
   * person who skipped the bread and then found it presses "Got it", and the
   * skip goes with the settle rather than needing this first.
   */
  unskip(basketId: string, rowKey: string): Promise<BasketRowResult>;

  /**
   * Change what one list asks for (`POST /v1/baskets/:id/rows/:rowKey/demand`),
   * velista `0092` section 6, backend `0131`.
   *
   * **The one write on this screen that changes a household's list**, for
   * everybody, on every screen the list appears on. Everything else here records
   * what a trip did.
   *
   * So the rule behind it is the list's, asked of the basket's **owner** and
   * never of the caller: a reader never learns the owner's permissions and a
   * guest has none of their own, which is why the answer travels as
   * `BasketRowEntry.demandEditable` rather than being worked out here.
   *
   * {@link BasketRowResult.row} is null when the row left the basket, which is
   * a demand taken to zero on a row nothing was bought of.
   */
  setDemand(
    basketId: string,
    rowKey: string,
    body: BasketDemandRequest
  ): Promise<BasketRowResult>;

  /**
   * Add a line, onto one of the basket's covered lists (`POST
   * /v1/baskets/:id/lines`), velista `0092` section 7, backend `0136`.
   *
   * **It names a list, and that is not optional.** A line added from the basket
   * used to live in the basket alone; a basket stores nothing now, so an add
   * with no list would be a line with nowhere to be.
   *
   * It goes through the list's ordinary rules, so it can land on a line the list
   * already held (backend `0091`) and it can land unapproved on a list that does
   * not auto approve. Either way the answer is the row it landed on, which the
   * store folds like any other row write.
   */
  addLine(
    basketId: string,
    body: BasketAddLineRequest
  ): Promise<BasketRowResult>;

  /**
   * Rename a row and every list line inside it (`PATCH /v1/baskets/:id/rows/:rowKey`),
   * velista `0084`, backend `0113`.
   *
   * **The server decides who may**: a guest never, and otherwise only somebody who
   * can write every list behind the row. The sheet draws the field from the same
   * rule — every entry's list served — but a refusal here is still the answer.
   *
   * A name already taken, on a list or in the basket, is refused with
   * `line_merge_required` until the same request carries `confirmMerge`. After a
   * merge the answer's row is the survivor, which may not be the row addressed:
   * `absorbedRowKey` names the one that went away.
   */
  renameRow(
    basketId: string,
    rowKey: string,
    body: BasketRenameRequest
  ): Promise<BasketRenameResult>;

  /**
   * The catalog, searched **through the basket**
   * (`GET /v1/baskets/:id/catalog/suggest?q=`), velista `0053` section 4.
   *
   * A route of its own rather than `CatalogServiceI.suggest`, because that one sits
   * behind the account guard and resolves its scope from the caller's shopping
   * profile, and the reader here may hold no account at all. The gateway composes
   * this one on the participant's behalf, exactly as it already composes the product
   * names every basket row carries.
   *
   * **The scope is the basket's, never the caller's** (luna `0055`, section 5.1):
   * the ranking is the basket's own, so a stranger's basket is not priced by a
   * different city's shops, and a guest with no profile gets a ranking at all.
   *
   * **Empty rather than thrown**, matching {@link CatalogServiceI.suggest}: a
   * dropdown is an offer, free text has been first class since `0043`, and adding a
   * line must never fail because a search did.
   */
  suggest(
    basketId: string,
    query: string
  ): Promise<readonly CatalogSuggestion[]>;

  /**
   * What changed on the lists this basket covers, newest first
   * (`GET /v1/baskets/:id/changes`), velista `0093`, backend `0138`.
   *
   * A **history** and not a nudge, so it includes the reader's own changes: the
   * marks on the basket read are what leave those out. Every entry carries the
   * server's own `unseen`, which is the only thing that says what is new to this
   * viewer; nothing on this side compares a time to a clock.
   *
   * On the participant credential like every other read here, so a guest may
   * call it and is served no list id and no actor they are not entitled to
   * (backend `0130`, section 6).
   *
   * **`context` is an argument because this answer cannot be mapped without
   * the basket.** Core serves no names, no list refs and no merge survivor
   * text: an actor is an id, a list is an id, and the line a merge folded
   * into is a row key. All three are resolved against the basket the caller
   * already holds, at the moment the page is mapped, which is the only place
   * that knows them.
   */
  changes(
    basketId: string,
    context: BasketChangeContext,
    cursor?: string
  ): Promise<BasketChangePage>;

  /**
   * Say which changes this viewer has drawn
   * (`POST /v1/baskets/:id/changes/seen`), velista `0093`, section 7.
   *
   * `through` is the **id of the newest change the client drew**, never "up to
   * now": a change that arrives between the render and this call stays unseen,
   * and a cursor never carries a timestamp (backend `0130`, section 13).
   *
   * The rule about **when** to call it is the caller's and cannot be enforced
   * here: only while the marked rows, or the changes sheet, were really on
   * screen with the document visible. A background refetch acknowledges nothing.
   * `ChangeAcknowledger` is the one thing in this app allowed to make this call.
   */
  acknowledgeChanges(basketId: string, through: string): Promise<void>;

  /** Everybody on the basket (`GET .../participants/mine`), for presence. */
  listParticipants(basketId: string): Promise<readonly BasketParticipant[]>;

  /**
   * A fresh socket token (`POST .../participant-token`).
   *
   * The token is short lived and cannot be revoked, so what carries revocation is
   * this call: it presents the participant credential, which is the database read
   * that refuses somebody who has been removed (backend `0051`, section 9).
   */
  refreshSocketToken(basketId: string): Promise<BasketSession>;

  /**
   * The live share link, minting one if there is none (`PUT .../share-link`).
   *
   * Owner only, and account authenticated. `PUT` rather than `POST` because it is
   * "ensure": pressing share on two devices produces one link, not two.
   */
  ensureShareLink(basketId: string): Promise<BasketShareLink>;

  /** The live link if there is one, without minting (`GET .../share-link`). */
  getShareLink(basketId: string): Promise<BasketShareLink | null>;

  /**
   * Revoke the live link (`DELETE .../share-link`).
   *
   * `cascade` is the second, explicit choice, and its default matters: without it
   * nobody new can join and **everybody already shopping keeps working**, because
   * their session authorizes them and the link was only an invitation they
   * already accepted. Defaulting the other way would throw three people out of a
   * shop on one tap.
   */
  revokeShareLink(
    basketId: string,
    cascade?: boolean
  ): Promise<{ revoked: number }>;

  /** Remove one participant and nobody else (`DELETE .../participants/:id`). */
  revokeParticipant(basketId: string, participantId: string): Promise<void>;

  /**
   * Add one of the owner's contacts to the basket
   * (`POST .../participants`, backend `0114` section 4).
   *
   * Owner only, account authenticated. Somebody already on it by link becomes an
   * invited member, and somebody who was removed or left is brought back.
   */
  addParticipant(basketId: string, userId: string): Promise<BasketParticipant>;

  /**
   * Leave a basket somebody else shared (`DELETE .../participants/mine`, backend
   * `0114` section 6). A registered participant only: a guest and the owner are
   * refused.
   */
  leaveBasket(basketId: string): Promise<void>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching every other service token here for
 * the reason recorded on `ACCOUNT_SERVICE`: a wrong default that quietly works is
 * worse than one that fails loudly.
 */
export const BASKET_SERVICE = serviceToken<BasketServiceI>(
  'BASKET_SERVICE',
  () => inject(BasketApi)
);
