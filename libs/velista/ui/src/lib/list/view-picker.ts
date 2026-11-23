import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListRowLayout } from '@portfolio/velista/models';
import { handleBackWhile } from '@portfolio/velista/platform';
import {
  CheckIcon,
  CompactViewIcon,
  DefaultViewIcon,
  ViewIcon,
} from '../icons/icons';
import { PageHeaderAction } from '../layout/page-header-action';
import { AnchoredPopover, type AnchoredPopoverClose } from './anchored-popover';

/** The views, in the order the popover draws them. */
const VIEWS: readonly ListRowLayout[] = ['default', 'compact'];

/** Numbers each popover, so two on a page never share an id. */
let choicesCount = 0;

/**
 * The two views as a popover held against the control that opened it (velista
 * `0202`, target 4), in the choice frame of {@link AnchoredPopover}: under the
 * control and lined up with its end, and pushed back onto the screen where the
 * control sits too far from the edge for its 276 px (the zone list header at 360).
 *
 * One `menuitemradio` row for each view, its glyph and its words, and the compact
 * one says what it is for on a second line. The current row carries the tick in the
 * quiet amber and the heavier weight, which is the only accent.
 *
 * Plain values in, a choice out (rule D1): the page owns the store. It owns no open
 * state either, so the header button, the tools row button and the basket menu's row
 * open the same popover. Focus is its own business, because it is handed the control
 * that opened it: the current row takes focus on opening, and a choice, Escape or
 * the back gesture send it back to that control.
 */
@Component({
  selector: 'lib-view-choices',
  imports: [
    AnchoredPopover,
    CheckIcon,
    CompactViewIcon,
    DefaultViewIcon,
    RokuTranslatorPipe,
  ],
  template: `
    @if (open()) {
      <lib-anchored-popover
        (closed)="close($event)"
        [open]="true"
        [origin]="origin()"
        [push]="true"
        [role]="null"
        align="end"
        frame="choice"
        side="below"
      >
        <div
          (keydown)="onKey($event)"
          [attr.aria-label]="'view.title' | rokuT"
          [attr.data-view-choices]="id"
          class="options"
          role="menu"
          tabindex="-1"
        >
          @for (view of views; track view) {
            <button
              (click)="choose(view)"
              [attr.aria-checked]="view === layout()"
              [attr.data-view]="view"
              [attr.tabindex]="view === layout() ? 0 : -1"
              [class.is-on]="view === layout()"
              class="option"
              role="menuitemradio"
              type="button"
            >
              @if (view === 'compact') {
                <lib-compact-view-icon class="glyph" />
              } @else {
                <lib-default-view-icon class="glyph" />
              }
              <span class="words">
                <span class="name">{{ 'view.' + view | rokuT }}</span>
                @if (view === 'compact') {
                  <span class="hint">{{ 'view.compactHint' | rokuT }}</span>
                }
              </span>
              <span class="tick">
                @if (view === layout()) {
                  <lib-check-icon />
                }
              </span>
            </button>
          }
        </div>
      </lib-anchored-popover>
    }
  `,
  styleUrl: './view-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewChoices {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);

  /** Whether it is on screen. */
  readonly open = input(false);

  /** The control that opened it, which it is held against and gives focus back to. */
  readonly origin = input.required<HTMLElement>();

  /** The view the rows are drawn in now, which carries the tick. */
  readonly layout = input.required<ListRowLayout>();

  /** A view was chosen. The popover wants to close as well. */
  readonly chosen = output<ListRowLayout>();

  /** It wants to close with no choice, and why. */
  readonly closed = output<AnchoredPopoverClose>();

  protected readonly views = VIEWS;
  protected readonly id = `view-choices-${++choicesCount}`;

  constructor() {
    // A native back press closes it, as Escape does (velista `0166`).
    handleBackWhile(this.open, () => this.close('escape'));

    // The popover is drawn in the top layer after the render that opens it. The
    // current row takes focus then, which is where a set of radios is entered.
    effect(() => {
      if (!this.open()) {
        return;
      }
      untracked(() =>
        afterNextRender(() => this._focus(this.layout()), {
          injector: this._injector,
        })
      );
    });
  }

  protected choose(view: ListRowLayout): void {
    this.origin().focus();
    this.chosen.emit(view);
  }

  protected close(reason: AnchoredPopoverClose): void {
    if (!this.open()) {
      return;
    }
    // A press outside lands where it was pressed, so focus stays with it.
    if (reason === 'escape') {
      this.origin().focus();
    }
    this.closed.emit(reason);
  }

  /**
   * The arrow keys move between the rows, as they do in any menu, and Home and End
   * go to the first and the last. Escape closes it here and goes no further, so a
   * sheet the popover is opened from (the basket's menu) stays open under it.
   */
  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close('escape');
      return;
    }
    const end =
      event.key === 'Home'
        ? VIEWS[0]
        : event.key === 'End'
          ? VIEWS[VIEWS.length - 1]
          : undefined;
    if (end !== undefined) {
      event.preventDefault();
      this._focus(end);
      return;
    }
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const focused = (event.target as HTMLElement).dataset['view'];
    const at = VIEWS.findIndex((view) => view === focused);
    const next = VIEWS[(at + step + VIEWS.length) % VIEWS.length];
    if (next !== undefined) {
      this._focus(next);
    }
  }

  private _focus(view: ListRowLayout): void {
    // The overlay is an inline popover in the top layer, found from the document.
    this._host.nativeElement.ownerDocument
      .querySelector<HTMLElement>(
        `[data-view-choices="${this.id}"] [data-view="${view}"]`
      )
      ?.focus();
  }
}

