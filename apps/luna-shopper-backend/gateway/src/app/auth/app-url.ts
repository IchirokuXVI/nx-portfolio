import {
  DEFAULT_LOCALE,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import { APP_BASE_URL_LOCALE_PLACEHOLDER } from '../config/app-config';

/**
 * The address of a page of the app, with a fragment, built from `APP_BASE_URL`
 * and a locale this service resolved, and from nothing a client supplied.
 *
 * That is what keeps a redirect or a link built here from being an open
 * redirect, so both halves matter: the base comes from configuration, and the
 * locale is narrowed to the supported set before it is interpolated.
 *
 * With a `{locale}` placeholder in the base, the locale replaces it. With none,
 * the locale is appended as the first path segment. The Google callback (plan
 * 0023) and the handoff of a support session (plan 0194) both end here.
 */
export function appUrl(
  appBaseUrl: string,
  locale: SupportedLocale | undefined,
  path: string,
  fragment: Record<string, string>
): string {
  const language = locale ?? DEFAULT_LOCALE;
  const base = appBaseUrl.includes(APP_BASE_URL_LOCALE_PLACEHOLDER)
    ? appBaseUrl.replace(APP_BASE_URL_LOCALE_PLACEHOLDER, language)
    : `${appBaseUrl.replace(/\/+$/, '')}/${language}`;
  const params = new URLSearchParams(fragment).toString();
  return `${base.replace(/\/+$/, '')}/${path}#${params}`;
}
