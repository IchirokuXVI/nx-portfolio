import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  recordIdIn,
  type ScopeLevel,
} from '@portfolio/luna-shopper-admin/models';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import { PopoverSheet } from '../page/popover-sheet';
import { ScopeMark } from '../page/scope-mark';
import { Viewport } from '../viewport';

/** A chain the picker offers. */
export interface ScopePickerChain {
  readonly id: string;
  readonly name: string;
}

/** A price scope the picker offers, already named. */
export interface ScopePickerScope {
  readonly id: string;
  readonly name: string;
  /** How far it reaches, 1 the widest. `null` for a kind this app does not know. */
  readonly level: ScopeLevel | null;
  /** The kind, already translated. */
  readonly kind: string;
}

/** The scope that is chosen, as the button says it. */
export interface ScopePickerChoice {
  readonly chain: string;
  readonly scope: string;
  readonly level: ScopeLevel | null;
  /** The kind, already translated, said by the mark. */
  readonly kind: string;
}

/**
 * A picker of one price scope: a chain, then one of its scopes (admin plan
 * 0043, target 2).
 *
 * A price belongs to a scope, and a scope belongs to a chain, so the operator
 * says the chain first. Each scope is drawn with the mark that says how far it
 * reaches. The chosen scope is written on the button, with the chain before
 * it, because "Nationwide" alone is the name of a scope of every chain.
 *
 * **It reads nothing.** It says which chain was opened and which scope was
 * chosen, and whoever holds it hands it the chains and that chain's scopes. A
 * chain's single shop scopes are one for every shop, so they are asked for
 * apart, by a button under the general ones.
 *
 * A panel under the button on a wide screen and a sheet on a phone, for the
 * reason the info panel is.
 */
