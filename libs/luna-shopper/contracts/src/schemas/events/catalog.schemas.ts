import { CATALOG_EVENTS } from '../../lib/events/catalog.events';
import {
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  schemaId,
} from '../builders';

/**
 * What catalog announces about a product's group (plan 0070, section 5).
 *
 * `from` and `to` are nullable rather than absent when a product belongs to no
 * group, which is the same rule the rest of these schemas follow: an explicit
 * null says "no group", where an absent field says nothing at all and would leave
 * the consumer guessing which of the two halves of the sync to run.
 */
export const CATALOG_EVENT_SCHEMA_IDS = {
  itemGroupChanged: schemaId('event/catalog.itemGroupChanged'),
  productGroupDeleted: schemaId('event/catalog.productGroupDeleted'),
  itemMerged: schemaId('event/catalog.itemMerged'),
} as const;

const itemGroupChanged = object(
  CATALOG_EVENT_SCHEMA_IDS.itemGroupChanged,
  {
    eventId: nonEmptyString(),
    itemId: nonEmptyString(),
    from: nullableString(),
    to: nullableString(),
  },
  ['eventId', 'itemId', 'from', 'to']
);

const productGroupDeleted = object(
  CATALOG_EVENT_SCHEMA_IDS.productGroupDeleted,
  {
    eventId: nonEmptyString(),
    productGroupId: nonEmptyString(),
  },
  ['eventId', 'productGroupId']
);

/** One product was merged into another (plan 0239, section 3). */
const itemMerged = object(
  CATALOG_EVENT_SCHEMA_IDS.itemMerged,
  {
    eventId: nonEmptyString(),
    itemId: nonEmptyString(),
    intoItemId: nonEmptyString(),
  },
  ['eventId', 'itemId', 'intoItemId']
);

export const catalogEventSchemas: JsonSchema[] = [
  itemGroupChanged,
  productGroupDeleted,
  itemMerged,
];

/** event name -> payload schema id. */
export const catalogEventContracts: Record<string, string> = {
  [CATALOG_EVENTS.itemGroupChanged]: CATALOG_EVENT_SCHEMA_IDS.itemGroupChanged,
  [CATALOG_EVENTS.productGroupDeleted]:
    CATALOG_EVENT_SCHEMA_IDS.productGroupDeleted,
  [CATALOG_EVENTS.itemMerged]: CATALOG_EVENT_SCHEMA_IDS.itemMerged,
};
