import { TreatmentStatus } from "./treatment-status";

export interface OdontogramTreatment {
  id: string;
  odontogram?: string;
  status: TreatmentStatus;
  additionalInformation?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
