import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  BasketAddLineRequest,
  BasketBindResult,
  BasketLine,
  BasketLineOrigins,
  BasketLineTarget,
  BasketLinkPreview,
  BasketOriginQuantityRequest,
  BasketOriginQuantityResult,
  BasketOutstandingRequest,
  BasketParticipant,
  BasketSession,
  BasketSettleRequest,
  BasketSettleResult,
  BasketShareLink,
  BasketView,
  CatalogSuggestion,
} from '@portfolio/velista/models';
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
   * The basket, its lines and everybody on it
   * (`GET /v1/generated-lists/:id/basket`).
   *
   * One request for the whole screen, including the products every line names,
   * because a line's attribution is a participant id and its pick is a product
   * id: a basket without both is a page of identifiers.
   *
   * The answer is **redacted per reader** by the server (backend `0051`,
   * section 5.2), so what comes back for a guest genuinely lacks the origins
   * rather than carrying them behind a flag.
   */
  getBasket(generatedListId: string): Promise<BasketView>;

  /**
   * Settle a line (`POST .../lines/:lineId/settle`).
   *
   * The three gestures of section 4.2 in one call, because they are the same act
   * with progressively more of it supplied. Available to everybody for the first
   * two; an `allocations` array is refused by the server for a reader who does
   * not pass the rule, which is why the sheet that produces one is not drawn for
   * them in the first place.
   */
  settle(
    generatedListId: string,
    lineId: string,
    body: BasketSettleRequest
  ): Promise<BasketSettleResult>;

  /**
   * Take a finished line back to fully outstanding
   * (`POST .../lines/:lineId/reopen`), luna `0054` section 3.
   *
   * **The whole line, never a number of units.** That is the gesture the row's status
   * control makes, and a partial reopen has no honest answer to which of several
   * settlements it is undoing.
   *
   * The history is **not deleted** by it: each settlement this line produced is marked
   * reverted and is still served by the settlement pane, because "somebody said they
   * got this and then took it back" is a truer history than a gap.
   *
   * Answers the same shape as {@link settle}, and for the same reason: an origin whose
   * line has been deleted since cannot have its units put back, and the caller has to
   * be told something did not land.
   *
   * **Any live participant may, guests included** (luna `0054`, section 3.5). A reopen
   * is not a wider act than a settle: it touches exactly the origins this line's own
   * settlements touched, and refusing it to the person who just made the mistake would
   * leave the mistake standing.
   */
  reopen(generatedListId: string, lineId: string): Promise<BasketSettleResult>;

  /**
   * Swap a line's pick (`POST .../lines/:lineId/pick`).
   *
   * **Anybody may, guests included.** The options are catalog products and never
   * zone data, and the person at the shelf is exactly who wants another brand.
   */
  setPick(
    generatedListId: string,
    lineId: string,
    itemId: string
  ): Promise<BasketLine>;

  /**
   * Put a line in the basket (`POST .../basket/lines`), velista `0053`.
   *
   * **Every participant may, guests included**, and that is the unusual part of this
   * screen rather than a relaxation of `0030`'s rule. There is no permission to read
   * and no branch to write, because a line added here has no target list: it changes
   * nothing shared, names no zone and claims no zone line. It is a note on the list
   * somebody is carrying, and the gate that matters is on **binding** it to a
   * household's list, which is a separate gesture with a list picker in front of it.
   *
   * The one refusal that has a screen treatment is a **finished basket**, which the
   * server answers with a code of its own rather than a validation failure. The page
   * draws no composer over one at all, so that code is a race rather than a state.
   *
   * Answers the created line, which is what the caller appends. Nothing is drawn
   * optimistically here, unlike the list page: four people work a basket at once,
   * and a row that appeared locally and then reordered when the server answered is a
   * row somebody might tap in between.
   *
   * ## The path is under `basket`, not `:id/lines`
   *
   * `POST /v1/generated-lists/:id/lines` is the **owner's** add, resolved by
   * `ownerUserId`, so a guest holding a perfectly valid session gets a not found
   * from it. The participant surface reads through `basket` already, and its write
   * sits beside that read.
   */
  addLine(
    generatedListId: string,
    body: BasketAddLineRequest
  ): Promise<BasketLine>;

  /**
   * The catalog, searched **through the basket**
   * (`GET .../catalog/suggest?q=`), velista `0053` section 4.
   *
   * A route of its own rather than `CatalogServiceI.suggest`, because that one sits
   * behind the account guard and resolves its scope from the caller's shopping
   * profile, and the reader here may hold no account at all. The gateway composes
   * this one on the participant's behalf, exactly as it already composes the product
   * names every basket line carries.
   *
   * **The scope is the run's, never the caller's** (luna `0055`, section 5.1): the
   * ranking is the basket's own, so a stranger's basket is not priced by a different
   * city's shops, and a guest with no profile gets a ranking at all.
   *
   * **Empty rather than thrown**, matching {@link CatalogServiceI.suggest}: a
   * dropdown is an offer, free text has been first class since `0043`, and adding a
   * line must never fail because a search did.
   */
  suggest(
    generatedListId: string,
    query: string
  ): Promise<readonly CatalogSuggestion[]>;

  /**
   * Say how many of a line are still to get (`POST .../lines/:lineId/outstanding`),
   * velista `0054`.
   *
   * **The number, not a delta**, and {@link BasketOutstandingRequest.from} is the
   * whole of why. Above the current amount the basket asks for more and nothing is
   * settled; below it, the difference was bought; zero finishes the line exactly as
   * "got all" does. Which of those a gesture meant depends entirely on where it
   * started, so a `from` that no longer matches is refused with `stale_quantity`
   * rather than applied to a number that moved underneath it.
   *
   * Answers a {@link BasketSettleResult} in **both** directions, which is not a
   * convenience: the downward move writes a settlement and can skip an origin whose
   * access has gone, so the caller has to be told something did not land, exactly as
   * it does after {@link settle}.
   */
  setOutstanding(
    generatedListId: string,
    lineId: string,
    body: BasketOutstandingRequest
  ): Promise<BasketSettleResult>;

  /**
   * Which lists are on this line, and which could be (`GET .../lines/:lineId/origins`),
   * velista `0055`.
   *
   * **Zone data throughout**, so the server refuses it outright to a guest and to a
   * registered participant who does not pass the all or nothing rule: a redacted
   * version of this answer would be an empty sheet, which is a worse lie than a
   * refusal. The screen does not draw the way in for them either.
   */
  getLineOrigins(
    generatedListId: string,
    lineId: string
  ): Promise<BasketLineOrigins>;

  /**
   * Set what one list contributes (`POST .../lines/:lineId/origins`), velista `0055`.
   *
   * One call for three gestures, because they are one write at different starting
   * points: changing an existing contribution, adopting a candidate (`from: 0`), and
   * taking a list off the line altogether (`quantity: 0`).
   *
   * **It buys nothing, ever.** No settlement is written and no bought indicator is
   * set, whichever way the number goes, which is what keeps this sheet's captions
   * free of any sentence about a purchase. Going under what the basket has already
   * bought against the list is refused with `below_settled` rather than quietly
   * unbuying it.
   */
  setOriginQuantity(
    generatedListId: string,
    lineId: string,
    body: BasketOriginQuantityRequest
  ): Promise<BasketOriginQuantityResult>;

  /**
   * The lists this line could be sent to (`GET .../lines/:lineId/targets`),
   * velista `0056`.
   *
   * Every list **both** the reader and the basket's owner can write right now. The
   * owner's access is not a formality: it is what authorizes every later settle
   * against the line, so a list only the reader can write would give a household a
   * line it never sees bought.
   */
  getLineTargets(
    generatedListId: string,
    lineId: string
  ): Promise<readonly BasketLineTarget[]>;

  /**
   * Send a line to a shopping list (`POST .../lines/:lineId/target`), velista `0056`.
   *
   * Only an `ADDED` line, and only one that has been sent nowhere: a `DERIVED` line
   * already has the lists it came from, and a bound one cannot be bound twice. Both
   * refusals have codes of their own, because "this is not that kind of line" and
   * "this has already gone" are different sentences to whoever is holding the phone.
   *
   * The created zone line asks for what is **outstanding**, which may be zero on a
   * line already bought: sending it is still worth doing, because it puts what
   * happened onto the household's list.
   */
  bindLine(
    generatedListId: string,
    lineId: string,
    listId: string
  ): Promise<BasketBindResult>;

  /** Everybody on the basket (`GET .../participants/mine`), for presence. */
  listParticipants(
    generatedListId: string
  ): Promise<readonly BasketParticipant[]>;

  /**
   * A fresh socket token (`POST .../participant-token`).
   *
   * The token is short lived and cannot be revoked, so what carries revocation is
   * this call: it presents the participant credential, which is the database read
   * that refuses somebody who has been removed (backend `0051`, section 9).
   */
  refreshSocketToken(generatedListId: string): Promise<BasketSession>;

  /**
   * The live share link, minting one if there is none (`PUT .../share-link`).
   *
   * Owner only, and account authenticated. `PUT` rather than `POST` because it is
   * "ensure": pressing share on two devices produces one link, not two.
   */
  ensureShareLink(generatedListId: string): Promise<BasketShareLink>;

  /** The live link if there is one, without minting (`GET .../share-link`). */
  getShareLink(generatedListId: string): Promise<BasketShareLink | null>;

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
    generatedListId: string,
    cascade?: boolean
  ): Promise<{ revoked: number }>;

  /** Remove one participant and nobody else (`DELETE .../participants/:id`). */
  revokeParticipant(
    generatedListId: string,
    participantId: string
  ): Promise<void>;
}

/**
 * Whether the deployment serves the reopen route, which is luna `0054`'s to ship.
 *
 * A constant rather than a runtime probe, exactly as `VERIFY_RESEND_AVAILABLE` is and
 * for its reasons: there is nothing to discover at runtime that is not already known
 * at build time, and a probe would spend a request per basket read learning something
 * a one line edit says better.
 *
 * What it gates is **one control's behaviour and not its existence** (plan 0052,
 * section 10). A finished row still draws its status glyph while this is false; the
 * glyph is a state indicator rather than a button, because a control you may not use
 * is not drawn (`0030`) and offering an act that would 404 is the same mistake wearing
 * a different hat. The settle direction works in full either way, and it is most of
 * the value.
 *
 * **Turned on**: luna `0054` shipped `POST .../lines/:lineId/reopen`, so a finished
 * row's glyph is a control again. What the constant is still worth is the record of
 * what it gates, and the one line to change if the route is ever withdrawn.
 */
export const BASKET_REOPEN_AVAILABLE = true;

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
