import { type BrowserFacade, StorageKeys } from '@portfolio/velista/platform';

/**
 * The compass baseline this device learned for a walk, in degrees, or null
 * (`StorageKeys.walkBaselines`). Never throws: a record that will not parse is
 * no baseline.
 */
export function readWalkBaseline(
  browser: BrowserFacade,
  walkId: string
): number | null {
  const all = readAll(browser);
  const value = all[walkId];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Keeps a walk's baseline on this device. */
export function writeWalkBaseline(
  browser: BrowserFacade,
  walkId: string,
  degrees: number
): void {
  const all = readAll(browser);
  all[walkId] = Math.round(degrees * 100) / 100;
  browser.writeStorage(StorageKeys.walkBaselines, JSON.stringify(all));
}

function readAll(browser: BrowserFacade): Record<string, unknown> {
  try {
    const raw = browser.readStorage(StorageKeys.walkBaselines);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}
