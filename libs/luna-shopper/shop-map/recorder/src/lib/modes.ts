import type { ModeDescription, ModeId } from './track-types';
import type { WalkFile } from './walk-file';

export function availableModes(walk: WalkFile): ModeId[] {
  void walk;
  throw new Error('not implemented');
}

export function describeMode(mode: ModeId): ModeDescription {
  void mode;
  throw new Error('not implemented');
}
