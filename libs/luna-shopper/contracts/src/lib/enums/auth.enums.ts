/**
 * Identity enums shared across services (plan 0005).
 *
 * These are the cross service contract: the token `kind` claim and the auth
 * provider names travel between auth, the gateway and core, so they live here in
 * `contracts` rather than inside the auth service. String values are the wire
 * format and must stay stable.
 */

/** Whether an identity is a throwaway zone token holder or a real account. */
export enum UserKind {
  TEMPORARY = 'TEMPORARY',
  REGISTERED = 'REGISTERED',
}

/** How a registered user authenticates. `EMAIL` is email + password. */
export enum AuthProvider {
  GOOGLE = 'GOOGLE',
  EMAIL = 'EMAIL',
}
