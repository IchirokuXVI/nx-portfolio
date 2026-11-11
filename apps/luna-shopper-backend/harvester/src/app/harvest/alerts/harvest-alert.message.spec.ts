import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunTrigger,
  SourceProbeStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  alertMail,
  digestMail,
  durationOf,
  fixturesProjectOf,
  LEAD_SENTENCES,
  madridTime,
  PROBE_LEAD_SENTENCES,
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
      alertMail(
        {
          kind: HarvestAlertKind.TEST,
          supermarketId: null,
          runId: null,
          scheduleId: null,
          createdAt: CREATED,
          payload: { requestedByUserId: 'admin-1', at: CREATED.toISOString() },
        },
        context()
      ),
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

describe('the probe alerts (plan 0247, section 4.4)', () => {
  const NAMES: Record<string, string> = {
    'chain-mercadona': 'Mercadona',
    'chain-dia': 'DIA',
    'chain-lidl': 'LIDL',
    'chain-deza': 'DEZA',
  };
  const named = context({ chainName: (id) => NAMES[id] ?? null });

  const probeAlert = (
    supermarketId: string,
    status: SourceProbeStatus,
    over: Record<string, unknown> = {}
  ): AlertForMessage => ({
    kind: HarvestAlertKind.PROBE_FAILED,
    supermarketId,
    runId: null,
    scheduleId: null,
    createdAt: CREATED,
    payload: {
      probeId: 'probe-7',
      sourceId: 'source-1',
      adapterKey: 'mercadona-api',
      trigger: HarvestRunTrigger.SCHEDULED,
      status,
      previousStatus: SourceProbeStatus.PASSED,
      changed: true,
      attempt: status === SourceProbeStatus.UNREACHABLE ? 3 : 1,
      startedAt: '2026-11-05T02:00:00.000Z',
      finishedAt: '2026-11-05T02:00:09.000Z',
      error: 'listing: 2 of 40 rows carried a price above zero',
      requests: 4,
      steps: [
        { name: 'warehouse', ok: true },
        { name: 'listing', ok: false },
      ],
      at: '2026-11-05T02:00:09.000Z',
      ...over,
    },
  });

  const slotProbeAlert = (retry = false): AlertForMessage => ({
    kind: HarvestAlertKind.SLOT_PROBE_FAILED,
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
      note: 'probe probe-8 UNREACHABLE: listing: connect ECONNREFUSED',
      at: '2026-11-05T02:00:30.000Z',
      probeId: 'probe-8',
      probeStatus: 'UNREACHABLE',
      probeError: 'listing: connect ECONNREFUSED',
    },
  });

  it('has the four subjects of section 4.4', () => {
    expect(
      alertMail(
        probeAlert('chain-mercadona', SourceProbeStatus.SHAPE_CHANGED),
        named
      ).subject
    ).toBe('[production] Mercadona: the storefront changed shape');
    expect(
      alertMail(probeAlert('chain-dia', SourceProbeStatus.BLOCKED), named)
        .subject
    ).toBe('[production] DIA: the chain refused the probe');
    expect(
      alertMail(probeAlert('chain-lidl', SourceProbeStatus.UNREACHABLE), named)
        .subject
    ).toBe(
      '[production] LIDL: the chain was unreachable for three probes in a row'
    );
    expect(alertMail(slotProbeAlert(), named).subject).toBe(
      '[production] DEZA: a scheduled run was skipped, its probe did not pass'
    );
    expect(alertMail(slotProbeAlert(true), named).subject).toBe(
      '[production] DEZA: the retry of a scheduled run was skipped, its probe did not pass'
    );
  });

  it('holds what to do, the steps, the first problem, the requests and the probe id', () => {
    const { body } = alertMail(
      probeAlert('chain-mercadona', SourceProbeStatus.SHAPE_CHANGED),
      named
    );
    expect(body).toContain(
      PROBE_LEAD_SENTENCES[SourceProbeStatus.SHAPE_CHANGED]
    );
    expect(body).toContain('Chain: Mercadona');
    expect(body).toContain('Status: SHAPE_CHANGED');
    expect(body).toContain('Trigger: SCHEDULED');
    expect(body).toContain('Attempt: 1');
    expect(body).toContain('Steps:\n  warehouse: ok\n  listing: not ok');
    expect(body).toContain(
      'First problem: listing: 2 of 40 rows carried a price above zero'
    );
    expect(body).toContain('Requests: 4');
    expect(body).toContain('Probe id: probe-7');
    expect(body).toContain(
      'Fixtures: npx nx run luna-shopper/mercadona:capture-fixtures'
    );
    expect(body).not.toContain('Run:');
  });

  it('says which kind of probe alerted: a gate probe by its schedule, else daily or manual by the trigger', () => {
    const gate = alertMail(
      probeAlert('chain-mercadona', SourceProbeStatus.SHAPE_CHANGED, {
        scheduleId: 'schedule-3',
      }),
      named
    ).body;
    expect(gate).toContain('Run as the gate of schedule schedule-3');
    expect(gate).not.toContain('Daily probe');

    const daily = alertMail(
      probeAlert('chain-mercadona', SourceProbeStatus.SHAPE_CHANGED, {
        scheduleId: null,
      }),
      named
    ).body;
    expect(daily).toContain('Daily probe');
    expect(daily).not.toContain('Run as the gate');

    const manual = alertMail(
      probeAlert('chain-mercadona', SourceProbeStatus.BLOCKED, {
        scheduleId: null,
        trigger: HarvestRunTrigger.MANUAL,
      }),
      named
    ).body;
    expect(manual).toContain('Manual probe');
  });

  it('names no fixtures target for a refusal or an outage', () => {
    for (const status of [
      SourceProbeStatus.BLOCKED,
      SourceProbeStatus.UNREACHABLE,
    ]) {
      const { body } = alertMail(probeAlert('chain-dia', status), named);
      expect(body).toContain(PROBE_LEAD_SENTENCES[status]);
      expect(body).not.toContain('capture-fixtures');
    }
  });

  it('says three probes in a row for an outage, with the start of the last one, and claims no hour', () => {
    const { body } = alertMail(
      probeAlert('chain-lidl', SourceProbeStatus.UNREACHABLE),
      named
    );
    expect(body).toContain(
      'The chain was unreachable for three probes in a row.'
    );
    expect(body).toContain(
      'The last of them started at 2026-11-05 03:00:00 Madrid time.'
    );
    expect(body).not.toContain('hour');

    const bare = alertMail(
      probeAlert('chain-lidl', SourceProbeStatus.UNREACHABLE, {
        startedAt: null,
      }),
      named
    ).body;
    expect(bare).toContain(PROBE_LEAD_SENTENCES[SourceProbeStatus.UNREACHABLE]);
    expect(bare).not.toContain('The last of them');
  });

  it('holds the slot, the schedule, the preset and the probe of a skipped slot', () => {
    const { body } = alertMail(slotProbeAlert(), named);
    expect(body).toContain(LEAD_SENTENCES[HarvestAlertKind.SLOT_PROBE_FAILED]);
    expect(body).toContain('Schedule: schedule-2');
    expect(body).toContain('Preset: preset-2');
    expect(body).toContain('Slot: 2026-11-05 03:00:00 Madrid time');
    expect(body).toContain('Probe: probe-8');
    expect(body).toContain('Probe status: UNREACHABLE');
    expect(body).toContain('Probe sentence: listing: connect ECONNREFUSED');
  });

  it('maps each adapter to its library project', () => {
    expect(fixturesProjectOf('deza-web')).toBe('luna-shopper/deza');
    expect(fixturesProjectOf('carrefour-web')).toBe('luna-shopper/carrefour');
    expect(fixturesProjectOf(null)).toBeNull();
  });

  it('use no dash as punctuation', () => {
    const DASH_AS_PUNCTUATION = /\s[-–—]\s|[–—]/;
    for (const sentence of Object.values(PROBE_LEAD_SENTENCES)) {
      expect(sentence).not.toMatch(DASH_AS_PUNCTUATION);
    }
    for (const mail of [
      alertMail(
        probeAlert('chain-mercadona', SourceProbeStatus.SHAPE_CHANGED),
        named
      ),
      alertMail(probeAlert('chain-dia', SourceProbeStatus.BLOCKED), named),
      alertMail(probeAlert('chain-lidl', SourceProbeStatus.UNREACHABLE), named),
      alertMail(slotProbeAlert(true), named),
      digestMail(
        [
          probeAlert('chain-deza', SourceProbeStatus.SHAPE_CHANGED),
          slotProbeAlert(),
        ],
        named
      ),
    ]) {
      expect(mail.subject).not.toMatch(DASH_AS_PUNCTUATION);
      expect(mail.body).not.toMatch(DASH_AS_PUNCTUATION);
    }
  });
});

