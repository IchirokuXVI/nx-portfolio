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
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  AlertIcon,
  EmailField,
  FormError,
  GoogleOption,
  LinkedText,
  PASSWORD_MIN_LENGTH,
  PasswordField,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import type { AuthErrorCopy } from '../auth-error-copy';

/**
 * Something, an @, something, a dot, something, with no spaces (velista `0160`).
 *
 * Looser than the gateway's `@IsEmail()` on purpose: this only answers the obvious
 * miss before a round trip, and the server still refuses whatever this lets past.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a submit hands up: the address trimmed, the password as typed. */
export interface AccountFormValue {
  readonly email: string;
  readonly password: string;
}

/**
 * The one form register and upgrade share (velista `0173`, target 3, D2).
 *
 * The owner asked for one form. Plan `0009`'s objection, inputs for every label, falls
 * away because the two modes differ by their ids and one label; what else differs stays
 * on the page: which call it makes, register's conflict action and its sign in footer,
 * upgrade's keepsafe note and its "Not now".
 *
 * ## What it owns
 *
 * The address, the two passwords, the checkbox and the privacy line, the error slot,
 * the submit, and the Google option with its line. It answers the obvious misses
 * before the request (plan `0160`), in order: the address shape, the password length,
 * the two passwords, then the checkbox. Only a form that passes all four emits
 * {@link submitted}.
 *
 * ## The checkbox is not a condition on the button
 *
 * Plan `0009` section 5.5 and plan `0160`: a press with the box clear says "Tick the box
 * to accept the Terms" under it, marks it invalid, moves focus to it and sends nothing.
 * The label holds the link to the terms, which open as a sheet over this form, so
 * nothing typed is lost. Under it, outside the label, one line links the privacy
 * policy, which is read and never accepted.
 *
 * With no terms published ({@link termsUrl} null), neither is drawn and nothing about
 * them is checked (target 9).
 *
 * ## A refusal about the terms
 *
 * An {@link error} placed on `terms` clears the box and is drawn under it with its link,
 * and focus moves to the box: the person reads the terms again and ticks it again.
 */
