import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ChevronLeftIcon } from '@portfolio/shared/ui';

/** One category of the tree, already named in the language it is read in. */
export interface CategoryTreeNode {
  readonly id: string;
  readonly name: string;
  /** How many products it holds, or `null` when nobody counted. */
  readonly count: number | null;
  /** The categories inside it. Empty for one that holds products itself. */
  readonly children: readonly CategoryTreeNode[];
}

/** What {@link CategoryTree} says was chosen, when it is not a category. */
export const CATEGORY_TREE_ALL = '';

/**
 * The value for "the products on no category", which is the literal the
 * gateway reads on the same parameter a category id goes on.
 */
export const CATEGORY_TREE_NONE = 'none';

/**
 * The categories as a tree that narrows a list (admin plan 0043, target 2).
 *
 * "All products" first, then each top level category with its product count,
 * its children when it is opened, and "No category" last. A press on any of
 * them says which was chosen, and the page that holds the tree narrows its
 * list. The same tree is a column beside the list on a wide screen and the
 * body of a sheet on a narrow one.
 *
 * **A top level category has two controls**: its name, which chooses it, and
 * the chevron, which opens it. A press on the name of a closed one opens it as
 * well, because the operator who chose "Dairy" is about to choose "Milk".
 *
 * Purely presentational. It is handed the nodes and draws them. It reads
 * nothing and counts nothing: a count that is `null` draws no number.
 */
