import { BasketChangeCursor } from './basket-change-cursor.entity';
import { BasketLineSkip } from './basket-line-skip.entity';
import { BasketSource } from './basket-source.entity';
import { BasketTripRow } from './basket-trip-row.entity';
import { CommentAudio } from './comment-audio.entity';
import { CoreAudit } from './core-audit.entity';
import { BasketParticipant } from './basket-participant.entity';
import { BasketShareLink } from './basket-share-link.entity';
import { Basket } from './basket.entity';
import { LineComment } from './line-comment.entity';
import { LineSettlement } from './line-settlement.entity';
import { ListAccess } from './list-access.entity';
import { ListLineChange } from './list-line-change.entity';
import { ListLineGroupRemoval } from './list-line-group-removal.entity';
import { ListLineItem } from './list-line-item.entity';
import { ListLine } from './list-line.entity';
import { MergeRequest } from './merge-request.entity';
import { ProcessedEvent } from './processed-event.entity';
import { ProfileGenerationSource } from './profile-generation-source.entity';
import { ProfileLocationPreference } from './profile-location-preference.entity';
import { ProfilePostalCode } from './profile-postal-code.entity';
import { ProfileSupermarketPreference } from './profile-supermarket-preference.entity';
import { ShoppingList } from './shopping-list.entity';
import { ShoppingProfile } from './shopping-profile.entity';
import { UserAppState } from './user-app-state.entity';
import { ZoneMembership } from './zone-membership.entity';
import { Zone } from './zone.entity';

export { BaseEntity } from './base.entity';
export { BasketChangeCursor } from './basket-change-cursor.entity';
export { BasketLineSkip } from './basket-line-skip.entity';
export { BasketSource } from './basket-source.entity';
export { BasketTripRow } from './basket-trip-row.entity';
export { CommentAudio } from './comment-audio.entity';
export {
  CoreAudit,
  CoreAuditAction,
  CoreAuditActorKind,
} from './core-audit.entity';
export { BasketParticipant } from './basket-participant.entity';
export { BasketShareLink } from './basket-share-link.entity';
export { Basket } from './basket.entity';
export { LineComment } from './line-comment.entity';
export { LineSettlement } from './line-settlement.entity';
export { ListAccess } from './list-access.entity';
export { ListLineChange } from './list-line-change.entity';
export { ListLineGroupRemoval } from './list-line-group-removal.entity';
export { ListLineItem } from './list-line-item.entity';
export { ListLine } from './list-line.entity';
export { MergeRequest } from './merge-request.entity';
export { ProcessedEvent } from './processed-event.entity';
export { ProfileGenerationSource } from './profile-generation-source.entity';
export { ProfileLocationPreference } from './profile-location-preference.entity';
export { ProfilePostalCode } from './profile-postal-code.entity';
export { ProfileSupermarketPreference } from './profile-supermarket-preference.entity';
export { ShoppingList } from './shopping-list.entity';
export { ShoppingProfile } from './shopping-profile.entity';
export { UserAppState } from './user-app-state.entity';
export { ZoneMembership } from './zone-membership.entity';
export { Zone } from './zone.entity';

/** Every core entity, for TypeOrmModule registration and the CLI data source. */
export const CORE_ENTITIES = [
  Zone,
  ZoneMembership,
  ShoppingList,
  ListAccess,
  ListLine,
  ListLineItem,
  // What a person took off the set their line's group put there (plan 0070).
  // After the line it hangs off, like every other child table here.
  ListLineGroupRemoval,
  LineComment,
  // What happened to a line on a trip (plan 0047). After the line it references.
  LineSettlement,
  CommentAudio,
  MergeRequest,
  ProcessedEvent,
  // Shopping profiles (plan 0049). The parent comes first: its three child
  // tables all reference it.
  ShoppingProfile,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  // The finer axis beside the chain preference (plan 0064). Same parent, same
  // cascade, so it sits with its siblings.
  ProfileLocationPreference,
  ProfileGenerationSource,
  // Generated shopping lists (plan 0050). The basket comes first: its lines
  // reference it, and the origins and options reference the lines.
  Basket,
  // What the run was asked to draw from (plan 0133). After the basket it hangs
  // off, and it also references zones and lists, which are created far above.
  BasketSource,
  // Sharing a basket with people who have no account (plan 0051). The link comes
  // before the participants, which reference the link they arrived by.
  BasketShareLink,
  BasketParticipant,
  // What each finished trip asked of each zone line (plan 0135). After the
  // basket and the zone line it hangs off, since it references both.
  BasketTripRow,
  // One basket's "not today" on one covered line (plan 0137). Beside the
  // trip rows, for the same reason: it references the basket and the zone line.
  BasketLineSkip,
  // What changed on a list (plan 0138). After the list it cascades with. Its
  // `lineId`, `basketId` and the two actor columns carry no foreign key, so the
  // list is the only table it has to follow.
  ListLineChange,
  // What one viewer has seen of those changes (plan 0138). After the
  // participants it cascades with.
  BasketChangeCursor,
  // What this account has been shown (plan 0145). It references nothing and
  // nothing references it: the account lives in auth's database and is named
  // here by the opaque `userId` that is also this table's primary key.
  UserAppState,
  // The audit trail (plan 0077, section 8). Last, because it references
  // nothing and nothing references it: the actor lives in auth's database and
  // the row it describes is named by table and id rather than by a foreign key.
  CoreAudit,
];
