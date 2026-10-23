# velista: how the realtime socket behaves on Android when the screen goes off

Read on `feat/velista-capacitor-android` at `e5320be3` on 2026-10-23, and measured on the
API 37 emulator (`Medium_Phone_API_37.0`, Android 17, WebView 145) with the staging APK of
plan 0167 built with `VELISTA_NATIVE_DEBUG=1`, signed in as a guest who had just created a
group, on the home page. The owner's report that prompted it: "sometimes it doesn't reconnect
correctly on my phone (Pixel 10a)" after turning the screen off.

Three scenarios were run with a WebSocket monitor attached to the WebView over the Chrome
DevTools Protocol (`apps/velista/scripts/android-reconnect/`). Every claim below cites a
trace line or a source line. Times in the traces are UTC.

## 1. What the client does today

`libs/velista/data-access/src/lib/realtime/realtime-socket.ts`:

- The library's own reconnection is off (`reconnection: false`, L302), and the class owns
  the retry. A failed attempt counts one failure and schedules the next attempt with full
  jitter under a ceiling of 1 s, 2 s, 4 s and so on up to 30 s (L38 to L39, L401 to L421).
- **After two consecutive failures it stops.** `MAX_CONSECUTIVE_FAILURES = 2` (L42) latches
  `degraded` (L404 to L408), and `_start` returns at once while `degraded` holds (L276).
- Only two things clear the latch: the window `online` event (L168 to L178) and a resume
  from `AppResumed` (L187 to L192), both through `retry()` (L260). Nothing in the UI calls
  `retry()`.
- `retry()` does nothing useful while a socket object is still held: `_start` returns when
  `_socket !== null` (L276), and the class has no way to ask that socket whether it is
  still alive. A dead socket is noticed only when the engine's heartbeat timer fires, which
  is `pingInterval + pingTimeout` = 25 s + 20 s after the last server ping (handshake in the
  trace: `"pingInterval":25000,"pingTimeout":20000`).
- `_onConnected` (L363) rejoins the rooms through `RoomRegistry.onConnected`. It tells
  nobody that a reconnection happened: the interface exposes `connected` and `degraded`
  (realtime-client.ts L43, L54) and no counter. `BasketSocket` has one (`reconnects`,
  basket-socket.ts L165) for its own socket and nothing else.

`libs/velista/platform/src/lib/app-resumed.ts` counts the hidden to visible edge of
`document.visibilityState` and `pageshow` with `persisted`. `connection-recovery.ts` probes
`/health/ready` every 10 s while `ConnectionState.offline` holds (L123) and reloads the
document when the backend answers (L137).

## 2. What Android does to the app

The emulator's network policy service puts the app into the background chain about half a
second after the activity stops:

```
dumpsys netpolicy
  Uids transitioning to background:
    UID=10237, +556ms
  ... blocked_state={blocked=APP_BACKGROUND, ...}
```

This is the background network restriction of Android 15 and later: an app that is not in
the foreground and holds no foreground service loses network access. A screen that goes off
stops the activity, so **the socket dies within seconds of every screen off**, whatever the
client does, and every attempt made while hidden fails locally (`ERR_NAME_NOT_RESOLVED`).

The WebView does fire `visibilitychange` on screen off and on wake (trace: `vis":"hidden"`
one second after `KEYCODE_SLEEP`, `"visible"` after `KEYCODE_WAKEUP`), so `AppResumed`
sees every wake. No native plumbing is needed for that.

## 3. The three traces

### 3.1 Screen off for 90 s, wake (`sleep90`)

```
10:01:00.456 STATE vis hidden
10:01:04.841 WS CLOSED 9644.33                     the socket dies, 4 s after hidden
10:01:05.457 STATE mark true                       the home mark shows (while hidden)
10:01:05.613 WS CREATED 9644.46                    failure 1 schedules a retry, it fires
10:01:26.612 WS ERROR "closed before the connection is established"
10:01:26.613 WS CLOSED 9644.46                     failure 2: degraded latches
             (nothing for 63 s)
10:02:29.474 HTTP GET /v1/baskets/live/summary     the resume: LiveBasketStore reads again
10:02:29.485 WS CREATED 9644.48                    AppResumed -> retry() -> connect
10:02:29.632 WS HANDSHAKE 101
10:02:29.683 WS -> 420["zone.subscribe", ...]      rooms rejoined
10:02:29.748 WS <- 430[{"ok":true}]
10:02:30.570 STATE vis visible, mark false
10:02:30.975 HTTP GET /v1/baskets?limit=20         BasketListStore reads again (resume)
```

