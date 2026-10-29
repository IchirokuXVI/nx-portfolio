import {
  AllowanceLimit,
  AllowancePeriod,
  AllowancePurpose,
  AllowanceScope,
  type AllowanceLimits,
} from '@portfolio/luna-shopper/contracts';
import type { AllowanceCalendar } from './allowance-calendar';
import {
  amountsFor,
  firstRefusal,
  NO_DEPLOYMENT_USAGE,
  NO_PERSON_USAGE,
  reachableTurns,
  type DeploymentTotals,
  type PersonTotals,
} from './allowance-rules';

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

const CALENDAR: AllowanceCalendar = {
  day: '2026-10-27',
  monthStart: '2026-10-01',
  nextMonthStart: '2026-11-01',
  dayResetsAt: '2026-10-28T00:00:00+01:00',
  monthResetsAt: '2026-11-01T00:00:00+01:00',
};

function person(overrides: Partial<PersonTotals> = {}): PersonTotals {
  return { ...NO_PERSON_USAGE, ...overrides };
}

function deployment(
  overrides: Partial<DeploymentTotals> = {}
): DeploymentTotals {
  return { ...NO_DEPLOYMENT_USAGE, ...overrides };
}

function refuse(input: {
  purpose?: AllowancePurpose;
  audioSeconds?: number;
  microUsd?: number;
  limits?: Partial<AllowanceLimits>;
  personDay?: Partial<PersonTotals>;
  personMonth?: Partial<PersonTotals>;
  deploymentDay?: Partial<DeploymentTotals>;
  deploymentMonth?: Partial<DeploymentTotals>;
}) {
  return firstRefusal({
    amounts: amountsFor(
      input.purpose ?? AllowancePurpose.TURN,
      input.audioSeconds ?? 0,
      input.microUsd ?? 20_000
    ),
    limits: { ...LIMITS, ...input.limits },
    personDay: person(input.personDay),
    personMonth: person(input.personMonth),
    deploymentDay: deployment(input.deploymentDay),
    deploymentMonth: deployment(input.deploymentMonth),
    calendar: CALENDAR,
  });
}

describe('what a reservation holds (plan 0234, section 5.2)', () => {
  it('holds one turn for a typed or spoken turn and none for a transcription', () => {
    expect(amountsFor(AllowancePurpose.TURN, 0, 20_000)).toEqual({
      turns: 1,
      assistantAudioSeconds: 0,
      commentAudioSeconds: 0,
      microUsd: 20_000,
    });
    expect(amountsFor(AllowancePurpose.VOICE_TURN, 12, 20_000)).toEqual({
      turns: 1,
      assistantAudioSeconds: 12,
      commentAudioSeconds: 0,
      microUsd: 20_000,
    });
    expect(amountsFor(AllowancePurpose.TRANSCRIPTION, 30, 0)).toEqual({
      turns: 0,
      assistantAudioSeconds: 0,
      commentAudioSeconds: 30,
      microUsd: 0,
    });
  });
});

