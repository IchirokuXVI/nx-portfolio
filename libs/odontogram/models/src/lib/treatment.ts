import { ToothZones } from './tooth-zones';
import { TreatmentType } from './treatment-type';

export interface Treatment {
  id: string;
  name: string;
  description?: string;
  treatmentType: TreatmentType;
  zones: ToothZones[];
  createdAt?: Date;
  updatedAt?: Date;
}
