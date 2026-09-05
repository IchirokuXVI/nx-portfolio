import { Injectable } from '@angular/core';
import {
  asInstant,
  toAdminSession,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';

/** The one key this app writes, namespaced so it cannot collide on an origin. */
const SESSION_KEY = 'luna-shopper-admin.session';

/**
 * Where the token lives: `localStorage`, and nowhere else (plan 0013,
 * section 2).
 *
 * This is the second amendment to plan 0002, which said memory only. `0002`
 * moved it to `sessionStorage` to buy back the reload, and named the limit it
 * accepted: **`sessionStorage` is per tab**, so a tab typed or bookmarked into
 * the address bar starts empty and asks for a password. That limit turned out to
 * be the thing an operator hits most. A back office is used by opening rows in
 * new tabs, and every one of them was a login screen.
 *
 * So the store is `localStorage`, which is per origin: one session, shared by
 * every tab of this app, adopted by a tab that opens later and cleared for all of
 * them when one signs out.
 *
 * **What that costs is the browser restart.** `sessionStorage` was chosen so
 * closing the browser ended the sitting, and `localStorage` outlives it. The
 * token is what makes that acceptable rather than a decision to care less: it is
 * a short lived access token with no refresh token behind it, {@link read}
 * discards an expired one on sight, and a renewal is refused for a token that is
 * already over. So a browser reopened after a lunch break finds a credential that
 * expired during it, and reopened the next morning finds one that cannot be
 * renewed into anything. The exposure is one token lifetime of a token that is
 * checked against the server on every request, weighed against a password on
 * every new tab.
 *
 * A session written by an earlier build is picked up once, on the first read, so
 * the deploy that lands this does not sign everybody out.
 *
 * Every access is wrapped, because reading storage *throws* rather than
 * answering empty in more browsers than one expects: a private window with site
 * data blocked, an embedded webview, or an origin the user has denied storage
 * to. An operator whose browser refuses storage still gets a working app, one
 * that signs in again after every reload.
 */
@Injectable()
export class SessionStorage {
  /**
   * The stored session, or `null`.
   *
   * Everything unusable is `null` and is **cleared on the way out**: a body that
   * is not JSON, one that no longer matches the shape this build expects, and
   * one whose token has already expired. Leaving a rejected value behind means
   * parsing and rejecting it again on every reload, and an expired token in
   * particular is a credential with no remaining purpose.
   */
  read(): AdminSession | null {
    const raw = this.get() ?? this.inherited();
    if (raw === null) {
      return null;
    }

    const session = parse(raw);
    if (session === null || session.expiresAt.getTime() <= Date.now()) {
      this.clear();
      return null;
    }

    return session;
  }

  /** Write the session, ISO expiry and all. A failed write is not an error. */
  write(session: AdminSession): void {
    try {
      globalThis.localStorage?.setItem(SESSION_KEY, serialize(session));
    } catch {
      // Storage refused. The session still works for this page: it is held in a
      // signal either way, and this is only what makes it survive a reload and
      // reach the other tabs.
    }
  }

  clear(): void {
    try {
      globalThis.localStorage?.removeItem(SESSION_KEY);
    } catch {
      // Nothing to do, and nothing that can be done.
    }
  }

  /**
   * Tell me when another tab writes the session (plan 0013, section 3).
   *
   * The listener is called with the session another tab now holds, or with
   * `null` when another tab signed out. Returns the function that stops it.
   *
   * The `storage` event is the whole mechanism, and its one property this design
   * rests on is that **it never fires in the tab that wrote**. So a tab renewing
   * a token tells every other tab and does not tell itself, and there is no
   * echo to suppress and no loop to break.
   *
   * A value that does not parse is reported as `null` rather than ignored. It
   * cannot be used as a credential by anybody, so a tab still holding a session
   * for it is holding one the rest of the app has lost.
   */
  watch(listener: (session: AdminSession | null) => void): () => void {
    const onStorage = (event: StorageEvent): void => {
      // `key` is null when a page called `localStorage.clear()`, which nothing
      // here does but an extension or a developer console can. Everything the
      // app knows is gone in that case, so it reads as a sign out.
      if (event.key !== null && event.key !== SESSION_KEY) {
        return;
      }

      const raw = event.key === null ? null : event.newValue;
      listener(raw === null ? null : usable(parse(raw)));
    };

    globalThis.addEventListener?.('storage', onStorage);
    return () => globalThis.removeEventListener?.('storage', onStorage);
  }

  private get(): string | null {
    try {
      return globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * A session an older build left in `sessionStorage`, moved across once.
   *
   * Read before the deploy that lands `0013` is allowed to sign anybody out, and
   * removed from where it was so this runs exactly once per tab. It is the same
   * key holding the same shape, so nothing about it needs converting; only its
   * address changed.
   */
  private inherited(): string | null {
    let raw: string | null;
    try {
      raw = globalThis.sessionStorage?.getItem(SESSION_KEY) ?? null;
      globalThis.sessionStorage?.removeItem(SESSION_KEY);
    } catch {
      return null;
    }

    if (raw !== null) {
      try {
        globalThis.localStorage?.setItem(SESSION_KEY, raw);
      } catch {
        // The session still works for this page. It simply will not reach the
        // next tab, which is where this build came in.
      }
    }

    return raw;
  }
}

/** The stored shape: five fields the server stated, and one this app recorded. */
function serialize(session: AdminSession): string {
  return JSON.stringify({
    adminId: session.adminId,
    username: session.username,
    displayName: session.displayName,
    accessToken: session.accessToken,
    expiresAt: session.expiresAt.toISOString(),
    // Written so a reload keeps the token's *lifetime* and not only what is left
    // of it (plan 0003). Without it every reload would shorten the lifetime the
    // warning fraction is taken from, and a tab reloaded at the wrong moment
    // would warn seconds before it expired.
    receivedAt: session.receivedAt.toISOString(),
  });
}

/**
 * Stored text as a session.
 *
 * Through the same {@link toAdminSession} the network answer goes through, not a
 * looser check. What comes back out of storage is no more trustworthy than what
 * came off the wire: it was written by an older build, or by hand in a dev
 * console, and it is about to be presented as a credential.
 */
function parse(raw: string): AdminSession | null {
  try {
    const body: unknown = JSON.parse(raw);
    return toAdminSession(body, storedReceivedAt(body) ?? new Date());
  } catch {
    return null;
  }
}

/** The session, unless it is already over. */
function usable(session: AdminSession | null): AdminSession | null {
  if (session === null || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return session;
}

/**
 * The `receivedAt` a previous page wrote, or `null`.
 *
 * `null` covers a session written by a build from before `0003` as well as a
 * value somebody edited into nonsense, and both fall back to now. That
 * understates the lifetime, which moves the warning later rather than earlier:
 * the operator gets less notice on that one restored session and nothing else
 * changes. The opposite fallback, inventing a longer lifetime, would put the
 * warning after the expiry it exists to precede.
 */
function storedReceivedAt(body: unknown): Date | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  return asInstant((body as Record<string, unknown>)['receivedAt']);
}
