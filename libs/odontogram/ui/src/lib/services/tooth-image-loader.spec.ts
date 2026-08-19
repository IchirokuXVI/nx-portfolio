import { TestBed } from '@angular/core/testing';
import { ToothImageLoader } from './tooth-image-loader';

describe('ToothImageLoader', () => {
  let service: ToothImageLoader;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ToothImageLoader] });
    service = TestBed.inject(ToothImageLoader);
  });

  // Reference identity is checked without subscribing so the dynamic asset
  // import()s never run under jest; the cache contract is purely about reusing
  // the same observable instance.
  it('returns the same observable instance for repeated loads of one tooth', () => {
    const first = service.loadImage('11');
    const second = service.loadImage('11');

    expect(second).toBe(first);
  });

  it('returns distinct observables for different teeth', () => {
    const first = service.loadImage('11');
    const second = service.loadImage('12');

    expect(second).not.toBe(first);
  });
});
