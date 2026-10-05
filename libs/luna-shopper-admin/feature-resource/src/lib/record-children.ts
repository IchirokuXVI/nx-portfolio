import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  type Type,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  fieldOf,
  hasDetailScreen,
  idOf,
  isRecordChildList,
  toCell,
  type AnyResourceDescriptor,
  type RecordChild,
  type RecordChildList,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  RecordCollection,
  Viewport,
  type CollectionLink,
  type RecordCollectionRow,
} from '@portfolio/luna-shopper-admin/ui';
import { RECORD_CONTEXT, type RecordContext } from './record-context';
import { ResourceChanges } from './resource-changes';
import { ResourceRegistry } from './resource-registry';

/** How many rows a panel shows when its child does not say. */
const PANEL_ROWS = 5;

/**
 * Where the list of a child is, narrowed to one record, or `null` when it
 * cannot be narrowed (admin plan 0054, section 2.3).
 *
 * The list is a target only when it can show the rows of this record and no
 * others. That is a list under a `parent` whose filter is `by`, which has an
 * address under the record, or a list with a filter whose parameter is `by`,
 * which takes the ID in its query string. A list with neither would open on
 * every row of the resource, under a link that promised the rows of one.
 */
export function childListTarget(
  registry: ResourceRegistry,
  child: RecordChildList,
  id: string,
  row: ResourceRow | null
): CollectionLink | null {
  const target = registry.byName(child.resource);
  if (target === undefined || id === '') {
    return null;
  }
  const known = { ...(row ?? {}), [child.by]: id };

  const parent = target.parent;
  if (parent?.filter === child.by) {
    const above = registry.rowPath(parent.resource, id, known);
    return above === null ? null : { commands: [...above, target.segment] };
  }

  if (!(target.filters ?? []).some((filter) => filter.param === child.by)) {
    return null;
  }
  const path = registry.pathOf(child.resource, row ?? {});
  return path === null
    ? null
    : { commands: [...path], queryParams: { [child.by]: id } };
}

/** What a child is called: its own label, or what its resource calls many. */
function labelOf(registry: ResourceRegistry, child: RecordChild): string {
  return (
    child.label ??
    (isRecordChildList(child)
      ? registry.byName(child.resource)?.labels.many
      : undefined) ??
    ''
  );
}

/**
 * One panel of a record: a few rows of another resource, and the way to the
 * rest (admin plan 0054, section 2.3).
 *
 * It reads `rows` rows of the child's list, narrowed to the record, and never
 * more: a panel is not a list. The count beside its heading is one the record
 * holds, and never a count of what was read.
 *
 * **It fails alone.** A read that fails says so in the panel's own frame,
 * with "Try again", and the rest of the page stays.
 *
 * It reads again when something writes the child's resource, and in another
 * content language.
 */
