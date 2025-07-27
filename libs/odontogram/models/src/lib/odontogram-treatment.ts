import { TreatmentStatus } from "./treatment-status";

export interface OdontogramTreatment {
  odontogram?: string;
  status: TreatmentStatus;
  additionalInformation?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
