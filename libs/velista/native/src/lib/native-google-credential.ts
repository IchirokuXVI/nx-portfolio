import { inject, Injectable } from '@angular/core';
import type {
  GoogleCredentialI,
  GoogleCredentialRequest,
} from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';

/**
 * Why Android gave no token, when the reason is not one of the two quiet ones.
 *
 * Carries the plugin's code and nothing else, so a caller can tell "no Play services"
 * from "failed" without the plugin's message, which is Android's own wording.
 */
export class NativeGoogleCredentialError extends Error {
  constructor(readonly code: string) {
    super(`VelistaGoogle refused: ${code}`);
    this.name = 'NativeGoogleCredentialError';
  }
}

/**
 * Google's account picker through the app's own `VelistaGoogle` plugin (velista
 * `0175`, target 2).
 *
 * A closed sheet and a phone with no account that can answer are both null, because
 * neither is a failure to report: the person chose, or there was nothing to choose.
 * Every other refusal throws, and the caller decides what to show.
 */
@Injectable({ providedIn: 'root' })
export class NativeGoogleCredential implements GoogleCredentialI {
  private readonly _plugins = inject(NATIVE_PLUGINS);

  async getIdToken(request: GoogleCredentialRequest): Promise<string | null> {
    const { google } = await this._plugins();

    let answer: unknown;
    try {
      answer = await google.getIdToken({
        serverClientId: request.serverClientId,
        nonce: request.nonce,
        silent: request.silent,
      });
    } catch (error: unknown) {
      const code = codeOf(error);
      if (code === 'cancelled' || code === 'no_credential') {
        return null;
      }
      throw new NativeGoogleCredentialError(code ?? 'failed');
    }

    // Read from `unknown`, as any answer from outside the bundle is (rule D4).
    const idToken =
      typeof answer === 'object' && answer !== null
        ? (answer as { idToken?: unknown }).idToken
        : undefined;
    if (typeof idToken !== 'string' || idToken === '') {
      throw new NativeGoogleCredentialError('failed');
    }

    return idToken;
  }

  async forget(): Promise<void> {
    const { google } = await this._plugins();
    await google.forget();
  }
}

function codeOf(error: unknown): string | null {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : null;
}
