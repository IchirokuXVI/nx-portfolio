import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  SHOP_SERVICE,
  SHOPPING_PROFILE_SERVICE,
  ShoppingProfileStore,
  type ShoppingProfileServiceI,
  type ShopServiceI,
} from '@portfolio/velista/data-access';
import {
  inLocale,
  type LocalizedName,
  type ShoppingProfile,
} from '@portfolio/velista/models';
import { PageNavigation } from '@portfolio/velista/platform';
import {
  RowSkeleton,
  SetupChainList,
  SetupStepHeader,
  SpinnerIcon,
  WarningIcon,
  type SetupChainRow,
} from '@portfolio/velista/ui';
import { focusHeading } from '../focus-heading';
import { SetupFlow } from '../setup-flow';

/** One chain as this step holds it, before the reader's language is applied. */
interface Choice {
  readonly supermarketId: string;
  readonly name: LocalizedName;
  /** Shops near the profile's codes, or null for the unscoped listing. */
  readonly shops: number | null;
  /** Whether it was on when the screen opened, which is what a change is measured from. */
  readonly initiallyOn: boolean;
}

type Load = 'loading' | 'loaded' | 'failed';

/**
 * Step 3 of 3, the shops (velista `0098`, section 5).
 *
 * ## Two lists, one screen
 *
 * With a postal code on the profile, the chains near it, each with its shop count,
 * under "Near 14013". Without one, every chain the catalog holds, with no counts and no
 * "near" heading, because there is nothing to be near. The choice saves either way and
 * applies the moment a code arrives.
 *
 * The scoped list is read **as the profile** rather than for the one code step 2 wrote,
 * so the neighbours the nearby tick brought in are counted too.
 *
 * ## Off is a decision, not a deletion
 *
 * A chain switched off stays on the list, struck through and marked. All of them off
 * is allowed and never blocked; the screen says what it means, that nothing has a
 * price, and lets it stand.
 *
 * ## Done writes only what changed
 *
 * Measured against what the screen opened with, through `setChainsExcluded`, which is
 * the store's one rule for what an excluded chain looks like: excluding adds a row and
 * including removes one. Nothing changed, nothing is sent. Skip sends nothing either.
 */
