/**
 * What a deployment states about itself for its privacy policy and Terms of
 * Service (plan 0231, section 2).
 *
 * Luna Shopper is open source, and anybody may deploy it. Who runs a
 * deployment, how to reach them and which optional parts are on are facts
 * of the operator, not of the repository. The gateway answers them at the
 * public `GET /v1/legal/settings`, and velista (plan 0172) fills its document
 * templates from the answer.
 */

/** Who answers a typed assistant turn. Wire values; must stay stable. */
export enum AiTextProvider {
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
}

/** The name the documents use when the operator sets none. */
export const DEFAULT_LEGAL_APP_NAME = 'Luna Shopper';

export interface LegalSettingsView {
  /** Defaults to "Luna Shopper". */
  appName: string;
  /** The data controller: a person or a company. Null until the operator sets it. */
  controllerName: string | null;
  /** Where a person sends a data request. Null until the operator sets it. */
  contactEmail: string | null;
  /**
   * True when both of the above are set. False means: draw no documents, say
   * the operator has published none.
   */
  published: boolean;
  terms: {
    /** The effective version of section 1. What a client sends back as `acceptedTermsVersion`. */
    version: string;
    /** `YYYY-MM-DD`. */
    updatedOn: string;
    /** `TERMS_ACCEPTANCE_REQUIRED` of this deployment. */
    acceptanceRequired: boolean;
  };
  privacy: { updatedOn: string };
  features: {
    googleSignIn: boolean;
    assistant: boolean;
    /** Voice: spoken assistant turns and voice comment transcripts. Velista hides voice when false. */
    transcription: boolean;
    offsiteBackups: boolean;
    /** Support sessions (plan 0194). */
    supportAccess: boolean;
  };
  processors: {
    hosting: string | null;
    /** Null means the policy has no email section. */
    email: string | null;
    /** Who answers a typed assistant turn. Null when `features.assistant` is false. */
    aiText: AiTextProvider | null;
    offsiteBackups: string | null;
  };
  retention: {
    auditTrailDays: number;
    adminLoginFailureDays: number;
    expiredGrantDays: number;
    applicationLogDays: number;
    assistantLogDays: number;
    /** Null when `features.offsiteBackups` is false. */
    backupDays: number | null;
  };
}

/**
 * Where this account stands with the Terms (plan 0231, section 4.4), on
 * `GET /v1/account/me`. A guest is an account and reads the same way.
 */
export interface AccountTermsView {
  currentVersion: string;
  acceptedVersion: string | null;
  /** True when `TERMS_ACCEPTANCE_REQUIRED` and `acceptedVersion !== currentVersion`. */
  acceptanceRequired: boolean;
}

/** One recorded acceptance, as `POST /v1/account/terms-acceptances` answers it. */
export interface TermsAcceptanceView {
  version: string;
  acceptedAt: string;
}
