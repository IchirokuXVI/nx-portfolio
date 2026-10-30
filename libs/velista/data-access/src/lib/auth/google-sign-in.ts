import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  GOOGLE_CREDENTIAL,
  type GoogleCredentialI,
  StorageKeys,
} from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { AuthApi } from './auth-api';
import { TokenStore } from './token-store';

/**
 * Where this tab keeps the verifier of the Google sign in it started (velista `0171`).
 * `sessionStorage`, so it dies with the tab and no other tab can finish the flow.
 */
export const GOOGLE_VERIFIER_KEY = StorageKeys.googleVerifier;

/** 32 random bytes, which base64url writes as the 43 characters backend `0230` wants. */
const VERIFIER_BYTES = 32;

/**
 * How long a silent sign in may hold the front door before it is abandoned (velista
 * `0175`, target 5). An answer that arrives later is dropped, so nobody is moved off a
 * screen they already started to use.
 */
export const GOOGLE_SILENT_DEADLINE_MS = 4_000;

/**
 * How a {@link GoogleSignIn.start} that did not fail ended: the document or the app is
 * leaving for the next screen, or the person closed the system sheet, which is no
 * failure and gets no sentence.
 */
export type GoogleStartOutcome = 'leaving' | 'cancelled';

/**
 * The start of a Google sign in (velista `0171`, backend `0230`).
 *
 * The browser that starts the flow makes a verifier, keeps it in this tab's session
 * storage, and sends only its SHA-256 challenge to the gateway. The callback page trades
 * the code Google's redirect carries **and** the verifier for the pair. A link that
 * somebody else made lands on that page in a browser that holds no verifier, so it signs
 * nobody in and replaces nobody's session.
 *
 * The Google button on sign in, register, upgrade and the front door calls
 * {@link start}, and each page shows a refused start in its own way.
 *
 * ## In the Android app
 *
 * Google refuses its sign in page inside an embedded WebView, so the native shell
 * provides `GOOGLE_CREDENTIAL`, Android's own account picker (velista `0175`). With one,
 * {@link start} mints a nonce instead of a state, asks Android for an ID token with it,
 * and trades the token for the pair (backend `0238`). {@link trySilent} does the same
 * with no tap, for the front door. With none, which is the web, nothing here changes.
 *
 * Installed by `VELISTA_DATA_ACCESS_PROVIDERS` and not at the root (rule D5): it reaches
 * `ApiUrl` and `AuthApi`, which only the app injector holds. That injector lives once
 * per document, which is what makes the silent attempt once per document.
 */
@Injectable()
export class GoogleSignIn {
  private readonly _browser = inject(BrowserFacade);
  private readonly _api = inject(AuthApi);
  private readonly _urls = inject(ApiUrl);
  private readonly _credential = inject(GOOGLE_CREDENTIAL);
  private readonly _tokens = inject(TokenStore);
  private readonly _router = inject(Router);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Whether this document already spent its one silent attempt (velista `0175`, D3). */
  private _silentSpent = false;

  /**
   * Whether the front door should try {@link trySilent}: a native picker exists, this
   * document has not tried yet, nobody holds a session (a guest included: a session
   * that exists is kept by its refresh token, D3), and no sign out switched it off. The
   * front door adds what this cannot know: the deployment's feature switch.
   */
  silentSignInAllowed(): boolean {
    return (
      this._credential !== null &&
      !this._silentSpent &&
      !this._tokens.hasSession() &&
      this._browser.readStorage(StorageKeys.googleAutoSignInOff) === null
    );
  }

