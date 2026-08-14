import { Component, inject, OnInit } from '@angular/core';
import {
  InfoFactMemory,
  ProjectMemory,
} from '@portfolio/landing-v2/data-access';
import {
  TranslatedInfoFact,
  TranslatedProject,
} from '@portfolio/landing-v2/models';
import { LandingV2UiModule } from '@portfolio/landing-v2/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

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

  projects: TranslatedProject[] = [];
  facts: TranslatedInfoFact[] = [];

  ngOnInit() {
    const locale = RokuTranslator.getLocale();

    this._projectServ.getList(locale).subscribe((projects) => {
      this.projects = projects;
    });
    this._factServ.getList(locale).subscribe((facts) => {
      this.facts = facts;
    });
  }
}
