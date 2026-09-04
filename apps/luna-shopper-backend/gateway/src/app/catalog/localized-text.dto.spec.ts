import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import { CreateSupermarketDto, LocalizedTextDto } from './catalog.dto';

/**
 * A name in one language (plan 0079, section 2).
 *
 * `LocalizedTextDto` is the one write gate: Ajv is not on the request path, so
 * what this file proves is the whole enforcement of "at least one language,
 * every present one a non blank string, a missing one absent and never null".
 * It runs the pipe the gateway really runs with, nested under a real body DTO,
 * because the whitelist is part of the rule: a language the catalog cannot
 * serve is refused by the pipe and not by any decorator.
 */
async function outcome(name: unknown): Promise<'accepted' | string[]> {
  try {
    await createValidationPipe().transform(
      { name },
      { type: 'body', metatype: CreateSupermarketDto }
    );
    return 'accepted';
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as { message: string[] };
      return response.message;
    }
    throw error;
  }
}

describe('LocalizedTextDto', () => {
  it('accepts a name in either language alone, or both', async () => {
    expect(await outcome({ es: 'Leche' })).toBe('accepted');
    expect(await outcome({ en: 'Milk' })).toBe('accepted');
    expect(await outcome({ en: 'Milk', es: 'Leche' })).toBe('accepted');
  });

  it('refuses a name in no language', async () => {
    const messages = await outcome({});
    expect(messages).toEqual([
      expect.stringContaining('at least one of en, es'),
    ]);
  });

  it('refuses null: a missing language is an absent key, not a null one', async () => {
    const messages = await outcome({ en: null, es: 'Leche' });
    expect(messages).toEqual([expect.stringContaining('name.en')]);
  });

  it('refuses a blank string in any language', async () => {
    expect(await outcome({ en: '   ', es: 'Leche' })).not.toBe('accepted');
    expect(await outcome({ en: 'Milk', es: '' })).not.toBe('accepted');
  });

  it('refuses a string over the length', async () => {
    expect(await outcome({ es: 'x'.repeat(201) })).not.toBe('accepted');
    expect(await outcome({ es: 'x'.repeat(200) })).toBe('accepted');
  });

  it('refuses a language the catalog does not serve', async () => {
    expect(await outcome({ fr: 'Lait' })).not.toBe('accepted');
    expect(await outcome({ es: 'Leche', fr: 'Lait' })).not.toBe('accepted');
  });

  it('passes the object through with only the languages it was given', async () => {
    const dto = (await createValidationPipe().transform(
      { name: { es: 'Leche' } },
      { type: 'body', metatype: CreateSupermarketDto }
    )) as CreateSupermarketDto;

    expect(dto.name).toBeInstanceOf(LocalizedTextDto);
    expect(Object.keys(dto.name)).toEqual(['es']);
  });
});
