import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { LockIcon } from '@portfolio/shared/ui';

/**
 * A value that the form shows and cannot change (admin plan 0052, section
 * 3.8).
 *
 * The value is the content of the element, usually a `lib-field-value`. After
 * it comes a lock and the words that say who set it: "Set by the harvester",
 * "Fixed when it was added". A form that hid what it cannot change would be a
 * worse view of the record than the page it was opened from, and a value with
 * no control and no reason reads as a field that failed to draw.
 *
 * The lock is for the eye. The words carry the meaning.
 */
@Component({
  selector: 'lib-locked-value',
  imports: [RokuTranslatorPipe, LockIcon],
  template: `
    <ng-content />
    <span class="reason">
      <span class="lock"><lib-lock-icon /></span>
      <span data-reason>{{ reason() | rokuT }}</span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-2);
      align-items: center;
      min-block-size: var(--admin-control);
      max-inline-size: 100%;
    }

    .reason {
      display: inline-flex;
      gap: var(--admin-space-1);
      align-items: center;
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .lock {
      flex: none;
      inline-size: 0.875rem;
      block-size: 0.875rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LockedValue {
  /** A translation key for the words after the lock. */
  readonly reason = input.required<string>();
}
