import type { WalkSensorsI } from './walk-sensors';

/**
 * The production stand in for `scripted-walk-loader.ts`: no scripted walk, so
 * the real camera is used whatever the query says.
 */
export function loadScriptedWalkSensors(
  _document: Document,
  _speed: number
): WalkSensorsI | null {
  return null;
}