Recovered, 250 ms after the wake. Both attempts the client allows itself were spent while
hidden, where no attempt can succeed; the resume re-arm is the only reason the socket came
back.

### 3.2 Screen off under forced Doze, wake, then unforce (`doze`)

```
10:04:25.727 STATE vis hidden
10:04:29.900 WS CLOSED 9644.48
10:04:31.614 WS CREATED 9644.50
10:04:31.617 WS ERROR net::ERR_NAME_NOT_RESOLVED   failure 2 within 2 s: degraded
10:05:54.798 WS CREATED 9644.52                    the wake
10:05:55.004 WS HANDSHAKE 101
10:05:55.182 WS <- 430[{"ok":true}]
```

Recovered. The forced idle of the emulator did not block the wake's attempt, so this run did
not reproduce the Pixel. It shows the same burn of both attempts inside two seconds of the
screen going off.

### 3.3 Screen off, airplane mode on, airplane off and wake together (`airplane`)

```
10:07:11.038 STATE vis hidden
10:07:12.044 WS CLOSED 9644.52
10:07:12.617 WS ERROR net::ERR_NAME_NOT_RESOLVED   degraded, 1.6 s after hidden
10:07:31.079 STATE online false                    airplane mode: navigator.onLine drops
10:07:37.614 HTTP GET /health/ready  FAILED        ConnectionRecovery probes every 10 s,
10:07:47.613 HTTP GET /health/ready  FAILED        while hidden
10:07:57.617 HTTP GET /health/ready  FAILED
10:08:27.114 WS CREATED 9644.61                    the wake: resume -> retry()
10:08:27.138 WS ERROR net::ERR_INTERNET_DISCONNECTED   the radio is not back yet
10:08:27.247 WS CREATED 9644.62                    failure 1 retried within 110 ms
10:08:27.258 WS ERROR net::ERR_INTERNET_DISCONNECTED   failure 2: degraded again
10:08:28.294 WS CREATED 9644.64                    the `online` event -> retry()
10:08:28.542 WS HANDSHAKE 101                      recovered
10:08:30.222 HTTP 204 /health/ready                the probe answers; the document reload
                                                   that follows was not observed
```

**This is the owner's bug, one rescue away.** The wake's two attempts both failed inside
150 ms because the network came back a second after the screen did. The client latched and
would have stayed latched; only the `online` event, which fired because airplane mode had
dropped `navigator.onLine`, cleared it. On a phone whose Wi-Fi reassociates after wake, or
that leaves Doze a moment after the screen comes on, `navigator.onLine` never changes, no
`online` event comes, and the app stays stale until the next screen off and on. That matches
"sometimes it doesn't reconnect correctly".

One more observation from this run: the socket opened at 10:08:28 closed by itself at
10:09:01, 33 s later and 8 s after a successful ping and pong, with no page reload (no
lifecycle event in the trace) and the client reconnected in 700 ms. It is not explained by
anything on the client; it may be the emulator's network coming back in two steps. It is
noted here, not pursued.

## 4. What follows for the design

1. **A fixed number of attempts is the wrong shape.** The two attempts are spent where
   they cannot succeed (hidden, network cut), and the state that results has no way out
   except an event that may never come. The retry must not stop, and it must not run while
   hidden.
2. **A resume after a long absence should assume the socket is dead.** The server drops a
   socket that misses pongs for 20 s, and Android cuts the network within a second of the
   screen going off, so after 45 s hidden there is no live socket to preserve. Closing it on
   resume and reconnecting at once removes the up to 45 s window in which the client holds a
   corpse and `retry()` returns early (L276).
3. **The rooms come back, the data does not.** `RoomRegistry.onConnected` rejoins every room
   and presence is rebuilt by the server's own broadcast on join (`presence.service.ts`
   L233, L259). Everything that was broadcast while the socket was down is gone. A store
   that mirrors server state must read again after a reconnect, which needs an edge the
   stores can watch (plan 0169).
4. **The mark exists on one page.** `home-page.html` L20 to L28 draws the offline mark;
   the list header draws a band (list-header.html L78) on disconnect and on refusal; every
   other page says nothing. The state the mark reads is `connected` on the client, which is
   also false for the first second of a cold start.

Plans 0168 and 0169 are the design.
