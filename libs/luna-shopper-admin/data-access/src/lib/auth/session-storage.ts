import { Injectable } from '@angular/core';
import {
  asInstant,
  toAdminSession,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';

/** The one key this app writes, namespaced so it cannot collide on an origin. */
const SESSION_KEY = 'luna-shopper-admin.session';

/**
 * Where the token lives: `sessionStorage`, and nowhere else (plan 0002,
 * section 3).
 *
 * The plan originally said memory only, and this is a deliberate change from it.
 * Memory only means every reload is a new login, and a back office is a tool
 * somebody keeps open across a working day and reloads constantly while a
 * rebuild lands. `sessionStorage` buys back the reload and keeps the property
 * the design was actually aiming at: **closing the browser ends the session.**
 * The store is scoped to the tab and cleared when it closes, so nothing outlives
 * the sitting.
 *
 * Not `localStorage`, which survives a browser restart and would turn a fifteen
 * minute token into a credential sitting on a disk overnight. Not a cookie,
 * which this app has no server of its own to set one from.
 *
 * The honest limit, so nobody is surprised by it: `sessionStorage` is **per
 * tab**. A reload keeps the session, and a tab opened from this one inherits a
 * copy of it, but a brand new tab typed or bookmarked into the address bar
 * starts empty and asks for a password. Sharing a session across unrelated tabs
 * would take a `localStorage` handshake broadcasting the token between them,
 * which is a lot of machinery and a wider exposure than the thing it saves.
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
    const raw = this.get();
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
      globalThis.sessionStorage?.setItem(
        SESSION_KEY,
        JSON.stringify({
          adminId: session.adminId,
          username: session.username,
          displayName: session.displayName,
          accessToken: session.accessToken,
          expiresAt: session.expiresAt.toISOString(),
          // Written so a reload keeps the token's *lifetime* and not only what
          // is left of it (plan 0003). Without it every reload would shorten
          // the lifetime the warning fraction is taken from, and a tab reloaded
          // at the wrong moment would warn seconds before it expired.
          receivedAt: session.receivedAt.toISOString(),
        })
      );
    } catch {
      // Storage refused. The session still works for this page: it is held in a
      // signal either way, and this is only what makes it survive a reload.
    }
  }

  clear(): void {
    try {
      globalThis.sessionStorage?.removeItem(SESSION_KEY);
    } catch {
      // Nothing to do, and nothing that can be done.
    }
  }

  private get(): string | null {
    try {
      return globalThis.sessionStorage?.getItem(SESSION_KEY) ?? null;
    } catch {
      return null;
    }
  }
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
