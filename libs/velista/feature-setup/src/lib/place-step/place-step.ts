import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  SHOP_SERVICE,
  ShoppingProfileStore,
  type ShopServiceI,
} from '@portfolio/velista/data-access';
import { PROFILE_LIMITS } from '@portfolio/velista/models';
import {
  GEOLOCATION_READER,
  PageNavigation,
  type GeolocationReaderI,
} from '@portfolio/velista/platform';
import {
  CheckFilledIcon,
  InfoIcon,
  SetupStepHeader,
  SlashCircleIcon,
  SpinnerIcon,
  WarningIcon,
} from '@portfolio/velista/ui';
import { focusHeading } from '../focus-heading';
import { SetupFlow } from '../setup-flow';

/**
 * Where the location half of the step is.
 *
 * The location sheet's states (plan 0058, section 3), because section 5 asks for the
 * same four outcomes with the same copy: resolved, refused, unplaceable, failed, plus
 * the device that could not place itself. `idle` is the offer before any press.
 */
type LocateState =
  | 'idle'
  | 'locating'
  | 'resolved'
  | 'unplaceable'
  | 'refused'
  | 'unavailable'
  | 'failed';

/** A code the device resolved, with the country the server placed it in. */
interface Resolved {
  readonly postalCode: string;
  readonly country: string;
}

/** What a code reaches, from the shop summary. */
interface Reach {
  readonly chains: number;
  readonly shops: number;
}

/**
 * Step 2 of 3, the place (velista `0098`, section 5).
 *
 * ## Two ways in, and Continue waits for either
 *
 * **Use my location** or a typed code. Continue is disabled until one of them has
 * produced a code, and it writes that code with `source` saying which: `DEVICE` for the
 * button, `TYPED` for the field.
 *
 * ## The point is not kept
 *
 * The location sheet's rule, and its reasoning. The point goes to the server once and
 * comes back as a code, and nothing here holds it. The sentence saying so is on screen
 * **before** the press, because that is when it is a promise rather than a report.
 *
 * ## The nearby box is ticked
 *
 * Ticked by default here and unticked on the account page's own add control. Somebody
 * who has just handed over their location has asked to be found.
 *
 * ## What a code reaches
 *
 * Asked of the shop summary for **that code**, before anything is written, so the
 * person sees the answer to what they are about to confirm. It counts the code alone:
 * which neighbours the tick brings in is geography only the server holds, and it adds
 * them on the write. The next screen counts the profile as written, neighbours and all.
 *
 * ## Skipping says what it costs, once
 *
 * Without a code the catalog works and shows no prices. That is the one consequence
 * worth a sentence, so Skip asks with **Skip anyway** and **Back**, and Back is the
 * primary. Skip anyway writes nothing.
 */
