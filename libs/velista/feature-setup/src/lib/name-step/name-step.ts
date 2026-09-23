import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  ProfileStore,
  SessionStore,
} from '@portfolio/velista/data-access';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_SCOPE_DEFAULT,
} from '@portfolio/velista/models';
import { PageNavigation } from '@portfolio/velista/platform';
import { InfoIcon, SetupStepHeader, SpinnerIcon } from '@portfolio/velista/ui';
import { focusHeading } from '../focus-heading';
import { SetupFlow } from '../setup-flow';

/** A failure the step draws under the field, as a key and what it interpolates. */
interface Failure {
  readonly key: string;
  readonly wait: string;
}

/**
 * Step 1 of 3, the name (velista `0098`, section 5).
 *
 * ## The name already exists
 *
 * Registration generated one and the client never sends a display name (`0009`,
 * section 5.1), so the account is already "Brave Anchor" when this opens. The field is
 * therefore **empty**, with that name named beside it in a card, and the primary button
 * says what it will do: keep the card's name while the field is empty, continue as
 * whatever is typed once something is.
 *
 * ## What is written, and when
 *
 * Only on the primary button, and only a change. A blank field with the generated name
 * on the card writes nothing at all. A typed name is written once through
 * `ProfileStore.rename`. **Pick another one** asks the server for a name and swaps it
 * onto the card and writes nothing; if the person then keeps it, that is a change, and
 * the button writes it.
 *
 * Skip writes nothing, whatever is in the field or on the card.
 */
@Component({
  selector: 'lib-setup-name-step',
  imports: [RokuTranslatorPipe, InfoIcon, SetupStepHeader, SpinnerIcon],
  templateUrl: './name-step.html',
  styleUrl: './name-step.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NameStep {
  private readonly _flow = inject(SetupFlow);
  private readonly _profile = inject(ProfileStore);
  private readonly _session = inject(SessionStore);
  private readonly _pages = inject(PageNavigation);

  protected readonly maxLength = USERNAME_MAX_LENGTH;

  protected readonly typed = signal('');

  /** A name the server suggested, drawn on the card in place of the account's own. */
  private readonly _suggested = signal<string | null>(null);

  protected readonly suggesting = signal(false);
  protected readonly saving = signal(false);
  protected readonly failure = signal<Failure | null>(null);

  /** The name the account has now: the profile's when it has answered, else the pair's. */
  private readonly _current = computed(() => this._session.username() ?? '');

  /** The name on the card, which is what the button keeps when the field is empty. */
  protected readonly cardName = computed(
    () => this._suggested() ?? this._current()
  );

  protected readonly trimmed = computed(() => this.typed().trim());

  /** The primary button's words, which say what pressing it will do. */
  protected readonly action = computed(() => {
    const typed = this.trimmed();
    return typed === ''
      ? { key: 'setup.name.keep', name: this.cardName() }
      : { key: 'setup.name.continue', name: typed };
  });

  /** A typed name shorter than the server accepts is not sent to be refused. */
  protected readonly canContinue = computed(() => {
    const length = this.trimmed().length;
    return !this.saving() && (length === 0 || length >= USERNAME_MIN_LENGTH);
  });

  private readonly _heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    focusHeading(this._heading);
  }

  protected onInput(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
    this.failure.set(null);
  }

  /** Ask for another name and draw it on the card. Writes nothing. */
  protected async another(): Promise<void> {
    if (this.suggesting()) {
      return;
    }

    this.suggesting.set(true);
    this.failure.set(null);
    try {
      this._suggested.set(await this._profile.suggestUsername());
    } catch {
      this.failure.set({ key: 'account.error.failed', wait: '' });
    } finally {
      this.suggesting.set(false);
    }
  }

  /** The keyboard's Go key and the primary both arrive here. */
  protected onSubmit(event: Event): void {
    event.preventDefault();
    void this.continue();
  }

  protected async continue(): Promise<void> {
    if (!this.canContinue()) {
      return;
    }

    const name = this.trimmed() === '' ? this.cardName() : this.trimmed();
    if (name === '' || name === this._current()) {
      await this._flow.go('place');
      return;
    }

    this.saving.set(true);
    this.failure.set(null);
    try {
      const outcome = await this._profile.rename(name, USERNAME_SCOPE_DEFAULT);
      if (outcome.state === 'failed') {
        this.failure.set(failureOf(outcome.error));
        return;
      }
    } finally {
      this.saving.set(false);
    }

    await this._flow.go('place');
  }

  /** Back to the welcome, which is the only screen before this one. */
  protected back(): void {
    void this._pages.back(this._flow.path(''));
  }

  protected skip(): void {
    void this._flow.go('place');
  }
}

/**
 * The account screen's own copy for a refused rename, so the two say the same thing.
 *
 * Rate limited is five per hour and says when; a name the server will not take states
 * the rule; anything else is the ordinary try again.
 */
function failureOf(error: unknown): Failure {
  if (error instanceof GatewayError) {
    if (error.code === 'rate_limited') {
      return {
        key: 'account.error.tooManyRenames',
        wait: asClock(error.retryAfterSeconds ?? 0),
      };
    }
    if (error.code === 'validation_failed') {
      return { key: 'account.error.badName', wait: '' };
    }
  }

  return { key: 'account.error.failed', wait: '' };
}

/** Seconds as `m:ss`, the shape the account screen draws a wait in. */
function asClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
