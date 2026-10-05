import type { ActivatedRouteSnapshot } from '@angular/router';
import type {
  AnyResourceDescriptor,
  ResourceDraft,
} from '@portfolio/luna-shopper-admin/models';
import { parentsFromRoute, type ResourceRegistry } from './resource-registry';

/**
 * The field kinds a query parameter can fill in on a new record.
 *
 * Every one of them holds a plain string in the draft. A yes or no, a text in
 * several languages and a json field each hold a shape that a query parameter
 * cannot spell.
 */
const STRING_FIELD_KINDS: readonly string[] = [
  'text',
  'number',
  'money',
  'enum',
  'reference',
  'date',
];

/**
 * What a new record opens with: the parent the address names, and the fields
 * a caller filled in through the query string.
 *
 * `price-scopes/new?supermarketId=<id>` from the leaflet upload of admin plan
 * 0010 is the caller it exists for, and `prices/new?priceScopeId=<id>` from a
 * row of the Prices tab is the other. Only over fields the descriptor names,
 * which the store enforces again, and only the kinds whose control holds a
 * plain string.
 *
 * A function and not a method of the record page, because the form that adds
 * a price is a form of its own and opens with the same answers (admin plan
 * 0060).
 */
export function recordPrefill(
  registry: ResourceRegistry,
  descriptor: AnyResourceDescriptor,
  snapshot: ActivatedRouteSnapshot
): ResourceDraft {
  const parents = parentsFromRoute(registry, descriptor, snapshot);
  const draft: Record<string, string> = {};

  // A row made under a chain belongs to it.
  const parent = descriptor.parent;
  const parentId = parent === undefined ? undefined : parents[parent.filter];
  if (parent !== undefined && parentId !== undefined) {
    draft[parent.filter] = parentId;
  }

  for (const field of descriptor.fields) {
    if (!STRING_FIELD_KINDS.includes(field.kind)) {
      continue;
    }
    const value = snapshot.queryParamMap.get(field.name);
    if (value !== null && value !== '' && draft[field.name] === undefined) {
      draft[field.name] = value;
    }
  }

  return draft;
}
