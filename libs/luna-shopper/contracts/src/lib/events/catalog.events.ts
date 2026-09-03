/**
 * What catalog says about a product's group membership (plan 0070, section 5).
 *
 * The trigger is **`item.update`, not `productGroup.update`**. Group membership
 * is `items.productGroupId`, and `ProductGroupService` says so in its own class
 * doc: nothing there assigns items to groups. So "an admin adds three products to
 * Milk" is three item writes, and a consumer that watched the group service would
 * watch a service that never fires for the thing it cares about.
 *
 * Catalog publishes both after its transaction commits and never waits for them,
 * exactly as core does for `POSTAL_CODE_EVENTS`. A failure to announce must not
 * fail the admin write that caused it.
 */
export const CATALOG_EVENTS = {
  /** One product joined a group, left one, or moved between two. */
  itemGroupChanged: 'catalog.itemGroupChanged',
  /** A group no longer exists; every line bound to it must let go. */
  productGroupDeleted: 'catalog.productGroupDeleted',
} as const;

export type CatalogEvent = (typeof CATALOG_EVENTS)[keyof typeof CATALOG_EVENTS];

/**
 * One product's group membership changed (plan 0070, section 6.1).
 *
 * Both ends are carried because both halves of the sync need one: `to` is the
 * group whose subscribed lines gain the product, `from` is the group whose
 * subscribed lines lose it. A move between two groups is one event and not two,
 * so a line bound to either sees a single consistent statement.
 */
export interface ItemGroupChangedEvent {
  /**
   * Unique per emission, so a consumer's inbox dedupes redeliveries without
   * suppressing a genuine repeat. Keyed on the event and not on the pair of group
   * ids, because a product moved out of Milk and back into it later is a second
   * change that has to apply (section 5.1).
   */
  eventId: string;
  itemId: string;
  /** The group it left, or null if it belonged to none. */
  from: string | null;
  /** The group it joined, or null if it now belongs to none. */
  to: string | null;
}

/**
 * A group was deleted (plan 0070, section 6.2).
 *
 * **Not a convenience.** `ProductGroupService.delete` relies on the foreign key
 * to null every member's `productGroupId`, which happens inside Postgres and
 * emits nothing, so without this a deletion would be invisible to core and the
 * next unrelated item write would be the first hint. Worse, a deletion arriving
 * as a burst of per item changes would read as "the admin removed every product
 * from Milk" and empty every subscribed line.
 */
export interface ProductGroupDeletedEvent {
  eventId: string;
  productGroupId: string;
}
