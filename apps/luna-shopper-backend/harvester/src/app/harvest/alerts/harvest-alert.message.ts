import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunTrigger,
  SourceProbeStatus,
} from '@portfolio/luna-shopper/contracts';
import { SCHEDULES_STOP_AFTER } from './harvest-alert.rules';

/**
 * The subject and the body of an alert mail, as pure functions (plan 0218,
 * section 6).
 *
 * Plain text in English, read on a phone. Times are in `Europe/Madrid`. The
 * payload is a stored jsonb column, so every field is read defensively: a
 * missing fact prints as "not recorded" and never stops a mail.
 *
 * No fixed sentence here uses a dash as punctuation. The spec checks it.
 */

/** One alert as the message needs it. */
export interface AlertForMessage {
  kind: HarvestAlertKind;
  supermarketId: string | null;
  runId: string | null;
  scheduleId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** What the message knows about the deployment. */
export interface MessageContext {
  /** `ENVIRONMENT_NAME`: `production`, `staging`, or `slot<n>`. */
  environmentName: string;
  /** The back office origin, or empty. With it empty the body names the run id only. */
  adminAppBaseUrl: string;
  /**
   * The chain's name as catalog states it at send time, or null when it could
   * not be read. A name is never a reason not to send: the message falls back
   * to the adapter key.
   */
  chainName: (supermarketId: string) => string | null;
}

export interface AlertMail {
  subject: string;
  body: string;
}

/** The time zone every time in a mail is written in. */
export const ALERT_TIME_ZONE = 'Europe/Madrid';

/** The sentence a run alert opens with, per kind. Exported for the spec. */
export const LEAD_SENTENCES: Readonly<Record<HarvestAlertKind, string>> = {
  [HarvestAlertKind.RUN_FAILED]:
    'A harvest run ended FAILED. Read the error below, fix its cause, and start the run again from the back office.',
  [HarvestAlertKind.RUN_BLOCKED]:
    'The chain kept refusing requests, so the run stopped. Wait, and look at the chain before you start the run again: a run started at once is likely to be refused too.',
  [HarvestAlertKind.RUN_STALE]:
    'The stale reaper marked this run STALE, because its heartbeat stopped. The scheduler starts a scheduled run again one time while its slot is young enough. Start any other run again by hand.',
  [HarvestAlertKind.POSTAL_CODE_FAILED]:
    'The postal code queue gave up on this code after its last attempt. The code stays FAILED until a person queues it again from the back office.',
  [HarvestAlertKind.SLOT_REFUSED]:
    'A schedule reached its slot and could not start its run. This mail does not repeat until the schedule starts a run or the reason changes.',
  [HarvestAlertKind.TEST]:
    'This is a test alert from the harvester. If you can read it, harvest alerts reach this address.',
  [HarvestAlertKind.PROBE_FAILED]:
    'A probe of the chain did not pass. Read the steps below.',
  [HarvestAlertKind.SLOT_PROBE_FAILED]:
    'A schedule reached its slot and ran no walk, because the probe of the chain did not pass. The next slot tries again, and this mail does not repeat while the probe keeps the same status.',
};

/**
 * The sentence a probe alert opens with, by the probe's status (plan 0247,
 * section 4.4). Each one says what to do. Exported for the spec.
 */
export const PROBE_LEAD_SENTENCES: Readonly<
  Partial<Record<SourceProbeStatus, string>>
> = {
  [SourceProbeStatus.SHAPE_CHANGED]:
    'The probe read the storefront and found it changed shape, so a walk would store little or mark products wrong. Run the capture fixtures target of the library named below and read the diff of its fixtures.',
  [SourceProbeStatus.BLOCKED]:
    'The chain refused the probe. Wait: the daily probe says when the chain answers again, and a run started now is likely to be refused too.',
  [SourceProbeStatus.UNREACHABLE]:
    'The chain was unreachable for three probes in a row. The daily probe keeps looking, and nothing is to be done here until the chain answers.',
};

/**
 * The lead of an `UNREACHABLE` alert, with the start of the last probe when
 * the payload holds it. Three probes in a row is all the attempt proves: a
 * probe a slot runs joins the series with no wait, so the three can be
 * minutes apart and not an hour. The payload does not hold the start of the
 * first probe of the series, so the mail does not name it.
 */
function unreachableLead(
  sentence: string,
  payload: Record<string, unknown>
): string {
  const last = toDate(payload['startedAt']);
  if (last) {
    return `${sentence} The last of them started at ${madridTime(last)}.`;
  }
  return sentence;
}

/** The Nx project whose `capture-fixtures` target refreshes a chain's fixtures. */
export function fixturesProjectOf(adapterKey: unknown): string | null {
  if (typeof adapterKey !== 'string' || !adapterKey) {
    return null;
  }
  const library = adapterKey.split('-')[0];
  return library ? `luna-shopper/${library}` : null;
}

/** The sentence a run that stopped the chain's schedules adds (section 2.2). */
export function schedulesStoppedSentence(count: number): string {
  const schedules = count === 1 ? 'the 1 schedule' : `the ${count} schedules`;
  return (
    `This was failure ${SCHEDULES_STOP_AFTER} in a row for this chain, so ` +
    `${schedules} of the chain stopped. Start the preset by hand: the first ` +
    'run that completes lets the schedules fire again.'
  );
}

/** The mail of one alert. */
export function alertMail(
  alert: AlertForMessage,
  context: MessageContext
): AlertMail {
  return {
    subject: `[${context.environmentName}] ${headline(alert, context)}`,
    body: `${bodyOf(alert, context)}\n\n${footer(context)}`,
  };
}

/** One mail for several alerts, oldest first (section 5). */
export function digestMail(
  alerts: readonly AlertForMessage[],
  context: MessageContext
): AlertMail {
  const ordered = [...alerts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const parts = ordered.map(
    (alert, index) =>
      `Alert ${index + 1} of ${ordered.length}: ${headline(alert, context)}\n\n` +
      bodyOf(alert, context)
  );
  return {
    subject: `[${context.environmentName}] ${ordered.length} harvest alerts`,
    body:
      `${ordered.length} harvest alerts were due at the same time. They ` +
      'follow, oldest first.\n\n' +
      parts.join('\n\n\n') +
      `\n\n${footer(context)}`,
  };
}

/** The subject without the environment, which a digest reuses per alert. */
function headline(alert: AlertForMessage, context: MessageContext): string {
  const p = alert.payload;
  switch (alert.kind) {
    case HarvestAlertKind.RUN_FAILED:
      return `${chainOf(alert, context)}: ${modeLabel(p['mode'])} failed${stoppedClause(p)}`;
    case HarvestAlertKind.RUN_BLOCKED:
      return `${chainOf(alert, context)}: the chain refused the run${stoppedClause(p)}`;
    case HarvestAlertKind.RUN_STALE:
      return `${chainOf(alert, context)}: ${modeLabel(p['mode'])} went stale`;
    case HarvestAlertKind.SLOT_REFUSED:
      return p['retry'] === true
        ? `${chainOf(alert, context)}: the retry of a scheduled run was refused`
        : `${chainOf(alert, context)}: a scheduled run was refused`;
    case HarvestAlertKind.POSTAL_CODE_FAILED:
      return (
        `Postal code ${text(p['postalCode'])}: store discovery gave up after ` +
        `${attemptsLabel(p['attempts'])}`
      );
    case HarvestAlertKind.TEST:
      return 'Harvest alerts: a test mail';
    case HarvestAlertKind.PROBE_FAILED:
      return `${chainOf(alert, context)}: ${probeHeadline(p['status'])}`;
    case HarvestAlertKind.SLOT_PROBE_FAILED:
      return p['retry'] === true
        ? `${chainOf(alert, context)}: the retry of a scheduled run was skipped, its probe did not pass`
        : `${chainOf(alert, context)}: a scheduled run was skipped, its probe did not pass`;
    default:
      return `Harvest alert ${String(alert.kind)}`;
  }
}

/** What a probe alert says happened, by the probe's status. */
function probeHeadline(status: unknown): string {
  switch (status) {
    case SourceProbeStatus.SHAPE_CHANGED:
      return 'the storefront changed shape';
    case SourceProbeStatus.BLOCKED:
      return 'the chain refused the probe';
    case SourceProbeStatus.UNREACHABLE:
      return 'the chain was unreachable for three probes in a row';
    default:
      return `a probe ended ${text(status)}`;
  }
}

function bodyOf(alert: AlertForMessage, context: MessageContext): string {
  const p = alert.payload;
  const lead = LEAD_SENTENCES[alert.kind] ?? 'A harvest alert.';
  const lines: string[] = [];
  switch (alert.kind) {
    case HarvestAlertKind.RUN_FAILED:
    case HarvestAlertKind.RUN_BLOCKED:
    case HarvestAlertKind.RUN_STALE: {
      lines.push(`Chain: ${chainOf(alert, context)}`);
      lines.push(`Mode: ${modeLabel(p['mode'])}`);
      lines.push(`Trigger: ${text(p['trigger'])}`);
      if (p['presetId']) {
        lines.push(presetLine(p));
      }
      if (p['scheduleId']) {
        lines.push(`Schedule: ${text(p['scheduleId'])}`);
      }
      lines.push(`Requested: ${madridTime(p['requestedAt'])}`);
      lines.push(`Started: ${madridTime(p['startedAt'])}`);
      if (alert.kind === HarvestAlertKind.RUN_STALE) {
        lines.push(...staleLines(p));
      } else {
        lines.push(`Finished: ${madridTime(p['finishedAt'])}`);
        lines.push(`Duration: ${durationOf(p['startedAt'], p['finishedAt'])}`);
      }
      lines.push(
        `Failed: ${numberOr(p['failed'], 0)} of ${
          typeof p['totalPlanned'] === 'number'
            ? p['totalPlanned']
            : 'an unknown number of'
        } planned items`
      );
      if (alert.kind === HarvestAlertKind.RUN_STALE) {
        lines.push(
          `Stale window: no heartbeat for ${
            typeof p['staleAfterSeconds'] === 'number'
              ? `${p['staleAfterSeconds']} seconds`
              : 'the stale window'
          }`
        );
      }
      lines.push(`Error: ${text(p['error'])}`);
      const stopped = p['schedulesStopped'];
      const sections = [lead, lines.join('\n')];
      if (typeof stopped === 'number' && stopped > 0) {
        sections.push(schedulesStoppedSentence(stopped));
      }
      sections.push(runLine(alert.runId, context));
      return sections.join('\n\n');
    }
    case HarvestAlertKind.SLOT_REFUSED: {
      lines.push(`Chain: ${chainOf(alert, context)}`);
      lines.push(`Schedule: ${text(p['scheduleId'] ?? alert.scheduleId)}`);
      lines.push(presetLine(p));
      lines.push(
        `${p['retry'] === true ? 'Retry of the slot' : 'Slot'}: ${madridTime(p['slot'])}`
      );
      lines.push(`Reason: ${text(p['note'])}`);
      return [lead, lines.join('\n')].join('\n\n');
    }
    case HarvestAlertKind.POSTAL_CODE_FAILED: {
      lines.push(
        `Postal code: ${text(p['postalCode'])} (${text(p['country'])})`
      );
      lines.push(`Attempts: ${numberOr(p['attempts'], 0)}`);
      lines.push(`Last error: ${text(p['error'])}`);
      const sections = [lead, lines.join('\n')];
      if (alert.runId) {
        sections.push(runLine(alert.runId, context));
      }
      return sections.join('\n\n');
    }
    case HarvestAlertKind.TEST: {
      lines.push(`Requested: ${madridTime(p['at'] ?? alert.createdAt)}`);
      lines.push(`Environment: ${context.environmentName}`);
      return [lead, lines.join('\n')].join('\n\n');
    }
    case HarvestAlertKind.PROBE_FAILED: {
      const status = p['status'];
      const statusLead =
        typeof status === 'string'
          ? (PROBE_LEAD_SENTENCES[status as SourceProbeStatus] ?? lead)
          : lead;
      const probeLead =
        status === SourceProbeStatus.UNREACHABLE
          ? unreachableLead(statusLead, p)
          : statusLead;
      lines.push(`Chain: ${chainOf(alert, context)}`);
      lines.push(`Status: ${text(status)}`);
      if (p['previousStatus']) {
        lines.push(`Before: ${text(p['previousStatus'])}`);
      }
      lines.push(`Trigger: ${text(p['trigger'])}`);
      const kindLine = probeKindLine(p);
      if (kindLine) {
        lines.push(kindLine);
      }
      lines.push(`Attempt: ${numberOr(p['attempt'], 1)}`);
      lines.push(`Started: ${madridTime(p['startedAt'])}`);
      lines.push(`Finished: ${madridTime(p['finishedAt'])}`);
      lines.push(`Steps:\n${stepLines(p['steps'])}`);
      lines.push(`First problem: ${text(p['error'])}`);
      lines.push(`Requests: ${numberOr(p['requests'], 0)}`);
      lines.push(`Probe id: ${text(p['probeId'])}`);
      const sections = [probeLead, lines.join('\n')];
      const project = fixturesProjectOf(p['adapterKey']);
      if (status === SourceProbeStatus.SHAPE_CHANGED && project) {
        sections.push(`Fixtures: npx nx run ${project}:capture-fixtures`);
      }
      return sections.join('\n\n');
    }
    case HarvestAlertKind.SLOT_PROBE_FAILED: {
      lines.push(`Chain: ${chainOf(alert, context)}`);
      lines.push(`Schedule: ${text(p['scheduleId'] ?? alert.scheduleId)}`);
      lines.push(presetLine(p));
      lines.push(
        `${p['retry'] === true ? 'Retry of the slot' : 'Slot'}: ${madridTime(p['slot'])}`
      );
      if (p['probeId']) {
        lines.push(`Probe: ${text(p['probeId'])}`);
        lines.push(`Probe status: ${text(p['probeStatus'])}`);
        lines.push(`Probe sentence: ${text(p['probeError'])}`);
      } else {
        lines.push(`Reason: ${text(p['note'])}`);
      }
      return [lead, lines.join('\n')].join('\n\n');
    }
    default:
      return lead;
  }
}

/**
 * Which kind of probe alerted (the owner, 2026-11-06). A gate probe and a
 * daily probe both carry trigger `SCHEDULED`, and only the schedule id tells
 * them apart. Null for a payload that names neither.
 */
function probeKindLine(payload: Record<string, unknown>): string | null {
  const scheduleId = payload['scheduleId'];
  if (typeof scheduleId === 'string' && scheduleId !== '') {
    return `Run as the gate of schedule ${scheduleId}`;
  }
  switch (payload['trigger']) {
    case HarvestRunTrigger.SCHEDULED:
      return 'Daily probe';
    case HarvestRunTrigger.MANUAL:
      return 'Manual probe';
    default:
      return null;
  }
}

/** One line per probe step, `  listing: ok` or `  listing: not ok`. */
function stepLines(steps: unknown): string {
  if (!Array.isArray(steps) || steps.length === 0) {
    return '  none recorded';
  }
  return steps
    .map((step) => {
      const record = (step ?? {}) as Record<string, unknown>;
      return `  ${text(record['name'])}: ${record['ok'] === true ? 'ok' : 'not ok'}`;
    })
    .join('\n');
}

/**
 * `Preset: <name> (<uuid>)`, or `Preset: <uuid>` when the payload holds no
 * name: a preset deleted since, a name that could not be read, or a row
 * written before plan 0255.
 */
function presetLine(payload: Record<string, unknown>): string {
  const id = text(payload['presetId']);
  const name = payload['presetName'];
  return typeof name === 'string' && name.trim() !== ''
    ? `Preset: ${name.trim()} (${id})`
    : `Preset: ${id}`;
}

/**
 * The lines a stale run prints in place of `Finished` and `Duration` (plan
 * 0255, section 1). The reap time says nothing about when the run stopped,
 * so the mail says when it last showed life, what it had read by then, and
 * what it left. A row written before plan 0255 holds none of the new facts,
 * and each of them then prints as "not recorded".
 */
function staleLines(payload: Record<string, unknown>): string[] {
  const started = payload['startedAt'];
  const reaped = payload['finishedAt'];
  const last = toDate(payload['heartbeatAt']);
  const ran = last ? durationOf(started, last) : 'not recorded';
  const dead = last ? durationOf(last, reaped) : 'not recorded';
  return [
    `Last sign of life: ${madridTime(last)}${
      ran === 'not recorded' ? '' : ` (${ran} after it started)`
    }`,
    `Marked stale: ${madridTime(reaped)}${
      dead === 'not recorded' ? '' : ` (${dead} after its last sign of life)`
    }`,
    `Read before it stopped: ${readLabel(payload)}`,
    `Rows it left: ${rowsLabel(payload)}`,
  ];
}

/** `10279 of 18280 planned items`, or "not recorded". */
function readLabel(payload: Record<string, unknown>): string {
  const processed = payload['processed'];
  if (typeof processed !== 'number' || !Number.isFinite(processed)) {
    return 'not recorded';
  }
  const planned = payload['totalPlanned'];
  return `${processed} of ${
    typeof planned === 'number' ? planned : 'an unknown number of'
  } planned items`;
}

/**
 * The rows the run wrote, `created + updated`, or "none" when both are 0.
 * Which chains write only at the end is not guessed: the line states the
 * run's counters.
 */
function rowsLabel(payload: Record<string, unknown>): string {
  const counts = [payload['created'], payload['updated']].filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value)
  );
  if (counts.length === 0) {
    return 'not recorded';
  }
  const rows = counts.reduce((sum, value) => sum + value, 0);
  return rows === 0 ? 'none' : String(rows);
}

