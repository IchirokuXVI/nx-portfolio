import { CommentAudio } from './comment-audio.entity';
import { LineComment } from './line-comment.entity';
import { ListAccess } from './list-access.entity';
import { ListLineItem } from './list-line-item.entity';
import { ListLine } from './list-line.entity';
import { MergeRequest } from './merge-request.entity';
import { ProcessedEvent } from './processed-event.entity';
import { ShoppingList } from './shopping-list.entity';
import { ZoneMembership } from './zone-membership.entity';
import { Zone } from './zone.entity';

export { BaseEntity } from './base.entity';
export { CommentAudio } from './comment-audio.entity';
export { LineComment } from './line-comment.entity';
export { ListAccess } from './list-access.entity';
export { ListLineItem } from './list-line-item.entity';
export { ListLine } from './list-line.entity';
export { MergeRequest } from './merge-request.entity';
export { ProcessedEvent } from './processed-event.entity';
export { ShoppingList } from './shopping-list.entity';
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
];
