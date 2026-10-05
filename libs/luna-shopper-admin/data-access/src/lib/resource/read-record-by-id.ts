import {
  idOf,
  rowWithin,
  type AnyResourceDescriptor,
  type FilterValue,
  type ResourceDescriptor,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { toGatewayError } from '../gateway-error';

/**
 * The record of one resource that has an ID, or `null` (admin plan 0051).
 *
 * The one read behind every search that was handed an ID: the list and the
 * typeahead both call this, so they cannot disagree about what "no record has
 * this ID" means. It is the resource's own read route, which is what keeps the
 * ID on the table the search is over: the ID of a shop, typed into a search of
 * products, is read at `/items/{id}` and answers nothing.
 *
 * `null` in three cases, and all three are the same sentence on screen.
 *
 * - The route answers 404: no such row.
 * - The route answers 400: it refused the ID itself, so no row can have it.
 * - A row came back that is outside `within`: a shop of another chain is not
 *   a row of this chain's list, and a root category is not a row of a picker
 *   of leaves. The first is a column of the row and the second is not, so the
 *   row is held against `rowWithin` and against the resource's own `within`.
 *
 * Any other failure is thrown. A server that is down has not said the record
 * is missing, and saying so would send an operator looking for a row that is
 * there.
 */
export async function readRecordById<T extends ResourceRow>(
  // Either form: a page holds the erased descriptor and a typed gateway.
  descriptor: ResourceDescriptor<T> | AnyResourceDescriptor,
  gateway: ResourceGateway<T>,
  id: string,
  within: Readonly<Record<string, FilterValue>> = {},
  /** What the list around the read shows, for {@link ResourceGateway.read}. */
  shown?: Readonly<Record<string, FilterValue>>
): Promise<T | null> {
  let row: T;
  try {
    row = await gateway.read(id, shown);
  } catch (error) {
    const status = toGatewayError(error).status;
    if (status === 404 || status === 400) {
      return null;
    }
    throw error;
  }

  const erased = descriptor as AnyResourceDescriptor;
  return idOf(erased, row) === id &&
    rowWithin(row, within) &&
    (erased.within?.(row, within) ?? true)
    ? row
    : null;
}
