/**
 * Who answers a typed assistant turn, as this app names it (velista `0172`, target 1).
 *
 * Velista's own union rather than the backend's enum (rule D4). The backend serves
 * `anthropic` alone since backend `0236`, and the privacy policy's sentence about
 * training was checked against Anthropic's terms only, so a provider is named exactly
 * when that sentence holds. Anything else maps to null, which the documents read as
 * "the provider's name is not known" and leave out.
 */
export type OperatorAiTextProvider = 'anthropic';

/**
 * What a deployment states about itself for its privacy policy and its terms
 * (velista `0172`, target 1), read from backend `0231`'s `GET /v1/legal/settings`.
 *
 * Luna Shopper is open source and anybody may deploy it, so who runs this copy, how to
 * reach them and which optional parts are on are the operator's facts and never the
 * repository's. Plans `0173` and `0174` read these facts here and nowhere else.
 *
 * A missing feature flag reads as `false`, so a field the server did not send never
 * offers a feature.
 */
export interface OperatorSettings {
  /** The name the documents use. The server falls back to the software's name. */
  readonly appName: string;
  /** The data controller, or null while the operator has set none. */
  readonly controllerName: string | null;
  /** Where a person sends a data request, or null while the operator has set none. */
  readonly contactEmail: string | null;
  /**
   * True when the operator has published the documents: both of the above are set.
   * False is a supported deployment that has published nothing, not a failure.
   */
  readonly published: boolean;
  readonly terms: {
    /** The effective version, what a client sends back when a person accepts. */
    readonly version: string;
    /** `YYYY-MM-DD`, or null when the server sent no readable date. */
    readonly updatedOn: string | null;
    readonly acceptanceRequired: boolean;
  };
  /** `YYYY-MM-DD`, or null when the server sent no readable date. */
  readonly privacyUpdatedOn: string | null;
  readonly features: {
    readonly googleSignIn: boolean;
    readonly assistant: boolean;
    /** Voice: spoken assistant turns and voice comment transcripts. */
    readonly transcription: boolean;
    readonly offsiteBackups: boolean;
    /** Support sessions (backend `0194`). */
    readonly supportAccess: boolean;
  };
  readonly processors: {
    readonly hosting: string | null;
    readonly email: string | null;
    readonly aiText: OperatorAiTextProvider | null;
    readonly offsiteBackups: string | null;
  };
  /** Whole days, each read by the server from the key that enforces it. */
  readonly retention: {
    readonly auditTrailDays: number;
    /**
     * The operator's own failed logins. No document prints it, so a body without it
     * reads as null rather than failing the store.
     */
    readonly adminLoginFailureDays: number | null;
    readonly expiredGrantDays: number;
    readonly applicationLogDays: number;
    readonly assistantLogDays: number;
    /** Null when off site backups are off. */
    readonly backupDays: number | null;
  };
}