describe('a stale run says when it stopped (plan 0255)', () => {
  const PRESET = '2ddb77c5-f169-468a-a467-376c7521c83e';

  /** The run of 2026-11-06 on slot 4, as the reaper read it. */
  const carrefourStale = (
    over: Record<string, unknown> = {}
  ): AlertForMessage => ({
    ...runAlert(HarvestAlertKind.RUN_STALE),
    supermarketId: 'chain-carrefour',
    runId: '6fd4b58c-0dff-4193-b244-0a97dff3c708',
    payload: {
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      trigger: HarvestRunTrigger.SCHEDULED,
      presetId: PRESET,
      presetName: 'Carrefour catalog',
      scheduleId: 'schedule-1',
      adapterKey: 'carrefour-web',
      requestedAt: '2026-11-06T13:30:30.000Z',
      startedAt: '2026-11-06T13:30:31.000Z',
      finishedAt: '2026-11-06T15:13:05.000Z',
      failed: 1,
      totalPlanned: 18280,
      error:
        'The stale reaper marked the run after no heartbeat for 900 seconds.',
      schedulesStopped: null,
      staleAfterSeconds: 900,
      heartbeatAt: '2026-11-06T13:49:05.000Z',
      processed: 10279,
      created: 0,
      updated: 0,
      ...over,
    },
  });
  const carrefour = context({
    chainName: (id) => (id === 'chain-carrefour' ? 'Carrefour' : null),
  });

  it('reads 18 min to the last heartbeat and names the preset, with the numbers of 2026-11-06', () => {
    const { body } = alertMail(carrefourStale(), carrefour);
    expect(body).toContain(`Preset: Carrefour catalog (${PRESET})`);
    expect(body).toContain('Started: 2026-11-06 14:30:31 Madrid time');
    expect(body).toContain(
      'Last sign of life: 2026-11-06 14:49:05 Madrid time (18 min 34 s after it started)'
    );
    expect(body).toContain(
      'Marked stale: 2026-11-06 16:13:05 Madrid time (1 h 24 min after its last sign of life)'
    );
    expect(body).toContain(
      'Read before it stopped: 10279 of 18280 planned items'
    );
    expect(body).toContain('Rows it left: none');
    expect(body).toContain('Failed: 1 of 18280 planned items');
    expect(body).toContain('Stale window: no heartbeat for 900 seconds');
    // The reap is no longer told as the end of a run of 1 h 42 min.
    expect(body).not.toContain('Finished:');
    expect(body).not.toContain('Duration:');
    expect(body).not.toContain('1 h 42 min');
  });

  it('says how many rows a stale run wrote, created and updated together', () => {
    expect(
      alertMail(carrefourStale({ created: 120, updated: 35 }), carrefour).body
    ).toContain('Rows it left: 155');
    expect(
      alertMail(carrefourStale({ created: 0, updated: 7 }), carrefour).body
    ).toContain('Rows it left: 7');
  });

  it('keeps the uuid line for a preset whose name could not be read', () => {
    for (const presetName of [null, undefined, '']) {
      const { body } = alertMail(carrefourStale({ presetName }), carrefour);
      expect(body).toContain(`Preset: ${PRESET}\n`);
      expect(body).not.toContain('Carrefour catalog');
    }
  });

  it('renders a row written before plan 0255, which holds none of the new facts', () => {
    const old = carrefourStale();
    for (const key of [
      'presetName',
      'heartbeatAt',
      'processed',
      'created',
      'updated',
    ]) {
      delete old.payload[key];
    }
    const { body } = alertMail(old, carrefour);
    expect(body).toContain(`Preset: ${PRESET}\n`);
    expect(body).toContain('Last sign of life: not recorded\n');
    expect(body).toContain('Marked stale: 2026-11-06 16:13:05 Madrid time\n');
    expect(body).toContain('Read before it stopped: not recorded');
    expect(body).toContain('Rows it left: not recorded');
    expect(body).toContain('Failed: 1 of 18280 planned items');
  });

  it('claims no time after the start for a run that never started', () => {
    const { body } = alertMail(
      carrefourStale({ startedAt: null, processed: 0, totalPlanned: null }),
      carrefour
    );
    expect(body).toContain(
      'Last sign of life: 2026-11-06 14:49:05 Madrid time\n'
    );
    expect(body).toContain(
      'Read before it stopped: 0 of an unknown number of planned items'
    );
  });

  it('names the preset in every kind with a preset line, and changes nothing else', () => {
    const named = { presetName: 'Weekly Mercadona' };
    const failed = runAlert(HarvestAlertKind.RUN_FAILED, named);
    const blocked = runAlert(HarvestAlertKind.RUN_BLOCKED, named);
    const refused = slotAlert();
    refused.payload['presetName'] = 'Weekly DEZA';
    const skipped: AlertForMessage = {
      ...slotAlert(),
      kind: HarvestAlertKind.SLOT_PROBE_FAILED,
      payload: { ...slotAlert().payload, presetName: 'Weekly DEZA' },
    };
    expect(alertMail(failed, context()).body).toContain(
      'Preset: Weekly Mercadona (preset-1)'
    );
    expect(alertMail(blocked, context()).body).toContain(
      'Preset: Weekly Mercadona (preset-1)'
    );
    expect(alertMail(refused, context()).body).toContain(
      'Preset: Weekly DEZA (preset-2)'
    );
    expect(alertMail(skipped, context()).body).toContain(
      'Preset: Weekly DEZA (preset-2)'
    );
    // Without the name, each body is the one it was before plan 0255, and a
    // failed run still prints its end and its duration.
    const unnamed = (alert: AlertForMessage) =>
      alertMail(alert, context())
        .body.replace('Preset: Weekly Mercadona (preset-1)', 'Preset: preset-1')
        .replace('Preset: Weekly DEZA (preset-2)', 'Preset: preset-2');
    expect(unnamed(failed)).toBe(
      alertMail(runAlert(HarvestAlertKind.RUN_FAILED), context()).body
    );
    expect(unnamed(refused)).toBe(alertMail(slotAlert(), context()).body);
    expect(alertMail(failed, context()).body).toContain(
      'Finished: 2026-11-05 04:04:10 Madrid time\nDuration: 1 h 4 min'
    );
    expect(alertMail(failed, context()).body).not.toContain(
      'Last sign of life'
    );
  });

  it('use no dash as punctuation', () => {
    const DASH_AS_PUNCTUATION = /\s[-–—]\s|[–—]/;
    for (const mail of [
      alertMail(carrefourStale(), carrefour),
      alertMail(carrefourStale({ created: 3, updated: 4 }), carrefour),
      alertMail(carrefourStale({ heartbeatAt: undefined }), carrefour),
    ]) {
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
