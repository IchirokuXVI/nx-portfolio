import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProjectMemory } from '@portfolio/landing/data-access';
import { TranslatedProject } from '@portfolio/landing/models';
import { LandingUiModule } from '@portfolio/landing/ui';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';

@Component({
  selector: 'lib-landing-wrapper',
  imports: [CommonModule, LandingUiModule],
  templateUrl: './landing-wrapper.html',
  styleUrl: './landing-wrapper.scss',
})
export class LandingWrapper implements OnInit {
  // TODO(di-wiring): injected as a concrete implementation instead of via a DI token bound to the service interface, so the real/API impl cannot be swapped without editing here. Tracked in libs/shared/data-access/plans/0001-data-access-di-token-wiring.md
  _projectServ = inject(ProjectMemory);
  private _i18n = inject(RokuTranslatorService);
  private _destroyRef = inject(DestroyRef);
  projects: TranslatedProject[] = [];

  ngOnInit() {
    // Re-fetch the localized projects whenever the language changes at runtime.
    this._i18n
      .withLocale((locale) => this._projectServ.getList(locale))
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((projects) => {
        this.projects = projects;
      });
  }
}
