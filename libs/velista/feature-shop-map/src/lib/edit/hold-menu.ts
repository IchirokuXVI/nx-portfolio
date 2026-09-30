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
import { FormsModule } from '@angular/forms';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { ThemeStore } from '@portfolio/velista/platform';
import { CommentIcon, FlagIcon, TrashIcon } from '@portfolio/velista/ui';
import {
  heldSquare,
  holdActionsFor,
  kindSwatch,
  metresText,
  type HoldAction,
  type HoldKindAction,
  type HoldPress,
  type SwatchStyle,
} from './map-edits';

/** What the menu was closed with. */
export type HoldChoice =
  | { readonly action: HoldKindAction | 'erase' | 'section' }
  | { readonly action: 'note'; readonly text: string };

/** The longest note the menu takes, like a mark's text. */
export const NOTE_MAX_LENGTH = 120;

/**
 * The long press menu (velista `0123`, target 2; the `HoldMenu` board): a popover
 * anchored at the press, headed by the square ("This square · 14.5 m across,
 * 8.5 m in"), listing only the actions that apply to what is under the finger.
 * Add a note here turns the menu into a one field form.
 *
 * It holds no page state: the host gives it the press and reads the choice, so
 * the recording screen of velista `0126` mounts the same menu while walking.
 * The host places it over the map as a positioned layer; the menu covers the
 * layer with a clear backdrop, and a tap on it, Escape or Cancel close the menu
 * with `dismissed`, after which the host calls the canvas's `clearHeld()`.
 */
@Component({
  selector: 'lib-hold-menu',
  imports: [CommentIcon, FlagIcon, FormsModule, RokuTranslatorPipe, TrashIcon],
  templateUrl: './hold-menu.html',
  styleUrl: './hold-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'dismiss()',
  },
})
export class HoldMenu {
  /** The press the menu is about. */
  readonly press = input.required<HoldPress>();

  /** An action was chosen. */
  readonly chosen = output<HoldChoice>();

  /** Closed with nothing chosen. */
  readonly dismissed = output<void>();

  private readonly _theme = inject(ThemeStore).theme;
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _injector = inject(Injector);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly _panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly actions = computed(() =>
    holdActionsFor(this.press().area)
  );

  protected readonly square = computed(() => {
    const square = heldSquare(this.press().at);
    return {
      x: metresText(square.x, this._locale()),
      y: metresText(square.y, this._locale()),
    };
  });

  protected readonly noting = signal(false);
  protected readonly note = signal('');
  protected readonly noteMax = NOTE_MAX_LENGTH;

  /** Where the panel sits in the layer, once measured. Hidden until then. */
  protected readonly place = signal<{ left: number; top: number } | null>(null);

  constructor() {
    afterNextRender(() => {
      this._position();
      this._panel()
        ?.nativeElement.querySelector<HTMLElement>('button, input')
        ?.focus();
    });
  }

  protected swatch(action: HoldAction): SwatchStyle | null {
    return action === 'shelf' ||
      action === 'counter' ||
      action === 'blocked' ||
      action === 'path'
      ? kindSwatch(action, this._theme())
      : null;
  }

  protected choose(action: HoldAction): void {
    if (action === 'note') {
      this.noting.set(true);
      afterNextRender(
        () => {
          this._panel()?.nativeElement.querySelector('input')?.focus();
          this._position();
        },
        { injector: this._injector }
      );
      return;
    }
    this.chosen.emit({ action });
  }

  protected saveNote(): void {
    const text = this.note().trim();
    if (text === '') {
      return;
    }
    this.chosen.emit({ action: 'note', text });
  }

  dismiss(): void {
    this.dismissed.emit();
  }

  /**
   * Beside the finger rather than under it, so the pressed square stays in
   * sight: to its left when there is room, else its right, centred on it
   * vertically, and never past the layer's edges.
   */
  private _position(): void {
    const panel = this._panel()?.nativeElement;
    const layer = this._host.nativeElement;
    if (panel === undefined) {
      return;
    }
    const box = layer.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const gap = 16;
    const { x, y } = this.press().client;
    const px = x - box.left;
    const py = y - box.top;
    let left = px - gap - width;
    if (left < gap) {
      left = px + gap;
    }
    left = Math.max(gap, Math.min(left, box.width - width - gap));
    const top = Math.max(
      gap,
      Math.min(py - height / 2, box.height - height - gap)
    );
    this.place.set({ left: Math.round(left), top: Math.round(top) });
  }
}
