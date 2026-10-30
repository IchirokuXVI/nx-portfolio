import { InjectionToken } from '@angular/core';

/** What the app asks the operating system for (velista `0175`). */
export interface GoogleCredentialRequest {
  /**
   * The web client of the Google project, from the gateway's nonce answer (backend
   * `0238`, D2). Android names it as the audience of the token it returns.
   */
  readonly serverClientId: string;
  /** The single use nonce the gateway minted, which the token carries back. */
  readonly nonce: string;
  /**
   * True to ask only for an account that already approved this app, with no tap.
   * False shows the system's "Sign in with Google" sheet.
   */
  readonly silent: boolean;
}

/**
 * The operating system's Google account picker, behind a seam a native shell provides
 * (velista `0175`).
 *
 * Google refuses its sign in page inside an embedded WebView, so the native app cannot
 * run the redirect flow of `0171`. Android's Credential Manager hands the app a Google
 * ID token instead, and the gateway trades that token for the pair.
 */
export interface GoogleCredentialI {
  /**
   * A Google ID token for this request, or null when the person closed the sheet or
   * the phone holds no account that can answer. Throws for everything else (no Play
   * services, a refused configuration, a failure inside Android).
   *
   * The token is handed to one post and to nothing else: never logged, stored or kept.
   */
  getIdToken(request: GoogleCredentialRequest): Promise<string | null>;

  /** Tell Android to stop choosing an account by itself, after a sign out. */
  forget(): Promise<void>;
}

/**
 * The Google account picker of the host, or null where there is none.
 *
 * Null by default from a root factory, so the web app, a server render and every spec
 * get no picker without providing anything, and the code that reads it asks "is there
 * one" rather than "which host is this". The web keeps the redirect flow of `0171`
 * whatever this says. The native shell provides its implementation in
 * `provideNativeShell()`.
 */
export const GOOGLE_CREDENTIAL = new InjectionToken<GoogleCredentialI | null>(
  'GOOGLE_CREDENTIAL',
  {
    providedIn: 'root',
    factory: () => null,
  }
);