@Component({
  selector: 'lib-scope-picker',
  imports: [PopoverSheet, ScopeMark, ChevronLeftIcon, RokuTranslatorPipe],
  template: `
    <button
      (click)="toggle()"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label()"
      #trigger
      class="trigger"
      type="button"
      data-scope-picker
    >
      @if (prefix(); as text) {
        <span class="muted">{{ text }}</span>
      }
      @if (choice(); as chosen) {
        @if (chosen.level; as level) {
          <lib-scope-mark [label]="chosen.kind" [level]="level" />
        }
        <span class="chosen">{{ chosen.chain }}, {{ chosen.scope }}</span>
      } @else {
        <span class="chosen">{{ placeholder() }}</span>
      }
      <lib-chevron-left-icon class="caret" />
    </button>

    @if (open()) {
      <lib-popover-sheet
        (closed)="close()"
        [anchor]="trigger"
        [heading]="label()"
        [sheet]="compact()"
        #sheet
        width="20rem"
      >
        @if (chain(); as shown) {
          <button (click)="back()" class="row back" type="button">
            <lib-chevron-left-icon class="lead" />
            <span class="grow">{{ shown.name }}</span>
          </button>

          @if (scopes(); as listed) {
            @if (listed.length > 8) {
              <label class="find">
                <span class="sr-only">{{
                  'catalog.scopePicker.find' | rokuT
                }}</span>
                <input
                  (input)="term.set($any($event.target).value)"
                  [placeholder]="'catalog.scopePicker.find' | rokuT"
                  [value]="term()"
                  type="search"
                />
              </label>
            }
            @for (scope of matching(); track scope.id) {
              <button
                (click)="pick(scope.id)"
                [attr.aria-current]="scope.id === value() ? 'true' : null"
                [attr.data-scope]="scope.id"
                [class.current]="scope.id === value()"
                class="row"
                type="button"
              >
                @if (scope.level; as level) {
                  <lib-scope-mark [level]="level" />
                }
                <span class="grow">{{ scope.name }}</span>
                <span class="muted small">{{ scope.kind }}</span>
              </button>
            } @empty {
              <p class="note">{{ 'catalog.scopePicker.noScopes' | rokuT }}</p>
            }
            @if (truncated()) {
              <p class="note">{{ 'catalog.scopePicker.truncated' | rokuT }}</p>
            }
            @if (shopsOffered()) {
              <button
                (click)="shopsWanted.emit()"
                class="row more"
                type="button"
                data-shop-scopes
              >
                {{ 'catalog.scopePicker.shops' | rokuT }}
              </button>
            }
          } @else {
            <p class="note" role="status">
              {{ 'resource.list.loading' | rokuT }}
            </p>
          }
        } @else {
          @if (clearable() && value() !== null) {
            <button
              (click)="pick(null)"
              class="row more"
              type="button"
              data-scope-clear
            >
              {{ clearKey() | rokuT }}
            </button>
          }
          @if (chains(); as listed) {
            @for (entry of listed; track entry.id) {
              <button
                (click)="openChain(entry.id)"
                [attr.data-chain]="entry.id"
                class="row"
                type="button"
              >
                <span class="grow">{{ entry.name }}</span>
                <lib-chevron-left-icon class="lead forward" />
              </button>
            } @empty {
              <p class="note">{{ 'catalog.scopePicker.noChains' | rokuT }}</p>
            }
          } @else {
            <p class="note" role="status">
              {{ 'resource.list.loading' | rokuT }}
            </p>
          }
        }
      </lib-popover-sheet>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      min-inline-size: 0;
    }

    .trigger {
      display: inline-flex;
      gap: var(--admin-space-2);
      align-items: center;
      max-inline-size: 100%;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-weight: 500;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .trigger[aria-expanded='true'] {
      border-color: var(--admin-accent);
    }

    .chosen {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .muted {
      font-weight: 400;
      white-space: nowrap;
      color: var(--admin-ink-muted);
    }

    .small {
      font-size: 0.8125rem;
    }

    /* The one chevron the app has points back. Turned, it points down on the
       button and forward on a chain. */
    .caret,
    .lead {
      flex: none;
      inline-size: 1rem;
      block-size: 1rem;
      color: var(--admin-ink-muted);
    }

    .caret {
      rotate: -90deg;
    }

    .forward {
      rotate: 180deg;
    }

    .row {
      display: flex;
      flex: none;
      gap: var(--admin-space-2);
      align-items: center;
      inline-size: 100%;
      min-block-size: max(2.5rem, var(--admin-control));
      padding: var(--admin-space-2) var(--admin-space-4);
      border: none;
      border-block-end: 1px solid var(--admin-border);
      border-radius: 0;
      background: none;
      font: inherit;
      text-align: start;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .row.back {
      font-weight: 600;
    }

    .row.more {
      color: var(--admin-accent);
    }

    .row.current {
      background: var(--admin-accent-wash);
      font-weight: 600;
      color: var(--admin-accent-on-wash);
    }

    .row.current .muted {
      color: var(--admin-accent-on-wash);
    }

    .grow {
      flex: 1;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .find {
      display: block;
      flex: none;
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-end: 1px solid var(--admin-border);
    }

    .find input {
      inline-size: 100%;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: var(--admin-field-size);
      color: var(--admin-ink);
    }

    .note {
      padding: var(--admin-space-3) var(--admin-space-4);
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: -2px;
    }

    .trigger:focus-visible {
      outline-offset: 2px;
    }

    .sr-only {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopePicker {
  private readonly _viewport = inject(Viewport);
  private readonly _injector = inject(Injector);
  private readonly _trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly _sheet = viewChild<unknown, ElementRef<HTMLElement>>(
    'sheet',
    { read: ElementRef }
  );

  /** What the picker is for, already translated: the name of the button. */
  readonly label = input.required<string>();
  /** Words before the choice on the button, already translated, or `''`. */
  readonly prefix = input('');
  /** What the button says while nothing is chosen, already translated. */
  readonly placeholder = input('');
  /** The id of the chosen scope, or `null`. */
  readonly value = input<string | null>(null);
  /** The chosen scope as the button says it, or `null`. */
  readonly choice = input<ScopePickerChoice | null>(null);
  /** The chains, or `null` while they are being read. */
  readonly chains = input<readonly ScopePickerChain[] | null>(null);
  /** The chain whose scopes are listed, or `null` on the list of chains. */
  readonly chainId = input<string | null>(null);
  /** That chain's scopes, or `null` while they are being read. */
  readonly scopes = input<readonly ScopePickerScope[] | null>(null);
  /** Whether the chain has more scopes than were read. */
  readonly truncated = input(false);
  /** Whether the chain's single shop scopes can still be asked for. */
  readonly shopsOffered = input(false);
  /** Whether "no scope" is a choice. */
  readonly clearable = input(false);
  /** What the choice of no scope says, as a key. */
  readonly clearKey = input('catalog.scopePicker.clear');

  /** The picker was opened. Whoever holds it reads the chains. */
  readonly opened = output<void>();
  /** A chain was opened, or the list of chains was gone back to (`null`). */
  readonly chainChange = output<string | null>();
  /** The single shop scopes of the open chain were asked for. */
  readonly shopsWanted = output<void>();
  /** A scope was chosen, or the choice was cleared (`null`). */
  readonly scopeChange = output<string | null>();

  readonly compact = this._viewport.compact;
  readonly open = signal(false);
  /** What is typed to find a scope among those listed. */
  readonly term = signal('');

  readonly chain = computed(() => {
    const id = this.chainId();
    return id === null
      ? null
      : ((this.chains() ?? []).find((entry) => entry.id === id) ?? {
          id,
          name: '',
        });
  });

  /** The listed scopes whose name or kind holds what was typed. */
  readonly matching = computed(() => {
    const term = this.term().trim().toLowerCase();
    const listed = this.scopes() ?? [];
    // A typed ID is the scope that has it, among the scopes held here (admin
    // plan 0051). The list can be cut short, so one that is absent is not
    // called missing: the note under the list stays the one it always was.
    const id = recordIdIn(term);
    if (id !== null) {
      return listed.filter((scope) => scope.id === id);
    }
    return term === ''
      ? listed
      : listed.filter((scope) =>
          `${scope.name} ${scope.kind}`.toLowerCase().includes(term)
        );
  });

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.term.set('');
    this.open.set(true);
    this.opened.emit();
  }

  /** Close, and put the focus back on the button. */
  close(): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    this._trigger().nativeElement.focus();
  }

  openChain(id: string): void {
    this.term.set('');
    this.chainChange.emit(id);
    this._refocus();
  }

  back(): void {
    this.term.set('');
    this.chainChange.emit(null);
    this._refocus();
  }

  /**
   * The row that was pressed is gone, and the focus went with it. Put it on
   * the first row of what replaced the list, so that a keyboard goes on from
   * inside the panel and not from the top of the page.
   */
  private _refocus(): void {
    afterNextRender(
      () => {
        this._sheet()
          ?.nativeElement.querySelector<HTMLElement>('button.row')
          ?.focus();
      },
      { injector: this._injector }
    );
  }

  pick(id: string | null): void {
    this.scopeChange.emit(id);
    this.close();
  }
}
