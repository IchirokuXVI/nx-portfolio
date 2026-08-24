# 0011 Account deletion and zone ownership fallback

Built **after realtime (0009)**, per the decision that account deletion follows websockets. It
adds the ability to delete an account and the cross service handling of what that does to the
zones the account touched, including the ownerless zone lifecycle whose model was already put in
place in 0006.

## 1. Account deletion (auth side)

- `auth.deleteAccount` for the authenticated user (temporary or registered). Auth deletes the
  `User` and everything personal it owns: `Credential`, `OAuthIdentity`, `EmailVerification`,
  `RefreshToken`. This satisfies the "right to be forgotten" for the identity data, which lives
  only in auth.
- Auth emits `user.deleted { userId }`. The operation is idempotent (a redelivered event is a
  no op if the user is already gone).

## 2. Core reaction (the saga)

Core subscribes to `user.deleted` and, in an idempotent handler, for each membership the user
held:

- **If the user owned the zone**: apply the ownerless flow from 0006 section 5, set
  `ownerUserId = null` and `status = MARKED_FOR_DELETION`, emit `zone.markedForDeletion`, and
  notify members over realtime. An admin may `zone.claimOwnership` to rescue it.
- **Remove or retire the membership**: the departing user's `ZoneMembership` is removed. Content
  they authored (lists, lines, comments) is **retained** so the zone's data stays intact, but the
  author reference is anonymized: the opaque `userId` remains as an author key while their per
  zone `username` is scrubbed to a neutral placeholder (for example "former member"). Whether to
  scrub the username or keep it is a small policy choice flagged here; the default is to scrub,
  since it is the only arguably personal field core holds.

Because core only ever stored an opaque `userId` plus a per zone username, there is little
personal data on this side, which keeps the deletion saga simple.

## 3. Cleanup jobs

- **Zone reaper (core)**: a scheduled job deletes zones in `MARKED_FOR_DELETION` that are past a
  configurable grace period with no owner claim, cascading their lists, lines, and comments.
- **Orphan temporary user reaper (auth + core)**: the job annotated in 0005 deletes temporary
  users that hold no zone membership after a grace period. Core is the authority on membership,
  so it either emits the "user has no memberships" signal or answers a periodic reconciliation
  query from the job.

Both grace periods are configuration values.

## 4. Exit criteria

- A user can delete their account; their identity data in auth is removed and `user.deleted` is
  emitted.
- Owned zones become ownerless and marked for deletion, rescuable by an admin claim; other
  memberships are removed with authored content retained and the author anonymized.
- The zone reaper deletes abandoned marked zones after the grace period; the orphan temporary
  user reaper removes membership free temporary accounts.
- All event handlers are idempotent.
