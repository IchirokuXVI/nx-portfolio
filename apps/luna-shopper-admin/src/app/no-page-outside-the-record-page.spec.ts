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
