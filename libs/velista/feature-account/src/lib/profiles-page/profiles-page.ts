import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  REALTIME_CLIENT,
  ShoppingProfileStore,
  type ProfileField,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  PROFILE_LIMITS,
  type ShoppingProfile,
} from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { AppBar, ChevronLeftIcon } from '@portfolio/velista/ui';
import { ChainPreferenceList } from '../chain-preference-list/chain-preference-list';
import {
  PostalCodeList,
  type NewPostalCode,
} from '../postal-code-list/postal-code-list';
import { ProfileSelector } from '../profile-selector/profile-selector';

/**
 * The query parameter the catalog sends somebody here with.
 *
 * A parameter rather than router state, because the trip is often a redirect after a
 * failed read and state does not survive one; and because it is the honest shape of
 * "you are here for a reason", which a person can see in the address bar and a deep
 * link can reproduce.
 */
export const SCOPE_REQUIRED_PARAM = 'scope';
export const SCOPE_REQUIRED_VALUE = 'required';

/**
 * Where you shop, per profile (plan 0046).
 *
 * One page for all of them. A selector at the top says which profile is being edited, a
 * plus mints one, a trash deletes the one on screen, and everything below the selector
 * belongs to the selected profile.
 *
 * ## Nothing here is submitted
 *
 * Every control saves itself, optimistically, through `ShoppingProfileStore.save`
 * (section 3.1, and plan 0004 section 7.2 for the overlay). There is no Save button and
 * there is not going to be one: a settings page with a submit is a settings page people
 * leave half changed, and the failure path a submit would buy is the same failure path
 * each control already draws for itself.
 *
 * The text fields save on **blur**, not on every keystroke. A request per character
 * would be a request per character on a phone on supermarket signal, and the last one
 * to answer would win rather than the last one sent.
 *
 * ## Plus mints a profile rather than asking for a name
 *
 * No modal first (section 3.2). The profile is created, selected, and the name field is
 * focused, so the name is a field like any other and somebody who does not want to name
 * it has already got what they came for. Until it is named it renders as the localized
 * default, because the server stores null and does not know the caller's language.
 *
 * ## The banner
 *
 * `CATALOG_SCOPE_REQUIRED` is the catalog refusing to answer because the profile says
 * nothing about where the caller is. Arriving with `?scope=required` draws the banner,
 * and it clears the moment either field is filled in, which is `scopeSaid` and is the
 * same rule the server applies: a profile holding only *exclusions* has still said
 * nothing, because "not DIA" is not a place.
 */
