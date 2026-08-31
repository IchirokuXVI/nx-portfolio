import { CommentAudio } from './comment-audio.entity';
import { GeneratedListLineOption } from './generated-list-line-option.entity';
import { GeneratedListLineOrigin } from './generated-list-line-origin.entity';
import { GeneratedListLine } from './generated-list-line.entity';
import { GeneratedList } from './generated-list.entity';
import { LineComment } from './line-comment.entity';
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
export { GeneratedListLineOption } from './generated-list-line-option.entity';
export { GeneratedListLineOrigin } from './generated-list-line-origin.entity';
export { GeneratedListLine } from './generated-list-line.entity';
export { GeneratedList } from './generated-list.entity';
export { LineComment } from './line-comment.entity';
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
  CommentAudio,
  MergeRequest,
  ProcessedEvent,
  // Shopping profiles (plan 0049). The parent comes first: its three child
  // tables all reference it.
  ShoppingProfile,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ProfileGenerationSource,
  // Generated shopping lists (plan 0050). The basket comes first: its lines
  // reference it, and the origins and options reference the lines.
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOrigin,
  GeneratedListLineOption,
];
