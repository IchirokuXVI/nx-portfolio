import { BasketSource } from './basket-source.entity';
import { BasketTripRow } from './basket-trip-row.entity';
import { CommentAudio } from './comment-audio.entity';
import { CoreAudit } from './core-audit.entity';
import { GeneratedListLineOption } from './generated-list-line-option.entity';
import { GeneratedListLineOrigin } from './generated-list-line-origin.entity';
import { GeneratedListLine } from './generated-list-line.entity';
import { GeneratedListParticipant } from './generated-list-participant.entity';
import { GeneratedListShareLink } from './generated-list-share-link.entity';
import { GeneratedList } from './generated-list.entity';
import { LineComment } from './line-comment.entity';
import { LineSettlement } from './line-settlement.entity';
import { ListAccess } from './list-access.entity';
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
import { ZoneMembership } from './zone-membership.entity';
import { Zone } from './zone.entity';

export { BaseEntity } from './base.entity';
export { BasketSource } from './basket-source.entity';
export { BasketTripRow } from './basket-trip-row.entity';
export { CommentAudio } from './comment-audio.entity';
export {
  CoreAudit,
  CoreAuditAction,
  CoreAuditActorKind,
} from './core-audit.entity';
export { GeneratedListLineOption } from './generated-list-line-option.entity';
export { GeneratedListLineOrigin } from './generated-list-line-origin.entity';
export { GeneratedListLine } from './generated-list-line.entity';
export { GeneratedListParticipant } from './generated-list-participant.entity';
export { GeneratedListShareLink } from './generated-list-share-link.entity';
export { GeneratedList } from './generated-list.entity';
export { LineComment } from './line-comment.entity';
export { LineSettlement } from './line-settlement.entity';
export { ListAccess } from './list-access.entity';
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
  GeneratedList,
  // What the run was asked to draw from (plan 0133). After the basket it hangs
  // off, and it also references zones and lists, which are created far above.
  BasketSource,
  GeneratedListLine,
  GeneratedListLineOrigin,
  GeneratedListLineOption,
  // Sharing a basket with people who have no account (plan 0051). The link comes
  // before the participants, which reference the link they arrived by.
  GeneratedListShareLink,
  GeneratedListParticipant,
  // What each finished trip asked of each zone line (plan 0135). After the
  // basket and the zone line it hangs off, since it references both.
  BasketTripRow,
  // The audit trail (plan 0077, section 8). Last, because it references
  // nothing and nothing references it: the actor lives in auth's database and
  // the row it describes is named by table and id rather than by a foreign key.
  CoreAudit,
];