@Component({
  selector: 'lib-profiles-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AppBar,
    ChainPreferenceList,
    ChevronLeftIcon,
    PostalCodeList,
    ProfileSelector,
  ],
  templateUrl: './profiles-page.html',
  styleUrl: './profiles-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilesPage {
  private readonly _store = inject(ShoppingProfileStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _injector = inject(Injector);

  /** For the app bar's offline mark and nothing else. This page subscribes to no room. */
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  private readonly _nameField =
    viewChild<ElementRef<HTMLInputElement>>('nameField');

  protected readonly nameMaxLength = PROFILE_LIMITS.nameMaxLength;
  protected readonly addressMaxLength = PROFILE_LIMITS.addressMaxLength;

  protected readonly state = this._store.state;
  protected readonly profiles = this._store.profiles;
  protected readonly chains = this._store.chains;
  protected readonly selected = this._store.selected;
  protected readonly connected = this._realtime.connected;

  /**
   * Whether the catalog sent them here.
   *
   * From the snapshot rather than from the parameter map's stream: arriving at this page
   * creates this component, so there is no later value to miss, and a subscription here
   * would be a subscription that only ever fires once.
   */
  private readonly _sentByCatalog =
    this._route.snapshot.queryParamMap.get(SCOPE_REQUIRED_PARAM) ===
    SCOPE_REQUIRED_VALUE;

  /**
   * Whether the banner is drawn.
   *
   * Both halves are required: they were sent here for it, **and** the profile still says
   * nothing. Filling in either field clears it on the same frame, which is the path back
   * section 8 asks for.
   */
  protected readonly showBanner = computed(
    () => this._sentByCatalog && !this._store.scopeSaid()
  );

  /** What an unnamed profile is called, in whichever language is being read. */
  protected readonly defaultName = computed(() => {
    // Read so the name follows a language change, which is the whole reason a stored
    // English word would have been wrong.
    const locale = this._locale();
    return this._translator.t('profiles.defaultName', undefined, locale);
  });

  /** The name as it is rendered: the profile's own, or the localized default. */
  protected readonly displayName = computed(() =>
    nameOf(this.selected(), this.defaultName())
  );

  /** The codes the catalog says nobody we know serves, for the flag under each chip. */
  protected readonly uncovered = computed(() =>
    (this.selected()?.postalCodes ?? [])
      .map((code) => code.postalCode)
      .filter((code) => this._store.isUnserved(code))
  );

  /**
   * The threshold in whole currency units, as the field shows it.
   *
   * The wire is cents and the person types euros, and the conversion lives here rather
   * than in the store so that nothing below this page ever holds a number in the unit
   * the API does not use.
   */
  protected readonly thresholdValue = computed(() => {
    const cents = this.selected()?.minSavingCents ?? 0;
    return cents === 0 ? '' : String(cents / 100);
  });

  constructor() {
    // The screen's one read, and the chains and coverage that follow it. Not an
    // `effect`: this page is created when it is navigated to, and a signed out user
    // leaves the route rather than watching it re-fetch.
    void this._store.load();
  }

  /** How the last write to one control of the selected profile went. */
  protected saveState(field: ProfileField): 'idle' | 'saving' | 'failed' {
    const profile = this.selected();
    return profile === null ? 'idle' : this._store.saveState(profile.id, field);
  }

  protected failed(field: ProfileField): boolean {
    return this.saveState(field) === 'failed';
  }

  protected saving(field: ProfileField): boolean {
    return this.saveState(field) === 'saving';
  }

  /** Back to the account screen, which is the only place this page is reached from. */
  async back(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'account')
    );
  }

  /** The assistant, which is the one app bar button that goes anywhere from here. */
  async openAssistant(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'assistant')
    );
  }

  /** The retry on a failed read. */
  retry(): void {
    void this._store.load();
  }

  select(profileId: string): void {
    this._store.select(profileId);
  }

  /**
   * Mint a profile, and put the cursor in its name.
   *
   * `afterNextRender` rather than a timeout: the field being focused does not exist
   * until the new profile has been rendered, and a timeout would be a guess about when
   * that happened.
   */
  async add(): Promise<void> {
    const created = await this._store.create();
    if (created === null) {
      return;
    }

    afterNextRender(
      () => {
        this._nameField()?.nativeElement.focus();
      },
      { injector: this._injector }
    );
  }

  /** The confirm sheet, as a child of this route (rule E1). */
  openDelete(): void {
    void this._router.navigate(['confirm', 'delete'], {
      relativeTo: this._route,
    });
  }

  /**
   * The name, on blur.
   *
   * An empty field is **no name** rather than a name that is empty, which the server
   * agrees with: it trims and stores null, and the page puts the localized default back.
   * That is why the field is compared against the profile's stored name and not against
   * what is drawn.
   */
  async saveName(event: Event): Promise<void> {
    const profile = this.selected();
    if (profile === null) {
      return;
    }

    const typed = (event.target as HTMLInputElement).value.trim();
    const next = typed === '' ? null : typed;
    if (next === profile.name) {
      return;
    }

    await this._store.save(profile.id, 'name', { name: next }, (current) => ({
      ...current,
      name: next,
    }));
  }

  /** The address, on blur. Optional, display only, and nothing is geocoded from it. */
  async saveAddress(event: Event): Promise<void> {
    const profile = this.selected();
    if (profile === null) {
      return;
    }

    const typed = (event.target as HTMLInputElement).value.trim();
    const next = typed === '' ? null : typed;
    if (next === profile.addressText) {
      return;
    }

    await this._store.save(
      profile.id,
      'addressText',
      { addressText: next },
      (current) => ({ ...current, addressText: next })
    );
  }

  /**
   * The threshold, on blur, in cents.
   *
   * Anything unreadable is left alone rather than sent as zero: a field somebody has
   * half typed into is not a decision that a second stop must save nothing.
   */
  async saveThreshold(event: Event): Promise<void> {
    const profile = this.selected();
    if (profile === null) {
      return;
    }

    const typed = (event.target as HTMLInputElement).value.trim();
    const units = typed === '' ? 0 : Number(typed);
    if (!Number.isFinite(units) || units < 0) {
      return;
    }

    const cents = Math.round(units * 100);
    if (cents === profile.minSavingCents) {
      return;
    }

    await this._store.save(
      profile.id,
      'minSavingCents',
      { minSavingCents: cents },
      (current) => ({ ...current, minSavingCents: cents })
    );
  }

  /**
   * Add a postal code.
   *
   * The whole list is sent, because the wire replaces collections rather than patching
   * them, and the optimistic row carries a temporary id: the server mints the real one
   * and the answer replaces this the moment it lands.
   */
  async addPostalCode(entry: NewPostalCode): Promise<void> {
    const profile = this.selected();
    if (profile === null) {
      return;
    }

    const next = [
      ...profile.postalCodes,
      {
        id: `pending-${entry.postalCode}`,
        postalCode: entry.postalCode,
        label: entry.label,
        position: profile.postalCodes.length,
      },
    ];

    await this._savePostalCodes(profile, next);
  }

  async removePostalCode(codeId: string): Promise<void> {
    const profile = this.selected();
    if (profile === null) {
      return;
    }

    await this._savePostalCodes(
      profile,
      profile.postalCodes.filter((code) => code.id !== codeId)
    );
  }

  /**
   * Include or exclude a chain.
   *
   * A chain with no preference row is included, so the first press on an untouched chain
   * adds an excluded row and the next one removes it. Removing rather than flipping
   * `excluded` back to false is deliberate: an included chain and a chain nobody has an
   * opinion about are the same thing to the resolver, and keeping the row would leave
   * the profile carrying a decision that was undone.
   */
  async toggleChain(supermarketId: string): Promise<void> {
    const profile = this.selected();
    if (profile === null) {
      return;
    }

    const excluded = profile.chains.some(
      (chain) => chain.supermarketId === supermarketId && chain.excluded
    );

    const next = excluded
      ? profile.chains.filter((chain) => chain.supermarketId !== supermarketId)
      : [
          ...profile.chains.filter(
            (chain) => chain.supermarketId !== supermarketId
          ),
          {
            id: `pending-${supermarketId}`,
            supermarketId,
            excluded: true,
          },
        ];

    await this._store.save(
      profile.id,
      'chains',
      {
        supermarkets: next.map((chain) => ({
          supermarketId: chain.supermarketId,
          excluded: chain.excluded,
        })),
      },
      (current) => ({ ...current, chains: next })
    );
  }

  private async _savePostalCodes(
    profile: ShoppingProfile,
    next: readonly {
      readonly id: string;
      readonly postalCode: string;
      readonly label: string | null;
      readonly position: number;
    }[]
  ): Promise<void> {
    await this._store.save(
      profile.id,
      'postalCodes',
      {
        postalCodes: next.map((code) => ({
          postalCode: code.postalCode,
          label: code.label,
        })),
      },
      (current) => ({ ...current, postalCodes: next })
    );
  }
}

/** A profile's name, or the localized default when it has never been named. */
function nameOf(profile: ShoppingProfile | null, fallback: string): string {
  const name = profile?.name ?? null;
  return name === null || name.trim() === '' ? fallback : name;
}
