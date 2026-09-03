import { effect, inject, Injectable, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { DeploymentStore } from '@portfolio/luna-shopper-admin/data-access';
import { firstValueFrom } from 'rxjs';

/**
 * The environment name in the document title (plan 0001, section 6).
 *
 * It is in the title rather than only on the page because that is where it survives
 * being taken out of context: the browser tab, an alt-tab list, and any screenshot
 * pasted into a bug report. Somebody reporting "I did this and it broke" from a
 * screenshot of the wrong environment is the exact confusion this is here to end.
 *
 * Not a `TitleStrategy` and not a route resolver, because the title is not about the
 * route: every page of this app carries the same environment, and the fact arrives
 * asynchronously and after the first navigation has already happened. An effect on
 * the store's signal sets it whenever the answer changes, which is once.
 *
 * The title is composed from two keys rather than interpolated into one, so nothing
 * here relies on the translator's interpolation. That keeps it assertable in a spec
 * (the testing translator returns keys and does not interpolate) and it keeps the
 * environment name the single string it already is elsewhere on the page.
 */
@Injectable()
export class DocumentTitle {
  private readonly _title = inject(Title);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _deployments = inject(DeploymentStore);

  /** Whether the strings exist yet. Setting a title of raw keys would be worse than waiting. */
  private readonly _ready = signal(false);

  constructor() {
    void firstValueFrom(this._translator.loaded$).then(() =>
      this._ready.set(true)
    );

    effect(() => {
      if (!this._ready()) {
        return;
      }

      const deployment = this._deployments.deployment();
      // Still asking. The index.html title stands until there is something truer to
      // say; replacing it with "unknown" for the moment before the answer arrives
      // would make every cold load flash a warning it then withdraws.
      if (deployment === undefined) {
        return;
      }

      this._title.setTitle(
        `${this._translator.t(`environment.${deployment ?? 'unknown'}`)} · ${this._translator.t('app.name')}`
      );
    });
  }
}
