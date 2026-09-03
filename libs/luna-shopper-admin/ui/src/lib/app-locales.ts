/**
 * The locales this app's UI can load (it ships translation assets for each).
 *
 * One, today. Plan 0001 section 3 is why the list exists at all rather than the
 * strings being written into the templates: English is the only locale that
 * exists, hard coding the text would cost almost nothing now and a rewrite later,
 * so the keys go in from the first component.
 *
 * There is **no locale segment in the URL** and no `localeGuard` here, unlike every
 * other app in this workspace. The only thing that segment buys is a shareable URL
 * that opens in a stated language, and there is nothing here to share: one
 * operator, one browser, no links sent to anyone. If a second locale is ever added,
 * the choice lives in `localStorage` under {@link APP_KEY} and is changed inside the
 * app.
 */
export { APP_KEY } from '@portfolio/luna-shopper-admin/models';

export const APP_AVAILABLE_LOCALES: string[] = ['en'];
export const APP_DEFAULT_LOCALE = 'en';
