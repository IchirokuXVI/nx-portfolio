import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { DamoclesContent } from './damocles-content/damocles-content';
import { DetailPageShell } from './detail-page-shell/detail-page-shell';
import { Hero } from './hero/hero';
import { InfoTable } from './info-table/info-table';
import { LANDING_V2_AVAILABLE_LOCALES } from './landing-v2-locales';
import { LanguageSwitch } from './language-switch/language-switch';
import { Landing } from './landing/landing';
import { OdontogramContent } from './odontogram-content/odontogram-content';
import { PortfolioContent } from './portfolio-content/portfolio-content';
import { ProjectCard } from './project-card/project-card';
import { ProjectGrid } from './project-grid/project-grid';
import { SiteFooter } from './site-footer/site-footer';
import { SiteHeader } from './site-header/site-header';

const components = [
  Landing,
  SiteHeader,
  Hero,
  InfoTable,
  LanguageSwitch,
  ProjectCard,
  ProjectGrid,
  SiteFooter,
  DetailPageShell,
  PortfolioContent,
  OdontogramContent,
  DamoclesContent,
];

@NgModule({
  imports: [
    RokuTranslatorModule.withConfig({
      locales: LANDING_V2_AVAILABLE_LOCALES,
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
