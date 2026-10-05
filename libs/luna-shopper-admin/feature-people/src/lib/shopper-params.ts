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

/**
 * The segment of the Details tab, of a person and of a zone alike: the one tab
 * that is no resource of its own.
 */
export const DETAILS_TAB = 'details';

/** The segment of a person's Zones tab. */
export const PERSON_ZONES_TAB = 'zones';

/** The segment of the form that changes the row a page is about. */
export const EDIT_SEGMENT = 'edit';

/**
 * The one caution of the shoppers screens (admin plan 0045, target 6), as a
 * key: every page that edits a zone, a member, a list or a line shows it.
 */
export const ZONE_CAUTION = 'people.zoneCaution';
