import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  ToothTreatment,
  ToothTreatmentStatus,
  ToothZones,
  TreatmentType,
} from '@portfolio/odontogram/models';
import { Optional } from '@portfolio/shared/util';
import { Observable } from 'rxjs';
import { ToothTreatmentServiceI } from './tooth-treatment-service';

export function runSharedTreatmentServiceTests(
  serviceFactory: () => ToothTreatmentServiceI
) {
  describe('Shared ToothTreatmentServiceI behavior', () => {
    let service: ToothTreatmentServiceI;

    const mockToothTreatment: Optional<ToothTreatment, 'id'> = {
      teeth: ['11'],
      groupTeeth: false,
      status: ToothTreatmentStatus.COMPLETED,
      type: TreatmentType.STANDARD,
      zones: [ToothZones.BOTTOM],
      additionalInformation: 'Test treatment',
    };

    beforeEach(() => {
      service = serviceFactory();
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('getList should return an observable', () => {
      expect(service.getList() instanceof Observable).toBe(true);
    });

    it('getById should return an observable', () => {
      expect(service.getById('1') instanceof Observable).toBe(true);
    });

    it('create should return an observable', () => {
      expect(service.create(mockToothTreatment) instanceof Observable).toBe(
        true
      );
    });

    it('update should return an observable', () => {
      expect(
        service.update({
          id: '1',
          additionalInformation: 'Updated treatment',
        }) instanceof Observable
      ).toBe(true);
    });
  });
}
