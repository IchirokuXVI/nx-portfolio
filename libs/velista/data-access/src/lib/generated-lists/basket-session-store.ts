import { inject, Injectable } from '@angular/core';
import type { BasketSession } from '@portfolio/velista/models';
import { basketSessionKey, BrowserFacade } from '@portfolio/velista/platform';

/**
 * The participant credentials this browser holds, one per basket (plan 0044).
 *
 * ## Why there is one per basket rather than one per person
 *
 * A link is an invitation and a participant is an identity (backend `0051`,
 * section 3). The same person can be a guest on their flatmate's shop and a
 * registered participant on their mother's at the same time, and the two
 * credentials authorize nothing about each other. So the store is keyed by the
 * basket, and there is no notion here of "the current participant".
 *
 * ## Why it is persisted at all
 *
 * For a guest this secret **is** their identity on that basket. It is returned
 * exactly once, at join, and stored hashed on the server, so a browser that
 * forgets it cannot ask for it again: the person would have to rejoin through the
 * link and would come back as a *different* participant, with a new `Guest N` and
 * none of the lines they had settled attributed to them. Doing that in the middle
 * of a shop is the failure this store exists to prevent, which is why it survives
 * a closed tab.
 *
 * ## What it deliberately does not do
 *
 * It does not decide whether a session is still good. Revocation bites on the
 * server, on the next request, with no cache to wait out (backend `0051`,
 * section 3.3), so a stored secret is a *claim* rather than an authorization and
 * the only way to learn it has been revoked is to use it and be refused. The
 * store is told to {@link forget} at that point by whoever made the request.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// `BrowserFacade`, which the app configures.
@Injectable()
export class BasketSessionStore {
  private readonly _browser = inject(BrowserFacade);

  /**
   * The credential for one basket, or null when this browser holds none.
   *
   * Null is the ordinary answer for a stranger arriving on a link, and it is what
   * sends the basket page to the join screen rather than to an error.
   */
  read(generatedListId: string): BasketSession | null {
    const raw = this._browser.readStorage(basketSessionKey(generatedListId));
    if (raw === null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return this._revive(generatedListId, parsed);
    } catch {
      // Storage that will not parse is storage from another version of this app,
      // or from a half written write. Either way it is not a credential, and
      // treating it as absent sends the reader to the join screen, which works.
      return null;
    }
  }

  /** Remember a credential just minted by a join, or refreshed by a token call. */
  write(session: BasketSession): void {
    this._browser.writeStorage(
      basketSessionKey(session.generatedListId),
      JSON.stringify({
        participantId: session.participantId,
        secret: session.secret,
        socketToken: session.socketToken,
        socketTokenExpiresAt: session.socketTokenExpiresAt?.toISOString() ?? null,
      })
    );
  }

  /**
   * Drop a credential the server has refused.
   *
   * Called when a participant authenticated request answers 401, which is what a
   * revocation looks like from here. Keeping a secret that is known not to work
   * would send the reader to a basket that refuses them on every action instead
   * of to the join screen, where the link they still hold might let them back in.
   */
  forget(generatedListId: string): void {
    this._browser.removeStorage(basketSessionKey(generatedListId));
  }

  /**
   * Rebuild a session from what was stored, or null if it is not one.
   *
   * The basket id comes from the caller rather than from the stored object: it is
   * in the key, so storing it again would be a second copy that could disagree.
   */
  private _revive(
    generatedListId: string,
    raw: unknown
  ): BasketSession | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }

    const stored = raw as Record<string, unknown>;
    const participantId = stored['participantId'];
    const socketToken = stored['socketToken'];
    if (typeof participantId !== 'string' || typeof socketToken !== 'string') {
      return null;
    }

    const expiresAt =
      typeof stored['socketTokenExpiresAt'] === 'string'
        ? new Date(stored['socketTokenExpiresAt'])
        : null;

    return {
      generatedListId,
      participantId,
      // Null is a real value here and not a missing one: a registered
      // participant and the owner authenticate with their account token and are
      // given no second credential (backend `0051`, section 4).
      secret: typeof stored['secret'] === 'string' ? stored['secret'] : null,
      socketToken,
      socketTokenExpiresAt:
        expiresAt !== null && !Number.isNaN(expiresAt.getTime())
          ? expiresAt
          : null,
    };
  }
}
