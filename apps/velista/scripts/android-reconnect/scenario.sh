#!/usr/bin/env bash
# Drives one reconnect scenario on the connected Android device or emulator and writes a
# timestamped trace. Run ws-monitor.mjs beside it to see what the socket did.
#
#   bash apps/velista/scripts/android-reconnect/scenario.sh <name> <step>...
#
# Steps, in the order given:
#   devtools    forward the WebView's DevTools socket to localhost:9333 (once per app start)
#   off | on    screen off (KEYCODE_SLEEP) or on (KEYCODE_WAKEUP plus the keyguard dismiss)
#   wait:<s>    sleep that many seconds
#   air:on | air:off      airplane mode
#   doze:on | doze:off    force or unforce device idle (the screen must be off for force)
#   home | front          send the app to the background, or bring it back
#   state       print visibility, navigator.onLine and whether the header mark is drawn
#   shot        save a screenshot beside the trace
#
# The three scenarios of docs/reports/2026-10-23-velista-socket-reconnect-on-android.md:
#   scenario.sh sleep90  state off wait:90 on wait:5 state wait:30 state
#   scenario.sh doze     state off doze:on wait:90 on wait:5 state doze:off wait:30 state
#   scenario.sh airplane state off wait:20 air:on wait:60 air:off on wait:5 state wait:30 state
#
# Environment: VELISTA_ANDROID_SDK (default: the per user SDK), VELISTA_ANDROID_PACKAGE
# (default app.velista.staging), VELISTA_RECONNECT_EVIDENCE (default
# dist/apps/velista-android/reconnect-evidence), ADB_SERIAL (default: the one emulator, -e).
set -u
sdk="${VELISTA_ANDROID_SDK:-${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk}"
adb="$sdk/platform-tools/adb"
serial="${ADB_SERIAL:--e}"
pkg="${VELISTA_ANDROID_PACKAGE:-app.velista.staging}"
here="$(cd "$(dirname "$0")" && pwd)"
ev="${VELISTA_RECONNECT_EVIDENCE:-$here/../../../../dist/apps/velista-android/reconnect-evidence}"
mkdir -p "$ev"
name="$1"; shift
log="$ev/$name.steps.log"
say() { echo "$(date +%T.%3N) $*" | tee -a "$log"; }

for step in "$@"; do
  case "$step" in
    devtools)
      pid=$("$adb" "$serial" shell pidof "$pkg" | tr -d '\r')
      "$adb" "$serial" forward tcp:9333 "localabstract:webview_devtools_remote_$pid"
      say "STEP devtools forwarded for pid $pid" ;;
    off)   "$adb" "$serial" shell input keyevent KEYCODE_SLEEP; say "STEP screen off" ;;
    on)    "$adb" "$serial" shell input keyevent KEYCODE_WAKEUP; "$adb" "$serial" shell input keyevent 82; say "STEP screen on" ;;
    wait:*) s="${step#wait:}"; say "STEP wait $s"; sleep "$s" ;;
    air:on)  "$adb" "$serial" shell cmd connectivity airplane-mode enable; say "STEP airplane on" ;;
    air:off) "$adb" "$serial" shell cmd connectivity airplane-mode disable; say "STEP airplane off" ;;
    doze:on)  "$adb" "$serial" shell dumpsys deviceidle force-idle | tr -d '\r' | head -1 | sed 's/^/  /'; say "STEP doze forced" ;;
    doze:off) "$adb" "$serial" shell dumpsys deviceidle unforce | tr -d '\r' | head -1 | sed 's/^/  /'; say "STEP doze unforced" ;;
    home)  "$adb" "$serial" shell input keyevent KEYCODE_HOME; say "STEP home" ;;
    front) "$adb" "$serial" shell am start -n "$pkg/app.velista.MainActivity" >/dev/null; say "STEP app to front" ;;
    state)
      v=$(node "$here/cdp-eval.mjs" "JSON.stringify({vis: document.visibilityState, online: navigator.onLine, mark: !!document.querySelector('.offline-mark, .live-mark, .stale'), href: location.pathname})" 2>&1 | tr -d '\r')
      say "STATE $v" ;;
    shot)  "$adb" "$serial" exec-out screencap -p > "$ev/$name-$(date +%H%M%S).png"; say "STEP shot" ;;
    *) say "unknown step $step" ;;
  esac
done
say "DONE"
