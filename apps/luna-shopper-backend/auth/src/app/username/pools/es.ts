import type { AdjectiveEntry, NounEntry, UsernamePool } from '../pool';

/**
 * The Spanish name pool (plan 0018, section 3.2). Nautical by meaning, written
 * independently of the English pool so the two share no word.
 *
 * Every noun declares its grammatical gender and every adjective carries both
 * forms, because Spanish composition inflects: `Vela Rápida` but `Timón Rápido`.
 * `Ancla` is feminine despite taking `el` (the article shifts for the stressed
 * initial `a`, the agreement does not), so its adjective is the feminine one.
 */

const nouns: NounEntry[] = [
  { word: 'Vela', gender: 'f' },
  { word: 'Timón', gender: 'm' },
  { word: 'Quilla', gender: 'f' },
  { word: 'Mástil', gender: 'm' },
  { word: 'Ancla', gender: 'f' },
  { word: 'Brújula', gender: 'f' },
  { word: 'Faro', gender: 'm' },
  { word: 'Puerto', gender: 'm' },
  { word: 'Bahía', gender: 'f' },
  { word: 'Marea', gender: 'f' },
  { word: 'Corriente', gender: 'f' },
  { word: 'Ráfaga', gender: 'f' },
  { word: 'Brisa', gender: 'f' },
  { word: 'Horizonte', gender: 'm' },
  { word: 'Arrecife', gender: 'm' },
  { word: 'Cala', gender: 'f' },
  { word: 'Estela', gender: 'f' },
  { word: 'Rumbo', gender: 'm' },
  { word: 'Travesía', gender: 'f' },
  { word: 'Sextante', gender: 'm' },
  { word: 'Foque', gender: 'm' },
  { word: 'Cubierta', gender: 'f' },
  { word: 'Proa', gender: 'f' },
  { word: 'Popa', gender: 'f' },
  { word: 'Babor', gender: 'm' },
  { word: 'Estribor', gender: 'm' },
  { word: 'Nudo', gender: 'm' },
  { word: 'Amarra', gender: 'f' },
  { word: 'Bitácora', gender: 'f' },
  { word: 'Escollo', gender: 'm' },
  { word: 'Bruma', gender: 'f' },
  { word: 'Espuma', gender: 'f' },
  { word: 'Oleaje', gender: 'm' },
  { word: 'Marejada', gender: 'f' },
  { word: 'Delfín', gender: 'm' },
  { word: 'Gaviota', gender: 'f' },
  { word: 'Tortuga', gender: 'f' },
  { word: 'Ballena', gender: 'f' },
  { word: 'Caracola', gender: 'f' },
  { word: 'Calamar', gender: 'm' },
];

const adjectives: AdjectiveEntry[] = [
  { m: 'Rápido', f: 'Rápida' },
  { m: 'Sereno', f: 'Serena' },
  { m: 'Brillante', f: 'Brillante' },
  { m: 'Audaz', f: 'Audaz' },
  { m: 'Tranquilo', f: 'Tranquila' },
  { m: 'Profundo', f: 'Profunda' },
  { m: 'Plateado', f: 'Plateada' },
  { m: 'Dorado', f: 'Dorada' },
  { m: 'Inquieto', f: 'Inquieta' },
  { m: 'Lejano', f: 'Lejana' },
  { m: 'Ágil', f: 'Ágil' },
  { m: 'Valiente', f: 'Valiente' },
  { m: 'Silencioso', f: 'Silenciosa' },
  { m: 'Errante', f: 'Errante' },
  { m: 'Salado', f: 'Salada' },
  { m: 'Tormentoso', f: 'Tormentosa' },
  { m: 'Soleado', f: 'Soleada' },
  { m: 'Nocturno', f: 'Nocturna' },
  { m: 'Antiguo', f: 'Antigua' },
  { m: 'Ligero', f: 'Ligera' },
  { m: 'Astuto', f: 'Astuta' },
  { m: 'Afortunado', f: 'Afortunada' },
  { m: 'Paciente', f: 'Paciente' },
  { m: 'Sabio', f: 'Sabia' },
  { m: 'Norteño', f: 'Norteña' },
];

export const esPool: UsernamePool = {
  nouns,
  adjectives,
  /** Spanish puts the adjective after the noun and agrees with its gender. */
  compose: (noun, adjective) =>
    `${noun.word} ${noun.gender === 'f' ? (adjective.f ?? adjective.m) : adjective.m}`,
};
