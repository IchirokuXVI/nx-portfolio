import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { InfoContent } from '@portfolio/luna-shopper-admin/models';
import { keepTabInside } from '../focus-trap';
import { CautionLine } from './caution-line';

/** How far the panel sits from the button, and from the edge of the window. */
const GAP = 8;

/**
 * What an info button opens (admin plan 0041, section 5).
 *
 * A title, at most four points, and at most one caution. It is a dialog and not
 * a tooltip, because it holds sentences an operator reads and a tooltip is gone
 * the moment the pointer moves.
 *
 * Two shapes from one template. On a wide screen it is a panel that the button
 * anchors, and on a phone it is a sheet from the bottom edge with a scrim behind
 * it and a Close button, because there is no "outside" a thumb can reliably
 * find on a small screen. Which one is drawn is an input, so a spec can ask for
 * either.
 *
 * ## Where it is drawn
 *
 * In the top layer, through the `popover` attribute, and placed from the
 * rectangle of the button. A panel laid out inside the button's own box is
 * clipped by any ancestor that scrolls (a split pane, a table that scrolls
 * sideways), and a fixed sheet stops being fixed to the window under an
 * ancestor with a transform. The top layer has neither problem: nothing clips
 * it and its containing block is the window. A browser without the attribute
 * draws the same fixed boxes in place, which is right wherever no ancestor
 * clips or transforms.
 *
 * The sheet is modal: the scrim covers the page, the focus moves in, and Tab
 * stays in. The panel on a wide screen is not: the page beside it is in view
 * and in reach, and whoever opened it closes it when the focus leaves.
 *
 * It closes nothing by itself. It says that it was asked to close, and whoever
 * opened it decides, because that one also knows where the focus goes back to.
 */
