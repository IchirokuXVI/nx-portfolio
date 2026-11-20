import { PageQueryDto } from '@portfolio/luna-shopper/platform';

/**
 * The probes of one chain, newest first (plan 0219, section 8). `limit` is 1
 * to 100 and 20 when absent, as on every page of this gateway.
 */
export class SourceProbeListQueryDto extends PageQueryDto {}
