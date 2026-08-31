import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  inLocale,
  type ChainPreference,
  type Supermarket,
} from '@portfolio/velista/models';

/** One chain as this list draws it: its name, and whether it is in or out. */
interface ChainRow {
  readonly supermarketId: string;
  readonly name: string;
  readonly excluded: boolean;
}

/**
 * Every chain in the catalog, in or out (plan 0046, section 4).
 *
 * ## Every chain, and an excluded one stays visible
 *
 * The rows come from the **unscoped** supermarket listing rather than from the profile's
 * own preferences, and that is the whole design: a chain with no preference row is
 * included, so a chain added to the catalog next month is included by default rather
 * than missing from a handwritten allowlist. An excluded chain is drawn struck through
 * and dimmed **and labelled with the word**, never hidden, because "everything except
 * DIA" has to leave DIA on screen to be un-excluded, and never by colour alone (section
 * 7).
 *
 * ## The row is the target
 *
 * A `<label>` wrapping a real checkbox, so the whole 44px row toggles and the widget
 * every assistive technology already understands is the one doing the announcing. The
 * checkbox is checked when the chain is **included**, which is the question the row asks
 * out loud: the name is the label, not "exclude this".
 *
 * There is no per location choice here and there is not going to be one: the preference
 * names the franchise, and which shops it reaches is the resolver's business.
 *
 * Rule D1 holds. The locale store is read for one thing, which is which half of a
 * catalog name to draw, and that is a rendering decision rather than a data one.
 */
@Component({
  selector: 'lib-chain-preference-list',
  imports: [RokuTranslatorPipe],
  templateUrl: './chain-preference-list.html',
  styleUrl: './chain-preference-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainPreferenceList {
  readonly chains = input.required<readonly Supermarket[]>();
  readonly preferences = input.required<readonly ChainPreference[]>();

  /** Whether the last write to this control failed, for the failed treatment. */
  readonly failed = input(false);

  /** The chain whose row was pressed. What it means is the page's business. */
  readonly toggleChain = output<string>();

  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly rows = computed<readonly ChainRow[]>(() => {
    const excluded = new Set(
      this.preferences()
        .filter((preference) => preference.excluded)
        .map((preference) => preference.supermarketId)
    );
    const locale = this._locale();

    return this.chains().map((chain) => ({
      supermarketId: chain.id,
      name: inLocale(chain.name, locale),
      excluded: excluded.has(chain.id),
    }));
  });
}
