import { TreatmentStatus } from "./tooth-treatment-status";

export interface OdontogramTreatment {
  id?: string;
  odontogram?: string;
  description?: string;
  treatment?: string;
  status: TreatmentStatus;
  additionalInformation?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
