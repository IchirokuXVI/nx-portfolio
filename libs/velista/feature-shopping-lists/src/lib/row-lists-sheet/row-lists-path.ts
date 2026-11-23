import type { BasketAddress } from '@portfolio/velista/models';
import { sheetSegments } from '@portfolio/velista/platform';
import { basketPath } from '../basket-paths';

/**
 * The URL of the detailed view of a row's lists (velista `0200`, target state
 * 1): `rows/:rowKey/lists`, beside the settle sheet and addressed by the same
 * row key, so it follows the row as the settle sheet does. The `sheet` marker is
 * stamped by {@link sheetSegments}.
 */
export function rowListsPath(
  locale: string,
  basePath: string,
  address: BasketAddress | null,
  rowKey: string
): string {
  return `${basketPath(locale, basePath, address)}/${sheetSegments(
    'rows',
    rowKey,
    'lists'
  ).join('/')}`;
}
