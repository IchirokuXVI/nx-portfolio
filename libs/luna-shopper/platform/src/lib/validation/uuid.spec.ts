import { BadRequestException } from '@nestjs/common';
import { isUuid, UuidPipe } from './uuid';

describe('isUuid', () => {
  it('accepts a uuid in either case', () => {
    expect(isUuid('0b6b3a0e-6f0e-4c8e-9d4a-2f7f7f0b1c2d')).toBe(true);
    expect(isUuid('0B6B3A0E-6F0E-4C8E-9D4A-2F7F7F0B1C2D')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isUuid('undefined')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid('0b6b3a0e-6f0e-4c8e-9d4a-2f7f7f0b1c2')).toBe(false);
  });
});

describe('UuidPipe', () => {
  it('passes a uuid through', () => {
    const id = '0b6b3a0e-6f0e-4c8e-9d4a-2f7f7f0b1c2d';
    expect(new UuidPipe('basketId').transform(id)).toBe(id);
  });

  it('refuses a malformed id with the shape a failed DTO has', () => {
    let thrown: unknown;
    try {
      new UuidPipe('basketId').transform('undefined');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toEqual(
      expect.objectContaining({ message: ['basketId must be a UUID'] })
    );
  });
});
