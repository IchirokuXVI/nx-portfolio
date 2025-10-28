import { Provider } from '@angular/core';
import { RokuTranslatorService } from '../rokutranslator-service';
import { RokuTranslatorTestingService } from './rokutranslator-testing-service';

export function provideRokuTranslatorTesting(): Provider[] {
  return [
    { provide: RokuTranslatorService, useClass: RokuTranslatorTestingService },
  ];
}
