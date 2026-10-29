import { Logger } from '@nestjs/common';
import {
  AllowancePurpose,
  type AllowanceLimits,
  type ReserveAllowanceRequest,
} from '@portfolio/luna-shopper/contracts';
import { isDomainException } from '@portfolio/luna-shopper/platform';
import type { DataSource } from 'typeorm';
import { AssistantAllowanceService } from './assistant-allowance.service';

/**
 * The limits a reserve and a read accept (plan 0234, section 7). They fail
 * closed: a field that is missing or not a positive integer refuses the request
 * before any transaction opens, and is logged as an error. The counting itself
 * is proved against Postgres in the integration spec.
 */

const LIMITS: AllowanceLimits = {
  turnsPerDay: 60,
  turnsPerMonth: 600,
  assistantAudioSecondsPerDay: 900,
  assistantAudioSecondsPerMonth: 9000,
  commentAudioSecondsPerDay: 1800,
  commentAudioSecondsPerMonth: 18000,
  costPerDayMicroUsd: 100_000,
  costPerMonthMicroUsd: 1_000_000,
  deploymentCostPerDayMicroUsd: 3_000_000,
  deploymentCostPerMonthMicroUsd: 30_000_000,
};

function build(): { service: AssistantAllowanceService; opened: string[] } {
  const opened: string[] = [];
  const dataSource = {
    transaction: async () => {
      opened.push('transaction');
      throw new Error('no transaction in this spec');
    },
  } as unknown as DataSource;
  return { service: new AssistantAllowanceService(dataSource), opened };
}

function request(limits: unknown): ReserveAllowanceRequest {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    purpose: AllowancePurpose.TURN,
    audioSeconds: 0,
    microUsd: 20_000,
    limits: limits as AllowanceLimits,
    timezone: 'UTC',
    holdSeconds: 120,
  };
}

async function refusal(
  run: () => Promise<unknown>
): Promise<{ code: unknown; errors: string[] }> {
  const errors: string[] = [];
  const spy = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation((line) => {
      errors.push(String(line));
    });
  try {
    const thrown = await run().then(
      () => undefined,
      (error: unknown) => error
    );
    return {
      code: isDomainException(thrown) ? thrown.code : thrown,
      errors,
    };
  } finally {
    spy.mockRestore();
  }
}

describe('the limits of a reservation (plan 0234)', () => {
  const fields = Object.keys(LIMITS) as (keyof AllowanceLimits)[];

  it.each(fields)('refuses a request whose %s is missing', async (field) => {
    const { service, opened } = build();
    const limits: Partial<AllowanceLimits> = { ...LIMITS };
    delete limits[field];

    const { code, errors } = await refusal(() =>
      service.reserve(request(limits))
    );

    expect(code).toBe('validation_failed');
    expect(opened).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(JSON.parse(errors[0])).toEqual({
      event: 'assistant.allowance.limitsRefused',
      field,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, '60', null])(
    'refuses a limit of %p',
    async (value) => {
      const { service, opened } = build();

      const { code } = await refusal(() =>
        service.reserve(request({ ...LIMITS, turnsPerMonth: value }))
      );

      expect(code).toBe('validation_failed');
      expect(opened).toEqual([]);
    }
  );

  it('refuses a request with no limits at all, and a read with a missing one', async () => {
    const { service, opened } = build();

    const reserve = await refusal(() => service.reserve(request(undefined)));
    const partial: Partial<AllowanceLimits> = { ...LIMITS };
    delete partial.costPerMonthMicroUsd;
    const read = await refusal(() =>
      service.read({
        userId: '00000000-0000-4000-8000-000000000001',
        limits: partial as AllowanceLimits,
        timezone: 'UTC',
        turnReserveMicroUsd: 20_000,
      })
    );

    expect(reserve.code).toBe('validation_failed');
    expect(read.code).toBe('validation_failed');
    expect(opened).toEqual([]);
  });

  it('opens the transaction when every limit is a positive integer', async () => {
    const { service, opened } = build();

    await service.reserve(request(LIMITS)).catch(() => undefined);

    expect(opened).toEqual(['transaction']);
  });
});
