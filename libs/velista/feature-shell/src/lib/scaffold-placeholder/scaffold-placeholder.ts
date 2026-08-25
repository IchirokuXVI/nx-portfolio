import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { AppUiModule } from '@portfolio/velista/ui';

/**
 * Temporary home route, so `/<locale>/velista` resolves to something real while the
 * page plans are still being built. **Plan 0003 replaces this with feature-home**;
 * nothing should be added to it in the meantime.
 *
 * It renders the translated app title and nothing else, which is enough to prove
 * the whole chain end to end: the shell's route ordering, the remote's exposed
 * `./Routes`, the locale guard, the layout's token scope, and the `velista` i18n
 * namespace resolving through the shared RokuTranslator singleton.
 *
 * `compReady` gates the pipe on the namespace having loaded, the same guard every
 * page in this workspace applies, so a pure `| rokuT` never renders frozen on a
 * raw key.
 */
@Component({
  selector: 'lib-scaffold-placeholder',
  imports: [AppUiModule],
  templateUrl: './scaffold-placeholder.html',
  styleUrl: './scaffold-placeholder.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScaffoldPlaceholder {
  readonly compReady = signal(false);

  private readonly _rokuTranslatorServ = inject(RokuTranslatorService);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }
}