@Component({
  selector: 'lib-setup-place-step',
  imports: [
    RokuTranslatorPipe,
    CheckFilledIcon,
    InfoIcon,
    SetupStepHeader,
    SlashCircleIcon,
    SpinnerIcon,
    WarningIcon,
  ],
  templateUrl: './place-step.html',
  styleUrl: './place-step.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceStep {
  private readonly _flow = inject(SetupFlow);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _shops = inject<ShopServiceI>(SHOP_SERVICE);
  private readonly _reader = inject<GeolocationReaderI>(GEOLOCATION_READER);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly maxLength = PROFILE_LIMITS.postalCodeMaxLength;

  protected readonly state = signal<LocateState>('idle');
  protected readonly resolved = signal<Resolved | null>(null);
  protected readonly typed = signal('');
  protected readonly nearby = signal(true);
  protected readonly reach = signal<Reach | null>(null);
  protected readonly askingSkip = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveFailed = signal(false);

  /** Which reach request is the latest, so a slow answer for an old code is dropped. */
  private _reachAsked = 0;

  /** The code Continue would write: the resolved one, else whatever is typed. */
  protected readonly code = computed<string | null>(() => {
    const resolved = this.resolved();
    if (resolved !== null) {
      return resolved.postalCode;
    }

    const typed = this.typed().trim();
    return typed === '' ? null : typed;
  });

  protected readonly locating = computed(() => this.state() === 'locating');

  protected readonly canContinue = computed(
    () => this.code() !== null && !this.saving() && !this.locating()
  );

  /** The resolved code's country, in the reader's language. */
  protected readonly country = computed(() => {
    const resolved = this.resolved();
    return resolved === null
      ? ''
      : regionName(resolved.country, this._locale());
  });

  private readonly _heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly _field = viewChild<ElementRef<HTMLInputElement>>('field');

  constructor() {
    focusHeading(this._heading);

    // The one thing read on arrival, and it raises no prompt: a browser that has
    // already refused opens straight into the sentence that says so, rather than
    // offering a button that cannot work.
    void this._reader.permission().then((permission) => {
      if (permission === 'denied') {
        this.state.set('refused');
      }
    });
  }

  /**
   * Ask the device, then the server. The press is what raises the browser's dialog,
   * and nothing before it does.
   */
  protected async locate(): Promise<void> {
    if (this.locating()) {
      return;
    }

    this.state.set('locating');
    this.saveFailed.set(false);

    const outcome = await this._reader.read();
    if (outcome.state === 'denied') {
      this.state.set('refused');
      return;
    }
    if (outcome.state !== 'located') {
      this.state.set('unavailable');
      return;
    }

    try {
      const answer = await this._profiles.resolvePostalCode(
        outcome.point.latitude,
        outcome.point.longitude
      );

      if (answer.postalCode === null) {
        this.state.set('unplaceable');
        return;
      }

      this.resolved.set({
        postalCode: answer.postalCode,
        country: answer.country,
      });
      this.typed.set('');
      this.nearby.set(true);
      this.state.set('resolved');
      void this._askReach(answer.postalCode);
    } catch {
      this.state.set('failed');
    }
  }

  /** Typing replaces a resolved code: the field is the person's latest word. */
  protected onInput(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
    this.saveFailed.set(false);
    this.reach.set(null);
    this._reachAsked += 1;

    if (this.resolved() !== null) {
      this.resolved.set(null);
      this.state.set('idle');
    }
  }

  /** A typed code is counted once the field is left or submitted, not per key. */
  protected onChange(): void {
    const code = this.code();
    if (code !== null && this.resolved() === null) {
      void this._askReach(code);
    }
  }

  protected toggleNearby(event: Event): void {
    this.nearby.set((event.target as HTMLInputElement).checked);
  }

  /** The refused and unplaceable states hand over to typing rather than a retry. */
  protected typeInstead(): void {
    this._field()?.nativeElement.focus();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    void this.continue();
  }

  /** Write the code, then move on. A failure stays here, where it can be tried again. */
  protected async continue(): Promise<void> {
    const code = this.code();
    if (!this.canContinue() || code === null) {
      return;
    }

    const profile = this._flow.shoppingProfile();
    if (profile === null) {
      this.saveFailed.set(true);
      this._flow.loadProfiles();
      return;
    }

    this.saving.set(true);
    this.saveFailed.set(false);
    try {
      const outcome = await this._profiles.addPostalCode(profile.id, {
        postalCode: code,
        source: this.resolved() === null ? 'TYPED' : 'DEVICE',
        expandNearby: this.nearby(),
      });

      if (outcome === 'failed') {
        this.saveFailed.set(true);
        return;
      }
    } finally {
      this.saving.set(false);
    }

    await this._flow.go('shops');
  }

  protected back(): void {
    void this._pages.back(this._flow.path('name'));
  }

  protected skip(): void {
    this.askingSkip.set(true);
  }

  protected keepAnswering(): void {
    this.askingSkip.set(false);
  }

  protected skipAnyway(): void {
    void this._flow.go('shops');
  }

  private async _askReach(postalCode: string): Promise<void> {
    const profile = this._flow.shoppingProfile();
    if (profile === null) {
      return;
    }

    const asked = ++this._reachAsked;
    try {
      const chains = await this._shops.summarizeChains(profile.id, [
        postalCode,
      ]);
      if (asked !== this._reachAsked) {
        return;
      }

      this.reach.set({
        chains: chains.length,
        shops: chains.reduce((sum, chain) => sum + chain.locations, 0),
      });
    } catch {
      // The count is an explanation and not a control. Without it the step still
      // works, and the next screen lists the chains anyway.
    }
  }
}

/** A region code as a name, falling back to the code for a tag `Intl` refuses. */
function regionName(country: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: 'region' }).of(
        country.toUpperCase()
      ) ?? country.toUpperCase()
    );
  } catch {
    return country.toUpperCase();
  }
}
