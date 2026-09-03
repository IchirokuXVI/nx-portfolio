import { toDeployment, type Deployment } from './deployment';

/**
 * Everything `GET /v1/admin/environment` answers, for a caller with no token.
 *
 * Two facts rather than one, and they arrive together because they come from one
 * unauthenticated call the app already makes before anything renders: which
 * deployment this is (plan 0001, section 6) and whether it will sign the
 * operator in without a password (plan 0002, section 5).
 */
export interface AdminEnvironment {
  /**
   * The deployment, or `null` when the gateway did not answer or named one this
   * app does not recognise. The two are not told apart because what the screen
   * does about either is the same, and it is the only safe thing to do: say so,
   * rather than pick a colour.
   */
  readonly deployment: Deployment | null;
  /**
   * Whether the server will issue a token with no password.
   *
   * **False unless the server explicitly said true**, which is the whole point.
   * The client never decides for itself that it is in development: an
   * unreachable gateway, a body that did not parse, a deployment that predates
   * the field, and an explicit `false` are one answer, and it is the answer that
   * shows the login screen.
   */
  readonly devAutologin: boolean;
}

/** What the app assumes before it has been told anything: nothing, safely. */
export const UNKNOWN_ENVIRONMENT: AdminEnvironment = {
  deployment: null,
  devAutologin: false,
};

/**
 * The environment payload, as this app's own type (rule D4).
 *
 * Total: every input produces an `AdminEnvironment`, because there is no useful
 * distinction here between "did not answer" and "answered something I cannot
 * read". Both mean the app knows nothing, and {@link UNKNOWN_ENVIRONMENT} is
 * what knowing nothing looks like.
 */
export function toAdminEnvironment(value: unknown): AdminEnvironment {
  if (typeof value !== 'object' || value === null) {
    return UNKNOWN_ENVIRONMENT;
  }

  const body = value as Record<string, unknown>;

  return {
    deployment: toDeployment(body['environment']),
    // `=== true` rather than a truthiness check, so a string, a number or an
    // object cannot turn into permission to skip authentication.
    devAutologin: body['devAutologin'] === true,
  };
}
