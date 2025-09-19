import { NgModule } from '@angular/core';
import { provideTranslationsLoader } from '@portfolio/localization/rokutranslator-angular';
import { Landing } from './landing/landing';

const components = [Landing];

@NgModule({
  imports: components,
  exports: components,
  declarations: [],
  providers: [
    provideTranslationsLoader({
      locales: 'test',
      namespaces: 'prueba',
      loader: async () => ({}),
    }),
  ],
})
export class LandingUiModule {
  // constructor() {
  //   inject(TranslationsLoader);
  // }
}
