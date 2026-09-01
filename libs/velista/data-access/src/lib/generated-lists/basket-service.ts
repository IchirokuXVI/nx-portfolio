import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  BasketLine,
  BasketLinkPreview,
  BasketParticipant,
  BasketSession,
  BasketSettleRequest,
  BasketSettleResult,
  BasketShareLink,
  BasketView,
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
 * Flipping it to `true` is the whole of the frontend work when the route ships.
 */
export const BASKET_REOPEN_AVAILABLE = false;

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
