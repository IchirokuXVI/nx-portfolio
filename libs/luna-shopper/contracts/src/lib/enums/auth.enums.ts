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

/**
 * How far a change to the global username travels (plan 0018, section 4.1).
 *
 * A user's per zone names are copies, not derivations, so a global rename has to
 * say what should happen to them. The default leaves every zone alone: someone
 * who deliberately became "Mamá" in the family zone should not lose that by
 * editing their profile.
 */
export enum UsernamePropagation {
  /** Default. Only `users.username` changes; no membership is touched. */
  GLOBAL_ONLY = 'GLOBAL_ONLY',
  /** Also rename memberships whose username equals the OLD global username. */
  MATCHING_ZONES = 'MATCHING_ZONES',
  /** Also rename every membership, whatever it was called. */
  ALL_ZONES = 'ALL_ZONES',
}
