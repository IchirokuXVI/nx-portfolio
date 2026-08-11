import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { LandingV2UiModule } from '../landing-v2-ui-module';

/**
 * Page shell shared by every landingV2 route — the landing page and every
 * `projects/:slug` detail page. Owns the site header (brand link back to the
 * landing root + EN/ES language switch) and the site footer, and renders the
 * active child route into its <main> through a plain <router-outlet>.
 *
 * Deliberately NOT a copy of damoclesSword's layout: that one projects a
 * directive-marked <ng-template> in through a `contentChild` + NgTemplateOutlet
 * so it can defer the routed content. Here the router already owns that job —
 * Layout is wired as the *parent route* of the landingV2 children (see
 * landing-v2/feature-shell's routes.ts), so the outlet instantiates each page
 * itself and no content-projection machinery is needed.
 *
 * Imports LandingV2UiModule for the same reason LandingV2Wrapper and
 * ProjectPage do: its `RokuTranslatorModule.withConfig()` providers must land
 * in *this* component's injector so the header/footer `| rokuT` pipes resolve.
 * Being a parent route, those providers are also inherited by the child pages.
 *
 * Header and footer are gated on `compReady` (the i18n namespace having
 * loaded) so their pure `| rokuT` pipes never render frozen on a raw key —
 * the same guard each page already applies to its own content.
 */
@Component({
  selector: 'lib-landing-v2-layout',
  imports: [LandingV2UiModule, RouterOutlet],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Layout {
  compReady = signal(false);

  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  resumeLink = import('../../../assets/resume.pdf?asset').then((m) => {
    // Remove query parameter from the URL if present
    const url = m.default;
    return url.includes('?') ? url.split('?')[0] : url;
  });

  private _rokuTranslatorServ = inject(RokuTranslatorService);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }
}
