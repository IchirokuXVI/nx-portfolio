import type { Route } from '@angular/router';
import {
  adminRoutes,
  RecordPage,
  RESOURCE_DESCRIPTOR,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { ADMIN_SECTIONS } from './sections';

/**
 * **A record has one page, and this is the list of the resources that do not
 * use it** (admin plan 0060, target 6).
 *
 * One page reads a record, changes it and adds one. A descriptor that names
 * an `editor` or a `detail` puts a component of its own at `new` or at `:id`
 * in its place. That is the shorter way to a new screen, one property, and it
 * is how seven pages once came to disagree about where Save is.
 *
 * A test and not a sentence, because nothing else fails when a descriptor
 * gains one of the two properties. Every descriptor the app mounts is read as
 * a value. Nothing is rendered.
 *
 * ## What to do when it fails
 *
 * - **A resource is missing from the list.** Do not add it. Give the resource
 *   a `record` block, and draw what the record page cannot as a tab or a
 *   panel of the record (`children`). Add an entry only after a plan decided
 *   that the record page cannot draw the resource, and write the reason
 *   beside the entry.
 * - **An entry no longer sets the property.** The resource moved onto the
 *   record page. Delete its entry, so the list only shrinks.
 */
const OUTSIDE: Readonly<
  Record<string, readonly ('editor' | 'detail')[] | undefined>
> = {
  // A price belongs to a scope and not to a shop. Its form names the scope,
  // says its kind and counts the shops that share it, and none of that is a
  // field of the row (plan 0005, section 2). The form is built from the parts
  // of the record page, and only adds.
  prices: ['editor'],

  // A postal code is keyed by the code and not by an ID. Its page only reads,
  // from four reads that each fail alone, and its editor adds many codes at
  // once and reports on each (admin plan 0060, section 1).
  'postal-codes': ['editor', 'detail'],
};

/**
 * **The same list, read from the route table and not from the descriptors.**
 *
 * The list above only sees a page that a descriptor names. A route written by
 * hand, with a component of its own and the descriptor in its `data`, sets
 * neither property and passes it. So the route table of the app is walked as
 * well: every route that names a resource and sits at `new` or at an ID is
 * the record page, or it is here, by its address.
 *
 * Each entry is the name of the resource and the name of the component. The
 * rule for a new entry is the rule of the list above.
 */
const HAND_MOUNTED: Readonly<Record<string, readonly [string, string]>> = {
  // The editor of `prices`, above.
  'products/:productId/prices/new': ['prices', 'PriceFormPage'],

  // The editor and the detail of `postal-codes`, above.
  'harvest/setup/postal-codes/new': ['postal-codes', 'PostalCodeAddPage'],
  'harvest/setup/postal-codes/:id': ['postal-codes', 'PostalCodeDetailPage'],

  // A price rule opens inside its row of the six rules and not on a page.
  // The form in the row is `RecordView` on a `RecordStore`, so it is the
  // record page without the page (admin plan 0060, section 2.1).
  'products/price-rules/:id': ['price-policies', 'PriceRuleForm'],
};

/** One route that names a resource at `new` or at an ID. */
interface RecordRoute {
  readonly address: string;
  readonly resource: string;
  readonly component: unknown;
}

/**
 * Whether an address is the page of one record: it ends at `new`, at a
 * parameter, or at `edit` under a parameter.
 */
function isRecordAddress(segments: readonly string[]): boolean {
  const last = segments[segments.length - 1] ?? '';
  const before = segments[segments.length - 2] ?? '';

  return (
    last === 'new' ||
    last.startsWith(':') ||
    (last === 'edit' && before.startsWith(':'))
  );
}

/**
 * Every route of the app that draws a component for a resource at the
 * address of one record.
 *
 * By the whole address and not by the path of the route alone: a record with
 * tabs is mounted at the empty path under the route that holds its ID.
 */
function recordRoutes(
  routes: readonly Route[],
  above: readonly string[] = []
): RecordRoute[] {
  return routes.flatMap((route) => {
    const segments = [
      ...above,
      ...(route.path ?? '').split('/').filter((segment) => segment !== ''),
    ];
    const descriptor = route.data?.[RESOURCE_DESCRIPTOR] as
      | AnyResourceDescriptor
      | undefined;
    const here =
      descriptor !== undefined &&
      route.component !== undefined &&
      isRecordAddress(segments)
        ? [
            {
              address: segments.join('/'),
              resource: descriptor.name,
              component: route.component,
            },
          ]
        : [];

    return [...here, ...recordRoutes(route.children ?? [], segments)];
  });
}

function mounted(): readonly AnyResourceDescriptor[] {
  return [
    ...new Set(
      ADMIN_SECTIONS.flatMap((section) => [
        ...(section.resources ?? []),
        ...(section.held ?? []),
      ])
    ),
  ];
}

/** The page properties one descriptor sets, in a fixed order. */
function pagesOf(
  descriptor: AnyResourceDescriptor
): readonly ('editor' | 'detail')[] {
  return [
    ...(descriptor.editor === undefined ? [] : (['editor'] as const)),
    ...(descriptor.detail === undefined ? [] : (['detail'] as const)),
  ];
}

describe('the pages that are not the record page', () => {
  it('reads at least the resources the rail leads to', () => {
    // A guard that walked an empty list would pass for ever.
    expect(mounted().length).toBeGreaterThan(10);
  });

  /** A third exception needs a decision, and not only a property. */
  it('are set by no descriptor outside the list', () => {
    expect(
      mounted()
        .filter(
          (descriptor) =>
            pagesOf(descriptor).length > 0 &&
            OUTSIDE[descriptor.name] === undefined
        )
        .map((descriptor) => descriptor.name)
    ).toEqual([]);
  });

  /** A resource that moved takes its entry with it, in whole or in part. */
  it('are set by every entry of the list, exactly as the list says', () => {
    const found = Object.fromEntries(
      mounted()
        .filter((descriptor) => OUTSIDE[descriptor.name] !== undefined)
        .map((descriptor) => [descriptor.name, pagesOf(descriptor)])
    );

    expect(found).toEqual(OUTSIDE);
  });

  it('holds two entries, and can only shrink', () => {
    expect(Object.keys(OUTSIDE).sort()).toEqual(['postal-codes', 'prices']);
  });
});

describe('the routes that open a record', () => {
  const found = recordRoutes(adminRoutes(ADMIN_SECTIONS));

  it('are read from the route table of the app', () => {
    // A walk that found nothing would pass for ever.
    expect(found.length).toBeGreaterThan(15);
    expect(found.map((route) => route.address)).toEqual(
      expect.arrayContaining([
        'chains/new',
        'chains/:chainId',
        'products/:productId',
        'harvest/setup/sources/:id',
      ])
    );
  });

  /**
   * The case the list of descriptors cannot see: a route mounted by hand,
   * with a component of its own. It is the record page, or it is in the list
   * by its address, with its resource and its component as the list says.
   */
  it('draw the record page, but for the ones the list names', () => {
    const outside = Object.fromEntries(
      found
        .filter((route) => route.component !== RecordPage)
        .map((route) => [
          route.address,
          [route.resource, (route.component as { name: string }).name],
        ])
    );

    expect(outside).toEqual(HAND_MOUNTED);
  });

  it('holds four entries, and can only shrink', () => {
    expect(Object.keys(HAND_MOUNTED)).toHaveLength(4);
  });
});
