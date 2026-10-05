import type { AnyResourceDescriptor } from '@portfolio/luna-shopper-admin/models';
import { ADMIN_SECTIONS } from './sections';

/**
 * **No descriptor asks the operator for a bare ID, and no list shows a column
 * of them** (admin plan 0051, section 4).
 *
 * A test and not a sentence, because the mistake is one line long and reads
 * as ordinary. A new column named `brandId` arrives on a row, somebody adds
 * `{ kind: 'text', name: 'brandId' }` to show it, and the form now has a box
 * that wants a uuid typed into it. The `reference` kind is the answer every
 * time: it shows the name, it searches by name, and it still takes the ID from
 * an operator who has one.
 *
 * ## What it checks
 *
 * Every descriptor the app mounts is read as a value. Nothing is rendered.
 *
 * - **A field** whose name ends in `Id` or `Ids`, and that the form can
 *   change, is a `reference` or a `references` field.
 * - **A column** of a list (`columns`, `compact`, `line`, `trailing`) is not
 *   the row's own ID and not a plain field whose name ends in `Id`.
 * - **A filter** whose parameter ends in `Id` or `Ids` is a `reference`
 *   filter, never a search box.
 *
 * A field that only shows an ID, such as the row's own on its detail page,
 * passes: an ID is worth reading there, as the secondary thing it is.
 *
 * ## The way out
 *
 * `ALLOWED` names a field that is an ID of something outside this app, which
 * no typeahead can search. It is empty today. An entry needs the reason
 * beside it.
 */
const ALLOWED: ReadonlySet<string> = new Set<string>([]);

const NAMES_AN_ID = /Ids?$/;

function mounted(): readonly AnyResourceDescriptor[] {
  return ADMIN_SECTIONS.flatMap((section) => [
    ...(section.resources ?? []),
    ...(section.held ?? []),
  ]);
}

describe('descriptors and bare IDs', () => {
  it('reads at least the resources the rail leads to', () => {
    // A guard that walked an empty list would pass for ever.
    expect(mounted().length).toBeGreaterThan(10);
  });

  it('never asks for an ID in a plain field', () => {
    const typed = mounted().flatMap((descriptor) =>
      descriptor.fields
        .filter(
          (field) =>
            NAMES_AN_ID.test(field.name) &&
            field.kind !== 'reference' &&
            field.kind !== 'references' &&
            field.editable !== false &&
            !ALLOWED.has(`${descriptor.name}.${field.name}`)
        )
        .map((field) => `${descriptor.name}.${field.name} (${field.kind})`)
    );

    expect(typed).toEqual([]);
  });

  it('never draws a column of bare IDs in a list', () => {
    const drawn = mounted().flatMap((descriptor) => {
      const own = descriptor.idField ?? 'id';
      const columns = new Set<string>([
        ...descriptor.list.columns,
        ...descriptor.list.compact,
        ...(descriptor.list.brief?.line ?? []),
        ...(descriptor.list.brief?.trailing === undefined
          ? []
          : [descriptor.list.brief.trailing]),
      ]);

      return descriptor.fields
        .filter(
          (field) =>
            columns.has(field.name) &&
            // The row's own ID, unless the table is keyed by something an
            // operator reads: a postal code, a kind of source.
            ((field.name === own && /^id$|Id$/.test(own)) ||
              NAMES_AN_ID.test(field.name)) &&
            field.kind !== 'reference' &&
            field.kind !== 'references' &&
            !ALLOWED.has(`${descriptor.name}.${field.name}`)
        )
        .map((field) => `${descriptor.name}.${field.name} (${field.kind})`);
    });

    expect(drawn).toEqual([]);
  });

  it('never filters by an ID through a search box', () => {
    const boxes = mounted().flatMap((descriptor) =>
      (descriptor.filters ?? [])
        .filter(
          (filter) =>
            NAMES_AN_ID.test(filter.param) && filter.kind !== 'reference'
        )
        .map((filter) => `${descriptor.name}?${filter.param} (${filter.kind})`)
    );

    expect(boxes).toEqual([]);
  });
});
