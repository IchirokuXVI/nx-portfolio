import { FormControl, FormGroup } from "@angular/forms";
import { TeethNumbers, ToothTreatment, ToothTreatmentStatus, ToothZones, TreatmentType } from "@portfolio/odontogram/models";

export interface ToothTreatmentForm {
  odontogram: FormControl<string | null>;
  treatment: FormControl<string | null | undefined>;
  groupTeeth: FormControl<boolean | null>;
  teeth: FormControl<(typeof TeethNumbers[number])[] | null>;
  zones: FormControl<ToothZones[] | null>;
  status: FormControl<ToothTreatmentStatus | null>;
  type: FormControl<TreatmentType | null>;
  additionalInformation: FormControl<string | null>;
}

export function mapToothTreatmentToForm(toothTreatment: ToothTreatment): ToothTreatmentForm {
  return {
    odontogram: new FormControl<string | null>(toothTreatment.odontogram ?? null),
    treatment: new FormControl<string | null | undefined>(toothTreatment.treatment || null),
    groupTeeth: new FormControl<boolean>(toothTreatment.groupTeeth ?? true),
    teeth: new FormControl<(typeof TeethNumbers[number])[]>([...toothTreatment.teeth]),
    zones: new FormControl<ToothZones[]>([...toothTreatment.zones]),
    status: new FormControl<ToothTreatmentStatus | null>(toothTreatment.status ?? ToothTreatmentStatus.PENDING),
    type: new FormControl<TreatmentType | null>(toothTreatment.type ?? TreatmentType.STANDARD),
    additionalInformation: new FormControl<string | null>(toothTreatment.additionalInformation ?? null),
  };
}

export function mapFormToToothTreatment(form: FormGroup<ToothTreatmentForm>): ToothTreatment {
  const formValue = form.value;

  return {
    odontogram: formValue.odontogram ?? undefined,
    treatment: formValue.treatment ?? undefined,
    groupTeeth: formValue.groupTeeth ?? false,
    teeth: formValue.teeth ?? [],
    zones: formValue.zones ?? [],
    status: formValue.status ?? ToothTreatmentStatus.PENDING,
    type: formValue.type ?? TreatmentType.STANDARD,
    additionalInformation: formValue.additionalInformation ?? '',
  };
}
