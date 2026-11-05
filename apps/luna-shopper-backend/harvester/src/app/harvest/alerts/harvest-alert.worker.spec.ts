import type { ConfigService } from '@nestjs/config';
import {
  HarvestAlertKind,
  HarvestAlertStatus,
  HarvestRunMode,
  HarvestRunTrigger,
} from '@portfolio/luna-shopper/contracts';
import type { HarvestAlertConfig } from '../../config/app-config';
import type { HarvestAlert } from '../../entities';
import type { CatalogClient } from '../catalog-client.service';
import type { AlertChannel } from './alert-mailer';
import {
  FINAL_ALERT_STATUSES,
  type HarvestAlertStore,
} from './harvest-alert.store';
import { HarvestAlertWorker } from './harvest-alert.worker';

/**
 * The worker that sends what the outcomes wrote (plan 0218, section 5).
 *
 * The store is a fake over an array that answers each call the way the SQL
 * does: a claim takes due `PENDING` rows oldest first and marks them
 * `SENDING`, a release puts back rows claimed before its instant, and the
 * sweep deletes final rows created before its cutoff. The transport is a
 * fake that records each mail, and the clock is passed in.
 */

const NOW = new Date('2026-11-05T03:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function alertRow(over: Partial<HarvestAlert> = {}): HarvestAlert {
  return {
    id: `alert-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date(NOW.getTime() - MINUTE),
    updatedAt: new Date(NOW.getTime() - MINUTE),
    kind: HarvestAlertKind.RUN_FAILED,
    dedupeKey: `run:${Math.random()}`,
    status: HarvestAlertStatus.PENDING,
    supermarketId: 'chain-1',
    runId: 'run-1',
    scheduleId: null,
    payload: {
      mode: HarvestRunMode.CATALOG_DISCOVERY,
      trigger: HarvestRunTrigger.MANUAL,
      adapterKey: 'mercadona-api',
      error: 'boom',
    },
    attempts: 0,
    nextAttemptAt: new Date(NOW.getTime() - MINUTE),
    claimedAt: null,
    sentAt: null,
    lastError: null,
    ...over,
  } as HarvestAlert;
}

function fakeStore(rows: HarvestAlert[]) {
  const find = (id: string) =>
    rows.find((row) => row.id === id) as HarvestAlert;
  const store = {
    releaseStuck: jest.fn(async (before: Date) => {
      let count = 0;
      for (const row of rows) {
        if (
          row.status === HarvestAlertStatus.SENDING &&
          row.claimedAt &&
          row.claimedAt < before
        ) {
          row.status = HarvestAlertStatus.PENDING;
          row.claimedAt = null;
          count += 1;
        }
      }
      return count;
    }),
    claim: jest.fn(async (now: Date, limit: number) =>
      rows
        .filter(
          (row) =>
            row.status === HarvestAlertStatus.PENDING &&
            row.nextAttemptAt <= now
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit)
        .map((row) => {
          row.status = HarvestAlertStatus.SENDING;
          row.claimedAt = now;
          return { ...row };
        })
    ),
    markSent: jest.fn(async (ids: readonly string[], at: Date) => {
      for (const id of ids) {
        Object.assign(find(id), {
          status: HarvestAlertStatus.SENT,
          sentAt: at,
        });
      }
    }),
    markSuppressed: jest.fn(async (ids: readonly string[]) => {
      for (const id of ids) {
        find(id).status = HarvestAlertStatus.SUPPRESSED;
      }
    }),
    markFailed: jest.fn(
      async (
        id: string,
        attempts: number,
        error: string,
        next: Date | null
      ) => {
        Object.assign(find(id), {
          status: next
            ? HarvestAlertStatus.PENDING
            : HarvestAlertStatus.GAVE_UP,
          attempts,
          lastError: error,
          nextAttemptAt: next ?? find(id).nextAttemptAt,
          claimedAt: null,
        });
      }
    ),
    deleteFinishedBefore: jest.fn(async (cutoff: Date) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (
          (FINAL_ALERT_STATUSES as readonly HarvestAlertStatus[]).includes(
            row.status
          ) &&
          row.createdAt < cutoff
        ) {
          rows.splice(i, 1);
        }
      }
      return before - rows.length;
    }),
  };
  return store;
}

function build(
  rows: HarvestAlert[],
  options: {
    recipients?: string[];
    smtpHost?: string;
    failSends?: number;
    now?: () => Date;
  } = {}
) {
  const store = fakeStore(rows);
  const sent: { subject: string; body: string }[] = [];
  let failures = options.failSends ?? 0;
  const channel: AlertChannel = {
    send: jest.fn(async (subject: string, body: string) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('421 the relay is busy');
      }
      sent.push({ subject, body });
    }),
  };
  const alerts: HarvestAlertConfig = {
    // Not addresses: the fake channel never reads them, and no address is
    // written anywhere in the repository (the owner, 2026-11-05).
    recipients: options.recipients ?? ['the-recipient'],
    smtp: {
      host: options.smtpHost ?? 'localhost',
      port: 1025,
      user: '',
      pass: '',
      from: 'the-sender',
    },
    environmentName: 'slot6',
    adminAppBaseUrl: '',
  };
  const config = {
    getOrThrow: () => ({ alerts }),
  } as unknown as ConfigService;
  const catalog = {
    getSupermarket: jest.fn(async () => ({ name: { es: 'Mercadona' } })),
  } as unknown as CatalogClient;
  let clock = options.now ?? (() => NOW);
  const worker = new HarvestAlertWorker(
    store as unknown as HarvestAlertStore,
    channel,
    catalog,
    config,
    () => clock()
  );
  return {
    worker,
    store,
    sent,
    channel,
    rows,
    setClock: (next: () => Date) => (clock = next),
  };
}

describe('HarvestAlertWorker', () => {
  it('sends one row as one mail and marks it SENT', async () => {
    const rows = [alertRow()];
    const { worker, sent } = build(rows);

    await worker.tick();

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('[slot6] Mercadona: catalog discovery failed');
    expect(rows[0]).toMatchObject({
      status: HarvestAlertStatus.SENT,
      sentAt: NOW,
    });
  });

  it('sends three rows as three mails, and four rows as one digest', async () => {
    const three = build([alertRow(), alertRow(), alertRow()]);
    await three.worker.tick();
    expect(three.sent).toHaveLength(3);

    const four = build([alertRow(), alertRow(), alertRow(), alertRow()]);
    await four.worker.tick();
    expect(four.sent).toHaveLength(1);
    expect(four.sent[0].subject).toBe('[slot6] 4 harvest alerts');
    expect(
      four.rows.every((row) => row.status === HarvestAlertStatus.SENT)
    ).toBe(true);
  });

  it('marks the rows SUPPRESSED and sends nothing with no address or no SMTP host', async () => {
    const noAddress = build([alertRow(), alertRow()], { recipients: [] });
    await noAddress.worker.tick();
    expect(noAddress.channel.send).not.toHaveBeenCalled();
    expect(
      noAddress.rows.every(
        (row) => row.status === HarvestAlertStatus.SUPPRESSED
      )
    ).toBe(true);

    const noHost = build([alertRow()], { smtpHost: '' });
    await noHost.worker.tick();
    expect(noHost.channel.send).not.toHaveBeenCalled();
    expect(noHost.rows[0].status).toBe(HarvestAlertStatus.SUPPRESSED);
  });

  it('moves nextAttemptAt by 1, 5, 15, 60 and 240 minutes, and gives up after the sixth failure', async () => {
    const rows = [alertRow()];
    let now = NOW;
    const { worker, sent } = build(rows, { failSends: 6, now: () => now });

    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await worker.tick();
      expect(rows[0].status).toBe(HarvestAlertStatus.PENDING);
      expect(rows[0].attempts).toBe(attempt);
      expect(rows[0].lastError).toBe('421 the relay is busy');
      waits.push((rows[0].nextAttemptAt.getTime() - now.getTime()) / MINUTE);
      now = rows[0].nextAttemptAt;
    }
    expect(waits).toEqual([1, 5, 15, 60, 240]);

    await worker.tick();
    expect(rows[0].status).toBe(HarvestAlertStatus.GAVE_UP);
    expect(rows[0].attempts).toBe(6);
    expect(sent).toHaveLength(0);
  });

  it('does not send a row before its nextAttemptAt', async () => {
    const rows = [
      alertRow({ nextAttemptAt: new Date(NOW.getTime() + MINUTE) }),
    ];
    const { worker, sent } = build(rows);
    await worker.tick();
    expect(sent).toHaveLength(0);
    expect(rows[0].status).toBe(HarvestAlertStatus.PENDING);
  });

  it('sends again a SENDING row claimed more than 10 minutes ago, and leaves a younger one', async () => {
    const old = alertRow({
      status: HarvestAlertStatus.SENDING,
      claimedAt: new Date(NOW.getTime() - 11 * MINUTE),
    });
    const young = alertRow({
      status: HarvestAlertStatus.SENDING,
      claimedAt: new Date(NOW.getTime() - 9 * MINUTE),
    });
    const { worker, sent } = build([old, young]);

    await worker.tick();

    expect(sent).toHaveLength(1);
    expect(old.status).toBe(HarvestAlertStatus.SENT);
    expect(young.status).toBe(HarvestAlertStatus.SENDING);
  });

  it('deletes a final row of 91 days and keeps one of 89, once a day', async () => {
    const old = alertRow({
      status: HarvestAlertStatus.SENT,
      createdAt: new Date(NOW.getTime() - 91 * DAY),
    });
    const kept = alertRow({
      status: HarvestAlertStatus.SENT,
      createdAt: new Date(NOW.getTime() - 89 * DAY),
    });
    const pendingOld = alertRow({
      status: HarvestAlertStatus.PENDING,
      createdAt: new Date(NOW.getTime() - 91 * DAY),
      nextAttemptAt: new Date(NOW.getTime() + DAY),
    });
    const rows = [old, kept, pendingOld];
    const { worker, store, setClock } = build(rows);

    await worker.tick();
    expect(rows).toEqual([kept, pendingOld]);

    await worker.tick();
    expect(store.deleteFinishedBefore).toHaveBeenCalledTimes(1);

    setClock(() => new Date(NOW.getTime() + DAY));
    await worker.tick();
    expect(store.deleteFinishedBefore).toHaveBeenCalledTimes(2);
  });

  it('still sends when catalog cannot name the chain', async () => {
    const rows = [alertRow()];
    const harness = build(rows);
    (
      (harness.worker as unknown as { catalog: CatalogClient }).catalog
        .getSupermarket as jest.Mock
    ).mockRejectedValue(new Error('catalog is down'));

    await harness.worker.tick();

    expect(harness.sent[0].subject).toBe(
      '[slot6] mercadona-api: catalog discovery failed'
    );
  });

  it('runs no tick after shutdown', async () => {
    const rows = [alertRow()];
    const { worker, sent } = build(rows);
    worker.onApplicationShutdown();
    await worker.tick();
    expect(sent).toHaveLength(0);
  });
});
