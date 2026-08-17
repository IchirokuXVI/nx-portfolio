import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  InfoFactMemory,
  ProjectMemory,
} from '@portfolio/landing-v2/data-access';
import {
  TranslatedInfoFact,
  TranslatedProject,
} from '@portfolio/landing-v2/models';
import { LandingV2UiModule } from '@portfolio/landing-v2/ui';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';

/**
 * Thin routed wrapper: resolves the current locale, subscribes to the
 * projects + info-table data-access services, and hands the already-
 * translated data down to the presentational `<lib-landing-v2-ui>` (0003).
 * Mirrors `libs/landing/feature-shell/src/lib/landing-wrapper/landing-wrapper.ts`.
 */
@Component({
  selector: 'lib-landing-v2-wrapper',
  standalone: true,
  imports: [LandingV2UiModule],
  template: `<lib-landing-v2-ui [facts]="facts" [projects]="projects" />`,
  styles: [':host { width: 100%; }'],
})
export class LandingV2Wrapper implements OnInit {
  // TODO(di-wiring): the services below are injected as concrete implementations instead of via DI tokens bound to their interfaces, so the real/API impls cannot be swapped without editing here. Tracked in libs/shared/data-access/plans/0001-data-access-di-token-wiring.md
  private _projectServ = inject(ProjectMemory);
  private _factServ = inject(InfoFactMemory);
  private _i18n = inject(RokuTranslatorService);
  private _destroyRef = inject(DestroyRef);

  projects: TranslatedProject[] = [];
  facts: TranslatedInfoFact[] = [];

  ngOnInit() {
    // Re-fetch both localized lists whenever the language changes at runtime.
    this._i18n
      .withLocale((locale) => this._projectServ.getList(locale))
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((projects) => {
        this.projects = projects;
      });
    this._i18n
      .withLocale((locale) => this._factServ.getList(locale))
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((facts) => {
        this.facts = facts;
      });
  }
}
