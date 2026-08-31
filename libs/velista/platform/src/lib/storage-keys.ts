import { APP_KEY } from '@portfolio/velista/models';

/**
 * Every key this app writes to browser storage, in one place.
 *
 * All of them are namespaced with `APP_KEY`, and that is load bearing rather than
 * tidiness: while the app runs as a remote it shares an origin with the whole
 * portfolio, so an unnamespaced key collides with the shell and with every other
 * remote (plan 0004, section 5.3).
 *
 * The names describe the **role** of what is stored, never the product, so a rename
 * stays a data edit (rule N1, plan 0001).
 *
 * The shape is `{role}:{appKey}`, following the convention `RokuTranslator` already
 * set with `roku-locale:{appKey}`
 * (`libs/shared/localization/rokutranslator-angular/src/lib/locale-routing/app-locale-storage.ts:1`).
 * Plan 0002 landed its theme key the other way round, as `{appKey}:theme`; merging the
 * two plans is where that showed up, and one convention per app is worth more than
 * either ordering, so the theme key moved here. Nothing had shipped, so no stored
 * preference was orphaned.
 */
export const StorageKeys = {
  /** The persisted token pair. See plan 0004 section 5.3 for why it is here at all. */
  session: `session:${APP_KEY}`,
  /** The user's explicit theme choice, overriding the system preference (plan 0002). */
  theme: `theme:${APP_KEY}`,
  /** The last list the user opened, so the home page can offer to resume it (plan 0003). */
  lastList: `last-list:${APP_KEY}`,
  /**
   * That `appinstalled` fired on this origin (plan 0033, section 2.4).
   *
   * The event fires once, in the tab that installed, and the installed window is a
   * separate document that never sees it, so without this the belief would last until
   * the next reload. There is no matching uninstall event anywhere, which is why every
   * screen that renders it has to stay useful when it is wrong (rule I4).
   */
  installed: `installed:${APP_KEY}`,
  /**
   * Whether a silence ends the recording and sends it (plan 0038's original
   * behaviour, now a choice).
   *
   * Off unless it is stored, because the plain recorder is the one somebody who has
   * never opened settings should get: a microphone that sends on its own surprises
   * people who paused to think about the next item.
   */
  voiceSendOnSilence: `voice-send-on-silence:${APP_KEY}`,
  /** Whether the microphone reopens after a recording is sent. Off unless stored. */
  voiceKeepListening: `voice-keep-listening:${APP_KEY}`,
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
