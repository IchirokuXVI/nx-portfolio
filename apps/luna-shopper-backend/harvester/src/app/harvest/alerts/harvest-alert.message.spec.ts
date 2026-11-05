import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunTrigger,
} from '@portfolio/luna-shopper/contracts';
import {
  alertMail,
  digestMail,
  durationOf,
  LEAD_SENTENCES,
  madridTime,
  schedulesStoppedSentence,
  type AlertForMessage,
  type MessageContext,
} from './harvest-alert.message';

/**
 * The subject and the body of an alert mail (plan 0218, section 6). Pure:
 * the chain names are passed in, and every time is in the payload.
 */

const CHAIN = 'chain-1';
const CREATED = new Date('2026-11-05T03:20:00.000Z');

const context = (over: Partial<MessageContext> = {}): MessageContext => ({
  environmentName: 'production',
  adminAppBaseUrl: 'https://admin.velista.app',
  chainName: (id) => (id === CHAIN ? 'Mercadona' : null),
  ...over,
});

function runAlert(
  kind: HarvestAlertKind,
  payload: Record<string, unknown> = {}
): AlertForMessage {
  return {
    kind,
    supermarketId: CHAIN,
    runId: 'run-1',
    scheduleId: 'schedule-1',
    createdAt: CREATED,
    payload: {
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      trigger: HarvestRunTrigger.SCHEDULED,
      presetId: 'preset-1',
      scheduleId: 'schedule-1',
      adapterKey: 'mercadona-api',
      requestedAt: '2026-11-05T02:00:00.000Z',
      startedAt: '2026-11-05T02:00:05.000Z',
      finishedAt: '2026-11-05T03:04:10.000Z',
      failed: 30,
      totalPlanned: 100,
      error: '30 of 100 items failed, which is over the 0.25 threshold.',
      schedulesStopped: null,
      staleAfterSeconds: null,
      ...payload,
    },
  };
}

const slotAlert = (retry = false): AlertForMessage => ({
  kind: HarvestAlertKind.SLOT_REFUSED,
  supermarketId: 'chain-deza',
  runId: null,
  scheduleId: 'schedule-2',
  createdAt: CREATED,
  payload: {
    presetId: 'preset-2',
    scheduleId: 'schedule-2',
    adapterKey: 'deza-web',
    slot: '2026-11-05T02:00:00.000Z',
    retry,
    note: 'That source is disabled. Enable it with supermarketSource.setEnabled.',
    at: '2026-11-05T02:00:30.000Z',
  },
});

const postalAlert = (runId: string | null): AlertForMessage => ({
  kind: HarvestAlertKind.POSTAL_CODE_FAILED,
  supermarketId: null,
  runId,
  scheduleId: null,
  createdAt: CREATED,
  payload: {
    postalCode: '14013',
    country: 'es',
    attempts: 3,
    error: 'OpenStreetMap: Overpass timed out',
    runId,
    at: '2026-11-05T03:00:00.000Z',
  },
});

