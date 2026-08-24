import { ZoneMembership } from './zone-membership.entity';
import { Zone } from './zone.entity';

export { BaseEntity } from './base.entity';
export { ZoneMembership } from './zone-membership.entity';
export { Zone } from './zone.entity';

/** Every core entity, for TypeOrmModule registration and the CLI data source. */
export const CORE_ENTITIES = [Zone, ZoneMembership];
