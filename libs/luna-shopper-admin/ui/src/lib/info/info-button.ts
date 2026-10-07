import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { InfoContent } from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '../viewport';
import { InfoPanel } from './info-panel';

let nextId = 0;

/**
 * The button that replaced the paragraph above a page (admin plan 0041,
 * section 5).
 *
 * A circle with the letter i. Its accessible name says what it explains, so a
 * page with two of them does not offer a screen reader "info" twice.
 *
 * It owns the open state and everything about leaving it: Escape closes, a
 * press anywhere outside closes, and either way the focus returns here, which
 * is where the operator was before they asked.
 */
@Component({
  selector: 'lib-info-button',
  imports: [RokuTranslatorPipe, InfoPanel],
  template: `
    <button
      (click)="toggle()"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="
        'info.about' | rokuT: { subject: (info().title | rokuT) }
      "
      [class.open]="open()"
      #trigger
      aria-haspopup="dialog"
      class="trigger"
      type="button"
    >
      <span aria-hidden="true" class="glyph">i</span>
    </button>

    @if (open()) {
      <lib-info-panel
        (closed)="close()"
        [align]="align()"
        [anchor]="trigger"
        [headingId]="headingId"
        [info]="info()"
        [sheet]="compact()"
      />
    }
  `,
  host: {
    '(document:click)': 'pressed($event)',
    '(document:keydown.escape)': 'close()',
    '(focusout)': 'left($event)',
  },
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      flex: none;
    }

    /* The target is a full control, and the circle inside it is the 28 px mark
       of the mock: a small glyph with a thumb sized hit area around it. */
    .trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: var(--admin-control);
      min-block-size: var(--admin-control);
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
    }

    .glyph {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 1.75rem;
      block-size: 1.75rem;
      border: 1px solid var(--admin-border-strong);
      border-radius: 50%;
      background: var(--admin-surface-raised);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    .trigger.open .glyph {
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .trigger:focus-visible {
      outline: none;
    }

    .trigger:focus-visible .glyph {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoButton {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _viewport = inject(Viewport);
  private readonly _trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  /** What the panel says. Its title is also what this button is named after. */
  readonly info = input.required<InfoContent>();
  /** Which edge of the button the panel lines up with on a wide screen. */
  readonly align = input<'start' | 'end'>('end');

  /** A sheet on a phone, a panel anchored here otherwise. */
  readonly compact = this._viewport.compact;

  readonly open = signal(false);

  /** One per button, so two panels on one page do not share a heading id. */
  readonly headingId = `info-panel-${nextId++}`;

  toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.open.set(true);
    }
  }

  /**
   * Close, and put the focus back on the button.
   *
   * Called for Escape on a closed panel as well, where it does nothing: a page
   * may hold several of these and every one of them hears the key.
   */
  close(): void {
    if (!this.open()) {
      return;
    }

    this.open.set(false);
    this._trigger().nativeElement.focus();
  }

  /**
   * The focus left the button and its panel, on a wide screen.
   *
   * The panel there is not modal: Tab walks out of it and on down the page,
   * and a panel left open behind the focus would cover what the operator is
   * now working on. So it closes, and the focus stays where it went. The sheet
   * on a phone keeps Tab inside itself, and is not closed by this.
   *
   * A focus that went nowhere (a press on plain text, another window) is left
   * to the press handler below, which knows where the press landed.
   */
  left(event: FocusEvent): void {
    const next = event.relatedTarget;

    if (
      this.open() &&
      !this.compact() &&
      next instanceof Node &&
      !this._host.nativeElement.contains(next)
    ) {
      this.open.set(false);
    }
  }

  /**
   * A press somewhere in the document.
   *
   * Outside this element it closes the panel. Inside it, the press is the
   * button's own click or a click in the panel, and both are handled where
   * they happen. The sheet's scrim is inside this element and outside the
   * dialog, so a press on it closes too.
   */
  pressed(event: Event): void {
    const target = event.target;

    if (!this.open() || !(target instanceof Element)) {
      return;
    }

    if (
      !this._host.nativeElement.contains(target) ||
      target.hasAttribute('data-info-scrim')
    ) {
      this.close();
    }
  }
}
