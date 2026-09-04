import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { SessionLifecycle } from '@portfolio/luna-shopper-admin/data-access';

/**
 * "This is about to end, and anything you do keeps it" (plan 0003, section 3).
 *
 * Shown only while the session is idle and inside the warning fraction of the
 * token's lifetime, which is three minutes of fifteen and moves with the TTL
 * rather than being a fixed three minutes.
 *
 * **It is not a modal and it does not trap anything.** The session is still
 * perfectly usable and the operator has done nothing wrong; covering the screen
 * to say so would be worse than the expiry it is warning about. It is a strip at
 * the bottom of the viewport, above the content and out of the way of it.
 *
 * The button is not a dismissal. Dismissing the warning and touching anything
 * are the same act — both are activity, both renew the token, and both take the
 * strip away — so there is deliberately no close control that leaves the session
 * running down with the operator believing they answered it.
 *
 * `role="status"` rather than `alert`: this is not an error and it interrupts a
 * screen reader mid sentence if it is announced as one. Polite is right for
 * something with minutes of warning behind it.
 */
@Component({
  selector: 'lib-session-warning',
  imports: [RokuTranslatorPipe],
  template: `
    <p>{{ 'session.warning.body' | rokuT }}</p>
    <button (click)="keep()" type="button">
      {{ 'session.warning.keep' | rokuT }}
    </button>
  `,
  host: {
    role: 'status',
    'aria-live': 'polite',
  },
  styles: `
    :host {
      position: fixed;
      z-index: 50;
      display: flex;
      /* Wraps to two rows on a phone rather than squeezing the button off the
         edge, which is the width this is most likely to be read at. */
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: var(--admin-space-3);
      /* Bottom rather than top: the top of an admin screen is where the chrome
         and the environment badge go, and covering the badge to warn about a
         session would hide which database the operator is looking at. */
      inset-block-end: 0;
      inset-inline: 0;
      padding: var(--admin-space-3) var(--admin-space-4);
      /* Fully opaque, like the overlay, for the plainer reason that text over a
         half seen table is hard to read. */
      border-block-start: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
      color: var(--admin-ink);
    }

    p {
      margin: 0;
      font-size: 0.875rem;
    }

    button {
      min-block-size: 2.75rem;
      padding: 0 var(--admin-space-4);
      border: 1px solid transparent;
      border-radius: var(--admin-radius);
      background: var(--admin-accent);
      font: inherit;
      font-weight: 600;
      color: var(--admin-accent-ink);
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionWarning {
  private readonly _lifecycle = inject(SessionLifecycle);

  keep(): void {
    this._lifecycle.keepAlive();
  }
}
