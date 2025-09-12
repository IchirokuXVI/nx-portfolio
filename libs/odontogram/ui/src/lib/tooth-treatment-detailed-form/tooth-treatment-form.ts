import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  effect,
  input,
  output,
  Signal,
} from '@angular/core';
import { FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  ToothTreatment,
  ToothTreatmentStatus,
  ToothZones,
  Treatment,
  TreatmentType,
} from '@portfolio/odontogram/models';
import {
  mapToothTreatmentToForm,
  ToothTreatmentFormModel,
} from './tooth-treatment-form-model';

@Component({
  selector: 'lib-tooth-treatment-form',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatIconModule,
    MatAutocompleteModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatInputModule,
  ],
  templateUrl: './tooth-treatment-form.html',
  styleUrls: ['./tooth-treatment-form.scss'],
  providers: [],
})
export class ToothTreatmentForm {
  toothZones = ToothZones;
  toothTreatmentStatus = ToothTreatmentStatus;
  toothTreatmentStatusArr = Object.values(ToothTreatmentStatus);

  toothTreatmentStatusToCssClass: { [key in ToothTreatmentStatus]: string } = {
    [ToothTreatmentStatus.PENDING]: 'pending',
    [ToothTreatmentStatus.COMPLETED]: 'finished',
  };

  disabled = input(false);

  toothTreatment = input.required<ToothTreatment>();

  toothTreatmentForm: Signal<FormGroup<ToothTreatmentFormModel>>;

  treatmentSuggestions = input(<Treatment[]>[]);

  deleteTreatment = output<void>();

  constructor() {
    this.toothTreatmentForm = computed(() =>
      mapToothTreatmentToForm(this.toothTreatment())
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

  displayTreatmentOption(treatment: Treatment) {
    return treatment?.name || '';
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

  setStatus(treatment: FormGroup, status: ToothTreatmentStatus) {
    treatment.get('status')?.setValue(status);
  }
}
