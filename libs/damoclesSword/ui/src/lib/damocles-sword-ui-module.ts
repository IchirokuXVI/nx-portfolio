import {
  createComponent,
  EnvironmentInjector,
  inject,
  NgModule,
} from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { CallToActionButton } from './call-to-action-button/call-to-action-button';
import { ContactForm } from './contact-form/contact-form';
import { DoubleBorderedTitle } from './double-bordered-title/double-bordered-title';
import { FooterLogo } from './footer-logo/footer-logo';
import { FooterMain } from './footer-main/footer-main';
import { FormButton } from './form-button/form-button';
import { InfoCard } from './info-card/info-card';
import { LanguageSelector } from './language-selector/language-selector';
import { Layout } from './layout/layout';
import { LayoutContent } from './layout/layout-content';
import { LogoBrand } from './logo-brand/logo-brand';
import { MainHeader } from './main-header/main-header';
import { NewsCard } from './news-card/news-card';
import { SectionContactSupport } from './section-contact-support/section-contact-support';
import { SectionGeneralContact } from './section-general-contact/section-general-contact';
import { SectionHiring } from './section-hiring/section-hiring';
import { SectionLayout } from './section-layout/section-layout';
import { SectionNews } from './section-news/section-news';
import { SectionOurVision } from './section-our-vision/section-our-vision';
import { SectionProjects } from './section-projects/section-projects';
import { SectionPublishing } from './section-publishing/section-publishing';
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
  SectionContactSupport,
  SectionLayout,
  FormButton,
  ContactForm,
  InfoCard,
  SectionPublishing,
  SectionHiring,
  SectionGeneralContact,
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
