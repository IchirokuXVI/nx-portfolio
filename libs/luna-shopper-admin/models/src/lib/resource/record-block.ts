import type { Signal, Type } from '@angular/core';
import { idFieldOf, type ResourceDescriptor } from './resource-descriptor';
import {
  isEditable,
  type FieldDescriptor,
  type FieldName,
  type ResourceRow,
} from './resource-field';

/**
 * What the record page draws for one row (admin plan 0052, section 2.3).
 *
 * The page reads a record first and becomes a form on "Edit". A descriptor
 * says here which fields stand together, which collections belong to the
 * record, and where the facts about the record itself are held. Everything is
 * optional: a descriptor with no block still gets a page, with one section.
 *
 * {@link recordLayout} is the one reader of the block, so no page decides for
 * itself which field goes where.
 */
export interface RecordBlock<T extends ResourceRow = ResourceRow> {
  /** The order of the page. */
  readonly sections: readonly RecordSection<T>[];
  /** The collections that belong to the record. Plan 0054 reads them. */
  readonly children?: readonly RecordChild<T>[];
  /** The Record block: who made it, when it changed, and its ID. */
  readonly facts?: RecordFacts<T>;
  /** Where the app goes after a new record is saved. `'open'` when left out. */
  readonly afterAdd?: 'open' | 'list';
  /**
   * Where the Details tab sits among the tabs. `'first'` when left out. A
   * record opens on its first tab.
   */
  readonly details?: 'first' | 'last';
  /**
   * The counts beside the tabs that no field of the record holds, by the
   * `name` of the child. Built in an injection context, as `rowStates` is.
   */
  counts?(): (id: string) => Signal<Readonly<Record<string, number | null>>>;
}

export interface RecordSection<T extends ResourceRow = ResourceRow> {
  /** A translation key. */
  readonly title: string;
  readonly fields: readonly FieldName<T>[];
}

export interface RecordFacts<T extends ResourceRow = ResourceRow> {
  /** The field that holds when the record was made. */
  readonly added?: FieldName<T>;
  /** The field that holds who made it. Drawn only when the row carries a value. */
  readonly addedBy?: FieldName<T>;
  /** The field that holds when it last changed. */
  readonly changed?: FieldName<T>;
  /** The field that holds who changed it. Drawn only when the row carries a value. */
  readonly changedBy?: FieldName<T>;
  /** Other words for the two headings: "Signed up" on an account. */
  readonly labels?: { readonly added?: string; readonly changed?: string };
  /** More fields of the block, such as the source of a row. */
  readonly also?: readonly FieldName<T>[];
}

export type RecordChild<T extends ResourceRow = ResourceRow> =
  | RecordChildList<T>
  | RecordChildPart<T>;

/** A collection of another resource, read through that resource's list. */
export interface RecordChildList<T extends ResourceRow = ResourceRow> {
  /** `tab`: a tab beside Details. `panel`: a short list. `link`: a count. */
  readonly as: 'tab' | 'panel' | 'link';
  /** The `name` of the resource the rows belong to. */
  readonly resource: string;
  /** The filter of that resource's list that takes this record's ID. */
  readonly by: string;
  /** A translation key for the heading. The resource's `labels.many` when left out. */
  readonly label?: string;
  /** How many rows a panel shows. 5 when left out. */
  readonly rows?: number;
  /** The field of this record that holds how many rows there are. */
  readonly count?: FieldName<T>;
  /** A translation key for what an empty panel says. */
  readonly empty?: string;
  /**
   * A translation key for one small button in the heading of a panel. It
   * opens the form that adds a row of `resource`, with `by` filled in.
   */
  readonly add?: string;
}

/** A tab or a panel that the record's own library draws. */
export interface RecordChildPart<T extends ResourceRow = ResourceRow> {
  readonly as: 'tab' | 'panel';
  /** The route segment of a tab, and the key of a panel. */
  readonly name: string;
  /** A translation key. */
  readonly label: string;
  /** The component. It reads the record from `RECORD_CONTEXT` (plan 0054). */
  readonly component: Type<unknown>;
  /** The field of this record that holds the count beside the label. */
  readonly count?: FieldName<T>;
}

/** Whether the page reads a record, changes one, or adds one. */
export type RecordMode = 'read' | 'edit' | 'create';

/** What the page draws in one mode: its sections, and the Record block. */
export interface RecordLayout {
  readonly sections: readonly {
    readonly title: string;
    readonly fields: readonly FieldDescriptor[];
  }[];
  readonly facts: {
    readonly added: FieldDescriptor | null;
    readonly addedBy: FieldDescriptor | null;
    readonly changed: FieldDescriptor | null;
    readonly changedBy: FieldDescriptor | null;
    readonly addedLabel: string;
    readonly changedLabel: string;
    readonly also: readonly FieldDescriptor[];
  };
}

/**
 * What the save bar says about the form (admin plan 0052, section 3.10).
 *
 * Here and not beside the bar, because the store of plan 0053 works it out and
 * a store must not read a component.
 */
export type SaveBarState =
  | { readonly kind: 'clean' }
  | { readonly kind: 'dirty'; readonly changes: number }
  | { readonly kind: 'missing'; readonly required: number }
  | { readonly kind: 'saving' }
  | { readonly kind: 'invalid'; readonly fields: number }
  | { readonly kind: 'refused' };

/** The one section of a descriptor that states no `record` block. */
export const DETAILS_SECTION_KEY = 'record.section.details';
/** The last section, for a field that no section names. */
export const OTHER_SECTION_KEY = 'record.section.other';
export const ADDED_LABEL_KEY = 'record.facts.added';
export const CHANGED_LABEL_KEY = 'record.facts.changed';