@Component({
  selector: 'lib-account-form',
  imports: [
    AlertIcon,
    EmailField,
    FormError,
    GoogleOption,
    LinkedText,
    PasswordField,
    RokuTranslatorPipe,
    SpinnerIcon,
  ],
  templateUrl: './account-form.html',
  styleUrl: './account-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountForm {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);

  /** Which screen: decides the ids and the submit label. */
  readonly mode = input.required<'register' | 'upgrade'>();

  /** True while the page's request is out. The fields read only, the button is busy. */
  readonly submitting = input(false);

  /** The page's answer to the last request, or null. */
  readonly error = input<AuthErrorCopy | null>(null);

  /** The terms, as a sheet over this form, or null when none were published. */
  readonly termsUrl = input<string | null>(null);

  /** The privacy policy, as a sheet over this form, or null on the same terms. */
  readonly privacyUrl = input<string | null>(null);

  /** Whether the Google option is drawn below the form. */
  readonly googleOffered = input(false);

  /** True from a press on Google until the document leaves. */
  readonly googleBusy = input(false);

  /** A refused Google start, drawn beside the button, or null. */
  readonly googleError = input<AuthErrorCopy | null>(null);

  readonly submitted = output<AccountFormValue>();
  readonly continueWithGoogle = output<void>();

  /** The way out a page's error offers, when it has one (register's sign in). */
  readonly errorAction = output<void>();

  readonly email = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');

  /** Whether the box is ticked. */
  readonly accepted = signal(false);

  /** A miss this form answered before any request, or null. */
  readonly localError = signal<AuthErrorCopy | null>(null);

  readonly minPasswordLength = PASSWORD_MIN_LENGTH;

  readonly ids = computed(() => {
    const prefix = this.mode();
    return {
      email: `${prefix}-email`,
      password: `${prefix}-password`,
      confirm: `${prefix}-confirm-password`,
      error: `${prefix}-error`,
      terms: `${prefix}-terms`,
      termsError: `${prefix}-terms-error`,
      google: `${prefix}-google-error`,
    };
  });

  readonly submitLabel = computed(() =>
    this.mode() === 'register' ? 'auth.register.submit' : 'auth.upgrade.submit'
  );

  /** What is drawn: this form's own miss first, else the page's answer. */
  readonly shown = computed(() => this.localError() ?? this.error());

  /** The message about the terms, drawn under the box, or null. */
  readonly termsProblem = computed(() => {
    const shown = this.shown();
    return shown?.placement === 'terms' && this.termsUrl() !== null
      ? shown
      : null;
  });

  /**
   * Whether the box was ticked since the page's last {@link error}. A tick sets it, and a
   * new answer from the page clears it.
   *
   * A refusal about the terms is the page's input, so ticking cannot take it away: the
   * sentence stays until the next press. The box itself is answered by the tick, so it
   * stops being marked invalid and described by that sentence.
   */
  private readonly _answered = linkedSignal({
    source: this.error,
    computation: () => false,
  });

  /** Whether the box is drawn invalid and described by the sentence under it. */
  readonly termsFlagged = computed(
    () => this.termsProblem() !== null && !this._answered()
  );

  /** The message about the fields, drawn in the error slot, or null. */
  readonly fieldProblem = computed(() => {
    const shown = this.shown();
    return shown === null || this.termsProblem() !== null ? null : shown;
  });

  /**
   * All three fields non empty, and nothing else. Neither the rules nor the checkbox is
   * a condition on the button: each is answered by a sentence on submit.
   */
  readonly canSubmit = computed(
    () =>
      this.email() !== '' &&
      this.password() !== '' &&
      this.confirmPassword() !== '' &&
      !this.submitting()
  );

  constructor() {
    // A refusal about the terms clears the box and puts focus on it (target 7).
    effect(() => {
      const error = this.error();
      if (error?.placement !== 'terms') {
        return;
      }
      untracked(() => {
        this.accepted.set(false);
        afterNextRender(() => this._focus(this.ids().terms), {
          injector: this._injector,
        });
      });
    });
  }

  /** `(submit)` and not `(ngSubmit)`: see `SignInPage.onSubmit`. */
  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    // Before the request, with the sentence the server's 400 would draw (velista
    // `0160`). The server still checks both, and stays the authority.
    if (!EMAIL_SHAPE.test(this.email().trim())) {
      this._refuse({ key: 'auth.error.badEmail', placement: 'email' });
      this._focus(this.ids().email);
      return;
    }

    // Code points, as the DTO counts them, so an emoji is one character here too.
    if (Array.from(this.password()).length < PASSWORD_MIN_LENGTH) {
      this._refuse({ key: 'auth.error.shortPassword', placement: 'password' });
      this._focus(this.ids().password);
      return;
    }

    // Nothing else can catch a typo in a password: the server sees one string.
    // Compared exactly, with no trimming and no case folding. Focus goes to the
    // second box, because the first holds what is being confirmed.
    if (this.password() !== this.confirmPassword()) {
      this._refuse({
        key: 'auth.error.passwordMismatch',
        placement: 'password',
      });
      this._focus(this.ids().confirm);
      return;
    }

    if (this.termsUrl() !== null && !this.accepted()) {
      this._refuse({ key: 'legal.accept.unticked', placement: 'terms' });
      this._focus(this.ids().terms);
      return;
    }

    this.localError.set(null);
    this.submitted.emit({
      email: this.email().trim(),
      password: this.password(),
    });
  }

  onTermsChange(event: Event): void {
    this.accepted.set((event.target as HTMLInputElement).checked);
    this._answered.set(this.accepted());
    // Ticking answers the sentence under the box, so it goes.
    if (this.accepted() && this.localError()?.placement === 'terms') {
      this.localError.set(null);
    }
  }

  /** Whether a field is described by the error slot, by its placement. */
  describes(field: 'email' | 'password' | 'confirm'): string | null {
    const problem = this.fieldProblem();
    if (problem === null) {
      return null;
    }
    if (field === 'email') {
      return problem.placement === 'password' ? null : this.ids().error;
    }
    return problem.placement === 'email' ? null : this.ids().error;
  }

  /** Whether a field is drawn invalid. The first password box never is on a mismatch. */
  invalid(field: 'email' | 'password' | 'confirm'): boolean {
    const problem = this.fieldProblem();
    if (problem === null) {
      return false;
    }
    if (field === 'email') {
      return problem.placement !== 'password';
    }
    if (field === 'password') {
      return (
        problem.placement !== 'email' &&
        problem.key !== 'auth.error.passwordMismatch'
      );
    }
    return problem.placement !== 'email';
  }

  /**
   * Focus the address, where a correction after a refused request begins (plan 0009,
   * section 7). The page calls it; a refusal about the terms focuses the box instead.
   */
  focusFirst(): void {
    this._focus(this.ids().email);
  }

  private _refuse(copy: AuthErrorCopy): void {
    this.localError.set(copy);
  }

  /** By id rather than by type, because the reveal toggle swaps a password's type. */
  private _focus(id: string): void {
    this._host.nativeElement.querySelector<HTMLInputElement>(`#${id}`)?.focus();
  }
}