@Component({
  selector: 'lib-category-tree',
  imports: [RokuTranslatorPipe, ChevronLeftIcon],
  template: `
    <nav [attr.aria-label]="label()">
      <ul>
        <li>
          <button
            (click)="pick(all)"
            [attr.aria-current]="selected() === all ? 'true' : null"
            [class.current]="selected() === all"
            class="entry root"
            type="button"
            data-category=""
          >
            <span class="name">{{ allKey() | rokuT }}</span>
            @if (allCount() !== null) {
              <span class="count">{{ number(allCount()) }}</span>
            }
          </button>
        </li>

        @for (node of nodes(); track node.id) {
          <li>
            <div
              [class.current]="selected() === node.id"
              class="entry root split"
            >
              @if (node.children.length > 0) {
                <button
                  (click)="toggle(node.id)"
                  [attr.aria-expanded]="isOpen(node.id)"
                  [attr.aria-label]="
                    (isOpen(node.id)
                      ? 'catalog.categoryTree.close'
                      : 'catalog.categoryTree.open'
                    ) | rokuT: { name: node.name }
                  "
                  [class.open]="isOpen(node.id)"
                  class="twist"
                  type="button"
                >
                  <lib-chevron-left-icon />
                </button>
              } @else {
                <span class="twist"></span>
              }
              <button
                (click)="pick(node.id, true)"
                [attr.aria-current]="selected() === node.id ? 'true' : null"
                [attr.data-category]="node.id"
                class="label"
                type="button"
              >
                <span class="name">{{ node.name }}</span>
                @if (node.count !== null) {
                  <span class="count">{{ number(node.count) }}</span>
                }
              </button>
            </div>

            @if (isOpen(node.id) && node.children.length > 0) {
              <ul>
                @for (child of node.children; track child.id) {
                  <li>
                    <button
                      (click)="pick(child.id)"
                      [attr.aria-current]="
                        selected() === child.id ? 'true' : null
                      "
                      [attr.data-category]="child.id"
                      [class.current]="selected() === child.id"
                      class="entry child"
                      type="button"
                    >
                      <span class="name">{{ child.name }}</span>
                      @if (child.count !== null) {
                        <span class="count">{{ number(child.count) }}</span>
                      }
                    </button>
                  </li>
                }
              </ul>
            }
          </li>
        }

        @if (showNone()) {
          <li>
            <button
              (click)="pick(none)"
              [attr.aria-current]="selected() === none ? 'true' : null"
              [class.current]="selected() === none"
              class="entry root last"
              type="button"
              data-category="none"
            >
              <span class="name">{{ noneKey() | rokuT }}</span>
            </button>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }

    ul {
      display: flex;
      flex-direction: column;
      list-style: none;
    }

    .entry {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      inline-size: 100%;
      min-block-size: max(2.375rem, var(--admin-control));
      padding: 0 var(--admin-space-3) 0 var(--admin-space-4);
      border: none;
      border-block-start: 1px solid var(--admin-border);
      border-radius: 0;
      background: none;
      font: inherit;
      text-align: start;
      color: var(--admin-ink);
    }

    li:first-child > .entry.root {
      border-block-start: none;
    }

    button.entry,
    .label,
    .twist {
      cursor: pointer;
    }

    .entry.split {
      gap: 0;
      padding: 0;
    }

    .entry.child {
      min-block-size: max(2.25rem, var(--admin-control));
      padding-inline-start: 2.5rem;
      border-block-start: none;
    }

    .entry.last {
      border-block-end: 1px solid var(--admin-border);
    }

    .twist {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      inline-size: 2.5rem;
      align-self: stretch;
      padding: 0 0 0 var(--admin-space-2);
      border: none;
      background: none;
      color: var(--admin-ink-muted);
    }

    /* The one chevron the app has points back. Turned, it points right for a
       closed category and down for an open one. */
    .twist lib-chevron-left-icon {
      inline-size: 1rem;
      block-size: 1rem;
      rotate: 180deg;
    }

    .twist.open lib-chevron-left-icon {
      rotate: -90deg;
    }

    .label {
      display: flex;
      flex: 1;
      gap: var(--admin-space-2);
      align-items: center;
      align-self: stretch;
      min-inline-size: 0;
      padding: 0 var(--admin-space-3) 0 0;
      border: none;
      background: none;
      font: inherit;
      text-align: start;
      color: inherit;
    }

    .name {
      flex: 1;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .count {
      flex: none;
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      color: var(--admin-ink-muted);
    }

    .current {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .current .name {
      font-weight: 600;
    }

    .current .count,
    .current .twist {
      color: var(--admin-accent-on-wash);
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryTree {
  private readonly _translate = inject(RokuTranslatorService);

  /** The top level categories, each with the categories inside it. */
  readonly nodes = input.required<readonly CategoryTreeNode[]>();
  /**
   * What is chosen: a category id, {@link CATEGORY_TREE_ALL} for every
   * product, or {@link CATEGORY_TREE_NONE} for the products on no category.
   */
  readonly selected = input<string>(CATEGORY_TREE_ALL);
  /** How many products there are in all, or `null` when nobody counted. */
  readonly allCount = input<number | null>(null);
  /** What the tree is, already translated, for a screen reader. */
  readonly label = input('');
  /** What the first entry says, as a key. */
  readonly allKey = input('catalog.categoryTree.all');
  /** What the last entry says, as a key. */
  readonly noneKey = input('catalog.categoryTree.none');
  /** Whether "No category" is offered. */
  readonly showNone = input(true);

  /** An entry was pressed: a category id, or one of the two constants. */
  readonly choose = output<string>();

  readonly all = CATEGORY_TREE_ALL;
  readonly none = CATEGORY_TREE_NONE;

  /** The top level categories that are open, by id. */
  private readonly _open = signal<ReadonlySet<string>>(new Set());

  /** The top level category that holds what is chosen, when one does. */
  private readonly _holder = computed(() => {
    const selected = this.selected();
    return (
      this.nodes().find((node) =>
        node.children.some((child) => child.id === selected)
      )?.id ?? null
    );
  });

  constructor() {
    // What is chosen is always in view: a list opened already narrowed to
    // "Milk" shows "Dairy" open.
    effect(() => {
      const holder = this._holder();
      if (holder !== null) {
        untracked(() => this._setOpen(holder, true));
      }
    });
  }

  isOpen(id: string): boolean {
    return this._open().has(id);
  }

  toggle(id: string): void {
    this._setOpen(id, !this.isOpen(id));
  }

  /** Choose an entry, and open it when it holds others. */
  pick(id: string, open = false): void {
    if (open) {
      this._setOpen(id, true);
    }
    this.choose.emit(id);
  }

  /** A count with the separators of the interface language. */
  number(value: number | null): string {
    return value === null
      ? ''
      : new Intl.NumberFormat(this._translate.locale()).format(value);
  }

  private _setOpen(id: string, open: boolean): void {
    if (this.isOpen(id) === open) {
      return;
    }
    const next = new Set(this._open());
    if (open) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this._open.set(next);
  }
}
