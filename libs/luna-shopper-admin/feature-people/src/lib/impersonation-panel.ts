import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  type OnDestroy,
} from '@angular/core';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  IMPERSONATION_REASONS,
  toGatewayError,
  type ImpersonationReason,
  type ImpersonationSession,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import { CautionLine } from '@portfolio/luna-shopper-admin/ui';
import { instant } from './people-format';

/** The most a note may hold, as the gateway checks it (backend plan 0194). */
export const IMPERSONATION_NOTE_MAX = 500;

/** How often the time left on the link is said again. */
const TICK_MS = 1000;

/**
 * How long a handoff code is good for, from its start: the
 * `IMPERSONATION_CODE_TTL_MS` of backend plan 0194. The link counts down from
 * the arrival of the answer by this much, so a browser clock that is wrong
 * does not change the time left (see "What the build decided").
 */
export const IMPERSONATION_CODE_LIFETIME_MS = 60 * 1000;

/** What the dialog keeps of an answer once it arrived. Not the address. */
interface Started {
  /** When the session ends, as the gateway said it. */
  readonly expiresAt: string;
  /** When the link is too old, on the clock of this browser. */
  readonly deadline: number;
}

/** What the dialog asks the descriptor to do: start one session. */
export type StartImpersonation = (start: {
  readonly reason: ImpersonationReason;
  readonly note?: string;
}) => Promise<ImpersonationSession>;

/** The reason a step of the dialog was refused, as a translation key. */
const REFUSAL_KEYS: Readonly<Record<string, string>> = {
  impersonation_disabled: 'people.users.impersonate.refused.disabled',
};

/**
 * Open the app as a person: a reason, a session, and a link the operator
 * presses (admin plan 0062).
 *
 * The panel of the named action `open-as-user`, drawn in the dialog that
 * every action panel gets. That frame owns the heading, Escape and "Close".
 *
 * **A link and not a window.** A browser lets a script open a window only
 * inside the press itself, and the press here starts a request. So the
 * answer becomes a real `<a target="_blank">`, and the operator presses it.
 *
 * **The address lives here and nowhere else.** It arrives in the answer, is
 * held in one signal of this component (`link`), and is written only into the
 * `href` of the link. The rest of the answer is kept without it. The press,
 * the end of the minute and the close of the dialog each drop it. It is never
 * logged, copied or stored.
 *
 * **The reason is sent as its code.** The words of an option are copy.
 */
