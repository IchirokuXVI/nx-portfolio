import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { DetailPageShell } from './detail-page-shell/detail-page-shell';
import { Hero } from './hero/hero';
import { InfoTable } from './info-table/info-table';
import { Landing } from './landing/landing';
import { ProjectCard } from './project-card/project-card';
import { ProjectGrid } from './project-grid/project-grid';
import { SiteFooter } from './site-footer/site-footer';
import { SiteHeader } from './site-header/site-header';

const components = [
  Landing,
  SiteHeader,
  Hero,
  InfoTable,
  ProjectCard,
  ProjectGrid,
  SiteFooter,
  DetailPageShell,
];

@NgModule({
  imports: [
    RokuTranslatorModule.withConfig({
      locales: ['en', 'es'],
      defaultNamespace: 'landingV2',
      loader: (locale) => import(`../../assets/i18n/${locale}.json`),
    }),
    ...components,
  ],
  exports: components,
  declarations: [],
  providers: [],
})
export class LandingV2UiModule {}
