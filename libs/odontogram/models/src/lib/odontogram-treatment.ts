import { ToothTreatmentStatus } from './tooth-treatment-status';

export interface OdontogramTreatment {
  id?: string;
  odontogram?: string;
  description?: string;
  treatment?: string;
  status: ToothTreatmentStatus;
  additionalInformation?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
