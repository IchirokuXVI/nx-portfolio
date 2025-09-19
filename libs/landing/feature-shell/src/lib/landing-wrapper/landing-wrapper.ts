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
