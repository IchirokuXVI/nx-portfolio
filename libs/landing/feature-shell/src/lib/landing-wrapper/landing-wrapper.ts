import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  PROJECT_SERVICE,
  ProjectServiceI,
} from '@portfolio/landing/data-access';
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
  _projectServ: ProjectServiceI = inject(PROJECT_SERVICE);
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