describe('the subject of one alert', () => {
  it('says what happened to which chain, in each case of section 6', () => {
    expect(
      alertMail(runAlert(HarvestAlertKind.RUN_FAILED), context()).subject
    ).toBe('[production] Mercadona: catalog discovery failed');
    expect(
      alertMail(
        {
          ...runAlert(HarvestAlertKind.RUN_BLOCKED),
          supermarketId: 'chain-dia',
        },
        context({ chainName: (id) => (id === 'chain-dia' ? 'DIA' : null) })
      ).subject
    ).toBe('[production] DIA: the chain refused the run');
    expect(
      alertMail(
        runAlert(HarvestAlertKind.RUN_FAILED, { schedulesStopped: 2 }),
        context()
      ).subject
    ).toBe(
      '[production] Mercadona: catalog discovery failed, and its 2 schedules stopped'
    );
    expect(
      alertMail(
        slotAlert(),
        context({ chainName: (id) => (id === 'chain-deza' ? 'DEZA' : null) })
      ).subject
    ).toBe('[production] DEZA: a scheduled run was refused');
  });

  it('names a stale run, a refused retry, a postal code and a test', () => {
    expect(
      alertMail(
        runAlert(HarvestAlertKind.RUN_STALE, { staleAfterSeconds: 900 }),
        context()
      ).subject
    ).toBe('[production] Mercadona: catalog discovery went stale');
    expect(alertMail(slotAlert(true), context()).subject).toBe(
      '[production] deza-web: the retry of a scheduled run was refused'
    );
    expect(alertMail(postalAlert('run-9'), context()).subject).toBe(
      '[production] Postal code 14013: store discovery gave up after 3 attempts'
    );
    expect(
      alertMail(
        {
          kind: HarvestAlertKind.TEST,
          supermarketId: null,
          runId: null,
          scheduleId: null,
          createdAt: CREATED,
          payload: { requestedByUserId: 'admin-1', at: CREATED.toISOString() },
        },
        context({ environmentName: 'slot6' })
      ).subject
    ).toBe('[slot6] Harvest alerts: a test mail');
  });

  it('falls back to the adapter key when catalog could not name the chain', () => {
    expect(
      alertMail(
        runAlert(HarvestAlertKind.RUN_FAILED),
        context({ chainName: () => null })
      ).subject
    ).toBe('[production] mercadona-api: catalog discovery failed');
  });
});

describe('the body of one alert', () => {
  it('holds the facts of a run, in Madrid time, and links the run', () => {
    const { body } = alertMail(
      runAlert(HarvestAlertKind.RUN_FAILED),
      context()
    );
    expect(body).toContain(LEAD_SENTENCES[HarvestAlertKind.RUN_FAILED]);
    expect(body).toContain('Chain: Mercadona');
    expect(body).toContain('Mode: catalog discovery');
    expect(body).toContain('Trigger: SCHEDULED');
    expect(body).toContain('Preset: preset-1');
    expect(body).toContain('Schedule: schedule-1');
    // 02:00 UTC is 03:00 in Madrid in November.
    expect(body).toContain('Requested: 2026-11-05 03:00:00 Madrid time');
    expect(body).toContain('Started: 2026-11-05 03:00:05 Madrid time');
    expect(body).toContain('Finished: 2026-11-05 04:04:10 Madrid time');
    expect(body).toContain('Duration: 1 h 4 min');
    expect(body).toContain('Failed: 30 of 100 planned items');
    expect(body).toContain(
      'Error: 30 of 100 items failed, which is over the 0.25 threshold.'
    );
    expect(body).toContain('Run: https://admin.velista.app/harvest/runs/run-1');
    expect(body).toContain('Sent by the harvester of production.');
  });

  it('names the run id only when no base URL is set', () => {
    const { body } = alertMail(
      runAlert(HarvestAlertKind.RUN_FAILED),
      context({ adminAppBaseUrl: '' })
    );
    expect(body).toContain('Run id: run-1');
    expect(body).not.toContain('/harvest/runs/');
  });

  it('carries the sentence of section 2.2 when the schedules stopped', () => {
    const { body } = alertMail(
      runAlert(HarvestAlertKind.RUN_FAILED, { schedulesStopped: 2 }),
      context()
    );
    expect(body).toContain(schedulesStoppedSentence(2));
    expect(schedulesStoppedSentence(2)).toBe(
      'This was failure 3 in a row for this chain, so the 2 schedules of the ' +
        'chain stopped. Start the preset by hand: the first run that completes ' +
        'lets the schedules fire again.'
    );
    expect(
      alertMail(runAlert(HarvestAlertKind.RUN_FAILED), context()).body
    ).not.toContain('schedules of the chain stopped');
  });

  it('lays a stale run out like a failed one, with the window and the reaper error', () => {
    const { body } = alertMail(
      runAlert(HarvestAlertKind.RUN_STALE, {
        staleAfterSeconds: 900,
        error:
          'The stale reaper marked the run after no heartbeat for 900 seconds.',
      }),
      context()
    );
    expect(body).toContain(LEAD_SENTENCES[HarvestAlertKind.RUN_STALE]);
    expect(body).toContain('Stale window: no heartbeat for 900 seconds');
    expect(body).toContain(
      'Error: The stale reaper marked the run after no heartbeat for 900 seconds.'
    );
    expect(body).toContain('Run: https://admin.velista.app/harvest/runs/run-1');
  });

  it('holds the slot time and the note of a refused slot', () => {
    const { body } = alertMail(slotAlert(), context());
    expect(body).toContain('Slot: 2026-11-05 03:00:00 Madrid time');
    expect(body).toContain(
      'Reason: That source is disabled. Enable it with supermarketSource.setEnabled.'
    );
    expect(body).toContain('does not repeat until the schedule starts a run');
  });

  it('holds the code, the attempts, the last error and the run link of a postal code', () => {
    const { body } = alertMail(postalAlert('run-9'), context());
    expect(body).toContain('Postal code: 14013 (es)');
    expect(body).toContain('Attempts: 3');
    expect(body).toContain('Last error: OpenStreetMap: Overpass timed out');
    expect(body).toContain('Run: https://admin.velista.app/harvest/runs/run-9');
    expect(alertMail(postalAlert(null), context()).body).not.toContain('Run');
  });
});

