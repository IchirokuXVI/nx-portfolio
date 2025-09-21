export enum ToothTreatmentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

export const ToothTreatmentStatusTranslationKey = {
  [ToothTreatmentStatus.PENDING]: 'odontogram.treatmentStatus.pending',
  [ToothTreatmentStatus.COMPLETED]: 'odontogram.treatmentStatus.completed',
};
