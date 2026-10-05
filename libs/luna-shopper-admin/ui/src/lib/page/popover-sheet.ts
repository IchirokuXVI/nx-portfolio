import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { keepTabInside } from '../focus-trap';

/** How far the panel sits from its anchor, and from the edge of the window. */
const GAP = 8;

/** One per dialog, so two on one page do not share a heading id. */
let nextId = 0;

/**
 * A panel that holds controls, opened over the page (admin plan 0043).
 *
 * The same two shapes the info panel has, for content that is not sentences:
 * a tree of categories, a list of price scopes, a form. On a wide screen it is
 * a panel under the control that opened it. As a sheet it comes from the
 * bottom edge with a scrim behind it and a Close button.
 *
 * It is drawn in the top layer through the `popover` attribute, for the reason
 * the info panel gives: an ancestor that scrolls would clip it, and one with a
 * transform would stop the sheet being fixed to the window.
 *
 * **It closes nothing by itself.** Escape, a press on the scrim, a press
 * outside the panel and the Close button each say that it was asked to close.
 * Whoever opened it removes it, and puts the focus back where it came from.
 */
@Component({
  selector: 'lib-popover-sheet',
  imports: [RokuTranslatorPipe],
  template: `
    <!-- A press on the scrim is a press outside the dialog, heard on the
         document. The scrim itself is not a control: a keyboard closes the
         sheet with Escape or its button. -->
    @if (sheet()) {
      <div #scrim class="scrim" popover="manual" data-sheet-scrim></div>
    }

    <section
      (keydown)="onKeydown($event)"
      [attr.aria-labelledby]="headingId"
      [attr.aria-modal]="sheet() ? 'true' : null"
      [class.sheet]="sheet()"
      [style.--popover-width]="width()"
      #panel
      class="panel"
      popover="manual"
      role="dialog"
      tabindex="-1"
    >
      <div class="head">
        <h2 [id]="headingId">{{ heading() }}</h2>
        @if (sheet()) {
          <button (click)="closed.emit()" class="close" type="button">
            {{ 'info.close' | rokuT }}
          </button>
        }
      </div>

      <div class="body"><ng-content /></div>
    </section>
  `,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
    '(document:click)': 'pressed($event)',
  },
  styles: `
    :host {
      display: contents;
    }

    /* Both boxes are popovers, so each rule also undoes what a browser gives a
       popover by default. */
    .scrim {
      position: fixed;
      z-index: 30;
      inset: 0;
      display: block;
      inline-size: 100%;
      block-size: 100%;
      margin: 0;
      padding: 0;
      border: none;
      background: rgb(20 33 29 / 50%);
    }

    .panel {
      position: fixed;
      z-index: 31;
      inset: auto;
      display: flex;
      flex-direction: column;
      inline-size: min(var(--popover-width, 22rem), calc(100vw - 2rem));
      block-size: auto;
      max-block-size: min(32rem, calc(100dvh - 1rem));
      margin: 0;
      overflow: hidden;
      padding: 0;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      box-shadow: 0 0.5rem 1.5rem rgb(20 33 29 / 16%);
      text-align: start;
      color: var(--admin-ink);
    }

    .panel.sheet {
      inset: auto 0 0;
      inline-size: auto;
      max-block-size: 85dvh;
      padding-block-end: env(safe-area-inset-bottom, 0px);
      border: none;
      border-radius: 0.875rem 0.875rem 0 0;
      box-shadow: none;
    }

    .panel:focus {
      outline: none;
    }

    .head {
      display: flex;
      flex: none;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-end: 1px solid var(--admin-border);
    }

    h2 {
      flex: 1;
      font-size: 0.9375rem;
      font-weight: 600;
    }

    .body {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-block-size: 0;
      overflow-y: auto;
    }

    .close {
      flex: none;
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

    .close:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: no-preference) {
      .scrim,
      .panel {
        animation: appear 120ms ease-out;
      }
    }

    @keyframes appear {
      from {
        opacity: 0;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopoverSheet {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** What the panel is about, already translated. It names the dialog. */
  readonly heading = input.required<string>();
  /** A sheet from the bottom edge. A panel under its anchor otherwise. */
  readonly sheet = input(false);
  /** The element the panel is placed from. Ignored by the sheet. */
  readonly anchor = input<HTMLElement | null>(null);
  /** Which edge of the anchor the panel lines up with. */
  readonly align = input<'start' | 'end'>('start');
  /** How wide the panel is, as a CSS length. Ignored by the sheet. */
  readonly width = input<string | null>(null);

  /** Asked to close: Escape, the scrim, a press outside, or the button. */
  readonly closed = output<void>();

  readonly headingId = `popover-sheet-${nextId++}`;

  private readonly _panel =
    viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly _scrim = viewChild<ElementRef<HTMLElement>>('scrim');

  /** When the panel was put up, so the press that opened it does not close it. */
  private _openedAt = 0;

  constructor() {
    const destroyed = inject(DestroyRef);

    afterNextRender(() => {
      const panel = this._panel().nativeElement;

      // The scrim first, so that the panel is above it in the top layer.
      show(this._scrim()?.nativeElement);
      show(panel);
      this.place();
      this._openedAt = Date.now();
      panel.focus();

      const again = () => this.place();
      window.addEventListener('scroll', again, {
        capture: true,
        passive: true,
      });
      window.addEventListener('resize', again, { passive: true });
      destroyed.onDestroy(() => {
        window.removeEventListener('scroll', again, { capture: true });
        window.removeEventListener('resize', again);
      });
    });
  }

  /** Tab stays inside the sheet. The panel on a wide screen lets it leave. */
  onKeydown(event: KeyboardEvent): void {
    if (this.sheet()) {
      keepTabInside(event, this._panel().nativeElement);
    }
  }

  /**
   * A press somewhere in the document, while the panel is up.
   *
   * Outside the panel and outside its anchor, it asks to close. The anchor is
   * the control that opened the panel, and it closes the panel by itself. The
   * sheet has a scrim over everything else, so a press outside the sheet is a
   * press on the scrim.
   */
  pressed(event: Event): void {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }
    if (this.sheet()) {
      if (target === this._scrim()?.nativeElement) {
        this.closed.emit();
      }
      return;
    }
    // The press that opened the panel reaches the document after the panel is
    // up, when the opener is not the anchor.
    if (Date.now() - this._openedAt < 50) {
      return;
    }
    if (
      this._host.nativeElement.contains(target) ||
      this.anchor()?.contains(target) === true ||
      // A control inside the panel that was removed by its own press.
      !target.isConnected
    ) {
      return;
    }
    this.closed.emit();
  }

  /** Put the panel under its anchor, inside the window. */
  place(): void {
    const panel = this._panel().nativeElement;

    if (this.sheet()) {
      panel.style.top = '';
      panel.style.left = '';
      return;
    }

    const anchor = this.anchor() ?? this._host.nativeElement.parentElement;
    if (anchor === null) {
      return;
    }

    const from = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = this.align() === 'end' ? from.right - width : from.left;
    const below = from.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - GAP;
    const fitsAbove = from.top - GAP - height >= GAP;
    const top = fitsBelow || !fitsAbove ? below : from.top - GAP - height;

    panel.style.left = `${Math.round(
      Math.max(GAP, Math.min(left, window.innerWidth - width - GAP))
    )}px`;
    panel.style.top = `${Math.round(Math.max(GAP, top))}px`;
  }
}

/** Move an element to the top layer, where the browser can. */
function show(element: HTMLElement | undefined): void {
  if (element !== undefined && typeof element.showPopover === 'function') {
    element.showPopover();
  }
}
