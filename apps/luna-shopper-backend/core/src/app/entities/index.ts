import { CommentAudio } from './comment-audio.entity';
import { LineComment } from './line-comment.entity';
import { LineSettlement } from './line-settlement.entity';
import { ListAccess } from './list-access.entity';
import { ListLineItem } from './list-line-item.entity';
import { ListLine } from './list-line.entity';
import { MergeRequest } from './merge-request.entity';
import { ProcessedEvent } from './processed-event.entity';
import { ProfileGenerationSource } from './profile-generation-source.entity';
import { ProfilePostalCode } from './profile-postal-code.entity';
import { ProfileSupermarketPreference } from './profile-supermarket-preference.entity';
import { ShoppingList } from './shopping-list.entity';
import { ShoppingProfile } from './shopping-profile.entity';
import { ZoneMembership } from './zone-membership.entity';
import { Zone } from './zone.entity';

export { BaseEntity } from './base.entity';
export { CommentAudio } from './comment-audio.entity';
export { LineComment } from './line-comment.entity';
export { LineSettlement } from './line-settlement.entity';
export { ListAccess } from './list-access.entity';
export { ListLineItem } from './list-line-item.entity';
export { ListLine } from './list-line.entity';
export { MergeRequest } from './merge-request.entity';
export { ProcessedEvent } from './processed-event.entity';
export { ProfileGenerationSource } from './profile-generation-source.entity';
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
  ProfileGenerationSource,
];