/**
 * The sections of the page for a mode, and the fields of the Record block.
 *
 * The rules, each with a case in `record-block.spec.ts`:
 *
 * - A field named in `facts`, and the ID field, are in no section. The ID is
 *   in the Record block and nowhere else.
 * - A field that a child names as its `count` is in no section. It is drawn
 *   beside the tab or the heading of that child.
 * - Reading and changing draw every field a section names. Adding draws only
 *   the fields a new record can state, and the parent field, which the page
 *   shows as a locked value.
 * - A section with no field in this mode is left out.
 * - A field no section names goes in a last section, in the order of
 *   `fields`. A field added to a descriptor later can then never be missing
 *   from the page.
 * - While adding, the facts are empty. A record that does not exist has no ID
 *   and no date.
 */
export function recordLayout<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  mode: RecordMode
): RecordLayout {
  // The one cast, for the reason `defineResource` has one: a field name is
  // `keyof T`, which makes a descriptor of a known row not a descriptor of any
  // row. Nothing below reads a row, so every name is only a string here.
  const fields = descriptor.fields as unknown as readonly FieldDescriptor[];
  const block = descriptor.record as unknown as RecordBlock | undefined;
  const byName = new Map(fields.map((field) => [field.name, field]));
  const facts = block?.facts;

  const outside = new Set<string>([idFieldOf(descriptor)]);
  for (const name of [
    facts?.added,
    facts?.addedBy,
    facts?.changed,
    facts?.changedBy,
    ...(facts?.also ?? []),
    ...(block?.children ?? []).map((child) => child.count),
  ]) {
    if (name !== undefined) {
      outside.add(name);
    }
  }

  const parent = descriptor.parent?.filter;
  const drawn = (field: FieldDescriptor): boolean =>
    !outside.has(field.name) &&
    (mode !== 'create' || isEditable(field, 'create') || field.name === parent);

  const named = new Set<string>();
  const sections: { title: string; fields: readonly FieldDescriptor[] }[] = [];
  const add = (title: string, names: readonly string[]): void => {
    const held: FieldDescriptor[] = [];
    for (const name of names) {
      const field = byName.get(name);
      // A field named by two sections is drawn by the first.
      if (field !== undefined && !named.has(name)) {
        named.add(name);
        if (drawn(field)) {
          held.push(field);
        }
      }
    }
    if (held.length > 0) {
      sections.push({ title, fields: held });
    }
  };

  for (const section of block?.sections ?? []) {
    add(section.title, section.fields);
  }
  add(
    block === undefined ? DETAILS_SECTION_KEY : OTHER_SECTION_KEY,
    fields.map((field) => field.name)
  );

  const fact = (name: string | undefined): FieldDescriptor | null =>
    mode === 'create' || name === undefined ? null : (byName.get(name) ?? null);

  return {
    sections,
    facts: {
      added: fact(facts?.added),
      addedBy: fact(facts?.addedBy),
      changed: fact(facts?.changed),
      changedBy: fact(facts?.changedBy),
      addedLabel: facts?.labels?.added ?? ADDED_LABEL_KEY,
      changedLabel: facts?.labels?.changed ?? CHANGED_LABEL_KEY,
      also: (facts?.also ?? []).flatMap((name) => fact(name) ?? []),
    },
  };
}

/** The route segment of the Details tab of a record that has tabs. */
export const RECORD_DETAILS_TAB = 'details';

/** Whether a child is a collection of another resource, and not a part. */
export function isRecordChildList<T extends ResourceRow>(
  child: RecordChild<T>
): child is RecordChildList<T> {
  return 'resource' in child;
}

/**
 * What a child is known by: the `name` of a part, or the `resource` of a
 * list. It is the key of its count in `counts`, and of its route in the
 * `tabs` a caller hands to the route factory.
 */
export function recordChildKey<T extends ResourceRow>(
  child: RecordChild<T>
): string {
  return isRecordChildList(child) ? child.resource : child.name;
}

/** One tab of a record: Details, or a child the block draws as a tab. */
export interface RecordTab {
  /** {@link RECORD_DETAILS_TAB}, or the key of the child. */
  readonly key: string;
  /** `null` for Details. */
  readonly child: RecordChild | null;
}

/**
 * The tabs of a record, in the order they are drawn (admin plan 0054, target
 * 1). Empty when no child is a tab: Details is then the page.
 *
 * Details is first, or last when the block says so. The record opens on the
 * first of them.
 */
export function recordTabs<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>
): readonly RecordTab[] {
  const block = descriptor.record as unknown as RecordBlock | undefined;
  const tabs: RecordTab[] = (block?.children ?? [])
    .filter((child) => child.as === 'tab')
    .map((child) => ({ key: recordChildKey(child), child }));
  if (tabs.length === 0) {
    return [];
  }

  const details: RecordTab = { key: RECORD_DETAILS_TAB, child: null };
  return block?.details === 'last' ? [...tabs, details] : [details, ...tabs];
}

/**
 * The count beside a tab, a panel or a link (admin plan 0054, section 2.4).
 *
 * The first of these that exists: the field of the record that the child
 * names, then what another read holds under the key of the child. `null`
 * draws the label alone. Nothing here counts rows, so a count is only ever
 * one that something already holds.
 */
export function recordChildCount(
  child: RecordChild,
  row: ResourceRow | null,
  held: Readonly<Record<string, number | null>> | null
): number | null {
  if (child.count !== undefined) {
    const value = row?.[child.count];
    return typeof value === 'number' ? value : null;
  }
  return held?.[recordChildKey(child)] ?? null;
}
