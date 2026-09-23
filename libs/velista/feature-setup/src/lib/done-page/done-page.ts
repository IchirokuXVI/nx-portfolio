import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { SessionStore } from '@portfolio/velista/data-access';
import { CheckIcon } from '@portfolio/velista/ui';
import { focusHeading } from '../focus-heading';
import { SetupFlow } from '../setup-flow';

/** One cell of the answers table, as a key and what it interpolates. */
interface Answer {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/** A value that is not a key at all, drawn as it is. */
const VERBATIM = '';

/**
 * The finish, and the tour's offer (velista `0098`, section 6).
 *
 * The three answers in a small table, read back from where they are **stored** rather
 * than from what the steps were told, because each step already wrote its own and a
 * reload between steps must not turn an answer into a blank.
 *
 * **The offer names no feature.** Stops will be added and dropped, and a list of them
 * ages into a lie on a screen nobody thinks to revisit.
 *
 * Both buttons end the setup the same way, through `SetupFlow.finish`, which marks it
 * over before it navigates.
 */
@Component({
  selector: 'lib-setup-done-page',
  imports: [RokuTranslatorPipe, CheckIcon],
  templateUrl: './done-page.html',
  styleUrl: './done-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DonePage {
  private readonly _flow = inject(SetupFlow);
  private readonly _session = inject(SessionStore);

  protected readonly verbatim = VERBATIM;

  protected readonly name = computed<Answer>(() => ({
    key: VERBATIM,
    params: { value: this._session.username() ?? '' },
  }));

  protected readonly where = computed((): Answer => {
    const codes = this._flow.shoppingProfile()?.postalCodes ?? [];
    const own = codes.find((code) => code.source !== 'NEARBY');
    if (own === undefined) {
      return { key: 'setup.done.skipped', params: {} };
    }

    return codes.some((code) => code.source === 'NEARBY')
      ? { key: 'setup.done.nearby', params: { code: own.postalCode } }
      : { key: VERBATIM, params: { value: own.postalCode } };
  });

  protected readonly shops = computed((): Answer => {
    const chains = this._flow.chains();
    return chains === null
      ? { key: 'setup.done.skipped', params: {} }
      : {
          key: 'setup.done.chainsOf',
          params: { on: chains.on, total: chains.total },
        };
  });

  /** The table, in the order the steps asked. */
  protected readonly rows = computed(() => [
    { label: 'setup.done.name', answer: this.name() },
    { label: 'setup.done.where', answer: this.where() },
    { label: 'setup.done.shops', answer: this.shops() },
  ]);

  private readonly _heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    focusHeading(this._heading);
  }

  /** Show me around. Until the tour (`0099`) is built, it ends the setup at home. */
  protected tour(): void {
    void this._flow.finish();
  }

  protected noThanks(): void {
    void this._flow.finish();
  }
}