@Component({
  selector: 'lib-setup-shops-step',
  imports: [
    RokuTranslatorPipe,
    RowSkeleton,
    SetupChainList,
    SetupStepHeader,
    SpinnerIcon,
    WarningIcon,
  ],
  templateUrl: './shops-step.html',
  styleUrl: './shops-step.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopsStep {
  private readonly _flow = inject(SetupFlow);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _shops = inject<ShopServiceI>(SHOP_SERVICE);
  private readonly _catalog = inject<ShoppingProfileServiceI>(
    SHOPPING_PROFILE_SERVICE
  );
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly load = signal<Load>('loading');
  private readonly _choices = signal<readonly Choice[]>([]);
  private readonly _on = signal<ReadonlySet<string>>(new Set());

  /** The code the heading names, or null for the unscoped list. */
  protected readonly near = signal<string | null>(null);

  protected readonly saving = signal(false);
  protected readonly saveFailed = signal(false);

  /** Whether the list has been asked for, so the effect below asks once. */
  private _started = false;

  protected readonly rows = computed<readonly SetupChainRow[]>(() => {
    const locale = this._locale();
    const on = this._on();

    return this._choices().map((choice) => ({
      supermarketId: choice.supermarketId,
      name: inLocale(choice.name, locale),
      shops: choice.shops,
      on: on.has(choice.supermarketId),
    }));
  });

  protected readonly anyOn = computed(() => this._on().size > 0);

  protected readonly noneOn = computed(
    () => this._choices().length > 0 && this._on().size === 0
  );

  private readonly _heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    focusHeading(this._heading);

    // The list needs the profile, which the flow reads on arrival and may still be
    // reading. Once it is held the list is asked for, once.
    effect(() => {
      const profile = this._flow.shoppingProfile();
      const state = this._flow.shoppingState();

      if (this._started) {
        return;
      }
      if (profile !== null) {
        this._started = true;
        untracked(() => void this._read(profile));
      } else if (state === 'failed') {
        this.load.set('failed');
      }
    });
  }

  protected toggle(supermarketId: string): void {
    this.saveFailed.set(false);
    this._on.update((on) => {
      const next = new Set(on);
      if (next.has(supermarketId)) {
        next.delete(supermarketId);
      } else {
        next.add(supermarketId);
      }
      return next;
    });
  }

  protected turnAllOff(): void {
    this.saveFailed.set(false);
    this._on.set(new Set());
  }

  protected retry(): void {
    const profile = this._flow.shoppingProfile();
    if (profile === null) {
      this.load.set('loading');
      this._flow.loadProfiles();
      return;
    }

    this._started = true;
    void this._read(profile);
  }

  /** Write the chains that changed, then the finish. */
  protected async done(): Promise<void> {
    const profile = this._flow.shoppingProfile();
    if (this.saving() || profile === null || this.load() !== 'loaded') {
      return;
    }

    const on = this._on();
    const choices = this._choices();
    const turnedOff = choices
      .filter((choice) => choice.initiallyOn && !on.has(choice.supermarketId))
      .map((choice) => choice.supermarketId);
    const turnedOn = choices
      .filter((choice) => !choice.initiallyOn && on.has(choice.supermarketId))
      .map((choice) => choice.supermarketId);

    this.saving.set(true);
    this.saveFailed.set(false);
    try {
      if (
        (turnedOff.length > 0 &&
          (await this._profiles.setChainsExcluded(
            profile.id,
            turnedOff,
            true
          )) === 'failed') ||
        (turnedOn.length > 0 &&
          (await this._profiles.setChainsExcluded(
            profile.id,
            turnedOn,
            false
          )) === 'failed')
      ) {
        this.saveFailed.set(true);
        return;
      }
    } finally {
      this.saving.set(false);
    }

    this._flow.chains.set({ on: on.size, total: choices.length });
    await this._flow.go('done');
  }

  protected back(): void {
    void this._pages.back(this._flow.path('place'));
  }

  /** Nothing written; the chains stay as the screen found them. */
  protected skip(): void {
    const choices = this._choices();
    if (this.load() === 'loaded') {
      this._flow.chains.set({
        on: choices.filter((choice) => choice.initiallyOn).length,
        total: choices.length,
      });
    }
    void this._flow.go('done');
  }

  private async _read(profile: ShoppingProfile): Promise<void> {
    this.load.set('loading');

    const codes = profile.postalCodes;
    const own = codes.find((code) => code.source !== 'NEARBY') ?? codes[0];

    try {
      const choices =
        own === undefined
          ? await this._unscoped(profile)
          : await this._scoped(profile);

      this.near.set(own?.postalCode ?? null);
      this._choices.set(choices);
      this._on.set(
        new Set(
          choices
            .filter((choice) => choice.initiallyOn)
            .map((choice) => choice.supermarketId)
        )
      );
      this.load.set('loaded');
    } catch {
      this.load.set('failed');
    }
  }

  /** The chains in the profile's codes, as the profile, neighbours included. */
  private async _scoped(profile: ShoppingProfile): Promise<Choice[]> {
    const summary = await this._shops.summarizeChains(profile.id);

    return summary.map((chain) => ({
      supermarketId: chain.supermarketId,
      name: chain.name,
      shops: chain.locations,
      initiallyOn: !chain.excludedChain,
    }));
  }

  /** Every chain the catalog holds, with the profile's refusals applied. */
  private async _unscoped(profile: ShoppingProfile): Promise<Choice[]> {
    const chains = await this._catalog.listSupermarkets();
    const refused = new Set(
      profile.chains
        .filter((chain) => chain.excluded)
        .map((chain) => chain.supermarketId)
    );

    return chains.map((chain) => ({
      supermarketId: chain.id,
      name: chain.name,
      shops: null,
      initiallyOn: !refused.has(chain.id),
    }));
  }
}
