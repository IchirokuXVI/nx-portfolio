import {
  createComponent,
  EnvironmentInjector,
  inject,
  NgModule,
} from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { CallToActionButton } from './call-to-action-button/call-to-action-button';
import { DoubleBorderedTitle } from './double-bordered-title/double-bordered-title';
import { FooterLogo } from './footer-logo/footer-logo';
import { FooterMain } from './footer-main/footer-main';
import { LanguageSelector } from './language-selector/language-selector';
import { Layout } from './layout/layout';
import { LayoutContent } from './layout/layout-content';
import { LogoBrand } from './logoBrand/logoBrand';
import { MainHeader } from './main-header/main-header';
import { NewsCard } from './news-card/news-card';
import { SectionNews } from './section-news/section-news';
import { SectionOurVision } from './section-our-vision/section-our-vision';
import { SectionProjects } from './section-projects/section-projects';
import { LibFontLoaderComponent } from './services/font-loader/font-loader';
import { TrailerVideo } from './trailer-video/trailer-video';

const components = [
  Layout,
  LayoutContent,
  LanguageSelector,
  MainHeader,
  LogoBrand,
  FooterLogo,
  FooterMain,
  TrailerVideo,
  DoubleBorderedTitle,
  SectionProjects,
  CallToActionButton,
  NewsCard,
  SectionNews,
  LibFontLoaderComponent,
  SectionOurVision,
];

@NgModule({
  imports: [
    RokuTranslatorModule.withConfig({
      locales: ['en', 'es', 'fr'],
      defaultNamespace: 'damoclesSword',
      loader: (locale) => import(`../../assets/i18n/${locale}.json`),
    }),
    ...components,
  ],
  exports: components,
  declarations: [],
  providers: [],
})
export class DamoclesSwordUiModule {
  constructor() {
    const injector = inject(EnvironmentInjector);

    createComponent(LibFontLoaderComponent, {
      environmentInjector: injector,
    });
  }
}
