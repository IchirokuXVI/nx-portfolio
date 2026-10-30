import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { AuthConfig } from '../config/app-config';

/**
 * The two issuers a Google ID token may name (plan 0238, target state 2).
 * Stated here rather than left to the library, whose default list also accepts
 * the universe domain of Google Cloud, which no sign in token carries.
 */
export const GOOGLE_ID_TOKEN_ISSUERS = [
  'accounts.google.com',
  'https://accounts.google.com',
];

/** What a verified Google ID token says, reduced to what a sign in reads. */
export interface GoogleIdTokenClaims {
  /** The Google account id, stable for the life of the account. */
  sub: string;
  email?: string;
  /** True only when the token says `email_verified: true`. */
  emailVerified: boolean;
  name?: string;
  /** The nonce the app asked Google to sign in, if it asked for one. */
  nonce?: string;
}

/**
 * Verifies a Google ID token from the Android app (plan 0238).
 *
 * The one place that reaches `google-auth-library`, so every spec of the sign
 * in hands in a double and none reaches Google. The checks are the library's:
 * the signature against Google's published keys, the audience against
 * `GOOGLE_CLIENT_ID`, the issuer against {@link GOOGLE_ID_TOKEN_ISSUERS}, and
 * an expiry in the future. The audience is the **web** client: Android checks
 * the package and the signing key on the device, and the token that comes back
 * names the web client, so no Android client id appears on the server.
 *
 * **A refusal is `null` and never an error that carries the token.** The
 * library writes the whole token, or its whole payload, into the message of
 * most of its errors, so a message passed on would put a credential in a log
 * line or in a reply. Only the name of the error class is logged.
 *
 * A failure to fetch Google's keys is thrown, not answered as `null`: it says
 * nothing about the token, and a 401 for it would tell the person their Google
 * account was refused while Google was only unreachable.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);
  private readonly client = new OAuth2Client({
    issuers: GOOGLE_ID_TOKEN_ISSUERS,
  });
  private readonly audience: string;

  constructor(configService: ConfigService) {
    this.audience =
      configService.getOrThrow<AuthConfig>('auth').google.clientId;
  }

  async verify(idToken: string): Promise<GoogleIdTokenClaims | null> {
    if (!this.audience || !idToken) {
      return null;
    }
    // Fetched first, and cached by the client until Google's expiry, so that
    // `verifyIdToken` below reads the cache and every error it throws is about
    // the token.
    try {
      await this.client.getFederatedSignonCertsAsync();
    } catch {
      throw new Error("Google's signing keys could not be fetched");
    }

    let payload;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audience,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `A Google ID token was refused (${
          error instanceof Error ? error.name : typeof error
        })`
      );
      return null;
    }
    if (!payload?.sub) {
      return null;
    }
    return {
      sub: payload.sub,
      ...(payload.email ? { email: payload.email } : {}),
      emailVerified: payload.email_verified === true,
      ...(payload.name ? { name: payload.name } : {}),
      ...(typeof payload.nonce === 'string' ? { nonce: payload.nonce } : {}),
    };
  }
}
