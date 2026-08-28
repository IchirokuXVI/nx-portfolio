import { NgModule } from '@angular/core';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { OdontogramSectorsView } from './odontogram-sectors-view/odontogram-sectors-view';
import { SingleToothImage } from './single-tooth-image/single-tooth-image';
import { ToothTreatmentDetailedForm } from './tooth-treatment-detailed-form/tooth-treatment-detailed-form';
import { ToothTreatmentsModal } from './tooth-treatments-modal/tooth-treatments-modal';

/**
 * This library's components, plus plain `RokuTranslatorModule` for the `| rokuT`
 * pipe.
 *
 * It used to carry `RokuTranslatorModule.withConfig`, which made this module the
 * place odontogram's translations were configured *and* the place a hand written
 * namespace dispatcher lived. Both moved: the descriptors to `translations.ts` next
 * to the assets they read, and the `provideRokuTranslator` call to
 * `apps/odontogram/src/app/translation-providers.ts` (plan 0005 D11).
 *
 * The reason is not tidiness. Providers on an NgModule imported by a component reach
 * that component's own injector, not the route injector its pages are created
 * against, and never the app injector where `provideHttpClient` and the locale guard
 * live. The guard has to reach this app's translator to adopt a locale before
 * anything renders, and from here it could not.
 */
@NgModule({
  imports: [
    RokuTranslatorModule,
    OdontogramSectorsView,
    ToothTreatmentsModal,
    SingleToothImage,
    ToothTreatmentDetailedForm,
  ],
  declarations: [],
  exports: [OdontogramSectorsView],
})
export class OdontogramUiModule {}
