import { allowanceReturn } from './assistant-allowance';

describe('allowanceReturn (velista 0174)', () => {
  // Built from local parts, so the expectations hold in whatever time zone the run is
  // in: the function formats in the reader's zone, which is the runtime's.
  const evening = new Date(2026, 9, 28, 21, 5);
  const firstOfMonth = new Date(2026, 10, 1, 0, 0);

  it('says a time of day for a day, with its hour', () => {
    expect(allowanceReturn({ period: 'day', resetsAt: evening }, 'en')).toEqual(
      { when: expect.stringMatching(/^(21:05|9:05\sPM)$/), hour: 21 }
    );
    expect(allowanceReturn({ period: 'day', resetsAt: evening }, 'es')).toEqual(
      { when: '21:05', hour: 21 }
    );
  });

  it('gives the hour that picks the Spanish article', () => {
    expect(
      allowanceReturn(
        { period: 'day', resetsAt: new Date(2026, 9, 29, 1, 0) },
        'es'
      )
    ).toEqual({ when: '1:00', hour: 1 });
    expect(
      allowanceReturn(
        { period: 'day', resetsAt: new Date(2026, 9, 29, 0, 0) },
        'es'
      )
    ).toEqual({ when: '0:00', hour: 0 });
  });

  it('says a date for a month', () => {
    expect(
      allowanceReturn({ period: 'month', resetsAt: firstOfMonth }, 'es')?.when
    ).toBe('1 de noviembre');
    expect(
      allowanceReturn({ period: 'month', resetsAt: firstOfMonth }, 'en')?.when
    ).toMatch(/November/);
  });

  it('answers null for a moment it cannot read', () => {
    expect(allowanceReturn({ period: 'day', resetsAt: null }, 'en')).toBeNull();
    expect(
      allowanceReturn({ period: 'day', resetsAt: new Date('not a date') }, 'en')
    ).toBeNull();
  });

  it('falls back to the runtime language for a tag Intl refuses', () => {
    expect(
      allowanceReturn({ period: 'day', resetsAt: evening }, 'not a locale!')
        ?.hour
    ).toBe(21);
  });
});
