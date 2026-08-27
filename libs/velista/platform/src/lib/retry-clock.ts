/**
 * A wait in seconds as `m:ss`, which is what every `{{wait}}` in this app interpolates.
 *
 * The convention `0009` set, and the reason it is a formatted string rather than a
 * number handed to a translation: neither language owns a clock format inside a
 * translation, and neither needs a plural for one.
 *
 * **Minutes are not capped at sixty**, and that is rule A4 rather than an oversight.
 * The `usernameChange` bucket is five per **hour**, so `41:08` is a real value this has
 * to render; a formatter that wrapped at an hour would quietly turn a forty one minute
 * wait into a plausible looking short one, which is the exact failure rule C3 was
 * written to prevent one order of magnitude down.
 *
 * It lives in `platform` because three places format the same number — the resend
 * sentence in `ui`, the member rename sheet in `feature-zones`, and the account screen
 * and its sheets in `feature-account` — and Sass is not the only thing that cannot
 * cross a library boundary: `feature-zones` and `feature-account` are lazy siblings and
 * neither may import the other's barrel. This is the lowest place all three can reach.
 */
export function retryClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);

  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
