# Luna Shopper — Postman suite

A smoke and contract suite for the backend running locally. It is meant to answer one
question quickly: **is the stack actually working?**

- `luna-shopper.postman_collection.json` — 71 requests across 11 folders
- `slot-0.postman_environment.json` — points at slot 0 (`gateway :3000`, `Mailpit :8025`)

## Running it

In the Postman app, import both files, pick the **Luna Shopper — slot 0** environment,
then run the whole collection with the Collection Runner.

From the terminal:

```sh
npx newman run apps/luna-shopper-backend/postman/luna-shopper.postman_collection.json \
  -e apps/luna-shopper-backend/postman/slot-0.postman_environment.json
```

Run the folders **in order**. The suite builds one identity and one zone per run and
threads them through lists, lines and the catalog, so folder 05 depends on what folder
04 captured. Folder 09 deletes everything it made, which is what lets you run it
repeatedly against the same database.

For a different slot, change `baseUrl` and `mailpitUrl` in the environment. With no
environment selected at all the collection falls back to slot 0.

## What it covers

| Folder | What it proves |
| --- | --- |
| 00 · Health | Which services are up, before anything else runs |
| 01 · Guest flow | Anonymous onboarding: create a zone with no account, get tokens back |
| 02 · Registration & login | Register, login, refresh rotation, and the 409/401/400 failures |
| 03 · Email verification | Reads the confirmation mail back out of Mailpit and verifies it |
| 04 · Zones | Owner lifecycle: create, read, rename, members, join-code rotation |
| 05 · Lists & lines | Lists, lines, status, approval, reordering, comments, counters |
| 06 · Catalog (read) | Catalog reads, and that a non-admin write is correctly refused |
| 06b · Catalog (admin only) | Write CRUD and the price join. Skipped unless `catalogAdmin` is set |
| 07 · Account | Global username change, and that `GLOBAL_ONLY` really is scoped |
| 08 · Contract & errors | 401/404/400 paths return RFC7807 problem documents, not 500s |
| 09 · Cleanup | Deletes everything the run created |

Two assertions run against **every** request in the collection:

- **no server error** — nothing may return 5xx. This is the single most useful signal in
  the suite: a 5xx means a service behind the gateway is down or throwing, and the
  gateway itself cannot tell you which one.
- **responded within 10s**.

### Folder 00 is the diagnostic

`GET /v1/stats` is unauthenticated and fans out to core and auth. The contract says a
block comes back `null` when that service did not answer, so the two assertions there
name the failing service directly:

```
√  core answered (core service is up)
1. auth answered (auth service is up)      <- auth is down
```

If folder 00 fails, everything after it fails too and there is no point reading the rest
of the output. Fix the service it names first.

## Catalog writes need the admin allowlist

Catalog reads are open to any authenticated user, but every catalog **write** is gated to
`PLATFORM_ADMIN_USER_IDS` in the catalog service — the app owner alone. A normal run gets
`403` on all of them, so folder 06b skips itself unless you opt in:

1. Run the suite once and note the `userId` it registered (folder 02).
2. Add that id to `PLATFORM_ADMIN_USER_IDS` in `apps/luna-shopper-backend/catalog/.env` and
   restart the catalog service.
3. Set the collection variable `catalogAdmin` to `true`.

Folder 06 covers the part that matters without any of that: it asserts a non-admin write is
refused with a `403`, which is the check worth having, since that allowlist is the only
thing standing between a signed-in user and the shared catalog.

## Two things this suite currently catches

- **`GET /v1/catalog/items/not-a-uuid` returns 500.** A well-formed but unknown id correctly
  returns 404, so the id is reaching the service unvalidated and blowing up there. The test
  `a malformed id is a client error, not a 500` in folder 06 fails on purpose until this is
  fixed; it is a real defect, not a suite bug.
- **Auth dying is invisible from the outside.** The gateway stays up and answers, so the app
  looks alive while every `/v1/auth/*` call returns a generic 500. Folder 00 is what turns
  that into a named service.

## Notes

- **Rate limiting.** The auth routes are throttled per minute: registration 3, login 5,
  anonymous zone creation 10, join-code lookup 5 per 30s. A full run uses one registration
  and one login, so running the suite more than about three times a minute empties the
  registration bucket. When that happens the run **stops at folder 02** with a single
  `RATE LIMITED` failure rather than cascading a missing token through every later folder.
  Wait a minute and re-run. Manual `curl` against `/v1/auth/*` counts against the same
  buckets. Nothing leaks when the run stops there: folder 01 has already cleaned up after
  itself and folder 02 has not created anything yet.
- **Renaming is throttled by the hour, not the minute.** Username changes are limited to
  **5 per hour per IP**, and a full run uses two of them (one per-zone in folder 04, one
  global in folder 07). So the third run in an hour will find that bucket empty. Those two
  requests report a `429` as `SKIPPED` rather than failing, because an exhausted hourly
  bucket says nothing about whether the backend works. Everything else in the run is
  unaffected.
- **Folder 03 is optional.** It talks to Mailpit rather than the API. If you run the
  stack without the mail container, skip that folder; nothing after it depends on the
  email being verified.
- **The registered user is left behind on purpose.** Cleanup removes the zone, lists,
  lines and catalog rows, but not the account, because `DELETE /v1/account` is
  destructive and is not worth wiring into a routine smoke run. Each run registers a
  fresh `postman+<random>@luna.test` address, so they accumulate slowly in the auth
  database and are harmless.
- **Keep it in step with the contract.** The bodies and status codes here were derived
  from `apps/luna-shopper-backend/gateway/docs/openapi.json`. When that document changes,
  this suite is the thing most likely to go stale.
