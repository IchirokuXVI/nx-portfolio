/**
 * The names the shoppers' addresses use (admin plan 0045).
 *
 * In a file of their own because a descriptor and the page it is drawn on both
 * read them, and a page must not import the descriptor that names it.
 *
 * ```
 * /shoppers/people/{userId}/shopping-lists/{basketId}
 * /shoppers/zones/{zoneId}/lists/{listId}/lines/{id}
 * ```
 */

/** The route parameter that holds the person, for everything under one. */
export const PERSON_PARAM = 'userId';

/** The route parameter that holds the zone, for everything under one. */
export const ZONE_PARAM = 'zoneId';

/** The route parameter that holds the list, for everything under one. */
export const LIST_PARAM = 'listId';

/** The route parameter that holds the shopping list. */
export const BASKET_PARAM = 'basketId';

/** The segment of a person's Zones tab. */
export const PERSON_ZONES_TAB = 'zones';

/**
 * The segment of a zone's Members tab. The members of a zone are a resource,
 * and its descriptor takes its segment from here, so the tab and the address
 * of one member cannot disagree.
 */
export const ZONE_MEMBERS_TAB = 'members';

/**
 * The segment of the form that changes the row a page is about. For a list it
 * is still a form of its own. For a person and a zone it is an old address
 * that leads to the record with its form open (admin plan 0057).
 */
export const EDIT_SEGMENT = 'edit';

/**
 * The one caution of the shoppers screens (admin plan 0045, target 6), as a
 * key: every page that edits a zone, a member, a list or a line shows it.
 */
export const ZONE_CAUTION = 'people.zoneCaution';
