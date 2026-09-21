import type {
  GeneratedListParticipantView,
  GeneratedListShareLinkView,
} from '@portfolio/luna-shopper/contracts';
import type {
  GeneratedListParticipant,
  GeneratedListShareLink,
} from '../entities';

/**
 * Entities to wire views for sharing (plan 0051).
 *
 * Separate functions rather than a `toJSON` on the entities, matching the rest of
 * core: what a row holds and what a caller is allowed to see are two different
 * questions, and this file is where the second one is answered.
 */

/**
 * The share sheet's view of the live link (plan 0051, section 3).
 *
 * `secret` is included **on every read**, which is the deliberate asymmetry with
 * a participant's session secret. The owner has to be able to copy the invitation
 * again tomorrow, from another device, for the next person, so a link secret is
 * stored retrievably and served every time, while a credential is hashed and
 * shown once (section 3.1).
 */
export function toShareLinkView(
  link: GeneratedListShareLink,
  participantCount: number
): GeneratedListShareLinkView {
  return {
    id: link.id,
    generatedListId: link.generatedListId,
    secret: link.secret,
    createdByParticipantId: link.createdByParticipantId,
    createdAt: link.createdAt.toISOString(),
    // Never null since plan 0140: every link ends twelve hours after it was
    // minted, and the share sheet draws a countdown from this.
    expiresAt: link.expiresAt.toISOString(),
    participantCount,
  };
}

/**
 * One person on a basket (plan 0051, sections 3.5 and 7).
 *
 * `withDevice` is section 7's rule rather than a convenience flag: a
 * participant's `userAgent` and join time are shown on tap, **to participants who
 * pass section 5.2 only**, because guests do not get to inspect each other. The
 * field is left off entirely rather than nulled when the reader may not have it,
 * so "you cannot see this" and "there is nothing to see" stay distinguishable.
 *
 * `sessionSecretHash` is never mapped anywhere. It is a credential, and the view
 * that carries it does not exist.
 */
export function toParticipantView(
  participant: GeneratedListParticipant,
  withDevice: boolean
): GeneratedListParticipantView {
  return {
    id: participant.id,
    kind: participant.kind,
    // Unverified text on an unauthenticated link (section 3.5): what the screen
    // shows, never what the record keeps. The id above is the attribution.
    displayName: participant.displayName,
    // The account's own name, beside the typed one rather than instead of it
    // (plan 0054, section 2.3): a client shows `displayName` when the person
    // typed one, because they said it on purpose, and falls back to this rather
    // than to a role. Null for a guest, who has no account behind them.
    username: participant.username,
    guestNumber: participant.guestNumber,
    userId: participant.userId,
    shareLinkId: participant.shareLinkId,
    // When this person's access ends, on **every** projection (plan 0140,
    // section 8), and deliberately not behind `withDevice`: the people sheet
    // offers "keep" for everybody who carries one, and the shopper themselves
    // needs the warning. Null for the owner and for a person added by name.
    expiresAt: participant.expiresAt?.toISOString() ?? null,
    // Join time and last seen travel with the device string, as the comment above
    // always said they did (plan 0114, section 11): when somebody arrived is part
    // of inspecting them, and guests do not get to inspect each other.
    ...(withDevice
      ? {
          joinedAt: participant.joinedAt.toISOString(),
          lastSeenAt: participant.lastSeenAt.toISOString(),
          userAgent: participant.userAgent,
        }
      : {}),
  };
}
