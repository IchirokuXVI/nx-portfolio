import { NgModule } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorModule } from '@portfolio/localization/rokutranslator-angular';
import { ODONTOGRAM_LOCALES } from './odontogram-locales';
import { OdontogramSectorsView } from './odontogram-sectors-view/odontogram-sectors-view';
import { SingleToothImage } from './single-tooth-image/single-tooth-image';
import { ToothTreatmentDetailedForm } from './tooth-treatment-detailed-form/tooth-treatment-detailed-form';
import { ToothTreatmentsModal } from './tooth-treatments-modal/tooth-treatments-modal';

@NgModule({
  imports: [
    RokuTranslatorModule.withConfig({
      locales: ODONTOGRAM_LOCALES,
      defaultNamespace: 'odontogram/ui',
      namespaces: ['odontogram/models'],
      loader: (locale, namespace: string | undefined) => {
        if (namespace === 'odontogram/models') {
          return import('@portfolio/odontogram/models-localization').then(
            (m) => (m as Record<string, Record<string, string>>)[locale]
          );
        }

        return import(`../../assets/i18n/${locale}.json`);
      },
    }),
    OdontogramSectorsView,
    ToothTreatmentsModal,
    SingleToothImage,
    ToothTreatmentDetailedForm,
  ],
  declarations: [],
  exports: [OdontogramSectorsView],
})
export class OdontogramUiModule {
  constructor() {
    RokuTranslator.addNamespace('odontogram/models');
  }
}
