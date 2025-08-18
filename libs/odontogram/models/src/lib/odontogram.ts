export interface Odontogram {
  id: string;
  name?: string;
  client?: string;
  additionalInformation?: string;
  generalTreatments?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
