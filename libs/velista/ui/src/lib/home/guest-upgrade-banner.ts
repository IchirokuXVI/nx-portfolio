import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * Tells a guest that this phone is the only thing holding their account.
 *
 * That is literally true: a temporary user's refresh token is their entire identity,
 * so losing the device loses the groups (plan 0001, D6). This banner is the product's
 * only defence against that, which is why it uses the attention treatment rather than
 * a quiet informational tone.
 *
 * **No dismiss X.** Two actions, and "Not now" is one of them, so dismissing is a
 * deliberate choice rather than a stray tap on a 24px target. `0003` requires the
 * banner not to reappear within the same session after that choice, which the
 * container owns because it is session state and not presentation.
 */
@Component({
  selector: 'lib-guest-upgrade-banner',
  imports: [RokuTranslatorPipe],
  template: `
    <aside class="banner">
      <h2 class="title">{{ 'home.guest.title' | rokuT }}</h2>
      <p class="body">{{ 'home.guest.body' | rokuT }}</p>
      <div class="actions">
        <button (click)="secure.emit()" class="primary" type="button">
          {{ 'home.guest.secure' | rokuT }}
        </button>
        <button (click)="dismiss.emit()" class="quiet" type="button">
          {{ 'home.guest.later' | rokuT }}
        </button>
      </div>
    </aside>
  `,
  styleUrl: './guest-upgrade-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestUpgradeBanner {
  readonly secure = output<void>();
  readonly dismiss = output<void>();
}
