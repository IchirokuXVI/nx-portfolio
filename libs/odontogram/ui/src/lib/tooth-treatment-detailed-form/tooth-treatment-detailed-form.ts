import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  Signal,
} from '@angular/core';
import { FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  TeethNumbers,
  ToothTreatment,
  ToothTreatmentStatus,
  ToothTreatmentStatusTranslationKey,
  ToothZones,
  Treatment,
  TreatmentType,
} from '@portfolio/odontogram/models';
import { BasicOptionToggle, TrashIcon } from '@portfolio/shared/ui';
import {
  mapFormToToothTreatment,
  mapToothTreatmentToForm,
  ToothTreatmentFormModel,
} from './tooth-treatment-detailed-form-model';

@Component({
  selector: 'lib-tooth-treatment-form',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    BasicOptionToggle,
    MatFormFieldModule,
    MatIconModule,
    MatButtonModule,
    MatAutocompleteModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatInputModule,
    RokuTranslatorPipe,
    TrashIcon,
  ],
  templateUrl: './tooth-treatment-detailed-form.html',
  styleUrls: ['./tooth-treatment-detailed-form.scss'],
})
export class ToothTreatmentDetailedForm {
  private _translateServ = inject(RokuTranslatorService);

  toothZones = ToothZones;
  toothTreatmentStatus = ToothTreatmentStatus;
  toothTreatmentStatusArr = Object.values(ToothTreatmentStatus).map(
    (status) => ({
      value: status,
      label: this._translateServ.t(ToothTreatmentStatusTranslationKey[status]),
    })
  );

  toothTreatmentStatusToCssClass: { [key in ToothTreatmentStatus]: string } = {
    [ToothTreatmentStatus.PENDING]: 'pending',
    [ToothTreatmentStatus.COMPLETED]: 'finished',
  };

  disabled = input(false);

  toothTreatment = input.required<ToothTreatment>();
  toothTreatmentChange = output<ToothTreatment>();

  toothTreatmentForm: Signal<FormGroup<ToothTreatmentFormModel>>;

  treatmentSuggestions = input(<Treatment[]>[]);

  deleteTreatment = output<void>();

  teeth: Signal<{ number: (typeof TeethNumbers)[number]; disabled: boolean }[]>;
  disabledTeeth = input<(typeof TeethNumbers)[number][]>([]);

  constructor() {
    this.toothTreatmentForm = computed(() =>
      mapToothTreatmentToForm(this.toothTreatment())
    );

    effect(() => {
      const form = this.toothTreatmentForm();

      form.valueChanges.subscribe(() => {
        this.toothTreatmentChange.emit(mapFormToToothTreatment(form));
      });
    });

    this.teeth = computed(() =>
      TeethNumbers.map((toothNumber) => ({
        number: toothNumber,
        disabled: this.disabledTeeth().includes(toothNumber),
      }))
    );

    // Automatically toggle the ROOT zone when the treatment type is EXTRACTION or IMPLANT
    // This is done every time a new form is created in case the tooth treatment has changed
    effect(() => {
      const form = this.toothTreatmentForm();

      if (
        form.get('type')?.value === TreatmentType.EXTRACTION ||
        form.get('type')?.value === TreatmentType.IMPLANT
      ) {
        this.toggleZone(ToothZones.ROOT);
      }
    });

    // When disabled changes, set the form to disabled or enabled
    // also executes when the form changes
    effect(() => {
      const form = this.toothTreatmentForm();

      if (this.disabled()) {
        form.disable();
      } else {
        form.enable();
      }
    });
  }

  displayTreatmentOption(treatment: Treatment | string) {
    return typeof treatment === 'string' ? treatment : treatment?.name || '';
  }

  toggleZone(zone: ToothZones) {
    const form = this.toothTreatmentForm();

    if (!form) throw new Error('Treatment form is not defined');

    const zones = form.get('zones')?.value;

    if (!zones) throw new Error('Zones form control is not defined');

    const index = zones.findIndex((currZone) => currZone === zone);

    if (index === -1) {
      zones.push(zone);
    } else {
      zones.splice(index, 1);
    }
  }

  setStatus(status: ToothTreatmentStatus) {
    this.toothTreatmentForm().get('status')?.setValue(status);
  }

  t(s: string) {
    return RokuTranslator.t(s);
  }
}
