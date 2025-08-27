import { TreatmentType } from './treatment-type';
import { ToothZones } from './tooth-zones';

export interface Treatment {
  id: string;
  name: string;
  description?: string;
  treatmentType: TreatmentType;
  zones: ToothZones[];
  createdAt?: Date;
  updatedAt?: Date;
}
