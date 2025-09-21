export interface Odontogram {
  id: string;
  name?: string;
  client?: string;
  additionalInformation?: string;
  generalTreatments?: string[];
  effectiveDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}
