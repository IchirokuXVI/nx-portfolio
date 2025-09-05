export enum ToothTreatmentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

export const ToothTreatmentStatusTranslationKey = {
  [ToothTreatmentStatus.PENDING]: 'odontogram.treatment.status.pending',
  [ToothTreatmentStatus.COMPLETED]: 'odontogram.treatment.status.completed',
};
