export interface InfoFact {
  id: string;
  /** Display order in the table. */
  order: number;
  /** Optional icon key resolved to a shared/ui icon in the UI (0003). */
  icon?: string;
}

export interface InfoFactTranslation {
  id: string;
  factId: string;
  locale: string;
  /** e.g. "FOCUS", "STACK". */
  label: string;
  /** e.g. "Web apps & automation". */
  value: string;
  /** Optional secondary line (e.g. "Working remotely"). */
  note?: string;
}

export type TranslatedInfoFact = InfoFact & InfoFactTranslation;
