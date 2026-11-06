/**
 * The OTA manifest of velista `0180`, section 3, as this app holds it.
 *
 * An own model mapped from `unknown` (rule D4). `scripts/ota-bundle.mjs` writes the
 * file; every field here is covered by the signature, because the signature covers
 * the exact bytes and the app verifies before it parses.
 */
export interface OtaManifest {
  readonly schema: 1;
  readonly platform: 'android';
  /** `<VELISTA_APP_VERSION>+<first 12 characters of the commit>` (D8). */
  readonly bundle: string;
  readonly version: string;
  /** The `nativeApi` the bundle was built against, the minimum it needs (D4). */
  readonly nativeApi: number;
  /** Copied from `appData.critical` of the built `ngsw.json` (D6, plan `0034` D3). */
  readonly critical: boolean;
  /** Relative to the manifest, always under `bundles/`. */
  readonly url: string;
  /**
   * The zip's SHA-256, 64 hex characters. The parser accepts either case and
   * lowercases it.
   */
  readonly sha256: string;
  readonly size: number;
  readonly builtAt: string;
}

/** The only schema this build reads. A `schema: 2` is a new app (section 8). */
export const OTA_MANIFEST_SCHEMA = 1;

/** The manifest file and its signature, relative to the OTA base URL. */
export const OTA_MANIFEST_FILE = 'manifest.json';
export const OTA_SIGNATURE_FILE = 'manifest.json.sig';

const SHA256 = /^[0-9a-f]{64}$/i;

/** One or more path segments under `bundles/`, of plain file name characters. */
const BUNDLE_URL = /^bundles(\/[A-Za-z0-9._-]+)+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Relative, under `bundles/`, and never leaving it with a `.` or `..` segment. */
function bundleUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !BUNDLE_URL.test(value)) {
    return null;
  }
  const segments = value.split('/').slice(1);
  return segments.some((segment) => segment === '.' || segment === '..')
    ? null
    : value;
}

/**
 * The manifest, or null for anything this build must not act on.
 *
 * Refuses (section 3): another `schema`, a `platform` other than `android`, a `url`
 * that is absolute or leaves `bundles/`, a `sha256` that is not 64 hex characters, a
 * `nativeApi` that is not a positive integer. Also refuses an empty `bundle` or
 * `version`, the reserved id `builtin`, a `size` that is not a whole number of bytes,
 * and a `critical` that is present and not a boolean. A missing `critical` reads as
 * false, the resting value.
 */
export function parseOtaManifest(raw: unknown): OtaManifest | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (raw['schema'] !== OTA_MANIFEST_SCHEMA || raw['platform'] !== 'android') {
    return null;
  }

  const bundle = nonEmptyString(raw['bundle']);
  const version = nonEmptyString(raw['version']);
  const url = bundleUrl(raw['url']);
  const sha256 = raw['sha256'];
  const nativeApi = raw['nativeApi'];
  const size = raw['size'];
  const critical = raw['critical'] ?? false;
  const builtAt = typeof raw['builtAt'] === 'string' ? raw['builtAt'] : '';

  if (bundle === null || bundle === 'builtin' || version === null) {
    return null;
  }
  if (url === null) {
    return null;
  }
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
    return null;
  }
  if (
    typeof nativeApi !== 'number' ||
    !Number.isInteger(nativeApi) ||
    nativeApi < 1
  ) {
    return null;
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    return null;
  }
  if (typeof critical !== 'boolean') {
    return null;
  }

  return {
    schema: OTA_MANIFEST_SCHEMA,
    platform: 'android',
    bundle,
    version,
    nativeApi,
    critical,
    url,
    sha256: sha256.toLowerCase(),
    size,
    builtAt,
  };
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = globalThis.atob(text.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** The DER body of a PEM `PUBLIC KEY` block, or null when there is none. */
function spkiFromPem(pem: string): Uint8Array<ArrayBuffer> | null {
  const match =
    /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/.exec(pem);
  return match ? decodeBase64(match[1]) : null;
}

function toBytes(value: Uint8Array | string): Uint8Array<ArrayBuffer> {
  return typeof value === 'string'
    ? new Uint8Array(new TextEncoder().encode(value))
    : new Uint8Array(value);
}

/**
 * Whether `signature` is this flavor's ECDSA P-256 signature over the exact bytes of
 * the manifest (D5).
 *
 * - `bytes`: the manifest as served. A string is taken as its UTF-8 bytes, which is
 *   exact for the ASCII file `ota-bundle.mjs` writes.
 * - `signature`: the IEEE P1363 form WebCrypto reads (`r || s`, 64 bytes). A string is
 *   the content of `manifest.json.sig`, which holds that signature **base64 encoded**
 *   on one line, so it survives a text fetch unchanged. Bytes are the raw signature.
 * - `publicKeyPem`: the flavor's key as a PEM SPKI (`-----BEGIN PUBLIC KEY-----`).
 *
 * False for every failure, never a throw: a key that does not import, a signature of
 * the wrong length, a host with no WebCrypto (`subtle` null). It is a parameter only so a spec
 * can hand in Node's.
 */
export async function verifyOtaManifest(
  bytes: Uint8Array | string,
  signature: Uint8Array | string,
  publicKeyPem: string,
  subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null
): Promise<boolean> {
  try {
    if (!subtle) {
      return false;
    }

    const spki = spkiFromPem(publicKeyPem);
    const sig =
      typeof signature === 'string'
        ? decodeBase64(signature.trim())
        : new Uint8Array(signature);
    if (spki === null || sig === null || sig.length !== 64) {
      return false;
    }

    const key = await subtle.importKey(
      'spki',
      spki,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    return await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sig,
      toBytes(bytes)
    );
  } catch {
    return false;
  }
}
