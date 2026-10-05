import type { Route } from '@angular/router';
import { SIGN_IN_PATH } from '@portfolio/luna-shopper-admin/data-access';
import {
  sectionLink,
  sectionScreens,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { appRoutes } from './app.routes';
import { ADMIN_SECTIONS } from './sections';

/**
 * **Every route in the table belongs to a section of the rail, or is the sign
 * in screen** (admin plan 0047, target 8).
 *
 * A test and not a sentence, because a route nobody can reach is invisible.
 * Plans 0042 to 0045 each kept the addresses of the screens they moved as
 * redirects, forty of them, and nothing in the app led to any: not the rail,
 * not a tab, not a link. Admin plan 0047 deleted them. Without this, the next
 * screen that moves leaves its old address behind the same way, and the route
 * table goes back to describing an app that is no longer there.
 *
 * ## What it checks
 *
 * The table is read as a value and walked. Nothing is navigated, and no
 * component is created. Every address it declares has to be one of these:
 *
 * - the sign in screen, which is outside the frame;
 * - the app's own root, where the overview is;
 * - an address under a tab of a section, for a section the frame draws tabs
 *   for: `/harvest/review/…`, `/shoppers/zones/…`;
 * - an address under the section's own entry in the rail, for a section that
 *   draws its own tabs or has none: `/chains/…`, `/admins/…`;
 * - a section's own address, which goes to the tab it opens on;
 * - the not found page, which is the one `**` and sits inside the frame.
 *
 * So `/harvest/entries` fails, because the harvester has three tabs and that
 * is none of them, and `/catalog/items` fails, because no section of the rail
 * is at `/catalog`.
 *
 * Whether a link is drawn to each address under a tab is not this spec's
 * business: the screens' own specs press those links.
 */

/** One address the table declares, as its segments from the app's root. */
type Address = readonly string[];

/** Every address a list of routes declares, from the segments above it. */
function declared(routes: readonly Route[], above: Address = []): Address[] {
  return routes.flatMap((route) => {
    const here = [...above, ...(route.path ?? '').split('/')].filter(
      (segment) => segment !== ''
    );
    const draws =
      route.component !== undefined ||
      route.loadComponent !== undefined ||
      route.redirectTo !== undefined;
    const children = route.children ?? [];

    return [
      // A route that only groups its children is no address of its own.
      ...(draws || children.length === 0 ? [here] : []),
      ...declared(children, here),
    ];
  });
}

function segmentsOf(path: string): Address {
  return path.split('/').filter((segment) => segment !== '');
}

function startsWith(address: Address, prefix: Address): boolean {
  return prefix.every((segment, index) => address[index] === segment);
}

function sameAddress(left: Address, right: Address): boolean {
  return left.length === right.length && startsWith(left, right);
}

/**
 * Where the screens of one section are allowed to be.
 *
 * The tabs the frame draws for it, where it has any. Otherwise its entry in
 * the rail: the chains have no second row, and the admins draw their own two
 * tabs under `/admins`.
 */
function places(section: AdminSection): Address[] {
  const tabs = sectionScreens(section).map((tab) => segmentsOf(tab.path));
  const entry = sectionLink(section);

  return tabs.length > 0 ? tabs : entry === null ? [] : [segmentsOf(entry)];
}

const SIGN_IN = segmentsOf(SIGN_IN_PATH);
const NOT_FOUND: Address = ['**'];
const ROOT: Address = [];

/** The sections the rail draws, which is every one that has an entry. */
const RAIL = ADMIN_SECTIONS.filter((section) => sectionLink(section) !== null);

function belongs(address: Address): boolean {
  return (
    sameAddress(address, SIGN_IN) ||
    sameAddress(address, ROOT) ||
    sameAddress(address, NOT_FOUND) ||
    RAIL.some(
      (section) =>
        // The section's own address, which goes to the tab it opens on.
        sameAddress(address, segmentsOf(sectionLink(section) ?? '')) ||
        places(section).some(
          (place) => place.length > 0 && startsWith(address, place)
        )
    )
  );
}

const ADDRESSES = declared(appRoutes);

describe('every route belongs to a section of the rail', () => {
  it('reads the route table', () => {
    // A walk that found nothing would pass the test below.
    expect(ADDRESSES.length).toBeGreaterThan(40);
    expect(ADDRESSES.some((address) => sameAddress(address, SIGN_IN))).toBe(
      true
    );
  });

  it('draws every section in the rail', () => {
    expect(RAIL.map((section) => section.key)).toEqual(
      ADMIN_SECTIONS.map((section) => section.key)
    );
  });

  it('knows an address under a tab from one beside the tabs', () => {
    expect(belongs(['harvest', 'review', 'products'])).toBe(true);
    expect(belongs(['chains', ':chainId', 'shops'])).toBe(true);
    expect(belongs(['harvest'])).toBe(true);
    // The harvester has three tabs, and this is none of them.
    expect(belongs(['harvest', 'entries'])).toBe(false);
    // No section of the rail is at this address.
    expect(belongs(['catalog', 'items'])).toBe(false);
    // The not found page is the one wildcard, at the top of the frame.
    expect(belongs(['harvest', 'brands', '**'])).toBe(false);
  });

  it('declares no route outside the rail and the sign in screen', () => {
    // Named in the failure, because the fix is per address: mount the screen
    // under a tab of its section, or delete the route.
    expect(
      ADDRESSES.filter((address) => !belongs(address)).map(
        (address) => `/${address.join('/')}`
      )
    ).toEqual([]);
  });
});
