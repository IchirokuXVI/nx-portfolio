import { OdontogramTreatment } from "./odontogram-treatment";
import { TeethNumbers } from "./teeth-numbers";
import { ToothZones } from "./tooth-zones";
import { TreatmentType } from "./treatment-type";

export interface ToothTreatment extends OdontogramTreatment {
  teeth: (typeof TeethNumbers[number])[];
  groupTeeth: boolean;
  zones: ToothZones[];
  type: TreatmentType;
}
