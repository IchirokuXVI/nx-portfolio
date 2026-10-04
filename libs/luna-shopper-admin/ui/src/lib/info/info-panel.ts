import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { InfoContent } from '@portfolio/luna-shopper-admin/models';
import { CautionLine } from './caution-line';

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
      <div class="scrim" data-info-scrim></div>
    }

    <section
      [attr.aria-labelledby]="headingId()"
      [class.end]="align() === 'end'"
      [class.sheet]="sheet()"
      #panel
      class="panel"
      role="dialog"
      tabindex="-1"
    >
      <h2 [id]="headingId()">{{ info().title | rokuT }}</h2>

      <ul>
        @for (point of info().points; track point) {
          <li>{{ point | rokuT }}</li>
        }
      </ul>

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

    .scrim {
      position: fixed;
      z-index: 30;
      inset: 0;
      background: rgb(20 33 29 / 50%);
    }

    .panel {
      position: absolute;
      z-index: 31;
      inset-block-start: calc(100% + var(--admin-space-2));
      inset-inline-start: 0;
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      inline-size: min(22rem, calc(100vw - 2rem));
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border-strong);
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

    .panel.end {
      inset-inline: auto 0;
    }

    .panel.sheet {
      position: fixed;
      inset: auto 0 0;
      inline-size: auto;
      max-block-size: 80dvh;
      overflow-y: auto;
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

    .close {
      min-block-size: 2.75rem;
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

  /** Asked to close: the Close button of the sheet. */
  readonly closed = output<void>();

  private readonly _panel =
    viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    // Focus goes into the dialog when it opens, so that Tab continues from it
    // and a screen reader starts reading at its heading.
    afterNextRender(() => this._panel().nativeElement.focus());
  }
}
