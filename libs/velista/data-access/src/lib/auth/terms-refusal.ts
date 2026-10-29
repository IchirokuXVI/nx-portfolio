import { GatewayError } from '../errors';
import { str } from '../mapping/primitives';

/**
 * A refusal about the terms, read off a failure (backend `0231`, section 4.3).
 *
 * - `stale`: a version was sent and it is no longer the current one, so the person read
 *   a text that has changed since (`terms_version_stale`, 409).
 * - `missing`: none was sent where the deployment requires one
 *   (`terms_acceptance_missing`, 400). This build sends one on every path that makes an
 *   account, so it means the settings were not there to read at the press.
 */
export interface TermsRefusal {
  readonly kind: 'stale' | 'missing';
  /** The version the server asks for now, or the empty string when it named none. */
  readonly currentVersion: string;
}

/**
 * Whether a failure is a refusal about the terms, and which (velista `0173`, target 2).
 *
 * Pure, and the one place that knows the two codes: every screen that makes an account
 * asks this before it picks its own sentence. Anything else answers null and keeps the
 * screen's own copy.
 */
export function termsRefusal(error: unknown): TermsRefusal | null {
  if (!(error instanceof GatewayError)) {
    return null;
  }

  const kind =
    error.code === 'terms_version_stale'
      ? 'stale'
      : error.code === 'terms_acceptance_missing'
        ? 'missing'
        : null;
  if (kind === null) {
    return null;
  }

  return {
    kind,
    currentVersion: str(error.details?.['currentVersion']) ?? '',
  };
}
