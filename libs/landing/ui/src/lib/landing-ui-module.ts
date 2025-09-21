import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { Landing } from './landing/landing';

const components = [Landing];

@NgModule({
  imports: [
    RokuTranslatorModule.withConfig({
      locales: ['en', 'es'],
      defaultNamespace: 'landing',
      loader: (locale) => import(`../../assets/i18n/${locale}.json`),
    }),
    ...components,
  ],
  exports: components,
  declarations: [],
  providers: [],
})
export class LandingUiModule {}
