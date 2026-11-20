import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { asQueryFlag } from './query-flag';
import { createValidationPipe } from './validation-pipe';

class FlagQueryDto {
  @IsOptional()
  @Transform(asQueryFlag)
  @IsBoolean()
  flag?: boolean;
}

/** The query as Express hands it to the pipe: every value is text. */
function read(query: Record<string, unknown>): Promise<FlagQueryDto> {
  return createValidationPipe().transform(query, {
    type: 'query',
    metatype: FlagQueryDto,
  });
}

describe('asQueryFlag through the gateway pipe', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('reads flag=%p as %p', async (spelled, expected) => {
    expect((await read({ flag: spelled })).flag).toBe(expected);
  });

  it('leaves the flag undefined when the query does not name it', async () => {
    const dto = await read({});

    expect(dto.flag).toBeUndefined();
    expect('flag' in dto).toBe(false);
  });

  it.each(['', 'no', 'yes', '0', '1', 'False', 'TRUE'])(
    'refuses flag=%p',
    async (spelled) => {
      await expect(read({ flag: spelled })).rejects.toBeInstanceOf(
        BadRequestException
      );
    }
  );

  it('refuses a flag named twice', async () => {
    await expect(read({ flag: ['true', 'false'] })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('shows why it exists: the pipe alone reads false as true', async () => {
    class UnguardedQueryDto {
      @IsOptional()
      @IsBoolean()
      flag?: boolean;
    }

    const dto = await createValidationPipe().transform(
      { flag: 'false' },
      { type: 'query', metatype: UnguardedQueryDto }
    );

    expect(dto.flag).toBe(true);
  });
});
