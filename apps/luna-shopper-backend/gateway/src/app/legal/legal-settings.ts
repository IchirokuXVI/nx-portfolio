import type {
  AssistantCapabilities,
  LegalSettingsView,
} from '@portfolio/luna-shopper/contracts';
import type { LegalConfig } from '../config/legal-config';

/**
 * What the route serves before the assistant first answered (plan 0231,
 * section 3). `assistant: true`, because a policy that describes an assistant
 * that is off says too much, which is the harmless direction; `transcription:
 * false`, because a voice button that does nothing is the harmful direction
 * for the UI. No provider is named, because none is known.
 */
export const CAPABILITIES_FALLBACK: AssistantCapabilities = {
  answers: true,
  hears: false,
  textProvider: null,
};

/**
 * The public settings (plan 0231, section 2), composed from the gateway's own
 * configuration and the assistant's last answer. A pure function, so the
 * route and its spec share every rule.
 */
export function composeLegalSettings(
  legal: LegalConfig,
  googleSignIn: boolean,
  capabilities: AssistantCapabilities | null
): LegalSettingsView {
  const assistant = capabilities ?? CAPABILITIES_FALLBACK;
  return {
    appName: legal.appName,
    controllerName: legal.controllerName,
    contactEmail: legal.contactEmail,
    published: legal.controllerName !== null && legal.contactEmail !== null,
    terms: { ...legal.terms },
    privacy: { updatedOn: legal.privacyUpdatedOn },
    features: {
      googleSignIn,
      assistant: assistant.answers,
      transcription: assistant.hears,
      offsiteBackups: legal.offsiteBackups,
      supportAccess: legal.supportAccess,
    },
    processors: {
      hosting: legal.hostingProvider,
      email: legal.emailProvider,
      aiText: assistant.answers ? assistant.textProvider : null,
      offsiteBackups: legal.offsiteBackups ? legal.backupProvider : null,
    },
    retention: {
      ...legal.retention,
      backupDays: legal.offsiteBackups ? legal.retention.backupDays : null,
    },
  };
}