@Component({
  selector: 'lib-impersonation-panel',
  imports: [CautionLine, RokuTranslatorPipe],
  template: `
    @switch (step()) {
      @case ('ask') {
        <p>{{ 'people.users.impersonate.body' | rokuT: { name: name() } }}</p>

        <div class="field">
          <label for="impersonate-reason">{{
            'people.users.impersonate.reason.label' | rokuT
          }}</label>
          <select
            (change)="choose($event)"
            [disabled]="busy()"
            id="impersonate-reason"
            required
            data-impersonate-reason
          >
            <option [selected]="reason() === null" disabled value="">
              {{ 'people.users.impersonate.reason.choose' | rokuT }}
            </option>
            @for (code of reasons; track code) {
              <option [selected]="reason() === code" [value]="code">
                {{ 'people.users.impersonate.reason.' + code | rokuT }}
              </option>
            }
          </select>
        </div>

        @if (reason() === 'OTHER') {
          <div class="field">
            <label for="impersonate-note">{{
              'people.users.impersonate.note.label' | rokuT
            }}</label>
            <textarea
              (input)="write($event)"
              [disabled]="busy()"
              [maxLength]="noteMax"
              [value]="note()"
              aria-describedby="impersonate-note-help"
              id="impersonate-note"
              required
              rows="3"
              data-impersonate-note
            ></textarea>
            <p class="quiet" id="impersonate-note-help">
              {{
                'people.users.impersonate.note.help' | rokuT: { max: noteMax }
              }}
            </p>
          </div>
        }

        @if (refusalKey(); as key) {
          <lib-caution-line
            [text]="key | rokuT"
            tone="refused"
            data-impersonate-refusal
          />
        }

        <div class="controls">
          <button
            (click)="start()"
            [disabled]="!canStart()"
            class="primary"
            type="button"
            data-impersonate-start
          >
            {{
              (busy()
                ? 'people.users.impersonate.starting'
                : 'people.users.impersonate.start'
              ) | rokuT
            }}
          </button>
        </div>
      }

      @case ('link') {
        <p>{{ 'people.users.impersonate.once' | rokuT }}</p>
        <a
          (auxclick)="pressedAux($event)"
          (click)="pressed()"
          [href]="link()"
          class="open"
          rel="noopener noreferrer"
          target="_blank"
          data-impersonate-link
          >{{ 'people.users.impersonate.open' | rokuT: { name: name() } }}</a
        >
        <p class="quiet" data-impersonate-left>
          {{
            'people.users.impersonate.left' | rokuT: { seconds: secondsLeft() }
          }}
        </p>
      }

      @case ('old') {
        <p role="status" data-impersonate-old>
          {{ 'people.users.impersonate.tooOld' | rokuT }}
        </p>
        <div class="controls">
          <button (click)="again()" type="button" data-impersonate-again>
            {{ 'people.users.impersonate.again' | rokuT }}
          </button>
        </div>
      }

      @case ('opened') {
        <p role="status" tabindex="-1" data-impersonate-opened>
          {{ 'people.users.impersonate.opened' | rokuT: { until: until() } }}
        </p>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    label {
      font-weight: 600;
    }

    select,
    textarea {
      inline-size: 100%;
    }

    textarea {
      display: block;
      resize: vertical;
    }

    .quiet {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      justify-content: flex-end;
    }

    button,
    .open {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      cursor: pointer;
    }

    /* The one thing to press in each step carries the accent. */
    button.primary,
    .open {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .open {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      text-decoration: none;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    select:focus-visible,
    textarea:focus-visible,
    button:focus-visible,
    .open:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    p[tabindex]:focus {
      outline: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImpersonationPanel implements OnDestroy {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);

  /** The title of the person, for the sentence and the link. */
  readonly name = input.required<string>();
  /** Start the session. Built by the descriptor, which owns the write. */
  readonly startSession = input.required<StartImpersonation>();

  readonly reasons = IMPERSONATION_REASONS;
  readonly noteMax = IMPERSONATION_NOTE_MAX;

  readonly reason = signal<ImpersonationReason | null>(null);
  readonly note = signal('');
  readonly busy = signal(false);
  readonly refusalKey = signal<string | null>(null);
  /** A refusal that no second press can change: the switch, a gone account. */
  private readonly _final = signal(false);

  /** The address of the app, until it is pressed or too old. */
  readonly link = signal<string | null>(null);
  private readonly _started = signal<Started | null>(null);
  private readonly _opened = signal(false);
  private readonly _now = signal(Date.now());
  private _timer: ReturnType<typeof setInterval> | null = null;
  /** The dialog closed. An answer that arrives after it is dropped. */
  private _destroyed = false;

  /** The control that had the focus when the dialog opened. */
  private readonly _opener =
    typeof document === 'undefined'
      ? null
      : (document.activeElement as HTMLElement | null);

  readonly step = computed<'ask' | 'link' | 'old' | 'opened'>(() => {
    if (this._opened()) {
      return 'opened';
    }
    const started = this._started();
    if (started === null) {
      return 'ask';
    }
    return this._now() >= started.deadline ? 'old' : 'link';
  });

  readonly canStart = computed(() => {
    const reason = this.reason();
    if (reason === null || this.busy() || this._final()) {
      return false;
    }
    if (reason !== 'OTHER') {
      return true;
    }
    const note = this.note().trim();
    return note !== '' && note.length <= IMPERSONATION_NOTE_MAX;
  });

  /** Whole seconds left on the link, never below zero. */
  readonly secondsLeft = computed(() => {
    const started = this._started();
    return started === null
      ? 0
      : Math.max(0, Math.ceil((started.deadline - this._now()) / 1000));
  });

  /** When the session ends, in the reading language of the operator. */
  readonly until = computed(() =>
    instant(this._started()?.expiresAt ?? null, this._translator.locale())
  );

  constructor() {
    // A step that takes away the control with the focus hands it on: to the
    // link, to "Start again", or to the sentence that says the tab is open.
    effect(() => {
      const step = this.step();
      untracked(() => {
        if (step === 'old') {
          this._stopClock();
          this.link.set(null);
        }
        afterNextRender(() => this._focusStep(step), {
          injector: this._injector,
        });
      });
    });
  }

  ngOnDestroy(): void {
    this._destroyed = true;
    this._stopClock();
    this.link.set(null);
    // Back to the control that opened the dialog, when it is still there.
    if (this._opener?.isConnected === true) {
      this._opener.focus();
    }
  }

  choose(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const reason = this.reasons.find((code) => code === value) ?? null;
    this.reason.set(reason);
    if (reason !== 'OTHER') {
      this.note.set('');
    }
  }

  write(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value);
  }

  async start(): Promise<void> {
    const reason = this.reason();
    if (reason === null || !this.canStart()) {
      return;
    }

    this.busy.set(true);
    this.refusalKey.set(null);
    try {
      const note = this.note().trim();
      const session = await this.startSession()(
        reason === 'OTHER' ? { reason, note } : { reason }
      );
      if (this._destroyed) {
        // Closed while it started: nothing is left to hold the link or tick.
        return;
      }
      this._keep(session);
    } catch (error) {
      if (this._destroyed) {
        return;
      }
      const refused = toGatewayError(error);
      if (refused.status === 404) {
        this._final.set(true);
        this.refusalKey.set('people.users.impersonate.refused.gone');
      } else if (REFUSAL_KEYS[refused.code] !== undefined) {
        this._final.set(true);
        this.refusalKey.set(REFUSAL_KEYS[refused.code]);
      } else {
        this.refusalKey.set(
          gatewayErrorKey(refused) ?? 'resource.error.unknown'
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The operator pressed the link. The browser has already taken the press
   * to the new tab when this runs, and the link goes on the next render.
   */
  pressed(): void {
    this._stopClock();
    this.link.set(null);
    this._opened.set(true);
  }

  /** A middle press opens the link in a tab too. */
  pressedAux(event: MouseEvent): void {
    if (event.button === 1) {
      this.pressed();
    }
  }

  /** Back to the reason, for a link that is too old. */
  again(): void {
    this._started.set(null);
    this.link.set(null);
  }

  /**
   * Hold the address in `link` alone, and the rest without it. The minute is
   * counted from now, on this clock, and not from `codeExpiresAt`, which is a
   * time on the clock of the server.
   */
  private _keep(session: ImpersonationSession): void {
    const now = Date.now();
    this._now.set(now);
    this.link.set(session.url);
    this._started.set({
      expiresAt: session.expiresAt,
      deadline: now + IMPERSONATION_CODE_LIFETIME_MS,
    });
    this._startClock();
  }

  private _startClock(): void {
    this._stopClock();
    this._timer = setInterval(() => this._now.set(Date.now()), TICK_MS);
  }

  private _stopClock(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _focusStep(step: string): void {
    const host = this._host.nativeElement;
    const active = host.ownerDocument.activeElement;
    // Only when the focus was lost with the step. An operator who moved it
    // elsewhere in the dialog keeps it where they put it.
    if (active !== null && active !== host.ownerDocument.body) {
      return;
    }
    const target =
      step === 'link'
        ? '[data-impersonate-link]'
        : step === 'old'
          ? '[data-impersonate-again]'
          : step === 'opened'
            ? '[data-impersonate-opened]'
            : '[data-impersonate-reason]';
    host.querySelector<HTMLElement>(target)?.focus();
  }
}
