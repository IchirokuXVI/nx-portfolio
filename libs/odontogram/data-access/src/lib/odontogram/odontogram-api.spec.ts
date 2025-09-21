import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  NotFoundResourceError,
  OwnApiUrlResolver,
} from '@portfolio/shared/data-access';
import { OdontogramApi } from './odontogram-api';
import { runSharedOdontogramServiceTests } from './odontogram-service.shared-spec';

const API_URL = 'https://api.example.com';

function serviceFactory() {
  TestBed.configureTestingModule({
    imports: [],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      OwnApiUrlResolver,
    ],
  });

  TestBed.inject(OwnApiUrlResolver).getApiUrl = () => API_URL; // Mock the API URL resolver
  const service = TestBed.inject(OdontogramApi);

  return service;
}

runSharedOdontogramServiceTests(serviceFactory);

describe('OdontogramApi', () => {
  let service: OdontogramApi;
  let httpMock: HttpTestingController;
  let finalUrl: string;
  const mockData = [
    { id: 1, name: 'Test Data' },
    { id: 2, name: 'More Test Data' },
  ];

  beforeEach(() => {
    service = serviceFactory();

    finalUrl = API_URL + service['_endpoint'];

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify(); // Verify no outstanding requests
  });

  it('should make GET request and return data', () => {
    service.getList().subscribe((data) => {
      expect(data).toEqual(mockData);
    });

    const req = httpMock.expectOne(finalUrl);
    expect(req.request.method).toEqual('GET');
    req.flush([mockData]);

    service.getById('1').subscribe((data) => {
      expect(data).toEqual(mockData[0]);
    });

    const idReq = httpMock.expectOne(finalUrl + '/1');
    expect(idReq.request.method).toEqual('GET');
    idReq.flush(mockData[0]);
  });

  it('should handle GET not found error', () => {
    const mockError = { status: 404, statusText: 'Not Found' };

    service.getList().subscribe({
      next: () => fail('Should have failed'),
      error: (error) => {
        expect(error instanceof NotFoundResourceError).toEqual(true);
      },
    });

    const req = httpMock.expectOne(finalUrl);
    req.flush(null, mockError);
  });

  it('should make POST request with payload', () => {
    const testPayload = { id: '1' };

    service.create(testPayload).subscribe((data) => {
      expect(data).toEqual(testPayload);
    });

    const req = httpMock.expectOne(finalUrl);
    expect(req.request.method).toEqual('POST');
    expect(req.request.body).toEqual(testPayload);
    req.flush(testPayload);
  });

  it('should handle POST errors', () => {
    const testPayload = { id: '1' };
    const mockError = { status: 500, statusText: 'Server Error' };

    service.create(testPayload).subscribe({
      next: () => fail('Should have failed'),
      error: (error) => {
        expect(error.status).toEqual(mockError.status);
      },
    });

    const req = httpMock.expectOne(finalUrl);
    req.flush(null, mockError);
  });

  it('should make PUT request with payload', () => {
    const testPayload = { id: '1' };

    service.update(testPayload).subscribe((data) => {
      expect(data).toEqual(testPayload);
    });

    const req = httpMock.expectOne(finalUrl + `/${testPayload.id}`);
    expect(req.request.method).toEqual('PUT');
    expect(req.request.body).toEqual(testPayload);
    req.flush(testPayload);
  });

  it('should handle PUT not found error', () => {
    const testPayload = { id: '1' };
    const mockError = { status: 404, statusText: 'Not Found' };

    service.update(testPayload).subscribe({
      next: () => fail('Should have failed'),
      error: (error) => {
        expect(error instanceof NotFoundResourceError).toEqual(true);
      },
    });

    const req = httpMock.expectOne(finalUrl + `/${testPayload.id}`);
    req.flush(null, mockError);
  });

  it('should make DELETE request with payload', () => {
    service.delete('1').subscribe((data) => {
      expect(data).toBeUndefined();
    });

    const req = httpMock.expectOne(finalUrl + '/1');
    expect(req.request.method).toEqual('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('should handle DELETE errors', () => {
    const mockError = { status: 500, statusText: 'Server Error' };

    service.delete('1').subscribe({
      next: () => fail('Should have failed'),
      error: (error) => {
        expect(error.status).toEqual(mockError.status);
      },
    });

    const req = httpMock.expectOne(finalUrl + '/1');
    req.flush(null, mockError);
  });
});