describe('the order of the checks (plan 0234, section 5.1 step 4)', () => {
  it('fits when everything fits, the limit itself included', () => {
    expect(refuse({})).toBeNull();
    expect(refuse({ personDay: { turns: 58, reservedTurns: 1 } })).toBeNull();
  });

  it('refuses the day turns first, with the time the day turns over', () => {
    expect(
      refuse({
        personDay: { turns: 60, costMicroUsd: 100_000 },
        personMonth: { turns: 600 },
        deploymentDay: { costMicroUsd: 3_000_000 },
      })
    ).toEqual({
      scope: AllowanceScope.USER,
      period: AllowancePeriod.DAY,
      limit: AllowanceLimit.TURNS,
      resetsAt: CALENDAR.dayResetsAt,
    });
  });

  it('counts what open reservations hold', () => {
    expect(refuse({ personDay: { turns: 59, reservedTurns: 1 } })).toEqual(
      expect.objectContaining({ limit: AllowanceLimit.TURNS })
    );
  });

  it('then the month turns, with the time the month turns over', () => {
    expect(
      refuse({ personMonth: { turns: 600 }, personDay: { turns: 3 } })
    ).toEqual({
      scope: AllowanceScope.USER,
      period: AllowancePeriod.MONTH,
      limit: AllowanceLimit.TURNS,
      resetsAt: CALENDAR.monthResetsAt,
    });
  });

  it('then assistant audio for a spoken turn, and never for a typed one', () => {
    const full = { assistantAudioSeconds: 900 };
    expect(
      refuse({
        purpose: AllowancePurpose.VOICE_TURN,
        audioSeconds: 10,
        personDay: full,
        personMonth: { ...full, costMicroUsd: 1_000_000 },
      })
    ).toEqual(
      expect.objectContaining({
        period: AllowancePeriod.DAY,
        limit: AllowanceLimit.ASSISTANT_AUDIO,
      })
    );
    expect(
      refuse({ purpose: AllowancePurpose.TURN, personDay: full })
    ).toBeNull();
  });

  it('then comment audio for a transcription, kept apart from assistant audio', () => {
    expect(
      refuse({
        purpose: AllowancePurpose.TRANSCRIPTION,
        audioSeconds: 60,
        microUsd: 0,
        personMonth: { commentAudioSeconds: 17_990 },
      })
    ).toEqual(
      expect.objectContaining({
        period: AllowancePeriod.MONTH,
        limit: AllowanceLimit.COMMENT_AUDIO,
      })
    );
    expect(
      refuse({
        purpose: AllowancePurpose.TRANSCRIPTION,
        audioSeconds: 60,
        microUsd: 0,
        personDay: { assistantAudioSeconds: 900 },
      })
    ).toBeNull();
  });

  it('then the person cost, day before month', () => {
    expect(
      refuse({
        personDay: { costMicroUsd: 90_000 },
        personMonth: { costMicroUsd: 990_000 },
      })
    ).toEqual(
      expect.objectContaining({
        scope: AllowanceScope.USER,
        period: AllowancePeriod.DAY,
        limit: AllowanceLimit.COST,
      })
    );
    expect(refuse({ personMonth: { reservedMicroUsd: 990_000 } })).toEqual(
      expect.objectContaining({
        scope: AllowanceScope.USER,
        period: AllowancePeriod.MONTH,
        limit: AllowanceLimit.COST,
      })
    );
  });

  it('and the deployment last, day before month', () => {
    expect(
      refuse({
        deploymentDay: { costMicroUsd: 2_990_000 },
        deploymentMonth: { costMicroUsd: 29_990_000 },
      })
    ).toEqual({
      scope: AllowanceScope.DEPLOYMENT,
      period: AllowancePeriod.DAY,
      limit: AllowanceLimit.COST,
      resetsAt: CALENDAR.dayResetsAt,
    });
    expect(
      refuse({ deploymentMonth: { reservedMicroUsd: 29_990_000 } })
    ).toEqual(
      expect.objectContaining({
        scope: AllowanceScope.DEPLOYMENT,
        period: AllowancePeriod.MONTH,
      })
    );
  });

  it('does not refuse a free transcription to a person over their cost', () => {
    expect(
      refuse({
        purpose: AllowancePurpose.TRANSCRIPTION,
        audioSeconds: 20,
        microUsd: 0,
        personDay: { costMicroUsd: 150_000 },
        deploymentDay: { costMicroUsd: 5_000_000 },
      })
    ).toBeNull();
  });

  it('applies whatever limits it is sent, so the guest limits apply to a guest', () => {
    const guest: Partial<AllowanceLimits> = {
      turnsPerDay: 20,
      costPerDayMicroUsd: 40_000,
    };
    expect(refuse({ limits: guest, personDay: { turns: 20 } })).toEqual(
      expect.objectContaining({ limit: AllowanceLimit.TURNS })
    );
    expect(
      refuse({ limits: guest, personDay: { costMicroUsd: 20_001 } })
    ).toEqual(expect.objectContaining({ limit: AllowanceLimit.COST }));
    expect(refuse({ personDay: { turns: 20 } })).toBeNull();
  });
});

describe('the turn limit the read shows (plan 0234, section 8.2)', () => {
  it('is the configured limit while the next reserve fits the money', () => {
    expect(reachableTurns(12, 60, 4_000, 100_000, 20_000)).toBe(60);
    expect(reachableTurns(12, 60, 80_000, 100_000, 20_000)).toBe(60);
  });

  it('is the turns already used once the next reserve does not fit', () => {
    expect(reachableTurns(12, 60, 80_001, 100_000, 20_000)).toBe(12);
    expect(reachableTurns(12, 60, 130_000, 100_000, 20_000)).toBe(12);
  });
});
