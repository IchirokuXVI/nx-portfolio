import { SUPERMARKETS } from '@portfolio/luna-shopper-admin/feature-catalog';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';

/**
 * Every resource this app has, in the order the navigation shows them.
 *
 * The list belongs to the app, because it is the app that decides which screens
 * exist. It is what the route table is built from and what the navigation is
 * read from, so a resource cannot end up reachable without a link or linked
 * without a route.
 *
 * One entry, today. That is the whole of `0004`'s exit criterion: supermarkets
 * working end to end through the generic machinery is the proof that the
 * descriptor is sufficient, and `0005` to `0007` add the other fourteen by
 * adding lines here.
 */
export const ADMIN_RESOURCES: readonly AnyResourceDescriptor[] = [SUPERMARKETS];