  /**
   * Sign in with no tap, when one Google account on the phone already approved this
   * app (velista `0175`, target 3). Answers whether the app is now signed in and on
   * its way home.
   *
   * Never throws and never shows anything: a refusal of any kind is `false`, and
   * `google_sign_in_needs_consent` (an account Google knows but this app does not) is
   * just one more. Once per document, whoever calls it. Abandoned after
   * {@link GOOGLE_SILENT_DEADLINE_MS}: the answer is then `false`, and a token or a
   * pair that arrives later is dropped rather than signing somebody in under a screen
   * they have started to use.
   */
  async trySilent(): Promise<boolean> {
    const credential = this._credential;
    if (credential === null || !this.silentSignInAllowed()) {
      return false;
    }
    this._silentSpent = true;

    let abandoned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        abandoned = true;
        resolve(false);
      }, GOOGLE_SILENT_DEADLINE_MS);
    });

    const attempt = (async (): Promise<boolean> => {
      // No terms version: a silent sign in accepts nothing on anybody's behalf, and
      // the server only opens an account this Google identity already opens.
      const { nonce, clientId } = await this._api.mintGoogleNonce({
        silent: true,
        acceptedTermsVersion: null,
      });
      const idToken = await credential.getIdToken({
        serverClientId: clientId,
        nonce,
        silent: true,
      });
      if (idToken === null || abandoned) {
        return false;
      }

      const tokens = await this._api.signInWithGoogleIdToken(idToken);
      // A session that appeared meanwhile is never replaced by one nobody asked for.
      if (abandoned || this._tokens.hasSession()) {
        return false;
      }

      this._tokens.set(tokens);
      void this._router.navigateByUrl(this._home());
      return true;
    })().catch(() => false);

    try {
      return await Promise.race([attempt, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stop the automatic sign in on this device until the person picks Google again
   * (velista `0175`, D4). Called by sign out and by the account deletion that clears
   * the pair; without it, the next open signs the person straight back in.
   *
   * Nothing on the web, where there is no picker and no automatic sign in. Android is
   * told to forget the account too, and its refusal changes nothing here: the flag is
   * what the front door reads.
   */
  stopAutoSignIn(): void {
    const credential = this._credential;
    if (credential === null) {
      return;
    }

    this._browser.writeStorage(StorageKeys.googleAutoSignInOff, 'true');
    void credential.forget().catch(() => undefined);
  }

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
   *
   * `acceptedTermsVersion` is the version the line under the button names, read from
   * the operator's settings at the press, or null when the deployment published no
   * terms (velista `0173`). It goes in the mint's body beside the challenge, where a
   * stale one is refused as `terms_version_stale` before the document leaves.
   *
   * In the Android app the same press takes the native path instead (see the class
   * comment). It answers `cancelled` when the person closed the system sheet, so the
   * page lets go of its busy state and says nothing, and `leaving` everywhere else.
   */
  async start(options: {
    readonly acceptedTermsVersion: string | null;
  }): Promise<GoogleStartOutcome> {
    if (this._credential !== null) {
      return this._startNative(this._credential, options.acceptedTermsVersion);
    }

    const verifier = base64url(this._browser.randomBytes(VERIFIER_BYTES));
    this._browser.writeSessionStorage(GOOGLE_VERIFIER_KEY, verifier);

    let state: string;
    try {
      const challenge = base64url(
        new Uint8Array(await this._browser.sha256(ascii(verifier)))
      );
      state = await this._api.mintGoogleState(
        challenge,
        options.acceptedTermsVersion
      );
    } catch (error) {
      this._browser.removeSessionStorage(GOOGLE_VERIFIER_KEY);
      throw error;
    }

    this._browser.assignDocument(
      this._urls.gateway('/v1/auth/google?state=' + encodeURIComponent(state))
    );
    return 'leaving';
  }

  /**
   * A press on Google in the Android app (velista `0175`, target 3).
   *
   * The nonce carries what the state carries on the web: the guest's bearer goes with
   * the mint through the interceptor, so a guest is linked in place, and the version
   * of the terms the line under the button names goes in its body. The ID token lives
   * in this frame only, from Android's answer to the post. The pair is stored and the
   * app goes home, as the callback page does at the end of the web flow.
   *
   * Every failure rejects as the web path does, the error as it arrived, so each page
   * keeps its own refusal copy.
   */
  private async _startNative(
    credential: GoogleCredentialI,
    acceptedTermsVersion: string | null
  ): Promise<GoogleStartOutcome> {
    const { nonce, clientId } = await this._api.mintGoogleNonce({
      silent: false,
      acceptedTermsVersion,
    });
    const idToken = await credential.getIdToken({
      serverClientId: clientId,
      nonce,
      silent: false,
    });
    if (idToken === null) {
      return 'cancelled';
    }

    this._tokens.set(await this._api.signInWithGoogleIdToken(idToken));
    // A deliberate Google sign in turns the automatic one back on (D4).
    this._browser.removeStorage(StorageKeys.googleAutoSignInOff);
    await this._router.navigateByUrl(this._home());
    return 'leaving';
  }

  private _home(): string {
    return appPath(this._locale(), this._basePath, 'home');
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
