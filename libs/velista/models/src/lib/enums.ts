/**
 * The app's own enums, and the fallback each one uses for a value it does not know.
 *
 * Rule D4 (plan 0004, section 4.1): the frontend owns its models, so it owns its
 * enums too. These are unions of string literals rather than re-exports of the
 * backend's TypeScript `enum`s, for two reasons:
 *
 * - **A newer backend can send a value this build has never heard of.** A phone can
 *   be running a bundle cached days before the deploy that added a status. Mapping
 *   into a closed union with a defined fallback turns that from a crash or an
 *   unstyled string into a state the UI already handles.
 * - **A union of literals is a type, not a value.** Nothing here needs a runtime
 *   import from `@portfolio/luna-shopper/contracts`, so every contracts import in the
 *   app is `import type` and is erased at compile time, which is what keeps the ajv
 *   the contracts barrel re-exports out of the bundle (plan 0004, section 9.3).
 *
 * The values match the backend's enum member values exactly, which is what makes the
 * mappers a validation step rather than a translation step. Keeping them identical is
 * deliberate and allowed: rule D4 asks that the model be **ours**, not that it differ.
 *
 * Every fallback below is chosen to be the **least dangerous** reading of an unknown
 * value, never the most convenient one.
 */

/** A caller's role in a zone. Unknown falls back to the least privileged role. */
export const ZONE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type ZoneRole = (typeof ZONE_ROLES)[number];
export const ZONE_ROLE_FALLBACK: ZoneRole = 'MEMBER';

/**
 * A zone's lifecycle state.
 *
 * `UNKNOWN` is a member here rather than a fallback onto `ACTIVE`, because `0003`
 * open question 2 already defines a treatment for a zone that is not normal: render
 * it as a plain, non-tappable card. An unrecognised status gets that same treatment,
 * which is safe, whereas guessing `ACTIVE` would offer a tap into a zone the backend
 * may have already torn down.
 */
export const ZONE_STATUSES = [
  'ACTIVE',
  'MARKED_FOR_DELETION',
  'UNKNOWN',
] as const;
export type ZoneStatus = (typeof ZONE_STATUSES)[number];
export const ZONE_STATUS_FALLBACK: ZoneStatus = 'UNKNOWN';

/**
 * A membership's state.
 *
 * Unknown falls back to `PENDING`, which renders as "waiting to be let in": no list
 * content, not tappable through. Falling back to `APPROVED` would show a member data
 * the backend may not have granted them.
 */
export const MEMBERSHIP_STATUSES = [
  'PENDING',
  'APPROVED',
  'KICKED',
  'BANNED',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export const MEMBERSHIP_STATUS_FALLBACK: MembershipStatus = 'PENDING';

/** Access to a single list. Unknown falls back to read only. */
export const LIST_ROLES = ['READER', 'WRITER'] as const;
export type ListRole = (typeof LIST_ROLES)[number];
export const LIST_ROLE_FALLBACK: ListRole = 'READER';

/** Where a line has got to on the shopping trip. Unknown reads as not yet done. */
export const LINE_STATUSES = ['PENDING', 'READY', 'NOT_AVAILABLE'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export const LINE_STATUS_FALLBACK: LineStatus = 'PENDING';

/** Whether a suggested line has been accepted. Unknown reads as still awaiting. */
export const LINE_APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;
export type LineApprovalStatus = (typeof LINE_APPROVAL_STATUSES)[number];
export const LINE_APPROVAL_STATUS_FALLBACK: LineApprovalStatus = 'PENDING';

/**
 * Whether the signed-in user has credentials of their own.
 *
 * Unknown falls back to `TEMPORARY`, so the guest banner in `0003` appears. Being
 * told to secure an account that is already secure is a small annoyance; not being
 * told, and then losing the phone, loses everything the user had.
 */
export const USER_KINDS = ['TEMPORARY', 'REGISTERED'] as const;
export type UserKind = (typeof USER_KINDS)[number];
export const USER_KIND_FALLBACK: UserKind = 'TEMPORARY';
