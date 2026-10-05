// Named, and not `export *`: what this library offers the app is its
// descriptors, its section's route table and the counter of its rail entry.
// The option lists of the descriptors and the pieces a page is built from are
// its own (admin plan 0045, section 1).
export { ADMINS, toAdminPage, type Admin } from './lib/admins';
export {
  basketSettlements,
  toBasketSettlement,
  toSettlementOutcome,
  type BasketSettlementView,
  type SettlementOutcome,
} from './lib/basket-settlements';
export { BASKETS, BASKET_INFO, ZONE_BASKETS, type Basket } from './lib/baskets';
export { LIST_LINES, type ListLine } from './lib/list-lines';
export { LISTS, LIST_INFO, type List } from './lib/lists';
export { MEMBERSHIPS, type Membership } from './lib/memberships';
export { oldShopperAddresses } from './lib/old-addresses';
export { day, instant } from './lib/people-format';
export * from './lib/people-seed';
export {
  BASKET_PARAM,
  DETAILS_TAB,
  EDIT_SEGMENT,
  LIST_PARAM,
  PERSON_PARAM,
  PERSON_ZONES_TAB,
  ZONE_CAUTION,
  ZONE_PARAM,
} from './lib/shopper-params';
export { SHOPPERS_INFO, ShoppersPage } from './lib/shoppers-page';
export { SHOPPER_RESOURCES, shoppersRoutes } from './lib/shoppers-routes';
export { ShoppersStatus } from './lib/shoppers-status';
export { USER_ROLE_OPTIONS, rolesCell } from './lib/user-roles';
export { USERS, isUnconfirmed, type User } from './lib/users';
export { ZONES, type Zone } from './lib/zones';