/**
 * The view button (velista `0202`, target 4): the glyph of two rows with their
 * pictures, named "View", in the secondary text colour like the filter beside it.
 * A press opens {@link ViewChoices} under it.
 *
 * `header` is a header action (`PageHeaderAction`), the first one on the zone list.
 * `tool` is a control of the basket's tools row, the same square as the filter
 * button of `ListTools` beside it.
 */
@Component({
  selector: 'lib-view-picker',
  imports: [PageHeaderAction, RokuTranslatorPipe, ViewChoices, ViewIcon],
  template: `
    @if (look() === 'header') {
      <button
        (click)="toggle()"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'view.title' | rokuT"
        [class.is-open]="open()"
        #trigger
        aria-haspopup="menu"
        class="trigger"
        libPageHeaderAction
        type="button"
      >
        <lib-view-icon />
      </button>
    } @else {
      <button
        (click)="toggle()"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'view.title' | rokuT"
        [class.is-open]="open()"
        #trigger
        aria-haspopup="menu"
        class="trigger tool"
        type="button"
      >
        <lib-view-icon class="tool-glyph" />
      </button>
    }

    @if (origin(); as control) {
      <lib-view-choices
        (chosen)="choose($event)"
        (closed)="open.set(false)"
        [layout]="layout()"
        [open]="open()"
        [origin]="control"
      />
    }
  `,
  styleUrl: './view-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewPicker {
  /** The view the rows are drawn in now. */
  readonly layout = input.required<ListRowLayout>();

  /** Where it sits: a page header, or the basket's tools row. */
  readonly look = input<'header' | 'tool'>('header');

  /** A view was chosen. The page writes it to the store. */
  readonly chosen = output<ListRowLayout>();

  protected readonly open = signal(false);

  private readonly _trigger = viewChild<string, ElementRef<HTMLElement>>(
    'trigger',
    { read: ElementRef }
  );

  protected readonly origin = computed(
    () => this._trigger()?.nativeElement ?? null
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected choose(view: ListRowLayout): void {
    this.open.set(false);
    this.chosen.emit(view);
  }
}
