import {
  HarvestDetailFetch,
  HarvestRunMode,
  HarvestRunWrites,
  type HarvestRunPresetInput,
  type ScopeCopy,
} from '@portfolio/luna-shopper/contracts';

/** A stored field that is not the type it should be. */
class Unreadable extends Error {}

/**
 * The run's own request, read back from `harvest_runs.input` in a preset's
 * input shape (owner decision 114a), or null when it cannot be read.
 *
 * **A record of what ran, not a request.** It has a preset's input type for
 * its shape only, and it states resolved values (`writes` and `details` are
 * always there). The spawn refuses some of them for some chains, so it must
 * never be resubmitted as a run request or saved as a preset.
 *
 * **Read, never trusted.** The column is a free JSON bag that has changed
 * shape across plans. A field that is absent is left out, or given the value
 * its runner reads in its place. A field of the wrong type makes the whole
 * input null, and that is stricter than the executor: a stored
 * `postalCodes: [14013]` of numbers reads as null here, although the run that
 * stored it ran. Null is the honest answer then: a run whose request is
 * partly read would be drawn as a run that asked for less.
 *
 * What the spawn stores beside the request and a preset does not hold is left
 * out: the chain (the run's own column), a file import's document (its digest
 * is the run's `documentSha256`), source kind and window.
 */
export function readRunInput(
  mode: HarvestRunMode,
  stored: unknown
): HarvestRunPresetInput | null {
  if (!isBag(stored)) {
    return null;
  }
  try {
    switch (mode) {
      case HarvestRunMode.CATALOG_DISCOVERY:
        return readCatalogInput(stored);
      case HarvestRunMode.STORE_DISCOVERY:
        return readStoreInput(stored);
      case HarvestRunMode.FILE_IMPORT:
        return {
          mode,
          ...optionalId('priceScopeId', stored['priceScopeId']),
        };
      default:
        // A mode this build does not know, such as a row of a mode a plan
        // deleted.
        return null;
    }
  } catch (error) {
    if (error instanceof Unreadable) {
      return null;
    }
    throw error;
  }
}

/**
 * What `HarvestRunService.validate` stores for a walk. `writes` and `details`
 * absent are what the executor reads for a run stored before they existed
 * (`readWrites`, `readDetails`): both writes, every detail.
 */
function readCatalogInput(
  stored: Record<string, unknown>
): HarvestRunPresetInput {
  const priceScopeIds = stringList(stored['priceScopeIds']);
  const scopeCopies = copyList(stored['scopeCopies']);
  const detailBackfill = optionalBoolean(stored['detailBackfill']);
  return {
    mode: HarvestRunMode.CATALOG_DISCOVERY,
    ...optionalId('priceScopeId', stored['priceScopeId']),
    ...(priceScopeIds.length > 0 ? { priceScopeIds } : {}),
    ...(detailBackfill ? { detailBackfill } : {}),
    ...(scopeCopies.length > 0 ? { scopeCopies } : {}),
    writes: enumValue(
      stored['writes'],
      Object.values(HarvestRunWrites),
      HarvestRunWrites.PRICES_AND_AVAILABILITY
    ),
    details: enumValue(
      stored['details'],
      Object.values(HarvestDetailFetch),
      HarvestDetailFetch.ALL
    ),
  };
}

/**
 * What the spawn stores for a store discovery. The executor reads a missing
 * centre as empty, a missing country as `es` and a missing radius as 3000, and
 * so does this.
 */
function readStoreInput(
  stored: Record<string, unknown>
): HarvestRunPresetInput {
  const postalCode = optionalString(stored['postalCode']) ?? '';
  const radius = stored['radiusMetres'];
  if (
    radius !== undefined &&
    !(typeof radius === 'number' && Number.isInteger(radius) && radius > 0)
  ) {
    throw new Unreadable();
  }
  return {
    mode: HarvestRunMode.STORE_DISCOVERY,
    ...(postalCode !== '' ? { postalCode } : {}),
    country: optionalString(stored['country']) ?? 'es',
    radiusMetres: radius ?? 3000,
    brandKeys: stringList(stored['brandKeys']),
    postalCodes: stringList(stored['postalCodes']),
  };
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Unreadable();
  }
  return value;
}

/** A scope id the spawn stores as null when none was given. */
function optionalId(
  key: 'priceScopeId',
  value: unknown
): Partial<Record<'priceScopeId', string>> {
  const id = optionalString(value);
  return id ? { [key]: id } : {};
}

function optionalBoolean(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new Unreadable();
  }
  return value;
}

function stringList(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Unreadable();
  }
  return [...value];
}

function copyList(value: unknown): ScopeCopy[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Unreadable();
  }
  return value.map((copy) => {
    if (!isBag(copy) || typeof copy['from'] !== 'string') {
      throw new Unreadable();
    }
    return { from: copy['from'], to: stringList(copy['to']) };
  });
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  absent: T
): T {
  if (value === undefined || value === null) {
    return absent;
  }
  if (!allowed.includes(value as T)) {
    throw new Unreadable();
  }
  return value as T;
}
