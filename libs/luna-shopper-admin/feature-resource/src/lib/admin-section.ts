import { InjectionToken, type Provider, type Type } from '@angular/core';
import type { Route } from '@angular/router';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import type { ShellLink } from '@portfolio/luna-shopper-admin/ui';

/**
 * One section of the app: a branch of the route table and a tab above it
 * (admin plan 0022).
 *
 * The navigation used to be twenty three links in one wrapping row, every one a
 * peer of every other, so "Price policies" sat beside "Baskets" beside "Chain
 * sources" with nothing to say that the first two are never opened in the same
 * hour. A section is what gives that row a shape to skip through.
 *
 * **A section is a real branch, not a label beside one.** A resource mounted in
 * the catalog is at `/catalog/items`, so a URL says which section drew the
 * screen. That is the whole of the argument for moving fourteen paths: an
 * operator who lands on `/list-lines` from a bookmark or the browser's history
 * cannot tell which of five sections it belongs to, and the navigation says so
 * only while the tab is open.
 */
export interface AdminSection {
  /** This section's own name, for a spec and for tracking. */
  readonly key: string;
  /** A translation key for the tab. */
  readonly label: string;
  /**
   * The URL segment this section owns, absent for a section with one screen.
   *
   * **A section with one screen has no segment**, so the admins list stays at
   * `/admins` rather than moving to `/admins/admins`, and the tab points
   * straight at it. A dashboard summarising one list is a click between the
   * operator and the list, which is `0004`'s argument and it holds at this level
   * too.
   */
  readonly segment?: string;
  /** The screen at the section's own path. */
  readonly home?: Type<unknown>;
  /** Resources mounted under the segment, in navigation order. */
  readonly resources?: readonly AnyResourceDescriptor[];
  /** Hand written screens under the segment. */
  readonly screens?: readonly Route[];
  /** Navigation entries for those hand written screens. */
  readonly links?: readonly ShellLink[];
}

/**
 * Every section this app has, in the order the first row shows them.
 *
 * One list where there were two. `ADMIN_RESOURCES` and `SHELL_LINKS` said which
 * resources existed and which hand written screens existed, and nothing said
 * which of them belonged together. The list is still the app's, for the reason
 * the registry already gives: it is the app that decides which screens exist.
 *
 * **Every mounted resource is registered**, because the registry is read from
 * this rather than from a second list. `POSTAL_CODES` was mounted by
 * `harvestRoutes` and registered nowhere, so a reference field pointing at it
 * would have found nothing with nothing to say about why.
 */
export const ADMIN_SECTIONS = new InjectionToken<readonly AdminSection[]>(
  'ADMIN_SECTIONS',
  { providedIn: 'root', factory: () => [] }
);

/** Name the sections this app has, and through them its resources. */
export function provideSections(
  ...sections: readonly AdminSection[]
): Provider {
  return { provide: ADMIN_SECTIONS, useValue: sections };
}

/**
 * Name resources with no section around them.
 *
 * One unnamed section mounted at the root, which is what this app was before
 * the sections arrived and is what a spec that cares only about the registry
 * still wants. Its label is empty because nothing draws a tab for it: a spec
 * rendering the chrome from this gets one nameless section, and the navigation
 * assertions that matter are in `admin-shell-page.spec.ts` where the sections
 * are real.
 */
export function provideResources(
  ...resources: readonly AnyResourceDescriptor[]
): Provider {
  return provideSections({ key: 'resources', label: '', resources });
}

/**
 * Where a section's tab points.
 *
 * Its home, which is a dashboard of its own for the three sections that have
 * one; and for a section with a single screen and no home, that screen, which
 * is the admins section and the reason the rule in {@link AdminSection.segment}
 * exists.
 *
 * `null` for a section with nothing in it at all, which
 * `shell-sections.spec.ts` refuses and which therefore cannot reach a tab.
 */
export function sectionLink(section: AdminSection): string | null {
  if (section.home !== undefined) {
    return section.segment === undefined ? '/' : `/${section.segment}`;
  }

  const [only] = sectionScreens(section);

  return only?.path ?? null;
}

/**
 * The second row for a section: its hand written screens, then its resources.
 *
 * Hand written first, because the harvester is the only section with both and
 * its resource is the postal codes queue, which section 1 of the plan puts last.
 * The resources keep the order the section named them in.
 *
 * A resource's label is its descriptor's, never a second copy written out here,
 * which is the property the registry has always given: a resource cannot be
 * reachable without a link or linked without a route.
 */
export function sectionScreens(section: AdminSection): readonly ShellLink[] {
  const prefix = section.segment === undefined ? '' : `/${section.segment}`;

  return [
    ...(section.links ?? []),
    ...(section.resources ?? []).map((descriptor) => ({
      path: `${prefix}/${descriptor.segment}`,
      label: descriptor.labels.many,
    })),
  ];
}