function footer(context: MessageContext): string {
  return `Sent by the harvester of ${context.environmentName}.`;
}

/** The run link, or the run id when no base URL is configured. */
function runLine(runId: string | null, context: MessageContext): string {
  if (!runId) {
    return 'Run: none';
  }
  const base = context.adminAppBaseUrl.trim().replace(/\/+$/, '');
  return base ? `Run: ${base}/harvest/runs/${runId}` : `Run id: ${runId}`;
}

/** ", and its N schedules stopped" for a failure that stopped them. */
function stoppedClause(payload: Record<string, unknown>): string {
  const stopped = payload['schedulesStopped'];
  if (typeof stopped !== 'number' || stopped <= 0) {
    return '';
  }
  return stopped === 1
    ? ', and its schedule stopped'
    : `, and its ${stopped} schedules stopped`;
}

/**
 * The chain as a person reads it: catalog's name, else the adapter key, else
 * OpenStreetMap for a run with no chain.
 */
function chainOf(alert: AlertForMessage, context: MessageContext): string {
  if (alert.supermarketId) {
    const name = context.chainName(alert.supermarketId);
    if (name) {
      return name;
    }
  }
  const adapterKey = alert.payload['adapterKey'];
  if (typeof adapterKey === 'string' && adapterKey) {
    return adapterKey;
  }
  return alert.supermarketId ? alert.supermarketId : 'OpenStreetMap';
}

