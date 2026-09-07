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

/**
 * The seconds before the app knows whether it can reach the backend (plan 0071).
 *
 * The fourth whole screen state, and the one that comes first: the app used to start
 * on a guess that it was online, draw a page, fire its requests and only then discover
 * it had no backend, which reads as the app breaking rather than as the app waiting.
 * `AppLayout` renders this **instead of** the outlet rather than over it, so the page
 * behind is never constructed and its resolvers never run on behalf of somebody who
 * has been told to wait (D3). `ConnectionLost` above is the opposite case and stays an
 * overlay, because there the page below is already alive and worth preserving.
 *
 * ## There is no spinner, and that is the design
 *
 * A stalled spinner is the most common way an app says "I have frozen" when what it
 * means is "I am waiting". After three seconds this says the true thing instead, in
 * words, and offers a way to act on it.
 *
 * Being the only content in the outlet's place, nothing behind it is reachable by tab,
 * so it needs no focus trap, which is the bug the overlay version of this would have
 * had. Both messages live in one `role="status"` region, which announces politely
 * rather than interrupting, and the three second change is text in place: it moves no
 * focus.
 *
 * Its copy arrives as inputs like every other panel here, so this library still reads
 * no keys of its own.
 */
@Component({
  selector: 'lib-startup-screen',
  imports: [BrandMark],
  template: `
    <div class="blocking">
      <div class="panel">
        <lib-brand-mark class="mark" />

        <div aria-live="polite" class="status" role="status">
          @if (slow()) {
            <h2 class="title">{{ slowTitle() }}</h2>
            <p class="body">{{ slowBody() }}</p>
          } @else {
            <p class="body">{{ connecting() }}</p>
          }
        </div>

        @if (slow()) {
          <button (click)="retry.emit()" class="action quiet" type="button">
            {{ retryLabel() }}
          </button>
        }
      </div>
    </div>
  `,
  styleUrl: './state-panels.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartupScreen {
  /** The one line shown while the wait is still ordinary. */
  readonly connecting = input.required<string>();

  /** The escape text and its button, which appear together or not at all. */
  readonly slowTitle = input.required<string>();
  readonly slowBody = input.required<string>();
  readonly retryLabel = input.required<string>();

  /**
   * Whether the wait has gone on long enough to say so.
   *
   * Wall clock from the app starting rather than from the current attempt, which is
   * `BackendReadiness.slow()`'s whole argument (D8): a per attempt timer resets on
   * every retry, so this sentence would arrive late or never on exactly the connection
   * that needs it.
   */
  readonly slow = input(false);

  readonly retry = output<void>();
}
