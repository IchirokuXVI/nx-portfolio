import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BrandMark } from '../brand/brand-mark';
import { CopyIcon, OfflineIcon } from '../icons/icons';

/**
 * The three whole-screen states: nothing yet, something broke, and no connection.
 *
 * All three are shared by every page rather than owned by this one, which is why they
 * take their copy as inputs instead of reading `home.*` keys themselves. The home page
 * passes its own keys; a list page will pass different ones for the same components.
 */

@Component({
  selector: 'lib-empty-state',
  imports: [BrandMark],
  template: `
    <div class="panel">
      <lib-brand-mark class="mark" />
      <h2 class="title">{{ title() }}</h2>
      <p class="body">{{ body() }}</p>
      <div class="actions"><ng-content /></div>
    </div>
  `,
  styleUrl: './state-panels.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly body = input.required<string>();
}

/**
 * A failure the user can act on.
 *
 * The correlation reference is **selectable text as well as a copy button**, because
 * reading it out over the phone is a real support path (plan 0003, section 7). The id
 * is minted by the client, so it exists even when the request never reached a server,
 * which is the case a user is most likely to be reporting.
 */
@Component({
  selector: 'lib-error-state',
  imports: [RokuTranslatorPipe, CopyIcon],
  template: `
    <div class="panel">
      <h2 class="title">{{ title() }}</h2>
      <p class="body">{{ body() }}</p>

      <button (click)="retry.emit()" class="action" type="button">
        {{ 'home.error.retry' | rokuT }}
      </button>

      @if (correlationId(); as reference) {
        <p class="reference">
          <span class="reference-text">{{
            'home.error.reference' | rokuT: { correlationId: reference }
          }}</span>
          <button
            (click)="copyReference.emit(reference)"
            [attr.aria-label]="'home.error.copyReference' | rokuT"
            class="copy"
            type="button"
          >
            <lib-copy-icon class="glyph" />
          </button>
        </p>
      }
    </div>
  `,
  styleUrl: './state-panels.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorState {
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  readonly correlationId = input<string | null>(null);

  readonly retry = output<void>();
  readonly copyReference = output<string>();
}

/**
 * The blocking screen for a lost connection.
 *
 * Deliberately minimal and explicitly temporary (plan 0001 D6, plan 0003 section 3.1):
 * no offline queue, no cached content behind it, and the app reloads itself when the
 * connection returns. Both plans record this as the weakest part of the design and the
 * first thing the PWA work should replace.
 *
 * The Reload now button is an addition to the brief, and it earns its place: the
 * automatic reload depends on an event that does not always fire on a flapping mobile
 * connection, and without a manual way out the user is stuck on a dead screen.
 *
 * It covers the page, so it is rendered by the app layout rather than by any one page.
 */
@Component({
  selector: 'lib-connection-lost',
  imports: [RokuTranslatorPipe, OfflineIcon],
  template: `
    <div aria-live="assertive" class="blocking" role="alertdialog">
      <div class="panel">
        <lib-offline-icon class="mark" />
        <h2 class="title">{{ 'connection.lost.title' | rokuT }}</h2>
        <p class="body">{{ 'connection.lost.body' | rokuT }}</p>
        <button (click)="reload.emit()" class="action quiet" type="button">
          {{ 'connection.lost.reload' | rokuT }}
        </button>
      </div>
    </div>
  `,
  styleUrl: './state-panels.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionLost {
  readonly reload = output<void>();
}
