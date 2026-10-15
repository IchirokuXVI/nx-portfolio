import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ImpersonationSession } from '@portfolio/velista/data-access';
import { OutcomeScreen, SpinnerIcon } from '@portfolio/velista/ui';

type HandoffState = 'working' | 'invalid' | 'failed';

/**
 * Where an operator's link to a support session lands (velista `0133`, target 3).
 *
 * The back office starts a session for a user and opens
 * `…/auth/impersonate#code=<code>` (backend `0194`). This page trades the code for the
 * user's pair and makes this tab hold it.
 *
 * - **The fragment is gone before any request.** The code is good once, for a minute,
 *   but a code left in the address is in the history and in a screenshot. It is
 *   replaced away as the page is created, and only then posted.
 * - **A good code** writes the marker and the pair to this tab and loads home as a new
 *   document (`ImpersonationSession.begin`). The page stays on its spinner until then.
 * - **A bad code, or none**, draws one sentence: the link is used or too old, and the
 *   operator opens a new one from the back office. No way into the app is offered,
 *   because the app here would be the operator's own account.
 * - **No answer** says so, and offers the same code again: it may still be good.
 *
 * No guard: nobody needs to be signed in, and the operator usually is, as themselves.
 */
@Component({
  selector: 'lib-impersonate-page',
  imports: [OutcomeScreen, RokuTranslatorPipe, SpinnerIcon],
  template: `
    @switch (state()) {
      @case ('working') {
        <div class="working" role="status">
          <lib-spinner-icon class="spinner" />
          <span class="visually-hidden">{{
            'support.handoff.working' | rokuT
          }}</span>
        </div>
      }
      @case ('invalid') {
        <lib-outcome-screen
          [body]="'support.handoff.invalidBody' | rokuT"
          [title]="'support.handoff.invalidTitle' | rokuT"
          tone="expired"
        />
      }
      @case ('failed') {
        <lib-outcome-screen
          (action)="retry()"
          [actionLabel]="'support.handoff.retry' | rokuT"
          [body]="'support.handoff.failedBody' | rokuT"
          [title]="'support.handoff.failedTitle' | rokuT"
          tone="expired"
        />
      }
    }
  `,
  styleUrl: './impersonate-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImpersonatePage {
  private readonly _support = inject(ImpersonationSession);
  private readonly _location = inject(Location);

  readonly state = signal<HandoffState>('working');

  private readonly _code: string | null;

  constructor() {
    const fragment = inject(ActivatedRoute).snapshot.fragment;
    this._code = codeFrom(fragment);

    if (fragment !== null) {
      // The address without its fragment, in place of the one with it.
      this._location.replaceState(this._location.path(false));
    }

    void this._open();
  }

  retry(): void {
    void this._open();
  }

  private async _open(): Promise<void> {
    const code = this._code;
    if (code === null) {
      this.state.set('invalid');
      return;
    }

    this.state.set('working');
    const outcome = await this._support.exchange(code);

    if (outcome.state === 'opened') {
      this._support.begin(outcome.tokens);
      return;
    }

    this.state.set(outcome.state);
  }
}

/** The `code` of a fragment such as `code=abc`, or null. Anybody can write a fragment. */
function codeFrom(fragment: string | null): string | null {
  if (fragment === null) {
    return null;
  }

  const code = new URLSearchParams(fragment).get('code')?.trim() ?? '';
  return code === '' ? null : code;
}
