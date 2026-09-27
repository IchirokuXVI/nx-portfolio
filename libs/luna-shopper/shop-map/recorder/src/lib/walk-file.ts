/**
 * The walk file, recorder plan 0002 section 2, verbatim. It is the contract
 * between the TypeScript and the Kotlin implementations: a field is added only
 * by editing the plan first.
 */
export interface WalkFile {
  format: 'shop-walk';
  version: 1;
  id: string; // a uuid made by the host at the start
  name?: string; // what the person typed, for example "Mercadona Plaza Mayor"
  startedAt: string; // ISO 8601 with offset
  durationMs: number;
  source: {
    platform: 'web' | 'android';
    app: string; // 'velista-walk-lab' | 'shop-walk-android'
    appVersion: string;
    device?: string; // Build.MODEL on Android
    userAgent?: string; // the web host
  };
  /** How the person says they held the phone. Informative. */
  holding?: 'flat' | 'upright';
  settings: { stepMetres: number; cellMetres: number }; // 0.7 and 0.5 by default
  /** The first location fix, when one arrived. */
  origin?: { lat: number; lon: number; accuracyMetres: number };
  streams: {
    motion?: number[][]; // [t, ax, ay, az, gx, gy, gz]
    game?: number[][]; // [t, qx, qy, qz, qw]
    absolute?: number[][]; // [t, qx, qy, qz, qw]
    magnetic?: number[][]; // [t, mx, my, mz] in µT, recorded for later, read by no mode
    steps?: number[]; // [t] of each hardware step detector event
    location?: number[][]; // [t, lat, lon, accuracyMetres]
    pose?: number[][]; // [t, x, y, z, qx, qy, qz, qw]
    pressure?: number[][]; // [t, hPa], recorded for later, read by no mode
  };
  poseSource?: 'arcore' | 'webxr';
  marks: WalkMark[];
  /** What happened to the recording: 'hidden', 'visible', 'tracking-lost',
   * 'tracking-resumed', 'permission-denied', 'sensor-missing', with a detail. */
  events: { t: number; kind: string; detail?: string }[];
}

export interface WalkMark {
  t: number;
  kind: 'entrance' | 'checkout' | 'checkpoint' | 'note';
  /** A checkpoint's name ("door", "fish counter"), or a note's text. */
  label?: string;
}

/** The name of one stream of the file. */
export type StreamName = keyof WalkFile['streams'];
