import { inject, Injectable } from '@angular/core';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { AuthApi } from './auth-api';

/**
 * Where this tab keeps the verifier of the Google sign in it started (velista `0171`).
 * `sessionStorage`, so it dies with the tab and no other tab can finish the flow.
 */
export const GOOGLE_VERIFIER_KEY = StorageKeys.googleVerifier;

/** 32 random bytes, which base64url writes as the 43 characters backend `0230` wants. */
const VERIFIER_BYTES = 32;

/**
 * The start of a Google sign in (velista `0171`, backend `0230`).
 *
 * The browser that starts the flow makes a verifier, keeps it in this tab's session
 * storage, and sends only its SHA-256 challenge to the gateway. The callback page trades
 * the code Google's redirect carries **and** the verifier for the pair. A link that
 * somebody else made lands on that page in a browser that holds no verifier, so it signs
 * nobody in and replaces nobody's session.
 *
 * Nothing calls {@link start} yet. Offering the button is a separate decision, and this
 * class is what makes it one line on each page that offers it.
 *
 * Installed by `VELISTA_DATA_ACCESS_PROVIDERS` and not at the root (rule D5): it reaches
 * `ApiUrl` and `AuthApi`, which only the app injector holds.
 */
@Injectable()
export class GoogleSignIn {
  private readonly _browser = inject(BrowserFacade);
  private readonly _api = inject(AuthApi);
  private readonly _urls = inject(ApiUrl);

  /**
   * Make a verifier, keep it, mint a state with its challenge, and send the document to
   * the gateway's Google route.
   *
   * The verifier is written **before** the mint goes out, and a second call overwrites
   * it. For a guest the interceptor sends the bearer with the mint, so the state carries
   * the account a successful sign in links to; signed out, the mint goes out bare.
   *
   * Rejects when the mint fails (a stale guest token the interceptor could not refresh,
   * `not_configured` while Google is unset, `impersonation_not_allowed` in a support
   * session, a network error) and removes the verifier first. The error is the
   * `GatewayError` or the network failure as it arrived, and the caller decides what to
   * show. Rejects on the server too, where there is no generator to make a verifier.
   */
  async start(): Promise<void> {
    const verifier = base64url(this._browser.randomBytes(VERIFIER_BYTES));
    this._browser.writeSessionStorage(GOOGLE_VERIFIER_KEY, verifier);

    let state: string;
    try {
      const challenge = base64url(
        new Uint8Array(await this._browser.sha256(ascii(verifier)))
      );
      state = await this._api.mintGoogleState(challenge);
    } catch (error) {
      this._browser.removeSessionStorage(GOOGLE_VERIFIER_KEY);
      throw error;
    }

    this._browser.assignDocument(
      this._urls.gateway('/v1/auth/google?state=' + encodeURIComponent(state))
    );
  }
}

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Bytes as unpadded base64url (RFC 4648 section 5), the encoding RFC 7636 uses for both
 * the verifier and the challenge. Written out rather than over `btoa`, so it touches no
 * browser global (rule D2) and runs the same on the server.
 */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;

    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    if (i + 1 < bytes.length) {
      out += ALPHABET[(triple >> 6) & 63];
    }
    if (i + 2 < bytes.length) {
      out += ALPHABET[triple & 63];
    }
  }
  return out;
}

/** The ASCII bytes of a base64url string, which is what RFC 7636 hashes. */
function ascii(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}
