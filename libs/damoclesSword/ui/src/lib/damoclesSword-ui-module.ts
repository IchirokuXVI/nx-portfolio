import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { FooterLogo } from './footer-logo/footer-logo';
import { FooterMain } from './footer-main/footer-main';
import { LanguageSelector } from './language-selector/language-selector';
import { LogoBrand } from './logoBrand/logoBrand';
import { MainHeader } from './main-header/main-header';

const components = [
  LanguageSelector,
  MainHeader,
  LogoBrand,
  FooterLogo,
  FooterMain,
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
export class DamoclesSwordUiModule {}
