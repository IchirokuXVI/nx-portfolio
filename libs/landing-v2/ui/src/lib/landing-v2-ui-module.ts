import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { DamoclesContent } from './damocles-content/damocles-content';
import { DetailPageShell } from './detail-page-shell/detail-page-shell';
import { DetailSection } from './detail-section/detail-section';
import { DetailToc } from './detail-toc/detail-toc';
import { Hero } from './hero/hero';
import { InfoTable } from './info-table/info-table';
import { Landing } from './landing/landing';
import { LanguageSwitch } from './language-switch/language-switch';
import { OdontogramContent } from './odontogram-content/odontogram-content';
import { PortfolioContent } from './portfolio-content/portfolio-content';
import { ProjectCard } from './project-card/project-card';
import { ProjectGrid } from './project-grid/project-grid';
import { SiteFooter } from './site-footer/site-footer';
import { SiteHeader } from './site-header/site-header';
import { TechChipGroup } from './tech-chip-group/tech-chip-group';

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
  DetailSection,
  DetailToc,
  TechChipGroup,
  PortfolioContent,
  OdontogramContent,
  DamoclesContent,
];

/**
 * This library's components, plus plain `RokuTranslatorModule` for the `| rokuT`
 * pipe.
 *
 * It used to carry `RokuTranslatorModule.withConfig`, which made this module the
 * place landingV2's translations were configured. That moved: the descriptor to
 * `translations.ts` next to the assets it reads, and the `provideRokuTranslator`
 * call to `apps/landing-v2/src/app/translation-providers.ts` (plan 0005 D11).
 *
 * The reason is not tidiness. Providers on an NgModule imported by a component reach
 * that component's own injector, not the route injector its pages are created
 * against, and never the app injector. The locale guard has to reach this app's
 * translator to adopt a locale before anything renders, and from here it could not.
 * Several components in this library carry comments about sitting above or below
 * these providers; those reasons expired with the move.
 */
@NgModule({
  imports: [RokuTranslatorModule, ...components],
  exports: components,
  declarations: [],
  providers: [],
})
export class LandingV2UiModule {}
