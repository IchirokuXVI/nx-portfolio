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
  OTHER_CHAINS,
  type FranchiseButton,
} from '@portfolio/velista/models';
import { HalfCircleIcon, SlashCircleIcon } from '../icons/icons';

/** One button as this list draws it: a name in the reader's language, and a state. */
interface FranchiseRow extends FranchiseButton {
  /** The chain's name, or the localized word for the bucket. */
  readonly label: string;
  readonly other: boolean;
  readonly open: boolean;
}

/**
 * The chains with a shop in this profile's postal codes, plus OTHER
 * (plan 0059, section 3.2).
 *
 * ## Three states, and none of them is a colour
 *
 * "Chain excluded" and "some shops excluded" are different promises, so they are drawn
 * differently and both are **named in words** on the button: the first covers shops the
 * brand has not opened yet, the second covers exactly the ones somebody switched off and
 * lets a new one arrive switched on (backend plan 0064, section 2.2). A button whose only
 * difference was a shade would say neither, and would say nothing at all to a reader who
 * cannot see the shade.
 *
 * ## OTHER is a button like the others and is not a brand
 *
 * It is the chains with no brand key, which is what an independent shop becomes when it
 * is imported, and for many people it is the biggest button on the screen: plan 0038
 * measured 35 of the 75 places in one city radius as independents. Its exclude control
 * therefore reads in the plural, because it refuses several brands rather than one.
 *
 * ## Why it lives in `ui`
 *
 * It was `feature-account`'s, and velista `0078` gives the basket's shop picker the
 * same buttons over a **basket's** price scopes. `feature-shopping-lists` cannot
 * import a lazy loaded feature library, so the component moved to where two features
 * can both reach it, which is what `ui` is for. Nothing about it changed in the move:
 * it takes rows and emits a key, exactly as rule D1 asks.
 */
@Component({
  selector: 'lib-franchise-buttons',
  imports: [RokuTranslatorPipe, HalfCircleIcon, SlashCircleIcon],
  templateUrl: './franchise-buttons.html',
  styleUrl: './franchise-buttons.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FranchiseButtons {
  readonly chains = input.required<readonly FranchiseButton[]>();

  /** The franchise whose shops are open, or null when none is. */
  readonly openKey = input<string | null>(null);

  /**
   * A button was pressed: open it, or close it if it was already open.
   *
   * The only thing this list emits. Refusing a brand sits on the open franchise rather
   * than on its button (plan 0059, section 3.3), where the shops it covers are on screen
   * beside it and the word "brand" is not a claim about a row somebody cannot see.
   *
   * Named `chosen` and not `select`, which is a DOM event an input fires:
   * `@angular-eslint/no-output-native` refuses an output that shadows one, because a
   * host listener for the native event would be caught by this one instead.
   */
  readonly chosen = output<string>();

  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly other = OTHER_CHAINS;

  protected readonly rows = computed<readonly FranchiseRow[]>(() => {
    const locale = this._locale();
    const open = this.openKey();

    return this.chains().map((chain) => ({
      ...chain,
      label: chain.name === null ? '' : inLocale(chain.name, locale),
      other: chain.name === null,
      open: chain.key === open,
    }));
  });
}
