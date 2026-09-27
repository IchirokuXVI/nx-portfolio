import type { Track } from './track-types';
import type { WalkFile } from './walk-file';

export type WalkFileErrorCode =
  | 'NOT_JSON'
  | 'UNKNOWN_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID';

export class WalkFileError extends Error {
  constructor(
    public readonly code: WalkFileErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WalkFileError';
  }
}

export type WalkImport =
  | { kind: 'walk'; walk: WalkFile }
  | { kind: 'tracks'; tracks: Track[] };

export function parseWalkImport(text: string): WalkImport {
  void text;
  throw new Error('not implemented');
}

export function walkFileName(walk: WalkFile): string {
  void walk;
  throw new Error('not implemented');
}
