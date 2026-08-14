import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { ProjectMemory } from '@portfolio/landing/data-access';
import { TranslatedProject } from '@portfolio/landing/models';
import { LandingUiModule } from '@portfolio/landing/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';

@Component({
  selector: 'lib-landing-wrapper',
  imports: [CommonModule, LandingUiModule],
  templateUrl: './landing-wrapper.html',
  styleUrl: './landing-wrapper.scss',
})
export class LandingWrapper implements OnInit {
  // TODO(di-wiring): injected as a concrete implementation instead of via a DI token bound to the service interface, so the real/API impl cannot be swapped without editing here. Tracked in libs/shared/data-access/plans/0001-data-access-di-token-wiring.md
  _projectServ = inject(ProjectMemory);
  projects: TranslatedProject[] = [];

  ngOnInit() {
    this._projectServ
      .getList(RokuTranslator.getLocale())
      .subscribe((projects) => {
        this.projects = projects;
      });
  }
}
