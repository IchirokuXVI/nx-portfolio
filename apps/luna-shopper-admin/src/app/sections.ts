import {
  BRANDS,
  BrandSuggestionsPage,
} from '@portfolio/luna-shopper-admin/feature-brands';
import {
  CHAIN_RESOURCES,
  chainsRoutes,
  oldCatalogAddresses,
  PRODUCT_RESOURCES,
  PRODUCTS_SEGMENT,
  productsRoutes,
} from '@portfolio/luna-shopper-admin/feature-catalog';
import { DashboardPage } from '@portfolio/luna-shopper-admin/feature-dashboard';
import {
  HARVEST_SEGMENT,
  HARVEST_TABS,
  harvestRoutes,
  HarvestStatus,
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
import {
  HARVEST_REVIEW_TAB,
  HARVEST_SETUP_TAB,
} from '@portfolio/luna-shopper-admin/models';
import {
  DashboardIcon,
  InboxIcon,
  PeopleIcon,
  ShieldIcon,
  StoreIcon,
  TagIcon,
} from '@portfolio/shared/ui';

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
 * sources". Around half a dozen is what the first row holds at a glance, and
 * eight is the widest second row.
 *
 * Admin plan 0027 added a sixth, Brands, for two screens, and it is gone again:
 * a tab for two screens was a click between the operator and both of them, and
 * the tab went unmarked on the registered list because it pointed at the other
 * one. Both brand screens are in the harvester, whose queues they are worked
 * beside.
 *
 * The list stays the app's, for the reason `ResourceRegistry` already gives: it
 * is the app that decides which screens exist. It is what the route table is
 * built from **and** what the registry is read from, so a resource cannot end up
 * reachable without a link, linked without a route, or mounted without being
 * registered.
 *
 * ## Why these, and why these names
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
 * chains, which hold the shops, the sections and the price scopes (admin plan
 * 0042); then the products, with their groups, their categories and the price
 * rules (admin plan 0043); then the harvester, which produces most of the
 * catalog and is where work waits for a person (admin plan 0044); then the
 * people and what they share, which is read far more often than it is
 * touched; then the admin table, which is opened to answer one question and
 * never to change anything. A phone shows the first four and "More".
 *
 * **There is no Catalog section any more.** It held ten screens. Five went to
 * the chains and five are the products, and its dashboard is a block of the
 * overview. What is left of `/catalog` is redirects.
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
    icon: DashboardIcon,
    home: DashboardPage,
  },
  {
    // A chain holds its shops (admin plan 0042). Second on the rail, after the
    // overview, because a chain is where an operator starts: a shop, a section
    // and a price scope each belong to one.
    //
    // **No segment and no tabs.** The chains are at `/chains`, which is the
    // segment of the one resource here that has no parent, and a chain's own
    // page draws its tabs. The five resources are held and not mounted: the
    // section's own route table is where each of them is.
    key: 'chains',
    label: 'shell.sections.chains',
    icon: StoreIcon,
    held: CHAIN_RESOURCES,
    // Beside the chains, at the root, everything that was under `/catalog`:
    // redirects to where a chain or a product holds the same rows now (admin
    // plans 0042 and 0043). They are here because this is the section whose
    // screens are mounted at the root, and no section owns that segment.
    screens: [...chainsRoutes(), oldCatalogAddresses()],
  },
  {
    // A product and its prices (admin plan 0043). Third on the rail.
    //
    // The four lists are held and are the section's tabs: Products at the
    // section's own address, then Groups, Categories and Price rules one
    // segment under it. A product is a page with tabs of its own, so the
    // section's route table mounts all of it and the route factory mounts
    // none. The fifth resource, a price, sits under one product and is no tab.
    key: 'products',
    label: 'shell.sections.products',
    icon: TagIcon,
    segment: PRODUCTS_SEGMENT,
    held: PRODUCT_RESOURCES,
    heldTabs: true,
    screens: productsRoutes(),
  },
  {
    // The harvester in three tabs (admin plan 0044). Fourth on the rail, and
    // so the last of the four a phone shows before "More".
    //
    // **No home.** The section's own address goes to Review, where a person
    // has work, and the three tabs are its links. The count on Review, and so
    // on this section's entry in the rail, is what waits in the four queues:
    // `HarvestStatus` reads it with the dashboard.
    //
    // The suggested brands are a queue of Review and the registered brands
    // are a part of Setup, although a registered brand is catalog data. The
    // suggestions are keys the harvested queue carries, and a person registers
    // them while working that queue. Both are in `feature-brands`, which
    // imports the harvester's library, so they are handed to its route table
    // here, where both are in sight.
    //
    // The two resources are held and not mounted by the route factory: they
    // are parts of the Setup tab, at `/harvest/setup/brands` and
    // `/harvest/setup/postal-codes`, and the section's own table mounts them.
    key: 'harvest',
    label: 'shell.sections.harvest',
    icon: InboxIcon,
    segment: HARVEST_SEGMENT,
    landing: HARVEST_REVIEW_TAB,
    held: [BRANDS, POSTAL_CODES],
    heldUnder: HARVEST_SETUP_TAB,
    screens: harvestRoutes({
      brandsQueue: BrandSuggestionsPage,
      setup: [BRANDS, POSTAL_CODES],
    }),
    links: HARVEST_TABS,
    counts: HarvestStatus,
  },
  {
    key: 'shoppers',
    label: 'shell.sections.shoppers',
    icon: PeopleIcon,
    segment: SHOPPERS_SEGMENT,
    home: PeopleDashboard,
    resources: [USERS, ZONES, MEMBERSHIPS, LISTS, LIST_LINES, BASKETS],
  },
  {
    // **A section with one screen has no segment**, so the admins list stays at
    // `/admins` rather than moving to `/admins/admins`, and the tab points
    // straight at it. A dashboard summarising one list is a click between the
    // operator and the list, which is `0004`'s argument and it holds here too.
    key: 'admins',
    label: 'shell.sections.admins',
    icon: ShieldIcon,
    resources: [ADMINS],
  },
];
