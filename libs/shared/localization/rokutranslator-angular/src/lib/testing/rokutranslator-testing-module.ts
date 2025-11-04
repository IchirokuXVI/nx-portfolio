import { ModuleWithProviders, NgModule } from '@angular/core';
import { RokuTranslatorPipe } from '../rokutranslator-pipe';
import { provideRokuTranslatorTesting } from './provide-rokutranslator-testing';

@NgModule({
  imports: [RokuTranslatorPipe],
  declarations: [],
  exports: [RokuTranslatorPipe],
})
export class RokuTranslatorTestingModule {
  static forTesting(): ModuleWithProviders<RokuTranslatorTestingModule> {
    return {
      ngModule: RokuTranslatorTestingModule,
      providers: [provideRokuTranslatorTesting()],
    };
  }
}