@Component({
  selector: 'lib-record-list-panel',
  imports: [RouterLink, RokuTranslatorPipe, RecordCollection],
  template: `
    <lib-record-collection
      (retry)="load()"
      [all]="all()"
      [count]="count()"
      [emptyKey]="child().empty ?? null"
      [heading]="heading() | rokuT"
      [more]="more()"
      [rows]="rows()"
      [status]="status()"
      shape="panel"
    >
      @if (addTarget(); as target) {
        <a
          [queryParams]="target.queryParams ?? null"
          [routerLink]="target.commands"
          class="add"
          sectionAction
          data-add
          >{{ child().add ?? '' | rokuT }}</a
        >
      }
    </lib-record-collection>
  `,
  styles: `
    :host {
      display: block;
    }

    /* One small button at the end of the heading row. It leads to a form,
       so it is a link. */
    .add {
      display: inline-flex;
      align-items: center;
      min-block-size: 1.875rem;
      padding: 0 0.625rem;
      border: 1px solid var(--admin-border-strong, var(--admin-border));
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface);
      font-size: 0.8125rem;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      color: var(--admin-ink);
    }

    .add:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    @media (max-width: 47.99rem) {
      .add {
        min-block-size: 2.25rem;
        font-size: 0.875rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordListPanel {
  private readonly _context = inject<RecordContext>(RECORD_CONTEXT);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _translator = inject(RokuTranslatorService);

  readonly child = input.required<RecordChildList>();

  /** The record this panel was built for. The page builds it again for another. */
  private readonly _id = this._context.id;

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  /** Whether the list holds more rows than the panel read. */
  readonly more = signal(false);
  private readonly _read = signal<readonly ResourceRow[]>([]);
  /** The read that is on its way, so an older answer never lands on a newer one. */
  private _reading = 0;

  /** The resource the rows belong to, when this app knows it. */
  private readonly _target = computed<AnyResourceDescriptor | undefined>(() =>
    this._registry.byName(this.child().resource)
  );

  readonly heading = computed(() => labelOf(this._registry, this.child()));

  readonly count = computed(() => this._context.countOf(this.child()));

  /** Where "See all" leads, and the one row a phone draws. */
  readonly all = computed(() =>
    childListTarget(this._registry, this.child(), this._id, this._context.row())
  );

  /**
   * Where the button of `add` leads: the form that adds a row of the child,
   * with `by` filled in from the query string, which the record page reads.
   */
  readonly addTarget = computed<CollectionLink | null>(() => {
    const child = this.child();
    const target = this._target();
    if (
      child.add === undefined ||
      target === undefined ||
      target.actions?.create !== true
    ) {
      return null;
    }
    const known = { ...(this._context.row() ?? {}), [child.by]: this._id };
    const list = this._registry.pathOf(child.resource, known);
    return list === null
      ? null
      : { commands: [...list, 'new'], queryParams: { [child.by]: this._id } };
  });

  readonly rows = computed<readonly RecordCollectionRow[]>(() => {
    const target = this._target();
    if (target === undefined) {
      return [];
    }
    const options = {
      locale: this._translator.locale(),
      contentLocales: this._content.order(),
    };
    this._translator.loaded();

    const trailing = target.list.brief?.trailing;
    const field =
      trailing === undefined ? undefined : fieldOf(target, trailing);
    const opens = hasDetailScreen(target);

    return this._read().map((row) => {
      const id = idOf(target, row);
      const cell = field === undefined ? null : toCell(field, row, options);
      return {
        id,
        title: target.title(row, options.contentLocales),
        trailing:
          field === undefined || cell === null || cell.key !== undefined
            ? null
            : field.kind === 'number'
              ? // A bare number at the end of a row says nothing. With what
                // it counts it reads "41 products".
                this._translator.t(
                  'record.collection.trailing',
                  undefined,
                  undefined,
                  {
                    value: cell.text,
                    label: this._translator
                      .t(field.label)
                      .toLocaleLowerCase(options.locale),
                  }
                )
              : cell.text,
        link:
          opens && id !== ''
            ? this._registry.rowPath(target.name, id, {
                ...row,
                [this.child().by]: this._id,
              })
            : null,
      };
    });
  });

  constructor() {
    // The first read, and one more each time the rows can have changed: a
    // write to the child's resource, or another content language.
    effect(() => {
      this._changes.version(this.child().resource);
      this._content.locale();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const child = this.child();
    const target = this._target();
    if (target === undefined) {
      // A resource this app did not mount has no rows to show.
      this.status.set('ready');
      return;
    }

    const reading = ++this._reading;
    // Only the first read draws the loading line. A later one keeps the rows
    // that are there until the new ones arrive.
    if (this.status() === 'error') {
      this.status.set('loading');
    }
    try {
      const page = await this._registry.gatewayFor(target).list({
        limit: child.rows ?? PANEL_ROWS,
        filters: { [child.by]: this._id },
      });
      if (reading !== this._reading) {
        return;
      }
      this._read.set(page.items);
      this.more.set(page.nextCursor !== null);
      this.status.set('ready');
    } catch {
      if (reading === this._reading) {
        this.status.set('error');
      }
    }
  }
}

/** One row of the last panel: a list panel on a phone, or a link. */
interface LinkRow {
  readonly heading: string;
  readonly count: number | null;
  readonly all: CollectionLink | null;
}

/** One panel, in the order of `children`. */
interface PanelView {
  readonly key: string;
  readonly list: RecordChildList | null;
  readonly component: Type<unknown> | null;
}

/**
 * The collections of a record that are drawn in the page (admin plan 0054,
 * section 2.3): its panels, in the order of `children`, and then one last
 * panel with a row for each link.
 *
 * A tab is not here. The page draws the tabs under its header.
 *
 * - A panel of another resource is `lib-record-list-panel`.
 * - A panel of the record's own is its `component`, which draws its own
 *   `lib-record-section`.
 * - A link is one row: the label, the count, and the way to the list narrowed
 *   to this record. Without a way it is the label and the count.
 *
 * **On a phone a panel of another resource is one row that opens the list**,
 * in the last panel with the links. A short list under every section would
 * push the next section off the screen. A panel with nowhere to lead keeps
 * its rows, because the one row would open nothing.
 *
 * Everything is read from `RECORD_CONTEXT`. With no page around the view
 * there is no context, and nothing is drawn.
 */
@Component({
  selector: 'lib-record-children',
  imports: [
    NgComponentOutlet,
    RokuTranslatorPipe,
    RecordCollection,
    RecordListPanel,
  ],
  template: `
    @for (panel of panels(); track panel.key) {
      @if (panel.list; as list) {
        <lib-record-list-panel [child]="list" />
      } @else if (panel.component; as component) {
        <ng-container [ngComponentOutlet]="component" />
      }
    }

    @if (links().length > 0) {
      <section
        [attr.aria-label]="'record.children.links' | rokuT"
        class="links"
        data-links
      >
        @for (link of links(); track $index) {
          <lib-record-collection
            [all]="link.all"
            [count]="link.count"
            [heading]="link.heading | rokuT"
            [joined]="true"
            shape="link"
          />
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }

    :host(:empty) {
      display: none;
    }

    .links {
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordChildren {
  private readonly _context = inject(RECORD_CONTEXT, { optional: true });
  private readonly _registry = inject(ResourceRegistry);
  private readonly _viewport = inject(Viewport);

  /** The children that are drawn in the page, which is all but the tabs. */
  private readonly _inPage: readonly RecordChild[] = (
    this._context?.descriptor.record?.children ?? []
  ).filter((child) => child.as !== 'tab');

  /** Where each list child leads, by its place among the children. */
  private readonly _targets = computed(() => {
    const context = this._context;
    return this._inPage.map((child) =>
      context === null || !isRecordChildList(child)
        ? null
        : childListTarget(this._registry, child, context.id, context.row())
    );
  });

  /** Whether a list panel is one row of the last panel: on a phone, with a way to its list. */
  private _asRow(index: number): boolean {
    return this._viewport.compact() && this._targets()[index] !== null;
  }

  readonly panels = computed<readonly PanelView[]>(() =>
    this._inPage.flatMap((child, index): PanelView[] => {
      if (child.as !== 'panel') {
        return [];
      }
      if (!isRecordChildList(child)) {
        return [
          {
            key: `${index}:${child.name}`,
            list: null,
            component: child.component,
          },
        ];
      }
      return this._asRow(index)
        ? []
        : [{ key: `${index}:${child.resource}`, list: child, component: null }];
    })
  );

  readonly links = computed<readonly LinkRow[]>(() => {
    const context = this._context;
    if (context === null) {
      return [];
    }
    return this._inPage.flatMap((child, index): LinkRow[] => {
      if (!isRecordChildList(child)) {
        return [];
      }
      if (child.as !== 'link' && !this._asRow(index)) {
        return [];
      }
      return [
        {
          heading: labelOf(this._registry, child),
          count: context.countOf(child),
          all: this._targets()[index],
        },
      ];
    });
  });
}
