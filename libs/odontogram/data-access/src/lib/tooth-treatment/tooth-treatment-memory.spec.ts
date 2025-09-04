import { TestBed } from '@angular/core/testing';
import { runSharedTreatmentServiceTests } from './tooth-treatment-service.shared-spec';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { firstValueFrom } from 'rxjs';
import { ToothTreatmentMemory } from './tooth-treatment-memory';
import { ToothTreatment, ToothZones, ToothTreatmentStatus, TreatmentType } from '@portfolio/odontogram/models';
import { Optional } from '@portfolio/shared/util';

function serviceFactory() {
  TestBed.configureTestingModule({
    imports: [],
    providers: []
  });

  const service = TestBed.inject(ToothTreatmentMemory);

  return service;
}

runSharedTreatmentServiceTests(serviceFactory);

describe('ToothTreatmentMemory', () => {
  let service: ToothTreatmentMemory;
  let currentServiceData: Map<string, ToothTreatment>;

  const mockTreatment: Optional<ToothTreatment, 'id'> = { teeth: ["11"], groupTeeth: false, status: ToothTreatmentStatus.COMPLETED, type: TreatmentType.STANDARD, zones: [ToothZones.BOTTOM], additionalInformation: "Test treatment" };

  beforeEach(() => {
    service = serviceFactory();
    currentServiceData = service['_toothTreatments'];
  });

  it('should read array correctly', async () => {
    const data = await firstValueFrom(service.getList());
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(currentServiceData.size);
  });

  it('should apply filter by ids', async () => {
    const data = await firstValueFrom(service.getList({ ids: ['1', '2'] }));
    expect(Array.isArray(data)).toBe(true);
    expect(data.every(item => item.id && ['1', '2'].includes(item.id))).toBe(true);
    expect(Array.from(currentServiceData.values()).filter((item) => item.id === '1' || item.id === '2')).toEqual(data);
  });

  it('should apply filter by odontogram', async () => {
    const odontogramIds: string[] = ['1', '3'];

    const data = await firstValueFrom(service.getList({ odontogram: odontogramIds }));
    expect(Array.isArray(data)).toBe(true);
    expect(data.every(item => odontogramIds.includes(item.odontogram as string))).toBe(true);
    expect(Array.from(currentServiceData.values()).filter((item) => odontogramIds.includes(item.odontogram as string))).toEqual(data);
  });

  it('should apply filter by client', async () => {
    const data = await firstValueFrom(service.getList({ odontogram: '1' }));
    expect(Array.isArray(data)).toBe(true);
    expect(data.every(item => item.odontogram === '1')).toBe(true);
    expect(Array.from(currentServiceData.values()).filter((item) => item.odontogram === '1')).toEqual(data);
  });

  it('should find object correctly', async () => {
    const data = await firstValueFrom(service.getById('1'));
    expect(data).toEqual(currentServiceData.get('1'));
  });

  it('should return error if not found on find', async () => {
    try {
      await firstValueFrom(service.getById('161616'));
      fail('Should have failed');
    } catch (error) {
      expect(error instanceof NotFoundResourceError).toBe(true);
    }
  });

  it('should add a new item', async () => {
    const id = '161616';
    const newItemWithId = { id, ...mockTreatment };
    const data = await firstValueFrom(service.create(newItemWithId));
    expect(data).toEqual(newItemWithId);
    expect(currentServiceData.get(newItemWithId.id)).toBeDefined();
    expect(currentServiceData.get(newItemWithId.id)).toEqual(newItemWithId);
  });

  it('should add a new item and generate id', async () => {
    const newItem = mockTreatment;
    expect(newItem.id).toBeUndefined();

    const data = await firstValueFrom(service.create(newItem));
    expect(data).toEqual({ ...newItem, id: data.id });
    expect(currentServiceData.get(data.id)).toBeDefined();
    expect(currentServiceData.get(data.id)).toEqual({ ...newItem, id: data.id });
  });

  it('should update an existing item', async () => {
    const updatedItem = { id: '1', additionalInformation: 'Updated Item' };
    const data = await firstValueFrom(service.update(updatedItem));
    expect(data.additionalInformation).toEqual(updatedItem.additionalInformation);
    expect(currentServiceData.get(updatedItem.id)?.additionalInformation).toEqual(updatedItem.additionalInformation);
  });

  it('should return error if not found on update', async () => {
    try {
      await firstValueFrom(service.update({ id: '161616', additionalInformation: 'Non Existent Item' }));
      fail('Should have failed');
    } catch (error) {
      expect(error instanceof NotFoundResourceError).toBe(true);
    }
  });

  it('should delete an item', async () => {
    const data = await firstValueFrom(service.delete('1'));
    expect(data).toBeUndefined();
    expect(currentServiceData.get('1')).toBeUndefined();
  });
});