const MODE_LABELS: Readonly<Record<string, string>> = {
  [HarvestRunMode.STORE_DISCOVERY]: 'store discovery',
  [HarvestRunMode.CATALOG_DISCOVERY]: 'catalog discovery',
  [HarvestRunMode.FILE_IMPORT]: 'file import',
};

function modeLabel(mode: unknown): string {
  if (typeof mode !== 'string' || !mode) {
    return 'a harvest run';
  }
  return MODE_LABELS[mode] ?? mode.toLowerCase().replace(/_/g, ' ');
}

function attemptsLabel(attempts: unknown): string {
  const n = numberOr(attempts, 0);
  return n === 1 ? '1 attempt' : `${n} attempts`;
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'not recorded';
  }
  return String(value);
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MADRID = new Intl.DateTimeFormat('en-GB', {
  timeZone: ALERT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `2026-11-05 03:00:12 Madrid time`, or "not recorded". */
export function madridTime(value: unknown): string {
  const date = toDate(value);
  if (!date) {
    return 'not recorded';
  }
  const parts = Object.fromEntries(
    MADRID.formatToParts(date).map((part) => [part.type, part.value])
  );
  return (
    `${parts['year']}-${parts['month']}-${parts['day']} ` +
    `${parts['hour']}:${parts['minute']}:${parts['second']} Madrid time`
  );
}

/** `1 h 4 min`, `3 min 12 s`, `45 s`, or "not recorded". */
export function durationOf(startedAt: unknown, finishedAt: unknown): string {
  const start = toDate(startedAt);
  const end = toDate(finishedAt);
  if (!start || !end || end.getTime() < start.getTime()) {
    return 'not recorded';
  }
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${rest} s`;
  }
  return `${rest} s`;
}
