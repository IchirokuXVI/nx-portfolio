import { ModuleWithProviders, NgModule } from '@angular/core';
import { provideRokuTranslator } from './provide-rokutranslator';
import { RokuTranslatorPipe } from './rokutranslator-pipe';
import { LoaderFunction } from './rokutranslator-service';

@NgModule({
  imports: [RokuTranslatorPipe],
  declarations: [],
  exports: [RokuTranslatorPipe],
})
export class RokuTranslatorModule {
  static withConfig<L extends string>({
    locales = [],
    namespaces = [],
    defaultNamespace,
    loader,
  }: {
    locales?: L | L[];
    namespaces?: string | string[];
    defaultNamespace?: string;
    loader: LoaderFunction<L>;
  }): ModuleWithProviders<RokuTranslatorModule> {
    return {
      ngModule: RokuTranslatorModule,
      providers: [
        provideRokuTranslator({
          locales,
          namespaces,
          defaultNamespace,
          loader,
        }),
      ],
    };
  }
}
