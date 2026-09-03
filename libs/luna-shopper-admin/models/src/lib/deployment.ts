/**
 * Which deployment the app is talking to (plan 0001, section 6).
 *
 * The three names the gateway answers with on `GET /v1/admin/environment`, and the
 * same three the backend's `DEPLOYMENT_ENVIRONMENT` is validated against. They are
 * restated here rather than imported: the backend's copy is a Node library this
 * browser bundle has no business depending on, and rule D4 says the frontend owns
 * its own enums and maps into them from `unknown` rather than trusting a payload.
 */
export const DEPLOYMENTS = ['production', 'staging', 'development'] as const;

export type Deployment = (typeof DEPLOYMENTS)[number];

/**
 * The deployment named in a response, or `null` when the value is not one this app
 * knows.
 *
 * `null` rather than a guess, and that is the whole design of this screen: an
 * unrecognised name means the app cannot say which database is behind it, and
 * saying so is safe where quietly choosing one is not. The failure being guarded
 * against is believing you are in staging when you are in production, and a
 * fallback to any particular name is a way of producing exactly that belief.
 */
export function toDeployment(value: unknown): Deployment | null {
  return DEPLOYMENTS.includes(value as Deployment)
    ? (value as Deployment)
    : null;
}
