import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * A record's ID, as the secondary thing it is (admin plan 0051, section 4).
 *
 * Small, in the mono face, in the muted ink, with a button that copies it. An
 * ID is never what a row is called, so this never stands where a name does. It
 * is what an operator carries to a log line or a database, and what any
 * search of this app takes back: the button is the first half of that trip.
 *
 * The whole ID is drawn and none of it is cut. Half an ID copied by hand finds
 * nothing.
 */
@Component({
  selector: 'lib-record-id',
  imports: [RokuTranslatorPipe],
  template: `
    <code>{{ value() }}</code>
    <button
      (click)="copy()"
      [attr.aria-label]="'resource.id.copy' | rokuT"
      type="button"
      data-copy-id
    >
      {{ (copied() ? 'info.copied' : 'info.copy') | rokuT }}
    </button>
    <!-- The button changes its own words, which a screen reader does not
         read out by itself. This line is what it hears. -->
    <span aria-live="polite" class="sr-only">{{
      copied() ? ('info.copied' | rokuT) : ''
    }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--admin-space-2);
      max-inline-size: 100%;
    }

    code {
      font-family: var(--admin-font-mono);
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
      overflow-wrap: anywhere;
    }

    /* Quiet beside the value, and still a full target for a thumb. */
    button {
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-2);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: none;
      font-size: 0.8125rem;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordId {
  readonly value = input.required<string>();

  /** Whether the ID was just copied, which the button then says. */
  readonly copied = signal(false);

  /**
   * Copy the ID, and say so on the button.
   *
   * A browser that refuses (no permission, or a page not served over a secure
   * origin) leaves the button as it was. The ID is still on the screen to be
   * selected by hand.
   */
  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
