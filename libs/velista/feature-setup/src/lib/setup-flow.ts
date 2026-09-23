import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import {
  ProfileStore,
  ShoppingProfileStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type ShoppingProfile } from '@portfolio/velista/models';
import { appPath, TourStore } from '@portfolio/velista/platform';

/** Where a step can send the person, relative to the setup's own path. */
export type SetupStep = '' | 'name' | 'place' | 'shops' | 'done';

/** What the last step decided, for the finish's table. */
export interface ChainsAnswer {
  readonly on: number;
  readonly total: number;
}

/**
 * The setup's one store (velista `0098`, section 1), provided by `SetupLayout`.
 *
 * **It holds no answer that is not already written.** Each step writes its own answer
 * when its button is pressed (section 7), through the store that owns the field: the
 * name through `ProfileStore`, the code and the chains through `ShoppingProfileStore`.
 * So closing the app halfway keeps what was answered, and this class is only the
 * routing between steps, the profile they write to, and the way out.
 *
 * The one thing kept here is the chain count the last step settled on, because the
 * finish draws it and the profile holds only the refusals, not how many chains there
 * were to refuse.
 */
@Injectable()
export class SetupFlow {
  private readonly _profile = inject(ProfileStore);
  private readonly _shopping = inject(ShoppingProfileStore);
  private readonly _router = inject(Router);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _tour = inject(TourStore);

  /**
   * The profile the setup writes to: the default one (section 10).
   *
   * Every account has one, because the first read creates it, so null means only
   * "not read yet" or "the read failed".
   */
  readonly shoppingProfile = computed<ShoppingProfile | null>(() => {
    const profiles = this._shopping.profiles();
    return profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;
  });

  /** How the profile read got on, for a step that cannot draw without it. */
  readonly shoppingState = this._shopping.state;

  /** The chains the last step left on, out of how many, once it has been pressed. */
  readonly chains = signal<ChainsAnswer | null>(null);

  constructor() {
    this.loadProfiles();
  }

  /**
   * Read the shopping profiles, unless they are already held.
   *
   * Public so a step's retry line can ask again after a failure.
   */
  loadProfiles(): void {
    if (this._shopping.profiles().length === 0) {
      void this._shopping.load();
    }
  }

  /** The URL of one of the setup's screens. */
  path(step: SetupStep): string {
    const segments = step === '' ? ['setup'] : ['setup', step];
    return appPath(this._locale(), this._basePath, ...segments);
  }

  /** Move to another step. */
  async go(step: SetupStep): Promise<void> {
    await this._router.navigateByUrl(this.path(step));
  }

  /**
   * Leave the setup, marked as over, for home (section 7).
   *
   * The mark is written first and not awaited: the person is finished with the flow
   * whatever the network thinks, and `ProfileStore` answers the guard from its own
   * copy on this tick. No thanks comes through here, Show me around through
   * {@link tour}, and `SetupLayout` calls the same mark on its way out for every route
   * that does neither.
   */
  async finish(): Promise<void> {
    this._profile.completeSetup();
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'home')
    );
  }

  /**
   * Leave the setup, marked as over, into the tour (velista `0099`, section 8).
   *
   * The only place the tour starts by itself, and it starts because the person asked.
   * The tour goes home on its own, replacing this screen, so back after it does not
   * land on the finish again.
   */
  async tour(): Promise<void> {
    this._profile.completeSetup();
    await this._tour.start();
  }
}
