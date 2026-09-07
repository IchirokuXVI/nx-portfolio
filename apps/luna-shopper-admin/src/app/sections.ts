import {
  CatalogDashboard,
  ITEMS,
  LOCATION_ITEMS,
  LOCATIONS,
  PRICE_POLICIES,
  PRICE_SCOPES,
  PRICES,
  PRODUCT_GROUPS,
  SUPERMARKETS,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import { DashboardPage } from '@portfolio/luna-shopper-admin/feature-dashboard';
import {
  HARVEST_LINKS,
  HARVEST_SEGMENT,
  HarvestDashboard,
  harvestRoutes,
  POSTAL_CODES,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  ADMINS,
  BASKETS,
  LIST_LINES,
  LISTS,
  MEMBERSHIPS,
  PeopleDashboard,
  USERS,
  ZONES,
} from '@portfolio/luna-shopper-admin/feature-people';
import type { AdminSection } from '@portfolio/luna-shopper-admin/feature-resource';

/**
 * The segment the catalog owns, for the rare screen that builds an absolute URL
 * into it by hand.
 *
 * Exported the way `HARVEST_SEGMENT` is, and used the same way: a **resource**
 * under this section is found through `ResourceRegistry.pathOf` and never
 * through this constant.
 */
export const CATALOG_SEGMENT = 'catalog';

/** The segment the shoppers section owns, for the same narrow use. */
export const SHOPPERS_SEGMENT = 'shoppers';

/**
 * Every section this app has, in the order the first row shows them, and every
 * screen inside each of them (admin plan 0022).
 *
 * One list where there were two. `ADMIN_RESOURCES` said which resources existed
 * and `SHELL_LINKS` said which hand written screens existed, and nothing said
 * which of them belonged together, so the navigation was twenty three links in
 * one wrapping row with "Price policies" beside "Baskets" beside "Chain
 * sources". Five is the number the first row holds at a glance, and eight is the
 * widest second row.
 *
 * The list stays the app's, for the reason `ResourceRegistry` already gives: it
 * is the app that decides which screens exist. It is what the route table is
 * built from **and** what the registry is read from, so a resource cannot end up
 * reachable without a link, linked without a route, or mounted without being
 * registered.
 *
 * ## Why these five, and why these names
 *
 * `Core` and `Auth` are the names of two backend deployments. They are the right
 * names in `values.staging.yaml` and in a NATS subject, and they are the wrong
 * names on a tab, because a tab names what the operator is about to look at and
 * nobody is about to look at a deployment.
 *
 * **Shoppers** for the section holding users, zones, memberships, lists, list
 * lines and baskets: the people who use velista and the things they own
 * together. Not *People*, which is `0007`'s own title and reads well until the
 * section next to it is full of admins, who are also people. Not *Users*, which
 * is one of the six screens inside it, and a section cannot carry the same word
 * as one of its members without an operator having to learn which is which. Not
 * *Accounts*, because an account is the auth idea and Auth is the next section
 * along. **Admins** for that one by the same rule, and because the section is
 * the admin account table and nothing else.
 *
 * ## Order
 *
 * The sections run in the order an operator meets them: the overview, then the
 * catalog, which is the half that gets edited; then the people and what they
 * share, which is read far more often than it is touched; then the harvester,
 * which produces most of the catalog; then the admin table, which is opened to
 * answer one question and never to change anything.
 *
 * Inside the catalog the order follows what an operator is holding in their head
 * rather than the alphabet. A chain, then the shops it has and the scopes it
 * prices against, because both belong to a chain and neither can be read without
 * naming one. Then the products, then the groups that make two products
 * comparable, then the prices, which need a product and a scope to exist at all.
 * Backend plan 0080 puts the price policies straight after the prices they
 * decide between. The per shop rows are last: they are the narrowest question in
 * the catalog and the one asked least often.
 *
 * Among the shoppers, each nested collection follows the resource it hangs off:
 * a membership after zones, a line after lists. Neither can be listed from
 * nothing, so both are usually reached by opening a row on their parent's detail
 * screen rather than from the navigation.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    // No segment and no screens: the overview is the empty path, and what it
    // holds is what is true of the whole system rather than of one part of it.
    key: 'overview',
    label: 'shell.sections.overview',
    home: DashboardPage,
  },
  {
    key: 'catalog',
    label: 'shell.sections.catalog',
    segment: CATALOG_SEGMENT,
    home: CatalogDashboard,
    resources: [
      SUPERMARKETS,
      LOCATIONS,
      PRICE_SCOPES,
      ITEMS,
      PRODUCT_GROUPS,
      PRICES,
      PRICE_POLICIES,
      LOCATION_ITEMS,
    ],
  },
  {
    key: 'shoppers',
    label: 'shell.sections.shoppers',
    segment: SHOPPERS_SEGMENT,
    home: PeopleDashboard,
    resources: [USERS, ZONES, MEMBERSHIPS, LISTS, LIST_LINES, BASKETS],
  },
  {
    // The one section that moves nothing. `0006` gave it this prefix for its own
    // reasons, and this plan makes the reason general rather than particular.
    key: 'harvest',
    label: 'shell.sections.harvest',
    segment: HARVEST_SEGMENT,
    home: HarvestDashboard,
    resources: [POSTAL_CODES],
    screens: harvestRoutes(),
    links: HARVEST_LINKS,
  },
  {
    // **A section with one screen has no segment**, so the admins list stays at
    // `/admins` rather than moving to `/admins/admins`, and the tab points
    // straight at it. A dashboard summarising one list is a click between the
    // operator and the list, which is `0004`'s argument and it holds here too.
    key: 'admins',
    label: 'shell.sections.admins',
    resources: [ADMINS],
  },
];