@Component({
  selector: 'lib-info-panel',
  imports: [RokuTranslatorPipe, CautionLine],
  template: `
    <!-- A press on the scrim is a press outside the dialog, and whoever opened
         it hears that press on the document. The scrim itself is not a
         control: a keyboard closes the sheet with Escape or its button. -->
    @if (sheet()) {
      <div #scrim class="scrim" popover="manual" data-info-scrim></div>
    }

    <section
      (keydown)="onKeydown($event)"
      [attr.aria-labelledby]="headingId()"
      [attr.aria-modal]="sheet() ? 'true' : null"
      [class.end]="align() === 'end'"
      [class.sheet]="sheet()"
      #panel
      class="panel"
      popover="manual"
      role="dialog"
      tabindex="-1"
    >
      <h2 [id]="headingId()">{{ info().title | rokuT }}</h2>

      <ul>
        @for (point of info().points; track point) {
          <li>{{ point | rokuT }}</li>
        }
      </ul>

      @if (info().command; as command) {
        <div class="command">
          <code>{{ command }}</code>
          <button (click)="copy(command)" type="button">
            {{ (copied() ? 'info.copied' : 'info.copy') | rokuT }}
          </button>
        </div>
      }

      @if (info().caution; as caution) {
        <lib-caution-line [text]="caution | rokuT" />
      }

      @if (sheet()) {
        <button (click)="closed.emit()" class="close" type="button">
          {{ 'info.close' | rokuT }}
        </button>
      }
    </section>
  `,
  styles: `
    :host {
      display: contents;
    }

    /* Both boxes are popovers, so each rule also undoes what a browser gives a
       popover by default: centered with auto margins, a border, a padding and
       the canvas colors. */
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
      gap: var(--admin-space-3);
      inline-size: min(22rem, calc(100vw - 2rem));
      block-size: auto;
      max-block-size: calc(100dvh - 1rem);
      margin: 0;
      overflow-y: auto;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      /* The one shadow in the app: this panel floats over the page it explains,
         and without an edge of its own it reads as part of the list under it. */
      box-shadow: 0 0.5rem 1.5rem rgb(20 33 29 / 16%);
      font-size: 0.875rem;
      font-weight: 400;
      text-align: start;
      white-space: normal;
      color: var(--admin-ink);
    }

    .panel.sheet {
      inset: auto 0 0;
      inline-size: auto;
      max-block-size: 80dvh;
      padding: var(--admin-space-4) var(--admin-space-4)
        calc(var(--admin-space-4) + env(safe-area-inset-bottom, 0px));
      border: none;
      border-radius: 0.875rem 0.875rem 0 0;
      box-shadow: none;
      font-size: 0.9375rem;
    }

    /* The dialog takes the focus so that reading starts at its heading. It is
       not a control, so it draws no ring: a ring round the whole panel reads
       as a selected state. The button that opened it keeps its pressed look. */
    .panel:focus {
      outline: none;
    }

    h2 {
      font-size: 1rem;
      font-weight: 600;
    }

    ul {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding-inline-start: 1.25rem;
    }

    /* A command to run, as it is typed: the mono face, on the page ground so
       that it reads as a thing to copy and not as a sentence. */
    .command {
      display: flex;
      gap: var(--admin-space-2);
      align-items: center;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface);
    }

    .command code {
      flex: 1;
      min-inline-size: 0;
      overflow-wrap: anywhere;
      font-family: var(--admin-font-mono);
      font-size: 0.78125rem;
    }

    .command button {
      flex: none;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .command button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .close {
      flex: none;
      min-block-size: var(--admin-control);
      font-weight: 500;
      cursor: pointer;
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
export class InfoPanel {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** What to say. */
  readonly info = input.required<InfoContent>();
  /** A sheet from the bottom edge, for a phone. A panel under the button otherwise. */
  readonly sheet = input(false);
  /**
   * Which edge of the button the panel lines up with.
   *
   * `end` for a button at the far side of a header, so the panel opens toward
   * the page and not off its edge. Ignored by the sheet.
   */
  readonly align = input<'start' | 'end'>('end');
  /** A document unique id for the heading, which names the dialog. */
  readonly headingId = input('info-panel-heading');
  /**
   * The element the panel is placed from, which is the button that opened it.
   *
   * Left out, the panel is placed from the element that holds it. Ignored by
   * the sheet, which is placed from the window.
   */
  readonly anchor = input<HTMLElement | null>(null);

  /** Asked to close: the Close button of the sheet. */
  readonly closed = output<void>();

  /** Whether the command was just copied, which the button then says. */
  readonly copied = signal(false);

  private readonly _panel =
    viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly _scrim = viewChild<ElementRef<HTMLElement>>('scrim');

  constructor() {
    const destroyed = inject(DestroyRef);

    afterNextRender(() => {
      const panel = this._panel().nativeElement;

      // The scrim first, so that the panel is above it in the top layer.
      show(this._scrim()?.nativeElement);
      show(panel);
      this.place();

      // Focus goes into the dialog when it opens, so that Tab continues from
      // it and a screen reader starts reading at its heading.
      panel.focus();

      // The panel is fixed to the window and its button is not, so a scroll or
      // a resize moves the one and not the other. Placing it again keeps them
      // together. Capture, because the thing that scrolls may be a pane.
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

  /**
   * Copy the command to the clipboard, and say so on the button.
   *
   * A browser that refuses (no permission, or a page that is not served over
   * a secure origin) leaves the button as it was. The command is still on the
   * screen to be selected by hand.
   */
  async copy(command: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  /** Tab stays inside the sheet. The panel on a wide screen lets it leave. */
  onKeydown(event: KeyboardEvent): void {
    if (this.sheet()) {
      keepTabInside(event, this._panel().nativeElement);
    }
  }

  /**
   * Put the panel under its button, inside the window.
   *
   * Under the button and lined up with the edge `align` names. Moved back in
   * where that would leave the window, and put above the button where there is
   * no room under it and there is room above. Written straight to the element:
   * it has to be in place before it takes the focus.
   */
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