describe('a digest', () => {
  it('lists four alerts in one mail, oldest first', () => {
    const at = (minutes: number) =>
      new Date(CREATED.getTime() + minutes * 60_000);
    const alerts: AlertForMessage[] = [
      { ...slotAlert(), createdAt: at(3) },
      { ...runAlert(HarvestAlertKind.RUN_FAILED), createdAt: at(0) },
      { ...postalAlert('run-9'), createdAt: at(2) },
      { ...runAlert(HarvestAlertKind.RUN_BLOCKED), createdAt: at(1) },
    ];
    const mail = digestMail(alerts, context());
    expect(mail.subject).toBe('[production] 4 harvest alerts');
    const order = [
      'Alert 1 of 4: Mercadona: catalog discovery failed',
      'Alert 2 of 4: Mercadona: the chain refused the run',
      'Alert 3 of 4: Postal code 14013: store discovery gave up after 3 attempts',
      'Alert 4 of 4: deza-web: a scheduled run was refused',
    ].map((line) => mail.body.indexOf(line));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('the fixed words', () => {
  const DASH_AS_PUNCTUATION = /\s[-–—]\s|[–—]/;

  it('use no dash as punctuation', () => {
    const fixed = [
      ...Object.values(LEAD_SENTENCES),
      schedulesStoppedSentence(1),
      schedulesStoppedSentence(2),
    ];
    for (const sentence of fixed) {
      expect(sentence).not.toMatch(DASH_AS_PUNCTUATION);
    }
    const mails = [
      alertMail(
        runAlert(HarvestAlertKind.RUN_FAILED, { schedulesStopped: 2 }),
        context()
      ),
      alertMail(runAlert(HarvestAlertKind.RUN_BLOCKED), context()),
      alertMail(runAlert(HarvestAlertKind.RUN_STALE), context()),
      alertMail(slotAlert(true), context()),
      alertMail(postalAlert('run-9'), context()),
      digestMail(
        [
          slotAlert(),
          postalAlert(null),
          slotAlert(true),
          runAlert(HarvestAlertKind.RUN_FAILED),
        ],
        context()
      ),
    ];
    for (const mail of mails) {
      expect(mail.subject).not.toMatch(DASH_AS_PUNCTUATION);
      expect(mail.body).not.toMatch(DASH_AS_PUNCTUATION);
    }
  });
});

describe('times and durations', () => {
  it('writes Madrid time across the summer change', () => {
    expect(madridTime('2026-07-01T10:00:00.000Z')).toBe(
      '2026-07-01 12:00:00 Madrid time'
    );
    expect(madridTime(null)).toBe('not recorded');
  });

  it('writes a duration in its largest units', () => {
    expect(durationOf('2026-11-05T00:00:00Z', '2026-11-05T00:00:45Z')).toBe(
      '45 s'
    );
    expect(durationOf('2026-11-05T00:00:00Z', '2026-11-05T00:03:12Z')).toBe(
      '3 min 12 s'
    );
    expect(durationOf(null, '2026-11-05T00:03:12Z')).toBe('not recorded');
  });
});
