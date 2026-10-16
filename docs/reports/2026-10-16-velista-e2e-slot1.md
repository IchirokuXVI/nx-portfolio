# velista end to end test on dev slot data, 2026-10-16

Screenshot names in this report point to files outside the repository. Each name `<name>` is the file `C:\Users\Ichi\.claude\jobs\d8ac86e2\tmp\e2e\shots\<name>.png`. Script and log paths such as `scripts/out4/log.txt` are under `C:\Users\Ichi\.claude\jobs\d8ac86e2\tmp\e2e\`.

## How this run was set up

- Slot 1 was down and locked. At the owner's word, its five volumes (auth, core, catalog and harvester databases, and NATS data) were copied into labelled `luna-slot2_*` volumes. The copy only read slot 1. The sizes match (catalog 627 MB).
- Backend slot 2 ran migrations on the copies only. Gateway on 43100, realtime on 43101, Mailpit on 43141.
- Front end slot 1 served only velista (42005) and luna-shopper-admin (42006), against backend slot 2.
- Slot 0 was not touched.
- Browser: Chromium through Playwright 1.59, with 100 ms of latency added through CDP. The main viewport was a phone at 390x844. Desktop shots used 1440x900.
- Server: the dev server. All numbers are dev build numbers. About 1.2 s of every cold load is dev JS chunks. A slot adds about 50 ms per NATS hop, where a cluster pays 2 to 12 ms.
- Code base: `dev` at `03e846fa`, after PRs #733 and #734.

## Summary

Seven scenarios ran with three registered users, four guests and one smoke user. The core flows work: register, setup, groups, invites, lists, lines, comments, live updates between people, the live basket, generated trips, share links and finishing a trip. Two blockers stand out. The realtime zone room sends the content of private lists to every group member's device, and any browser language other than Spanish or English shows raw translation keys on every page. Shared shopping has several ways to lose or misattribute a purchase, and browser back from a cold deep link leaves the app on every page type. Sheets mostly reopen on reload and keep their URL, and the Spanish and English copy is complete and parallel.

### Top ten problems

1. **F4.1, blocker.** Private list content (lines, comments) reaches every group member's device over the realtime zone room. The orchestrator verified this in `jetstream.consumer.ts:376-383` and in the captured frame (`scripts/out4/log.txt` line 172). Scenario 4.
2. **F7.1, blocker.** Any browser language other than es or en shows raw translation keys on every page. The orchestrator verified this in shot s7-a-frFR-home-phone and in `rokutranslator.ts:156` and `:197`. Scenario 7.
3. **F6.1, major.** A tap meant to tick becomes Undo and silently reverts another person's purchase. Scenario 6.
4. **F4.2, major.** Turning group sharing off leaves every member's rights, so a list the owner thinks is private is not. Scenario 4.
5. **F5.2, major.** At a shop with no prices (Deza) the basket shows other chains' prices as that shop's. Scenario 5.
6. **F6.3, major.** "Remove the guests" also removes a registered group member. Scenario 6.
7. **F7.3, major.** A quantity change queued while offline is lost silently. Scenario 7.
8. **F6.5, major.** `/s/:secret` hangs on "Checking the link" forever when the preview fails. Scenario 6.
9. **F7.2, major.** Browser back from a cold deep link leaves the app on all 11 page types, and the owner's rule says it never may. Scenarios 2, 5 and 7.
10. **F4.3, major.** The gone block shows the raw key `list.gone.unshared`, also for a missing list id (F7.6). Scenarios 4 and 7.

Also major: F2.1 (emoji name refused after it was echoed as valid), F2.2 (owner of a group with no lists is told nothing is shared), F3.1 (same product from the other locale makes a second line), F3.2 (list settings sheet empty on a cold load), F3.3 (chosen product does not reach the chooser's list), F3.4 (comment counts vanish on reload), F5.1 (other tabs never learn that a trip finished), F5.3 (shop picker drops Lidl), F5.4 (basket URL signed out has no way forward), F6.2 (one of two simultaneous increments is lost), F6.4 (removed member is offered "Continue as guest").

## Test matrix

Result values: pass, fail, partial, blocked, not done.

| scenario | step                                                                                     | user        | result   | evidence                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------- | ----------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| 1        | Landing cold, language switch EN and ES                                                  | A           | partial  | F1.1; s1-a-landing-cold-es-phone, s1-a-landing-afterback-urlES-mismatch-phone; landing cold 1499                      |
| 1        | Landing to login and to register                                                         | A           | pass     | s1-a-login-empty-es-phone, s1-a-register-empty-es-phone; 213 / 70                                                     |
| 1        | Register validation: empty, bad email, short password, mismatch                          | A           | partial  | F1.5, S2, S3; s1-a-register-bademail-es-phone, s1-a-register-shortpw-es-phone, s1-a-register-mismatch-es-phone        |
| 1        | Valid register lands on setup                                                            | A           | pass     | s1-a-setup-welcome-es-phone; register submit 775                                                                      |
| 1        | Setup welcome, name, place, shops, done                                                  | A           | partial  | F1.2, F1.3, F1.4; s1-a-setup-place-14013-es-phone, s1-a-setup-shops-default-es-phone, s1-a-setup-done-en-phone        |
| 1        | Shop chain adjustment in setup                                                           | A           | not done | all four chains reach 14013, so all stayed on                                                                         |
| 1        | Account page and shopping profiles                                                       | A           | partial  | F1.7, S5; s1-a-account-filled-es-phone, s1-a-account-profiles-filled-es-phone; postal code lives on /account/profiles |
| 1        | Sign out, then sign in, wrong password, unknown email                                    | A           | pass     | s1-a-login-wrongpw-es-phone, s1-a-login-unknownemail-es-phone; login submit 558                                       |
| 1        | Mailpit verification link                                                                | A           | not done | out of scope                                                                                                          |
| 1        | Leave users and data in place                                                            | A           | pass     | user A kept (section 9)                                                                                               |
| 2        | Create group sheet, Escape, Cancel, back, reload                                         | A           | pass     | s2-a-creategroup-sheet-empty-es-phone, -reloaded-; create group submit 294                                            |
| 2        | Signed out join link, Ask to join as guest                                               | guest       | pass     | s2-x-joinlink-signedout-en-phone, s2-x-joinlink-signedout-afterask-en-phone                                           |
| 2        | B registers in en, setup name with emoji                                                 | B           | fail     | F2.1; s2-b-setup-name-emoji-typed-en-phone, s2-b-setup-name-emoji-rejected-en-phone                                   |
| 2        | B asks to join, A approves, B updates live                                               | A, B        | partial  | F2.4; s2-a-members-pending-es-phone, s2-b-group-afterapprove-live-en-phone; live update about 1600                    |
| 2        | Approved member reuses the invite                                                        | B           | fail     | F2.3; s2-b-joinlink-alreadyasked-en-phone                                                                             |
| 2        | Regenerate code, old code 404                                                            | A, C        | pass     | s2-a-after-regenerate-es-phone, s2-c-joinlink-oldcode-en-phone                                                        |
| 2        | C joins with the new code, A turns C down                                                | A, C        | partial  | F2.5, F2.6, F2.10, F2.11; s2-c-group-afterrejection-cold-en-phone                                                     |
| 2        | Group page, members page, settings and member sheets                                     | A, B        | partial  | F2.2, F2.7, F2.8, F2.9, F2.12; s2-a-group-twomembers-es-phone, s2-a-membersheet-colddeeplink-es-phone                 |
| 2        | Plain member has no staff controls                                                       | B           | pass     | s2-b-groupsettings-byurl-nonstaff-en-phone                                                                            |
| 2        | Transfer, remove, ban, rename group, delete group                                        | A           | not done | sheets opened and closed only, to keep B a plain member                                                               |
| 2        | Leave users and data in place                                                            | all         | pass     | users A, B, C, guest Deep Keel and group kept                                                                         |
| 3        | Create three lists (two by A, one by B)                                                  | A, B        | pass     | s3-a-createlist-sheet-filled-compra-es-phone, s3-b-createlist-sheet-filled-bbq-en-phone; submit 189 to 203            |
| 3        | Empty list page                                                                          | A, B        | pass     | s3-a-list-empty-compra-es-phone, s3-b-list-empty-bbq-en-phone                                                         |
| 3        | Catalog search and add lines, free text lines                                            | A, B        | partial  | F3.1, F3.6, F3.7; s3-b-search-eggs-onlist-en-phone, s3-b-search-milk-en-phone                                         |
| 3        | Other user sees adds live and after reload                                               | A, B        | pass     | s3-b-list-filled-compra-live-en-phone; push 55 to 186                                                                 |
| 3        | Quantity reel, quantity 0, negative refused                                              | A, B        | pass     | s3-a-list-qty-23-es-phone, s3-a-list-qty-zero-es-phone; S9                                                            |
| 3        | Type an exact quantity                                                                   | A           | not done | no numeric field exists, by design                                                                                    |
| 3        | Comments on a line                                                                       | A, B        | partial  | F3.4; s3-a-comments-sheet-filled-es-phone, s3-a-sheet-line-detail-reloaded-es-phone                                   |
| 3        | Delete a line                                                                            | A           | pass     | s3-a-deleteline-confirm-es-phone, s3-b-list-afterdelete-live-en-phone                                                 |
| 3        | Change product set, choose one product                                                   | A, B        | partial  | F3.3, F3.8; s3-a-list-afterchoose-es-phone, s3-b-linepage-velas-noproduct-en-phone                                    |
| 3        | Line page, realtime on a cold line page, history                                         | A, B        | partial  | F3.5; lead refuted (line page gets realtime, 61 ms); s3-a-linepage-pan-es-phone                                       |
| 3        | Rename lists, list settings sheet                                                        | A, B        | partial  | F3.2; s3-a-listsettings-cold-es-phone; rename push 63 and 67                                                          |
| 3        | Sheets: URL, reload, Escape, Cancel, back                                                | A, B        | pass     | s3-a-sheet-_-es-phone, s3-b-sheet-_-en-phone and -reloaded-                                                           |
| 3        | Desktop list, line page, detail sheet                                                    | A, B        | pass     | s3-a-list-filled-compra-es-desktop, s3-b-linepage-leche-en-desktop                                                    |
| 3        | Leave users and data in place                                                            | A, B        | pass     | three lists and their lines kept                                                                                      |
| 4        | A creates a private list with four lines                                                 | A           | pass     | s4-a-createlist-private-filled-es-phone, s4-a-list-private-filled-es-phone; F4.10                                     |
| 4        | B sees nothing in the UI                                                                 | B           | pass     | s4-b-group-en-phone, s4-b-home-en-phone, s4-b-composer-tarjeta-en-phone                                               |
| 4        | B REST probes on the private list                                                        | B           | pass     | every read and write 403                                                                                              |
| 4        | B realtime socket                                                                        | B           | fail     | F4.1; `scripts/out4/log.txt` line 172                                                                                 |
| 4        | B opens direct URLs, cold and in app                                                     | B           | partial  | F4.3, F4.4, F4.5; s4-b-cold-list-en-phone, s4-b-cold-sheet-settings-en-phone                                          |
| 4        | Sharing on, then off                                                                     | A, B        | fail     | F4.2, F4.9; s4-b-list-afterShareOff-reload-en-phone, s4-b-group-afterShareOn-live-en-phone                            |
| 4        | Remove B's access                                                                        | A, B        | pass     | s4-b-list-afterRevoke-live-en-phone; gone block 55 after PUT                                                          |
| 4        | Signed out and non member C                                                              | anon, C     | partial  | F4.6, F4.7; s4-c-group-en-phone, s4-anon-list-en-phone                                                                |
| 4        | 300 character line name in the composer                                                  | A           | partial  | F4.8                                                                                                                  |
| 4        | Live `list.created` on B's socket, private lines in B's basket while shared, batch probe | B           | not done | see section 11                                                                                                        |
| 4        | Leave users and data in place                                                            | A           | pass     | private list kept, sharedWithZone false                                                                               |
| 5        | Live basket cold                                                                         | A           | pass     | s5-a-live-cold-es-phone; 1830 (B en 2038 / 2210, over budget)                                                         |
| 5        | Shop choice: Mercadona and El Jamón                                                      | A           | pass     | s5-a-live-shop-mercadona-es-phone, s5-a-live-shop-eljamon-es-phone                                                    |
| 5        | Shop choice: Deza                                                                        | A           | fail     | F5.2; s5-a-live-shop-deza-es-phone                                                                                    |
| 5        | Shop picker lists every chain of the profile                                             | A           | fail     | F5.3; s5-a-shoppicker-es-phone, s5-a-profile-supermarkets-es-phone                                                    |
| 5        | Three price spot checks                                                                  | A           | pass     | s5-a-product-aceite-es-phone                                                                                          |
| 5        | First tick asks for a shop; tick, reel, undo                                             | A           | pass     | s5-a-first-tick-ask-es-phone, s5-a-live-huevos-partial-es-phone                                                       |
| 5        | B sees A's ticks live on the list page                                                   | B           | pass     | s5-b-list-after-a-tick-leche-en-phone; 0 to 42 after A's response                                                     |
| 5        | Sheets settle, change, more, filter, shop, people                                        | A           | partial  | F5.7; s5-a-sheet-\*-es-phone; filter open 1149                                                                        |
| 5        | Reload mid shopping                                                                      | A           | pass     | s5-a-live-after-reload-es-phone; 2277                                                                                 |
| 5        | Scroll restore on reload                                                                 | A           | not done | unverified, page scrolls inside `main.page`                                                                           |
| 5        | Generate a trip and finish it                                                            | A, B        | pass     | s5-a-generated-basket-es-phone, s5-a-finish-sheet-es-phone                                                            |
| 5        | Another open tab learns of the finish                                                    | A           | fail     | F5.1, F5.5; s5-a-stale-409-after-es-phone                                                                             |
| 5        | Basket URL signed out and by a non participant                                           | anon, B     | fail     | F5.4; s5-anon-basket-es-phone                                                                                         |
| 5        | B pass in en                                                                             | B           | partial  | F5.6, F5.10; s5-b-generated-finished-en-phone, s5-b-live-cold-en-phone                                                |
| 5        | Browser back from a cold `/shopping-lists/live`                                          | A           | fail     | F7.2 (recorded as native behaviour in s5, now counted)                                                                |
| 5        | Leave users and data in place                                                            | A, B        | pass     | baskets kept (section 9)                                                                                              |
| 6        | Generate a trip from Fiesta and make a share link                                        | A           | pass     | s6-a-share-sheet-link-es-phone; make link 249                                                                         |
| 6        | B signed in opens the link                                                               | B           | pass     | s6-b-basket-joined-en-phone; 2223 (over budget)                                                                       |
| 6        | Guest joins signed out (en, es)                                                          | guest       | pass     | s6-g-join-offer-en-phone, s6-g-basket-joined-en-phone                                                                 |
| 6        | Sign in from the share link                                                              | guest       | fail     | F6.6; s6-g-after-signin-from-link-es-phone                                                                            |
| 6        | Malformed and random links                                                               | anon        | partial  | F6.9; s6-anon-link-malformed-en-phone                                                                                 |
| 6        | Link preview fails (network error, 503)                                                  | anon        | fail     | F6.5; s6-anon-link-preview-neterror-en-phone                                                                          |
| 6        | Concurrent ticks, adds and quantity changes                                              | A, B, guest | partial  | F6.1, F6.2; s6-b-e2c-after-en-phone, s6-b-e4-after-en-phone                                                           |
| 6        | Line removed by A shows crossed for others                                               | A, B, guest | pass     | s6-b-line-removed-live-en-phone; 200 / 251                                                                            |
| 6        | Revoke the link with "remove guests" ticked                                              | A           | fail     | F6.3, F6.7, F6.8; s6-a-revoke-sheet-cascade-ticked-es-phone                                                           |
| 6        | Remove one person, add B back from the group                                             | A           | pass     | s6-a-people-hugo-es-phone, s6-b-back-on-trip-en-phone                                                                 |
| 6        | Removed member opens a new link                                                          | B           | fail     | F6.4; s6-b-link2-after-cascade-en-phone                                                                               |
| 6        | Finish the shared trip                                                                   | A           | partial  | F5.1 seen again; s6-a-finished-shared-es-phone                                                                        |
| 6        | Sheets share, people, settle, change; reload mid trip                                    | A, B, guest | partial  | F6.10; s6-a-sheet-share-es-phone-reloaded; reload 1572 to 1579                                                        |
| 6        | B deletes a line from the trip                                                           | B           | not done | B may not delete approved lines (403), by design                                                                      |
| 6        | Leave users and data in place                                                            | all         | pass     | basket FINISHED, guests kept                                                                                          |
| 7        | 1. Reload of every sheet URL                                                             | A           | partial  | F2.7, F2.8, F3.2 reproduced; s7-a-sheetcold-list-settings-es-phone                                                    |
| 7        | 2. Back controls in app and browser back                                                 | A           | fail     | in app back pass; F7.2; s7-a-back-list-after-es-phone                                                                 |
| 7        | 3. Bad ids (malformed, random, upper case, wrong parent)                                 | A           | partial  | F4.3, F7.6, F7.7, F7.8, S31; s7-a-bad-list-random-es-phone                                                            |
| 7        | 4. Invite link variants and join sheet paste                                             | anon, C     | partial  | F7.4, S32; s7-c-joinsheet-leadingspace-paste-en-phone                                                                 |
| 7        | 5. 400 character names, emoji, accents                                                   | A, B        | partial  | F7.10; s7-a-list-longnames-es-phone, s7-a-line-api400-es-phone                                                        |
| 7        | 6. Quantity bounds 0 and 100000                                                          | A           | pass     | s7-a-list-qty100000-es-phone, s7-a-line-qty0-es-phone                                                                 |
| 7        | 7. Double click add, simultaneous adds                                                   | A, B        | pass     | s7-a-dblclick-add-es-phone                                                                                            |
| 7        | 8. Concurrent renames, delete against edit and comment                                   | A, B        | pass     | s7-b-fight-comment-vs-delete-en-phone                                                                                 |
| 7        | 9. Locale by URL on 15 page types; browser locale                                        | A, anon     | fail     | URL switch pass; F7.1, F7.5; s7-a-frFR-home-phone                                                                     |
| 7        | 10. Offline overlay and recovery                                                         | A           | partial  | F7.3, F7.9; s7-a-offline-idle-es-phone, s7-a-online-after-reel-es-phone                                               |
| 7        | 11. Owner opens the private list cold                                                    | A           | pass     | s7-a-privatelist-owner-cold-es-phone; 1467                                                                            |
| 7        | Leave users and data in place                                                            | A           | pass     | list "Casos límite ñandú" kept; no users created                                                                      |

## Defects

Severity counts for the F ids: 2 blocker, 19 major, 41 minor, 7 cosmetic. The scoring pass findings (S ids) are counted separately at the end of this section. "Cause" is from code reading unless it says verified.

### Accounts and setup

**F1.2, minor. Place step count understates what the next screen shows.**

- Steps: 1. User A in setup opens `http://localhost:42005/es/setup/place`. 2. Type 14013 and leave the field ("Incluir los códigos de alrededor" is ticked by default).
- Expected: "Lo que alcanza" matches what the next screen asks the person to confirm.
- Actual: "4 cadenas y 4 tiendas". The next screen lists 15 + 9 + 8 + 3 = 35 shops.
- Evidence: s1-a-setup-place-14013-es-phone, s1-a-setup-shops-default-es-phone; GET /v1/catalog/shops/summary?postalCode=14013 (no nearby parameter).
- Cause: by design, `place-step.ts:84` to `89` counts the code alone, and the copy does not say so.

**F1.3, minor. Browser back from shops to place shows an empty postal code.**

- Steps: 1. In setup, place 14013 and press Seguir. 2. Press browser back.
- Expected: 14013 shows, since the server saved it.
- Actual: `/es/setup/place` with an empty field and no "Lo que alcanza" block.
- Evidence: s1-a-setup-place-afterbrowserback-es-phone.

**F1.4, minor. Done step after a reload says the shops were skipped.**

- Steps: 1. Finish the shops step with "Listo" and no change (so no PATCH). 2. Load `/en/setup/done` cold.
- Expected: "4 chains of 4", as on the first visit.
- Actual: "SHOPS Skipped". The es visit before the reload said "4 cadenas de 4".
- Evidence: s1-a-setup-done-es-phone, s1-a-setup-done-en-phone.
- Cause: `done-page.ts:67` reads `SetupFlow.chains`, an in memory signal that only the shops step sets.

**F1.5, minor. Invalid email shows the browser's native message, not the app's.**

- Steps: 1. Open `/es/auth/register`. 2. Email "ana-sin-arroba", valid passwords. 3. Press Crear cuenta.
- Expected: the app's "Eso no parece un correo" (key `auth.error.badEmail` exists).
- Actual: no request and no app message. The native tooltip "Please include an '@' in the email address" shows in the browser's language (English) under an es page.
- Evidence: s1-a-register-bademail-es-phone.

**F1.6, minor. Every cold load requests GET /v1/account/me twice in parallel, and /health/ready twice.**

- Steps: 1. Sign in as A. 2. Load `/es/home` cold.
- Expected: one `me` read and one readiness check.
- Actual: GET /v1/account/me 200 twice (at 954+103 and 954+218 in "s1 home cold"). `/account` adds a third `me`. One `/health/ready` is usually aborted. About 100 ms of extra gateway time per load on a slot, and route data starts only after the second `me` returns.
- Evidence: every cold measure; 214 of 349 loads (section 6).

**F1.7, cosmetic. Profiles page warns about a nearby code that the app added.**

- Steps: 1. Finish setup with 14013. 2. Open `/es/account/profiles`.
- Expected: no warning on a code the app chose.
- Actual: "14003 Ningún supermercado que conozcamos llega aún a este código" under a chip marked CERCANO.
- Evidence: s1-a-account-profiles-filled-es-phone.

**F2.1, major. A name with an emoji is refused, and the setup screen echoes it back as valid.**

- Steps: 1. Register user B and reach `/en/setup/name`. 2. Type "Bruno 🍋 Peña". 3. Press "Continue as Bruno 🍋 Peña".
- Expected: the name is accepted, or refused before submit with the field marked invalid.
- Actual: PATCH /v1/account/me 400 `validation_failed`, "That username contains characters that are not allowed". The red rule "Names are 2 to 40 characters..." shows only after the request. The input has no aria-invalid. The note still says "somebody else can be Bruno 🍋 Peña too" and the button still says "Continue as Bruno 🍋 Peña".
- Evidence: s2-b-setup-name-emoji-typed-en-phone, s2-b-setup-name-emoji-rejected-en-phone.

**F2.13, cosmetic. Register displayName is ignored.**

- Steps: POST /v1/auth/register with displayName "Carla".
- Expected: the user shows as Carla (unverified whether displayName is meant to set the username).
- Actual: the user shows as "Roaming Albatross". API only, not a UI path.

### Groups and invites

**F2.2, major. The owner's group with no lists says "nothing shared with you".**

- Steps: 1. A owns Casa Córdoba with 0 lists and 2 members. 2. Open `http://localhost:42005/es/zones/68c05640-724e-4d73-bfd3-b4126645d634` (also `/en`).
- Expected: "Todavía no hay listas", since the owner reads every list. B should also see "No lists yet".
- Actual: A sees "Aún no han compartido nada contigo. Este grupo tiene listas y ninguna está compartida contigo". B sees "Nothing shared with you yet. This group has lists, and none of them are shared with you". With one member the copy is correct, so it flips when a second person joins.
- Evidence: s2-a-group-twomembers-es-phone, s2-a-group-filled-en-phone, s2-b-group-filled-en-phone.
- Cause: `select-group-state.ts:115` `emptyReason` returns `'no-access'` whenever memberCount > 1, also for the owner or an admin.

**F2.3, minor. An approved member who reuses the invite is told "You have already asked to join this group".**

- Steps: 1. As B (approved), open `/en/join/X2USCENJ` and press "Ask to join". 2. Repeat in `/en/home/sheet/zones/join` with the code.
- Expected: B is told he is already in the group, with a way to open it.
- Actual: POST /v1/zones/join 409, "You have already asked to join this group". "Ask to join" stays offered.
- Evidence: s2-b-joinlink-alreadyasked-en-phone, s2-b-joinsheet-alreadyasked-en-phone.

**F2.4, minor. A pending member's group page shows "Not updating live right now" and the chip "Member".**

- Steps: 1. As B while PENDING, open `/en/zones/:z`. 2. A approves B.
- Expected: a pending state with no offline banner; the banner clears on approval.
- Actual: the header reads "Member", then "Not updating live right now". The banner stays after the approval arrives live and clears only on reload.
- Evidence: s2-b-group-pending-en-phone, s2-b-group-afterapprove-live-en-phone, s2-c-group-pending-en-phone.
- Cause (unverified hypothesis): realtime `refusedZones` (`room-registry.ts:110`) is filled when the pending member's zone subscribe is refused, and nothing clears it on approval.

**F2.5, minor. A turned down person's open group page does not update.**

- Steps: 1. C is pending on `/en/zones/:z`. 2. A presses "Rechazar". 3. Wait 4 s.
- Expected: C's page changes, as B's did on approval.
- Actual: it still says "Waiting to be let in". Home drops the group only after navigation.
- Evidence: s2-c-group-afterrejection-live-en-phone, s2-c-home-afterrejection-en-phone.

**F2.6, minor. A cold load of a group you were turned down from shows a server error under the "not available" title.**

- Steps: after the rejection, C loads `http://localhost:42005/en/zones/68c05640-724e-4d73-bfd3-b4126645d634` cold.
- Expected: one clear message and no retry for a 404.
- Actual: the title "This group is not available to you...", then "Something went wrong on our side. Nothing you saved has been lost.", a "Try again" button and "ref b576948e-...". The console shows a 404. Seen again in s7 for a random group id (ref d4e04ca8-...).
- Evidence: s2-c-group-afterrejection-cold-en-phone, s7-a-bad-group-random-es-phone.

**F2.7, minor. Reloading the group sheets loses them.**

- Steps: 1. A opens `/es/zones/:z/sheet/lists/new` or `/sheet/settings`. 2. Reload. Also cold en URLs, and B with the new list sheet.
- Expected: the sheet reopens, as the home create group sheet does.
- Actual: redirect to `/es/zones/:z` with no dialog.
- Evidence: s2-a-newlist-sheet-reloaded-es-phone, s2-a-groupsettings-sheet-reloaded-es-phone, s2-b-newlist-sheet-reloaded-en-phone, s7-a-sheetcold-group-listsnew-es-phone.
- Cause: `zoneMemberGuard` and `zoneStaffGuard` read only the ZoneStore cache, which is empty on a cold load.

**F2.8, minor. A cold deep link or reload of a member sheet lands on the group page.**

- Steps: A loads `/es/zones/:z/members/sheet/f034ea97-a92b-4aba-8be9-0a695b2dda36/confirm/{transfer,rename,remove,ban}` cold. B does the same for his own rename.
- Expected: the sheet, or at least the members page.
- Actual: `/es/zones/:z` with no dialog, in all cases.
- Evidence: s2-a-membersheet-colddeeplink-es-phone, s2-a-membersheet-deeplink-landed-es-phone, s2-b-membersheet-colddeeplink-en-phone.

**F2.9, minor. The invite link cannot be had without Web Share.**

- Steps: A on the group page or home in a Chromium with no `navigator.share` (headless, and desktop browsers that lack it).
- Expected: a way to copy the `/join/CODE` link.
- Actual: only "Copiar código". "Compartir el enlace" is hidden, so the copy fallback in `group-page.ts` `shareCode` is unreachable. The members page shows no code or link.
- Evidence: s2-a-group-empty-es-phone, s2-a-members-onlyowner-es-phone.

**F2.10, minor. A turned down person can ask again at once, with no limit.**

- Steps: 1. A turns C down. 2. C opens `/en/join/6WQKCPKS` and asks again.
- Expected: some cooldown or a limit.
- Actual: POST /v1/zones/join 201 PENDING again. A had to turn C down twice. Reject deletes the row.

**F2.11, minor. A join through a link by a user who has not finished setup gets no confirmation.**

- Steps: C (setup not done) opens `/en/join/6WQKCPKS` and presses "Ask to join".
- Expected: "You asked to join" shows.
- Actual: 201, then straight to `/en/setup` "Three questions..." with no confirmation until setup is skipped.
- Evidence: s2-c-afterjoin-newcode-en-phone.

**F2.12, cosmetic. Nested main landmarks on the members page.**

- Steps: open `/es/zones/:z/members` and read the landmarks.
- Expected: one `main`.
- Actual: `main.app-main` contains `main.page` (two role=main). Probably on every page.

**F4.6, minor. A non member on a group URL gets "not available" plus "Something went wrong on our side".**

- Steps: as C (e2e-carla) open `http://localhost:42005/en/zones/68c05640-724e-4d73-bfd3-b4126645d634`.
- Expected: one not available message.
- Actual: GET /v1/zones/:z 404. The heading "This group is not available to you..." and under it "Something went wrong on our side", "Try again", "ref ef633728-...". On the list URL C gets `list.gone.unshared` with "Back to the group" for a group she is not in.
- Evidence: s4-c-group-en-phone, s4-c-list-en-phone.

**F7.4, minor. Pasting a join code with a space in front or in the middle loses its last character.**

- Steps: 1. As Carla, open `/en/home/sheet/zones/join`. 2. Paste " 6WQKCPKS" (or "6WQK CPKS", " 6wqkcpks") into "Join code".
- Expected: "6WQKCPKS" and "Ask to join" enabled, as the link page and the Paste button already normalize.
- Actual: the field shows "6WQKCPK", counter 7/8, "Ask to join" disabled. Typing the characters one by one works. A trailing space is fine.
- Evidence: s7-c-joinsheet-leadingspace-paste-en-phone; `scripts/s7d2.js`.
- Cause: `libs/velista/ui/src/lib/entry/join-code-field.html:21` `maxlength="8"` cuts the raw paste to 8 characters before `normalizeJoinCode` (`join-code.ts`) drops the space.

### Lists and lines

**F3.1, major. Adding a product that is already on the list, from a user in the other locale, makes a second line.**

- Steps: 1. A (es) adds "Huevos, 24 uds" (Mercadona) to Compra semanal. 2. B (en) opens the same list and types "eggs" in "Add or find something". 3. The first card "Eggs €5.25 24 units" says "Product already in your list" with a stepper, and still shows its "+" button. 4. B presses "+".
- Expected: the existing Huevos line rises by one, as it does when the same name is sent.
- Actual: POST /v1/lists/1a120241-.../lines 201 creates a new line "Eggs" q=1. A sees two rows "Huevos 5,25 € 24 uds" (3 and 1). The same POST with content "huevos" and the same itemIds merges. The duplicate also shows in the basket composer (two steppers) and on B's list.
- Evidence: s3-b-search-eggs-onlist-en-phone, s3-b-search-eggs-afteradd-en-phone, s3-a-list-afterdelete-es-phone, s5-a-composer-huevos-es-phone, s5-b-list-after-a-partial-huevos-en-phone.
- Cause (unverified): the composer names the line with the card's name in the viewer's locale (`list-page.ts:1015` `chooseCard` to `composer.choose`). The core merge needs the same folded name (core `line.service.ts` about 856 to 960), so "Eggs" never matches "Huevos".

**F3.2, major. The list settings sheet on a cold load shows an empty name and the group sharing switch off.**

- Steps: A loads `http://localhost:42005/es/zones/68c05640-724e-4d73-bfd3-b4126645d634/lists/606dcfda-7caa-4be1-8ced-48484ae583cf/sheet/settings` directly, or reloads on it. Same for B on `.../6727e76f-.../sheet/settings` (en).
- Expected: the name is filled and "Todo el mundo de este grupo puede usar esta lista" is on, as when opened from the gear.
- Actual: name empty ("Guardar" disabled), sharing switch off. Nothing fills them after 3 s. A user who fixes the name then saves sharing off. Reproduced in scenario 7: the s7 report line says the name was filled, but shot s7-a-sheetcold-list-settings-es-phone shows the empty name and the box off again. The shot wins.
- Evidence: s3-a-sheet-list-settings-reloaded-es-phone, s3-a-listsettings-cold-es-phone, s3-b-listsettings-cold-en-phone, s7-a-sheetcold-list-settings-es-phone; GET /v1/lists/:id/access 200 on open.
- Cause: the sheet copies the values once in its constructor, before ListStore has the list.

**F3.3, major. After choosing a product from a list row, the chooser's own list still says "Elige un producto".**

- Steps: 1. A on Compra semanal (es) presses "Elige un producto para Velas". 2. Pick "Velas de cumpleaños, 20 uds" and press "Usar este producto". 3. Land on the list.
- Expected: the Velas row shows the product.
- Actual: PATCH /v1/lines/3da64f40-... 200 (103 ms), then GET lines 105, GET zone 208, GET lists 210. The row still reads "Velas / Elige un producto" 1.8 s later. B's open line page showed the product after 66 ms. Only a reload fixes A's row.
- Evidence: s3-a-list-afterchoose-es-phone, s3-a-list-afterchoose-reload-es-phone, s3-b-linepage-velas-afterAchoose-en-phone.
- Cause (unverified hypothesis): the list reloads its lines in parallel with the PATCH, and the realtime echo of the user's own update is dropped, so the older read wins.

**F3.4, major. Comment counts disappear on reload, so notes on a line are invisible.**

- Steps: 1. A and B comment on Leche semidesnatada (2 comments). 2. Reload `http://localhost:42005/es/zones/68c05640-724e-4d73-bfd3-b4126645d634/lists/1a120241-03f9-4acd-a538-75a8b6583024`.
- Expected: the row badge "2", "Comentarios, 2" on the detail sheet, a count on the line page Comments row.
- Actual: no badge, the detail button is "Comentarios", the line page row has no count. GET /v1/lines/a413f628-.../comments still returns 2.
- Evidence: s3-a-list-commentbadge-es-phone (live, with badge), s3-a-sheet-line-detail-reloaded-es-phone, s3-b-linepage-leche-en-desktop.
- Cause (from reading the response): GET /v1/lists/:l/lines has no comment count field. The count only arrives through realtime events.

**F3.5, minor. Line page back chevron is labelled "Volver al grupo" but goes to the list.**

- Steps: open `.../lists/1a120241-.../lines/9d59c551-f4eb-42dd-bc21-8732e94a1697` and press the header chevron.
- Expected: a label that names the list.
- Actual: aria-label "Volver al grupo" / "Back to the group", destination the list.
- Evidence: s3-a-linepage-pan-es-phone, s7-a-line-api400-es-phone.
- Cause: `line-page.html:8` uses `'list.header.back'` instead of `'list.page.toList'`.

**F3.6, minor. Composer search ranks partial matches above the plain product.**

- Steps: on any list type "leche" (es), "milk", "bread", "velas" (en), "aceite de oliva".
- Expected: the plain product first.
- Actual: "leche" opens with condensed milk and "Dulce de leche". "milk" has milkshakes and Milka and no plain milk, although "Semi-skimmed milk" exists. "aceite de oliva" opens with two tins of sardines. "bread" opens with Breadsticks. Suggest is also the slowest request (GET /v1/catalog/suggest 373 to 638 ms).
- Evidence: s3-a-search-leche-es-phone, s3-b-search-milk-en-phone, s3-a-search-aceite-es-phone, s3-b-search-bread-en-phone.
- Cause: probably the known ranking issue (stemmer, ts_rank ignores length). Not traced.

**F3.7, cosmetic. The "already on your list" card names the line in the adder's language.**

- Steps: B (en) searches "eggs" on Compra semanal.
- Expected: the same name as the row above.
- Actual: the row says "Eggs", the card under "Product already in your list" says "Huevos", stepper label "How many of Huevos".
- Evidence: s3-b-search-eggs-onlist-en-phone.

**F3.8, minor (intent unverified). A plain member cannot give a product to his own free text line.**

- Steps: 1. B adds "Velas" (free text) to A's Compra semanal. 2. B opens its line page in en.
- Expected: some way for B to say which candles he meant.
- Actual: row "Velas / No product". The line page "No product yet" has no "Choose a product" and no "Change".
- Evidence: s3-b-linepage-velas-noproduct-en-phone.
- Cause: B's lines are APPROVED at once (B holds DECIDE), and `canChooseProduct` needs MANAGE, or WRITE on an unapproved line (`select-list-state.ts:424`, `line-page.ts:173`). Looks deliberate.

**F4.8, minor. The list composer sends a catalog suggest that the gateway refuses for long text.**

- Steps: A types or fills a 300 character line name in the list composer.
- Expected: no failing request.
- Actual: GET /v1/catalog/suggest?q=<300 chars> 400 `validation_failed` (120 characters pass, 200 fail). Console "Failed to load resource ... 400". Enter still adds the line (201).
- Evidence: `scripts/out4/log.txt` "suggest len".

**F4.9, minor. A list row that arrives live after sharing says "List is empty".**

- Steps: 1. B on the group page. 2. A turns sharing on for a list with 4 lines.
- Expected: "4 of 4 pending".
- Actual: the row appears live as "List is empty". After reload "4 of 4 pending".
- Evidence: s4-b-group-afterShareOn-live-en-phone, s4-b-group-afterShareOn-reload-en-phone.

**F7.6, minor. A list URL with the id in upper case shows the gone block although every read succeeds.**

- Steps: A opens `/es/zones/:z/lists/BA90C2FD-2924-4114-92E1-779402AE0166`.
- Expected: the list, or the URL made lower case.
- Actual: "Lista / list.gone.unshared / Volver al grupo" while GET lines, trips and suggestions are 200.
- Evidence: s7-a-bad-list-uppercase-uuid-es-phone.
- Cause (unverified): probably a case sensitive id match against the group's lists.

**F7.7, minor. A list under a group id that does not exist renders the list, read only, with wrong copy.**

- Steps: A opens `/es/zones/3f1c2b7e-9d4a-4c1e-8b2a-6e5f4d3c2b1a/lists/ba90c2fd-...` (random group, real list).
- Expected: not found, or a redirect to the list's real group.
- Actual: GET zone, lists and members 404, GET lines 200. The page reads "Lista, 3 de 3 pendientes, No se está actualizando ahora, Puedes ver esta lista, no cambiarla" with all lines. A owns the list. No data leak.
- Evidence: s7-a-bad-group-random-list-es-phone.

**F7.8, minor. A real line opened under another list says it was deleted.**

- Steps: A opens `/es/zones/:z/lists/ba90c2fd-.../lines/a413f628-...` (a line of Compra semanal), and `.../sheet/lines/a413f628-.../detail`.
- Expected: not found, or a redirect to the line's own list.
- Actual: "Esta línea se borró y ya no está disponible" on both. The sheet still fires GET /v1/lines/a413f628-.../settlements 200.
- Evidence: s7-a-bad-line-of-other-list-es-phone, s7-a-bad-sheet-detail-other-list-line-es-phone.

**F7.10, minor. A long line name cannot be read in full anywhere except inside the rename field.**

- Steps: phone, a line with 400 characters (or "Jamón ibérico 🐖 de bellota").
- Expected: the line page shows the full name.
- Actual: the list row and the line page title are each one ellipsized line. The full text is only in the single line inputs of the rename and detail sheets.
- Evidence: s7-a-list-longnames-es-phone, s7-a-line-api400-es-phone.

### Privacy

**F4.1, blocker. Every group member receives the content of private lists over the realtime socket.**

- Steps: 1. Log in as B through the API and connect socket.io to `http://localhost:43101` (websocket, `auth:{token}`). 2. Emit `zone.subscribe {zoneId:68c05640-...}` (ack ok:true; velista does this for each group). 3. `list.subscribe` for the private list acks ok:false, as expected. 4. As A: POST /v1/lists/ddcf23fd-.../lines `{content:"SECRETO perfume para Bruno"}`, POST /v1/lines/4b637ec6-.../comments `{body:"SECRETO que no lo vea Bruno"}`, PATCH the line, DELETE it.
- Expected: B receives nothing about a list he cannot read.
- Actual: B's socket receives `line.added` with the full line (listId, content, creator), `comment.added` with the comment body, `line.updated` and `line.deleted`. Repeated after A removed B's access: B's own unmodified velista tab on the group page received `42["line.added",{..."listId":"ddcf23fd-...","content":"SECRETO2 reloj"...}]`. The UI does not draw it, but the data reaches the device and any devtools.
- Evidence: `scripts/out4/log.txt` `[B event]` and `[B browser ws frames ...]` lines, line 172; `s4c.json`.
- Cause, verified by the orchestrator in `apps/luna-shopper-backend/realtime/src/app/consumer/jetstream.consumer.ts:376-383` and in the captured frame: core `CoreEventsPublisher.emit(event, zoneId, payload, listId)` sets both zoneId and listId on the envelope (`core-events.publisher.ts:64` to `68`; callers `line.service.ts:979`, `comment.service.ts:100`). Realtime `roomsFor` fans out to `zone:{id}` as well as `list:{id}`. The zone room holds every approved member, so the list room access check (`subscribeList`, `realtime.gateway.ts:335` to `345`) is bypassed. `list.created` and `list.updated` of a private list go the same way (`list.service.ts:278`, `610`), so the name of a private list very likely reaches B too (unverified live).

**F4.2, major. Turning "Everybody in this group can use this list" off does not make the list private again.**

- Steps: 1. A opens the private list, gear "Ajustes de la lista", ticks "Todo el mundo de este grupo puede usar esta lista" (PATCH 200). 2. B opens the list. 3. A unticks it (PATCH `sharedWithZone:false` 200).
- Expected: B loses the list, or A is shown that B keeps it.
- Actual: B keeps READ, WRITE and DECIDE (GET access `entries:[{membershipId f034ea97..., ["READ","WRITE","DECIDE"]}]`), and sees and edits the list live and after reload. Only the small hint "Desactivarlo no se la quita a nadie que ya la tenga" says so. A must open each member and untick "Puede ver esta lista". The intent is documented (`list.service.ts:541`), but a one tap "make it private" leaves a surprise gift readable.
- Evidence: s4-b-list-afterShareOff-live-en-phone, s4-b-list-afterShareOff-reload-en-phone, s4-a-listsettings-sharedOff-es-phone.

**F4.3, major. The gone block shows the raw key `list.gone.unshared`.**

- Steps: as B open `http://localhost:42005/en/zones/68c05640-724e-4d73-bfd3-b4126645d634/lists/ddcf23fd-4f5b-4fc2-901f-821bfd1d0e58` (also `/es`, in app, every sheet URL of the list, after a live revoke; as C too).
- Expected: a translated message that says the list is not shared with this person.
- Actual: header "List" / "Lista", body "list.gone.unshared", button "Back to the group". GET lines 403, GET trips 403. Widened in s7: a list id that does not exist (GET lines 404) shows the same raw key, and so does an upper case id (F7.6).
- Evidence: s4-b-cold-list-en-phone, s4-b-cold-list-es-phone, s4-b-cold-list-en-desktop, s4-b-list-afterRevoke-live-en-phone, s4-c-list-en-phone, s7-a-bad-list-random-es-phone.
- Cause: `libs/velista/feature-lists/src/lib/list-page/list-page.html:67` and `:69` use `list.gone.deleted` and `list.gone.unshared`, which are missing from `libs/velista/ui/assets/i18n/en.json` and `es.json` (`list.gone` has only byOthers, unavailable, close).

**F4.4, minor. Sheet URLs of a forbidden list still open their sheets over the gone block, with wrong copy.**

- Steps: as B open `.../lists/ddcf23fd-.../sheet/settings`, `/sheet/filter`, `/sheet/lines/c0dc4e32-.../comments`, `/lines/10b68055-.../sheet/comments` (cold or in app).
- Expected: no sheet, or the sheet closes to the gone block.
- Actual: the settings sheet draws an editable form (empty name, "Delete this list", "Save") and fires GET /access 403. The filter sheet offers "Show 0 lines". The comments sheet says "Nothing said about this yet" and "You can read this list, not change it" while GET comments is 403. No data leaks. The scoring pass also found the line detail and line page menu sheets open as blank strips (S12).
- Evidence: s4-b-cold-sheet-settings-en-phone, s4-b-cold-sheet-line-comments-en-phone, s4-b-cold-sheet-filter-en-phone, s4-b-cold-lp-sheet-comments-en-phone.

**F4.5, minor. Line page and history of a forbidden list show a generic load error with a useless retry.**

- Steps: as B open `.../lists/ddcf23fd-.../lines/c9ac491e-...` and `.../history`.
- Expected: the gone block of the list page.
- Actual: "Product" / "This line could not be loaded." with "Try again", which repeats the 403. The es history has the message with no button.
- Evidence: s4-b-cold-line-catalog-en-phone, s4-b-cold-line-history-en-phone, s4-b-cold-line-history-es-phone, s4-b-inapp-line-en-phone.

**F4.10, cosmetic. An empty private list says everyone will see it.**

- Steps: A opens the new empty private list.
- Expected: copy that fits a private list, and a private mark.
- Actual: "Escribe lo primero y todos lo verán". Nothing on the list or group page marks the list as private.
- Evidence: s4-a-list-private-empty-es-phone.

### Shopping alone

**F5.1, major. Realtime `basket.updated` is dropped, so other open tabs never learn that a trip finished.**

- Steps: 1. A opens `/es/shopping-lists/2cff9488-...` in two tabs. 2. A finishes the trip in tab 1 (or PATCH /v1/baskets/:id `{status:FINISHED}`).
- Expected: tab 2 reads the basket again and shows "Esta compra está terminada".
- Actual: the frame `basket.updated {"basketId":...,"kind":"GENERATED","name":null,"status":"FINISHED"}` arrives at +17 ms. The UI does not change in 10 s (twice). The tab learns of the finish only from a 409 on its next write. Seen again in s6 for B and the guest.
- Evidence: `scripts/s5m.js` frame log; s5-a-stale-after-finish-es-phone, s6-b-after-finish-write-en-phone.
- Cause: `realtime-event-mapper.ts:301-307` maps the payload through `toBasketFromView`, and `mappers.ts:1531-1535` (`toBasketSummary`) returns null without `id` and `generatedAt`. The payload carries `basketId` and no `generatedAt`, so the event is dropped before `basket-store.ts:283`. The rename, reopen and dashboard paths (`basket-list-store.ts:237`) probably fail the same way (unverified).

**F5.2, major. At a shop that publishes no prices (Deza), the basket shows other chains' prices as that shop's, and totals them.**

- Steps: 1. As A open `/es/shopping-lists/live`. 2. "Filtrar y ordenar", "Elegir la tienda", Deza, "Calle Libertador Sucre 38".
- Expected: rows unpriced, or labelled "17,25 € en Mercadona", as the Mercadona and El Jamón modes do.
- Actual: the chip reads "Deza", the total "~52,92 €", the rows "17,25 €", "5,25 €" and "1,55 €" with no chain named. The product page for the same oil says "Deza aquí no se vende". Kumato shows "2,95 €" next to "No disponible en esta tienda".
- Evidence: s5-a-live-shop-deza-es-phone; GET /v1/baskets/:id?locationId=0182ce5a... gives every product `atShop.price:null`.
- Cause: `compose-basket-view.ts:610-622` `basketPricedAtShop` is false when no row has an atShop price, so `basket-view.ts:854` `shownOffer` falls back to the cheapest offer anywhere while the chip still names the shop.

**F5.3, major. The basket shop picker leaves out Lidl although 3 Lidl shops are in the profile's codes.**

- Steps: A, live basket, "Filtrar y ordenar", "Elegir la tienda".
- Expected: the chains that setup and `/es/account/profiles/:id/supermarkets` show (El Jamón, Mercadona, Lidl 3 tiendas, Otras tiendas 8).
- Actual: only "Mercadona 9 tiendas, El Jamón 15 tiendas, Deza 8 tiendas" (B sees "Deza 7 shops"). A shopper in Lidl Avda. de Cádiz 68 (14013) can pick it only through "Cerca de mí". Carrefour appears only in the profile chain list and has no shop in 14013 or nearby (S5).
- Evidence: s5-a-shoppicker-es-phone, s5-a-profile-supermarkets-es-phone; the basket `scopes` hold no Lidl entry. In the slot 2 catalog database the Lidl shops have a STORE scope (0 prices) on top of REGION 43 (67 prices).
- Cause: `basket-catalog.service.ts:653-669` `scopesOf` keeps only scopes that quote a product of this basket. Lidl quotes none, so the picker (`shop-picker-sheet.ts:385`) has no button for it.

**F5.4, major. A basket URL opened signed out, or by a signed in non participant, says "no longer on this list" and offers no way forward.**

- Steps: (a) New context, no session, `http://localhost:42005/es/shopping-lists/2cff9488-4dd1-45c1-82cf-ae9c45600eb8`. (b) B (signed in, never a participant) opens `/en/shopping-lists/2cff9488-...`.
- Expected: a sign in path, or for B "this is not your list" with a way home.
- Actual: (a) "Ya no estás en esta lista / Este enlace ya no admite gente / Pídele uno nuevo a quien te lo mandó", with no buttons, links or nav. (b) "You are no longer on this list / This link is no longer accepting people", which is false. The nav shows.
- Evidence: s5-anon-basket-es-phone, s5-b-a-generated-basket-nonparticipant-en-phone; POST participant-token 401 and GET basket 401, two console 401 errors.

**F5.5, minor. A 409 `basket_finished` on a tick is silent.**

- Steps: after F5.1, in tab 2 tap "Marcar Aceite".
- Expected: the copy "The owner finished this shopping trip" shows.
- Actual: POST settle 409, then a GET. The tick reverts and only the banner "Esta compra está terminada. Reabrir" appears. No live region names the refused tap. Console "Failed to load resource ... 409".
- Evidence: s5-a-stale-409-moment-es-phone, s5-a-stale-409-after-es-phone.

**F5.6, minor. The amounts of a finished trip depend on the viewer's local shop choice.**

- Steps: 1. B finishes 21766b1c-... with El Jamón chosen. 2. B opens the same basket in a new desktop context.
- Expected: one set of amounts for a finished trip.
- Actual: the phone shows "~€0.00 bought · ~€2.95 left". The desktop (no shop) shows "~€1.95 bought · ~€4.90".
- Evidence: s5-b-generated-finished-en-phone, s5-b-generated-en-desktop.

**F5.7, minor. Opening the filter sheet reads the whole basket again.**

- Steps: A on `/es/shopping-lists/live`, open "Filtrar y ordenar".
- Expected: the sheet opens with no data reads.
- Actual: GET rows 154 ms, then GET basket 455 ms. The sheet takes 1149 ms. Seen on the first open with the "10 cambios" banner present (cause unverified).
- Evidence: timing s5-a-filter-open-es-phone.

**F5.8, cosmetic. On desktop the bottom sheets span the full 1440 px while the page column is 480 px.**

- Steps: open a settle sheet at 1440x900.
- Expected: the sheet matches the page column.
- Actual: "Ya tengo los 2" is a 1400 px wide button. Also seen on the new list sheet and line detail sheet.
- Evidence: s5-a-settle-sheet-pan-es-desktop, s2-a-newlist-sheet-es-desktop, s3-b-sheet-line-detail-en-desktop.

**F5.9, cosmetic. The "10 cambios en tus listas" banner runs edge to edge on the phone.**

- Steps: A opens the live basket on a phone.
- Expected: a 16 px gutter.
- Actual: no gutter; the rounded border is cut at both screen edges. The "You are on this list until" banner does the same.
- Evidence: s5-a-live-cold-es-phone, s6-b-basket-joined-en-phone.

**F5.10, minor. A deleted line stays in the live basket hours later.**

- Steps: A deletes "Tomate kumato" from Compra semanal (s3). Later B opens `/en/shopping-lists/live`.
- Expected: the row is gone.
- Actual: a struck through "Tomate kumato · No longer on the list". The deleted "Servilletas" row in s6 also stays crossed after reload.
- Evidence: s5-b-live-cold-en-phone.

**F5.11, minor. One basket page holds 3 socket.io connections to :43101.**

- Steps: open a basket page and watch the websocket frames.
- Expected: one connection.
- Actual: three connections; each `basket.updated` frame arrived 3 times. In s6 each `basket.unshared` and `linesChanged` frame arrived twice.
- Evidence: `scripts/s5m.js`.

### Shopping together

**F6.1, major. A tap meant to tick becomes Undo when the other person's tick lands under the finger, and silently reverts their purchase.**

- Steps: 1. A (es) and B (en) on `/.../shopping-lists/fb36b369-...`, shop question off. 2. A taps "Marcar Tarta de chocolate grande como conseguido". 3. 400 ms later B taps the same round control.
- Expected: B's tap does nothing, or says "already got". The line stays bought.
- Actual: A POST settle 201 @171. The socket turns B's control into "Tarta de chocolate grande is got. Undo it" before B's tap. B's tap sends POST /rows/4bc56596.../revert `{"target":"UNITS","units":1,"from":1}` 201 @538. Both pages end on "Mark ... as got". A's purchase is gone with no message to either. Reproduced earlier with Velas.
- Evidence: s6-a-e2c-after-es-phone, s6-b-e2c-after-en-phone; `scripts/s6f.js` write log.
- Cause (partial): the row button decides tick or undo from the state drawn at tap time. The revert carries `from:1`, which still matches, so the server accepts it.

**F6.2, major. Two people raising the same quantity at once: one increment is lost, and the loser sees only "That did not save. Try again".**

- Steps: 1. A and B open the settle sheet of Refresco cola (list asks 3, reel shows 2 left). 2. A presses ArrowUp on the "pide / asks for" reel. 3. 300 ms later B does the same.
- Expected: both count (2 to 4), or the loser is told the new number.
- Actual: A POST demand `{"quantity":3,"from":2}` 201. B sends the same body and gets 409 `stale_quantity`. Server quantity 3, both reels 3. B reads "That did not save. Try again", not the existing copy "Somebody else changed this line. It says 3 now".
- Evidence: s6-b-e4-moment-en-phone, s6-b-e4-after-en-phone; console "409 (Conflict)".
- Cause: `basket-api.ts:369-381` `setDemand` posts an absolute quantity with `from`, while the list page reel posts a delta (POST /v1/lines/:id/quantity).

**F6.3, major. "Also remove the 2 guests" on revoke also removes a registered group member.**

- Steps: 1. B (signed in, member of Casa Córdoba) and a guest join by link 1. 2. A: "Compartir esta lista", "Revocar el enlace". The pane reads "Quitar también a los 2 invitados que se unieron con él". 3. Tick it and press "Revocar el enlace".
- Expected: only the guest is removed, or the copy says "2 personas".
- Actual: participantLeft for B (kind REGISTERED) and the guest. B gets "You are no longer on this list". Participants afterwards: OWNER only.
- Evidence: s6-a-revoke-sheet-es-phone, s6-a-revoke-sheet-cascade-ticked-es-phone; `scripts/s6h.js` frames.
- Cause: the cascade label in `share-sheet.html` uses `joinedCount()` (every link joiner) with the "guests" string. Backend `revokeParticipants` removes every participant with that shareLinkId.

**F6.4, major. A signed in member who was removed and opens a new link is offered "Continue as guest" with "That did not work. Try again."**

- Steps: 1. After F6.3, A makes link 2. 2. B (signed in) opens `http://localhost:42005/s/7-qcthEEDLArtXr-l6OxWudKuHDInYqD53198Z6ZcBE`.
- Expected: "You were removed from this list. Ask Ana to add you", and no guest offer to a signed in person.
- Actual: POST join 401. The page shows the guest offer with "Continue as guest / That did not work. Try again. / Continue with Google / Sign in with email". Retries fail the same way.
- Evidence: s6-b-link2-after-cascade-en-phone.
- Cause: `join-page.ts` `join()` catch sets `failed` for every error, so a 401 `not_a_participant` is drawn as a network hiccup.

**F6.5, major. `/s/:secret` hangs forever on "Checking the link" when the preview request fails.**

- Steps: 1. Clean context. 2. Make GET :43100/v1/share-links/{secret} fail with a network error (or a 503). 3. Open `/en/s/PjLG6E1bUXxEcS5l8ve8ewmuq3mAIxreGdn-3McqYf4`.
- Expected: an error with "Try again".
- Actual: "Velista / Checking the link" after 8 s, with no control. Console "NetworkError: network failure during basket.preview" or "GatewayError: internal (503)". Malformed or random secrets are fine (200 joinable:false).
- Evidence: s6-anon-link-preview-neterror-en-phone, s6-anon-link-preview-503-en-phone.
- Cause: `join-page.ts` `_check()` awaits `previewLink` with no try/catch, so the state stays `checking`.

**F6.6, minor. Sign in from the share link loses the return URL.**

- Steps: 1. Signed out, open `/es/s/PjLG6E1b...`. 2. Press "Entrar con correo". 3. Sign in as Carla.
- Expected: back on the link, joined.
- Actual: `/es/auth/login` with no return parameter, then `/es/home`. The link is lost. "Crear una cuenta" behaves the same.
- Evidence: s6-g-signin-from-link-es-phone, s6-g-after-signin-from-link-es-phone.
- Cause: `join-page.ts` `signIn()` and `register()` navigate to auth/login and auth/register with no returnUrl.

**F6.7, minor. Contradictory banners after removal or finish.**

- Steps: 1. B or a guest is on the shared trip. 2. A revokes the link with the cascade, or finishes the trip.
- Expected: one state message.
- Actual: "You are on this list until 10:31 PM ... Got it" stays above "You are no longer on this list". A guest on a finished trip reads "You are on this list until 10:50 PM" above "This trip is finished."
- Evidence: s6-b-after-revoke-live-en-phone, s6-g-after-revoke-action-en-phone; `scripts/s6j.js` "G after reload".

**F6.8, minor. A guest removed by name is told after reload that the link no longer accepts people.**

- Steps: 1. A removes guest Hugo from People while the link still works. 2. Hugo reloads.
- Expected: "You were removed from this list", with a way out.
- Actual: "This link is no longer accepting people", which is false. The revoked and finished pages for a guest have no control at all. Related to F5.4.
- Evidence: s6-g2-after-removal-reload-en-phone, s6-g-after-revoke-reload-en-phone.

**F6.9, minor. The dead link page offers no button or link.**

- Steps: signed out, open `/en/s/abc` (also a random, revoked or finished link).
- Expected: an action such as opening the app.
- Actual: one card, no button, link or nav. A malformed link is told it is "no longer" accepting people.
- Evidence: s6-anon-link-malformed-en-phone, s6-anon-link-random43-en-phone.

**F6.10, minor. Escape does not close the share sheet right after "Crear un enlace".**

- Steps: 1. A opens the share sheet. 2. Press "Crear un enlace". 3. Press Escape.
- Expected: the sheet closes.
- Actual: the pressed button is replaced and focus falls to body. The scrim kept catching clicks on the header until "Cerrar". Escape on a fresh share sheet works. Escape with focus on the settle sheet's demand reel also did not close that sheet. Unverified beyond these two runs.
- Evidence: `scripts/s6g.js`.

### Navigation and locale

**F1.1, minor. Browser back after the landing language switch shows English under an /es URL.**

- Steps: 1. Clean context, open `http://localhost:42005/es`. 2. "Cambiar idioma", pick EN (URL `/en`). 3. Browser back.
- Expected: URL `/es` with Spanish text.
- Actual: URL `/es`, h1 "One list. Everyone in sync.", html lang en, stored locale en. A reload shows Spanish. The other direction fails too. The switcher pushes history entries, but popstate does not apply the locale.
- Evidence: s1-a-landing-afterback-urlES-mismatch-phone.

**F4.7, minor. A signed out deep link drops the target.**

- Steps: signed out, open a list, line or group URL.
- Expected: a sign in prompt that returns to the target.
- Actual: lands on the landing `/en` or `/es`. No sign in prompt, and no return after sign in. No data shown.
- Evidence: s4-anon-list-en-phone, s4-anon-group-en-phone.

**F7.1, blocker. Any browser language other than English or Spanish shows raw translation keys on every page, and the URL locale does not fix it.**

- Steps: 1. Fresh context with browser locale fr-FR (also de-DE, pt-BR, it). 2. Open `http://localhost:42005/`. 3. Reload. 4. Open `/es`, then `/en`. 5. Signed in as A in a fr-FR context, open `/home`; signed out, open `/en/auth/login`.
- Expected: the app uses its default (en) or the URL locale and shows text.
- Actual: redirect to `/en` with h1 "home.hero.headline.top home.hero.headline.bottom". After reload, after `/es` (storage now "es") and after `/en`: still raw keys. Signed in: "app-title", "auth.nudge.title", "HOME.SECTION.ZONES", "zone.role.owner", nav "nav.home". Login: "auth.signIn.title", "AUTH.FIELD.EMAIL". No translation chunk is requested at all. No console error. A French, German, Portuguese or Italian phone cannot sign in or register.
- Evidence: s7-anon-frFR-root-phone, s7-a-frFR-home-phone, s7-anon-frFR-after-switch-phone, s7-anon-frFR-login-phone; `scripts/s7g.js`, `s7g2.js`.
- Cause, verified by the orchestrator in shot s7-a-frFR-home-phone and in `rokutranslator.ts:156` and `:197`: `rokutranslator.ts:151` to `157` falls back to `getBrowserLocale()`, which returns undefined when no browser language is supported (`:232` to `247`). i18next then starts with `lng: undefined` (`:197`), the namespaces never load, and later `changeLocale` calls do not recover.

**F7.2, major. Browser back from a cold deep link leaves the app on every page type, also after the in app back.**

- Steps: 1. As A, in a new tab open `http://localhost:43141` (Mailpit, the referrer), then a deep link from the table. 2. Press browser back. 3. Repeat in a new tab with no prior entry. 4. Repeat with the referrer, but first press the in app back (header chevron, or Escape on a sheet), then browser back.
- Expected: browser back never leaves the app (the owner's rule).
- Actual: history.length is 3 in each case. The in app back replaces the entry, so it does not add a step.

  | page (deep link, es)       | back with referrer | back with no entry | in app back goes to    | then browser back |
  | -------------------------- | ------------------ | ------------------ | ---------------------- | ----------------- |
  | /home                      | Mailpit            | about:blank        | (no back control)      | Mailpit           |
  | /zones/:z                  | Mailpit            | about:blank        | /home                  | Mailpit           |
  | /zones/:z/members          | Mailpit            | about:blank        | /zones/:z              | Mailpit           |
  | /zones/:z/lists/:l         | Mailpit            | about:blank        | /zones/:z              | Mailpit           |
  | .../lines/:line            | Mailpit            | about:blank        | the list (F3.5)        | Mailpit           |
  | /account                   | Mailpit            | about:blank        | /home                  | Mailpit           |
  | /account/profiles          | Mailpit            | about:blank        | /account               | Mailpit           |
  | /shopping-lists            | Mailpit            | about:blank        | /home                  | Mailpit           |
  | /catalog/products/:id      | Mailpit            | about:blank        | /catalog               | Mailpit           |
  | list sheet/lines/:l/detail | Mailpit            | about:blank        | the list (Escape)      | Mailpit           |
  | line sheet/name            | Mailpit            | about:blank        | the line page (Escape) | Mailpit           |

  This absorbs two earlier sightings that were recorded as native browser behaviour: s2 (a member sheet deep link after Mailpit, back returned to `http://localhost:43141/`) and s5 (back from a cold `/es/shopping-lists/live` gave about:blank).

- Evidence: `scripts/s7c.js` "back" rows; s7-a-back-list-after-es-phone, s7-a-back-line-sheet-after-es-phone.
- Cause: `PageNavigation.back` and `SheetNavigation.dismiss` go to the fallback with replaceUrl after a cold load, and nothing inserts an app entry under a cold deep link. The entry below is always the referrer or the empty tab. A sheet URL opened cold has no page entry under it either.

**F7.5, minor. `<html lang>` is always "en", also on every /es page.**

- Steps: A on any `/es` page, read `document.documentElement.lang`.
- Expected: "es" under `/es`.
- Actual: "en" on all 15 page types. Screen readers read Spanish with an English voice.
- Evidence: `scripts/s7g.js` rows.
- Cause: `apps/velista/src/index.html:2` `<html lang="en">`, and nothing in velista or rokutranslator-angular sets `documentElement.lang`.

### Offline

**F7.3, major. A quantity change pending when the network drops is lost silently.**

- Steps: 1. As A open `/es/zones/:z/lists/ba90c2fd-...`. 2. Focus the reel of "Pan de pueblo" (1) and press ArrowUp (2). 3. 300 ms later set the network offline. 4. After 3 s bring it back.
- Expected: the +1 is sent when the connection returns, or the user is told it was not saved.
- Actual: POST /v1/lines/aaf5a88f-.../quantity fails with net::ERR_INTERNET_DISCONNECTED. The overlay appears. On reconnect the page reloads by itself; the reel shows 1 and the server has 1. Nothing says the change was dropped. Likely the same for any optimistic write in flight (unverified).
- Evidence: s7-a-offline-reel-pending-es-phone, s7-a-online-after-reel-es-phone; `scripts/s7h.js` "reel online".

**F7.9, minor. The offline overlay's own icon cannot load offline.**

- Steps: on any page, set the network offline.
- Expected: the overlay shows its icon.
- Actual: console "ERROR ChunkLoadError: Loading chunk libs_velista_ui_src_lib_icons_offline-icon_svg_raw failed" three times. The icon is a lazy `import('./offline-icon.svg?raw')` chunk first needed when there is no network. Dev server; whether the production service worker precaches it is unverified.
- Evidence: s7-a-offline-idle-es-phone; `scripts/s7h.js` errors.

### Notes (not defects)

- The share link names port 4205 on a 42005 slot (`http://localhost:4205/s/...`). This is a known dev slot artifact: the share origin is compiled in. Open the link's path on `http://localhost:42005`.
- Shot s4-a-listsettings-afterRevoke-es-phone looked like the owner saw the gone block. A recheck (s7-a-privatelist-owner-cold-es-phone, s7-a-privatelist-owner-settings-es-phone) shows the owner sees the list, its 4 lines and the filled settings. The s4 shot is treated as mislabelled (unverified). No defect is filed.
- Lead refuted: the line page does get realtime updates on a cold load. B's API quantity change showed after 61 ms and A's product change after 66 ms (s3).
- The 8.9 s first open of the line supermarket sheet is an outlier caused by external logo hosts. The dialog was visible at 1399 to 1569 ms in a recheck. The hot linked logos are filed as S11, not the time.

### Scoring pass findings

These come from the screen scoring batches b1 to b5. Each was seen in the cited shots. The steps are: open the named URL pattern as the named user and look at the shot's state.

| id  | severity | title                                                                  | where                                                                      | expected                                                | actual                                                                                                                                                                  | shots                                                                                                                 |
| --- | -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| S1  | cosmetic | Language switcher chevron renders as a broken glyph                    | `/es`, menu open                                                           | a chevron                                               | a broken glyph while the menu opens                                                                                                                                     | s1-a-landing-switchermenu-es-phone                                                                                    |
| S2  | minor    | Password mismatch paints the correct first field red                   | `/es/auth/register`                                                        | only the confirm field marked                           | both fields red                                                                                                                                                         | s1-a-register-mismatch-es-phone                                                                                       |
| S3  | minor    | Short password rule only after a server round trip                     | `/es/auth/register`                                                        | hint turns red under 8 before submit                    | hint grey, button enabled, rule after the 400                                                                                                                           | s1-a-register-shortpw-es-phone                                                                                        |
| S4  | cosmetic | Caps chips unlike the rest                                             | home, history, people sheet                                                | sentence case like "Member", "Dueño"                    | "PENDING", "FINISHED", "TÚ", "INVITADO"                                                                                                                                 | s2-b-home-pending-en-phone, s5-b-history-after-finish-en-phone, s5-a-sheet-people-es-phone                            |
| S5  | minor    | Profiles chain list shows Carrefour, which has no shop near 14013      | `/es/account/profiles` (A)                                                 | the chains setup showed                                 | Carrefour listed first; no shop in 14013 or nearby, no prices (s5 checked the catalog database)                                                                         | s1-a-account-profiles-filled-es-phone                                                                                 |
| S6  | cosmetic | Double focus ring on focused fields                                    | login, create list, line name, join code, line name 400                    | one ring                                                | blue ring outside an orange border                                                                                                                                      | s1-a-login-wrongpw-es-phone, s3-a-createlist-sheet-filled-fiesta-es-phone, s7-c-joinsheet-leadingspace-paste-en-phone |
| S7  | minor    | Destructive buttons have dark text on crimson                          | member remove and ban, delete line, delete profile                         | readable contrast                                       | near black label on crimson                                                                                                                                             | s2-a-membersheet-remove-other-es-phone, s3-a-deleteline-confirm-es-phone, s7-a-sheetcold-profiles-delete-es-phone     |
| S8  | minor    | Disabled primary buttons look enabled or vanish                        | login, create list, delete account, detail sheet                           | a clear disabled state                                  | pale orange or pink with grey text, low contrast                                                                                                                        | s1-a-login-empty-es-phone, s3-b-createlist-sheet-empty-en-phone, s7-a-sheetcold-account-delete-es-phone               |
| S9  | minor    | A line at quantity 0 counts as progress                                | list page, line page                                                       | a skipped line reads as skipped                         | bar fills green, "7 of 8 pending"; the zero row keeps full weight; line page at 0 still reads pending                                                                   | s3-b-list-qty-zero-reload-en-phone, s3-a-list-qty-zero-es-phone, s7-a-line-qty0-es-phone                              |
| S10 | cosmetic | Comment badge pushes the price out of its column                       | list page                                                                  | price column intact                                     | price shifted                                                                                                                                                           | s3-a-list-afterdelete-es-phone                                                                                        |
| S11 | minor    | Chain logos are hot linked from four external hosts                    | line supermarket sheet, shop picker, product page                          | logos served by the app                                 | empty logo tiles (El Jamón always); first cold open waited 7455 ms on upload.wikimedia.org, with logos-world.net, dezacalidad.es and supermercadoseljamon.com also used | s3-a-sheet-linepage-supermarket-es-phone, s5-a-shoppicker-full-es-phone, s7-a-line-supermarket-sheet-es-phone         |
| S12 | minor    | Line detail and line page menu sheets open blank over a forbidden list | `.../sheet/lines/:id/detail`, `.../lines/:id/sheet/menu` (B, private list) | no sheet, or the gone block                             | white strips with only a handle (extends F4.4)                                                                                                                          | s4-b-cold-sheet-line-detail-en-phone, s4-b-cold-lp-sheet-menu-en-phone                                                |
| S13 | cosmetic | Composer result card outlines misaligned                               | list and basket composer                                                   | aligned cards                                           | second card starts about 18 px further left                                                                                                                             | s4-b-composer-tarjeta-en-phone, s5-a-composer-huevos-es-phone                                                         |
| S14 | minor    | Live basket rows break on long names and scroll                        | `/es/shopping-lists/live`                                                  | one or two lines, clean scroll                          | 300 character line wraps 10 lines; list name collapses to "C..."; scrolled rows bleed under the sticky header                                                           | s5-a-live-shop-eljamon-es-phone, s5-a-live-untick-aceite-es-phone, s5-a-live-huevos-partial-es-phone                  |
| S15 | cosmetic | Basket reel covers the "Nueva" chip                                    | live basket, reel open                                                     | chip and label visible                                  | chip covered, "1 comprado" clipped                                                                                                                                      | s5-a-reel-huevos-dragged-es-phone                                                                                     |
| S16 | minor    | Sticky button in the basket filter sheet covers a list row             | `/live/sheet/filter`                                                       | all rows readable                                       | "Ver 13 líneas" cuts the third row after "Casa"                                                                                                                         | s5-a-filter-sheet-es-phone                                                                                            |
| S17 | minor    | Shop picker shop count changes between opens                           | shop picker (A)                                                            | a stable count                                          | Deza "8 tiendas" in one open, "7 tiendas" in another                                                                                                                    | s5-a-shoppicker-withchoice-es-phone, s5-a-generated-ask-shop-es-phone                                                 |
| S18 | minor    | Finished trip banner scrolls away and tick circles remain              | finished generated basket                                                  | a clear finished state                                  | banner not sticky; empty tick circles look tappable                                                                                                                     | s5-a-generated-finished-es-phone                                                                                      |
| S19 | cosmetic | Double space and no separator in a product line                        | list page (B)                                                              | "Birthday candles · 20 units"                           | "Birthday candles 20 units"                                                                                                                                             | s5-b-list-after-a-partial-huevos-en-phone                                                                             |
| S20 | minor    | Share sheet shows a member on the trip as unticked                     | `.../sheet/share` (A)                                                      | Bruno ticked                                            | Bruno unticked with "Aquí con el enlace hasta las 22:31"                                                                                                                | s6-a-share-sheet-with-joiners-es-phone                                                                                |
| S21 | cosmetic | Blue focus outline along the sheet top edge on a cold open             | share, settings, detail, account name sheets                               | no outline, or a contained one                          | blue outline cut at the rounded corners                                                                                                                                 | s6-a-sheet-share-es-phone-reloaded, s4-b-cold-sheet-settings-en-phone, s7-a-sheetcold-account-name-es-phone           |
| S22 | cosmetic | Presence avatars overlap and clip                                      | share sheet, finish sheet, guest basket                                    | whole initials                                          | "A( G", "I3", "G:"                                                                                                                                                      | s6-a-share-sheet-link-es-phone, s6-a-finish-shared-es-phone, s6-g3-after-finish-reload-en-phone                       |
| S23 | minor    | Shared basket bar reads full with 3 lines unbought                     | shared basket (A)                                                          | progress by lines, or a caveat                          | bar full, "~0,00 € por comprar" with 2 of 5 got and 3 unpriced                                                                                                          | s6-a-e1-after-es-phone                                                                                                |
| S24 | minor    | A guest is told "1 change on your lists"                               | shared basket (guest)                                                      | no list banner for a guest                              | the banner, and "Another list" on every row                                                                                                                             | s6-g-qty-changed-live-en-phone                                                                                        |
| S25 | minor    | Settle sheet header count disagrees with the rows                      | settle sheet (B)                                                           | matching counts                                         | "2 of 6 got" while the list shows 5 rows                                                                                                                                | s6-b-e4-after-en-phone                                                                                                |
| S26 | minor    | Person sheet prints the raw User Agent                                 | people sheet, person detail (A)                                            | a readable device name                                  | "Mozilla/5.0 (Windows NT 10.0; ...) HeadlessChrome/147..." as "Dispositivo"; remove has no confirm or undo                                                              | s6-a-people-hugo-es-phone                                                                                             |
| S27 | cosmetic | Offline icon used for a removal or permission state                    | basket not reachable, after revoke                                         | an icon that fits                                       | crossed wifi icon                                                                                                                                                       | s5-anon-basket-es-phone, s6-b-after-revoke-live-en-phone                                                              |
| S28 | minor    | Guest reload of a finished trip opens the shop picker                  | finished shared trip (guest 3)                                             | the finished view                                       | "Buying at" picker with owner copy and no Lidl                                                                                                                          | s6-g3-after-finish-reload-en-phone                                                                                    |
| S29 | cosmetic | Empty "To buy" heading during a trip                                   | list page (B)                                                              | no empty block                                          | heading followed by an empty block                                                                                                                                      | s6-b-fiesta-list-during-trip-en-phone                                                                                 |
| S30 | minor    | Line detail says "Last bought · 1" for a reverted purchase             | line detail sheet (B)                                                      | no last purchase after F6.1 reverted it                 | "Last bought Oct 16, 2026 · 1"                                                                                                                                          | s6-b-line-detail-no-delete-en-phone                                                                                   |
| S31 | minor    | The 404 page is unstyled with no way back                              | `/es/zones/:z/lists/not-a-uuid`                                            | the app shell and a way home                            | bold red default text at x=0 on white, no header, nav or link (scored 12)                                                                                               | s7-a-bad-list-malformed-es-phone                                                                                      |
| S32 | minor    | A 7 character join link drops the code silently                        | `/en/join/<7 chars>`                                                       | "this link looks incomplete" and a way to type the code | headline and "Not now" only                                                                                                                                             | s7-anon-join-seven-en-phone                                                                                           |
| S33 | cosmetic | Composer echoes 400 characters twice                                   | list composer at the cap                                                   | a short echo                                            | about 18 lines of echo before any action                                                                                                                                | s7-a-composer-401-es-phone                                                                                            |
| S34 | cosmetic | "100000" fills the row reel edge to edge                               | list page                                                                  | padding                                                 | no padding                                                                                                                                                              | s7-a-list-qty100000-es-phone                                                                                          |
| S35 | cosmetic | Two buttons do the same after a line is deleted                        | comments sheet (B)                                                         | one action                                              | "Close" and "Cancel"                                                                                                                                                    | s7-b-fight-comment-vs-delete-en-phone                                                                                 |
| S36 | cosmetic | Line detail sheet has no title                                         | line detail sheet                                                          | a title                                                 | none; the name shows twice                                                                                                                                              | s3-a-linedetail-sheet-es-phone, s6-b-line-detail-no-delete-en-phone, s7-b-own-line-detail-en-phone                    |
| S37 | minor    | Home card counts 5 lists and shows 3                                   | `/es/home` (A)                                                             | the count matches, or "see all"                         | "5 listas" with 3 rows                                                                                                                                                  | s7-a-sheetcold-home-recovery-es-phone                                                                                 |
| S38 | minor    | Delete account placeholder is the exact text to type                   | `/account/sheet/confirm/delete`                                            | an empty looking field                                  | the field looks filled while the button stays disabled                                                                                                                  | s7-a-sheetcold-account-delete-es-phone                                                                                |
| S39 | minor    | Delete is offered on the only, default profile                         | `/account/profiles/sheet/confirm/delete`                                   | no delete, or what happens next                         | delete offered                                                                                                                                                          | s7-a-sheetcold-profiles-delete-es-phone                                                                               |
| S40 | minor    | Add to list sheet shows a stale count                                  | `/catalog/sheet/add-list`                                                  | 5 to buy                                                | "Casos límite ñandú 3 por comprar" while the list held 5                                                                                                                | s7-a-sheetcold-catalog-addlist-es-phone                                                                               |
| S41 | minor    | Catalog supermarket page misses Deza                                   | `/catalog/supermarket`                                                     | the chains the line sheet offers                        | Deza missing                                                                                                                                                            | s7-a-locale-catalog-supermarket-en-phone                                                                              |

S id severity counts: 0 blocker, 0 major, 26 minor, 15 cosmetic.

## Screen scores

Merged from batches b1 to b5. Where a screen was scored in two batches, the later state is a separate row, and the verdict names the earlier row. Scores: 90+ nothing to fix, 75 to 89 small issues, 50 to 74 noticeable problems, 25 to 49 hard to use, under 25 blocks the task.

| screen                                                     | URL pattern                                                           | score | viewport       | verdict                                                                                                             | key shot                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ----- | -------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Any page, browser language not en or es                    | `/en`, `/en/home`, `/en/auth/login` (fr-FR)                           | 3     | phone          | Every word is a raw key; the URL locale does not rescue it (F7.1). b5                                               | s7-a-frFR-home-phone                         |
| Link preview failed                                        | `/s/:secret` (network error, 503)                                     | 10    | phone          | Logo and spinner forever, no text, no retry (F6.5). b4                                                              | s6-anon-link-preview-neterror-en-phone       |
| 404 page                                                   | `/es/zones/:z/lists/not-a-uuid`                                       | 12    | phone          | Unstyled red text at the left edge, no header, nav or way back (S31). b5                                            | s7-a-bad-list-malformed-es-phone             |
| Gone list block                                            | `/zones/:z/lists/:l` (no access)                                      | 15    | phone, desktop | The whole message is the raw key `list.gone.unshared` (F4.3). b3                                                    | s4-b-cold-list-en-phone                      |
| Gone list block, missing or upper case id                  | `/zones/:z/lists/:random`, upper case id                              | 15    | phone          | Raw key, and the owner's own list is gone because of letter case (F4.3, F7.6). b5, later state of "Gone list block" | s7-a-bad-list-random-es-phone                |
| Sheets over a forbidden list                               | `/lists/:l/sheet/*`, `/lines/:id/sheet/*`                             | 20    | phone          | Editable empty settings, "Show 0 lines", blank sheets (F4.4, S12). b3                                               | s4-b-cold-sheet-settings-en-phone            |
| Basket not reachable                                       | `/shopping-lists/:id` (signed out, non participant)                   | 20    | phone          | Wrong "no longer on this list" and no way forward (F5.4). b3                                                        | s5-anon-basket-es-phone                      |
| Back from a cold deep link                                 | (Mailpit after browser back)                                          | 20    | phone          | Browser back leaves velista on every page type (F7.2). b5                                                           | s7-a-back-list-after-es-phone                |
| Join offer for a removed member                            | `/s/:secret` (signed in, 401)                                         | 25    | phone          | A signed in person is offered "Continue as guest" and a retry that cannot work (F6.4). b4                           | s6-b-link2-after-cascade-en-phone            |
| Basket after revoke or removal                             | `/shopping-lists/:id` (no longer a participant)                       | 25    | phone          | "On this list until" above "no longer on this list"; no way out after reload (F6.7, F6.8). b4                       | s6-b-after-revoke-live-en-phone              |
| Group not available                                        | `/zones/:z` (after rejection, cold)                                   | 35    | phone          | Title says removed, body says server error, retry and raw ref for a 404 (F2.6). b1                                  | s2-c-group-afterrejection-cold-en-phone      |
| Line page and history, no access                           | `/lists/:l/lines/:id(/history)`                                       | 35    | phone          | Generic load error with a Try again that repeats the 403 (F4.5). b3                                                 | s4-b-cold-line-catalog-en-phone              |
| Group not available, random group id                       | `/es/zones/:random`                                                   | 35    | phone          | A plain 404 shown as a server error (F2.6, F4.6). b5, later state of "Group not available"                          | s7-a-bad-group-random-es-phone               |
| Dead link page                                             | `/s/:secret` (joinable false)                                         | 38    | phone          | One card, no button (F6.9); a malformed link is "no longer" accepting people. b4                                    | s6-anon-link-malformed-en-phone              |
| List under a group id that does not exist                  | `/es/zones/:random/lists/:l`                                          | 38    | phone          | Owner sees his list read only with wrong copy (F7.7). b5                                                            | s7-a-bad-group-random-list-es-phone          |
| Revoke link pane                                           | `/shopping-lists/:id/sheet/share` (revoke)                            | 40    | phone          | "2 invitados" against "2 personas"; ticking it removes a group member (F6.3). b4                                    | s6-a-revoke-sheet-cascade-ticked-es-phone    |
| List settings sheet, cold load                             | `/lists/:l/sheet/settings`                                            | 40    | phone          | Empty name and sharing off again (F3.2 reproduced). b5, later state of "List settings sheet"                        | s7-a-sheetcold-list-settings-es-phone        |
| Sign in from a share link                                  | `/auth/login`, then `/home`                                           | 45    | phone          | Login has no trace of the invite and lands on an empty home (F6.6). b4                                              | s6-g-after-signin-from-link-es-phone         |
| List settings sheet                                        | `/lists/:l/sheet/settings`                                            | 45    | phone          | Cold load shows an empty name and sharing off (F3.2). b2                                                            | s3-a-listsettings-cold-es-phone              |
| List settings sheet, sharing and access                    | `/lists/:l/sheet/settings`                                            | 48    | phone          | Sharing unticked while Bruno keeps his chips (F4.2). b3                                                             | s4-a-listsettings-sharedOff-es-phone         |
| Finished shared trip                                       | `/shopping-lists/:id` (finished)                                      | 48    | phone          | Guest gets the shop picker over a finished trip (S28, F6.7). b4, later state of "Generated basket"                  | s6-g3-after-finish-reload-en-phone           |
| Composer at the 400 character cap                          | `/lists/:l?search=1`                                                  | 48    | phone          | The 400 characters print twice, filling the screen (S33). b5                                                        | s7-a-composer-401-es-phone                   |
| Group page                                                 | `/zones/:z`                                                           | 50    | phone, desktop | Owner of an empty group is told lists exist and none are shared (F2.2). b1                                          | s2-a-group-twomembers-es-phone               |
| Live basket (Todo por comprar)                             | `/shopping-lists/live`                                                | 50    | phone, desktop | Rich and live, but Deza totals other chains' prices (F5.2). b3                                                      | s5-a-live-shop-deza-es-phone                 |
| Line page, line gone or under the wrong list               | `/lists/:l/lines/:random`, `/lists/:other/lines/:real`                | 50    | phone          | Clear words and a way back, but a real line is called deleted (F7.8). b5                                            | s7-a-bad-line-random-es-phone                |
| Group page after a lost group sheet                        | `/zones/:z` (from group sheet URLs)                                   | 50    | phone          | Six sheet URLs land on the bare group page (F2.7, F2.8). b5                                                         | s7-a-sheetcold-group-listsnew-es-phone       |
| Group page, pending member                                 | `/zones/:z`                                                           | 52    | phone          | "Member" chip and an offline banner that stays after approval (F2.4). b1                                            | s2-b-group-pending-en-phone                  |
| Composer search results                                    | `/zones/:z/lists/:l?search=1`                                         | 52    | phone          | Wrong top results (F3.6); "already in your list" still offers + (F3.1, F3.7). b2                                    | s3-b-search-eggs-onlist-en-phone             |
| Shop picker                                                | `.../sheet/filter/shop`, `.../sheet/shop`                             | 52    | phone          | Lidl missing (F5.3), empty logos, counts change (S17). b3                                                           | s5-a-shoppicker-full-es-phone                |
| Generated basket (open, mid trip, finished)                | `/shopping-lists/:id`                                                 | 52    | phone, desktop | Finished banner scrolls away (S18); viewer's shop rewrites a finished trip (F5.6). b3                               | s5-a-generated-finished-es-phone             |
| Settle sheet under concurrent edits                        | `.../sheet/rows/:k/settle`                                            | 52    | phone          | A lost increment shows only a generic retry message (F6.2). b4, later state of "Settle sheet"                       | s6-b-e4-after-en-phone                       |
| Setup name                                                 | `/setup/name`                                                         | 55    | phone          | Emoji name echoed as valid, then refused after submit (F2.1). b1                                                    | s2-b-setup-name-emoji-rejected-en-phone      |
| Shopping profiles                                          | `/account/profiles`                                                   | 55    | phone          | Ten auto chips, a warning on an added code (F1.7), Carrefour listed (S5). b1                                        | s1-a-account-profiles-filled-es-phone        |
| List page, filled                                          | `/zones/:z/lists/:l`                                                  | 55    | phone, desktop | Duplicate rows (F3.1), chosen product missing (F3.3), badge lost (F3.4). b2                                         | s3-a-list-afterdelete-es-phone               |
| List page as the member after share on and off             | `/zones/:z/lists/:l`                                                  | 55    | phone          | Member keeps the "private" list (F4.2). b3                                                                          | s4-b-list-afterShareOff-reload-en-phone      |
| Composer on the basket                                     | `/shopping-lists/live?search=1`                                       | 55    | phone          | Two steppers for one product (F3.1). b3                                                                             | s5-a-composer-huevos-es-phone                |
| Shared basket, guest                                       | `/shopping-lists/:id` (guest)                                         | 55    | phone          | "Another list" on every row; "1 change on your lists" for a guest (S24). b4                                         | s6-g-qty-changed-live-en-phone               |
| Line detail sheet, line gone or under the wrong list       | `/lists/:l/sheet/lines/:id/detail`                                    | 55    | phone          | Honest sheet, but false "se borró" for a real line (F7.8). b5                                                       | s7-a-bad-sheet-detail-random-line-es-phone   |
| List after reconnect                                       | `/es/zones/:z/lists/:l`                                               | 55    | phone          | Quantity rolled back with no notice (F7.3). b5                                                                      | s7-a-online-after-reel-es-phone              |
| Join code sheet, paste and short code                      | `/en/home/sheet/zones/join`                                           | 55    | phone          | Pasted code loses its last character (F7.4). b5, later state of "Join code sheet"                                   | s7-c-joinsheet-leadingspace-paste-en-phone   |
| Profile supermarkets, profile not found                    | `/account/profiles/undefined/supermarkets`                            | 55    | phone          | One cramped line; the locale run tested this error page instead of the real page. b5                                | s7-a-locale-supermarkets-es-phone            |
| Line page, no product                                      | `/lists/:l/lines/:id`                                                 | 58    | phone          | Explains why a product helps, then gives the member no way to choose one (F3.8). b2                                 | s3-b-linepage-velas-noproduct-en-phone       |
| Shop page                                                  | `/shops/:id`                                                          | 58    | phone          | Caps title truncated, one button, mostly empty. b3                                                                  | s5-a-shop-page-from-picker-es-phone          |
| List page watched by another member                        | `/zones/:z/lists/:l`                                                  | 58    | phone          | Live update works; duplicate Eggs rows (F3.1), double space (S19). b3                                               | s5-b-list-after-a-partial-huevos-en-phone    |
| Shared basket, owner and member                            | `/shopping-lists/:id`                                                 | 58    | phone, desktop | Live updates land, but a tick can undo another's purchase (F6.1). b4, later state of "Generated basket"             | s6-b-e2c-after-en-phone                      |
| People sheet and person detail                             | `.../sheet/people`                                                    | 58    | phone          | Raw User Agent as "Dispositivo", remove with no confirm (S26). b4, later state of "People sheet"                    | s6-a-people-hugo-es-phone                    |
| Line detail sheet, member during a trip                    | `/lists/:l/sheet/lines/:id/detail`                                    | 58    | phone          | No title, "Last bought · 1" on a reverted purchase (S30). b4, later state of "Line detail sheet"                    | s6-b-line-detail-no-delete-en-phone          |
| Setup place                                                | `/setup/place`                                                        | 60    | phone          | Count understates the next screen (F1.2); Seguir below the fold. b1                                                 | s1-a-setup-place-14013-es-phone              |
| Join code sheet                                            | `/home/sheet/zones/join`                                              | 60    | phone          | Wrong 409 copy for a member (F2.3). b1                                                                              | s2-b-joinsheet-alreadyasked-en-phone         |
| Line detail sheet                                          | `/lists/:l/sheet/lines/:id/detail`                                    | 60    | phone, desktop | No title, name twice, no comment count after reload (F3.4). b2                                                      | s3-a-sheet-line-detail-reloaded-es-phone     |
| List page, private (empty, filled)                         | `/zones/:z/lists/:l`                                                  | 60    | phone, desktop | Empty state promises everyone will see it (F4.10). b3                                                               | s4-a-list-private-empty-es-phone             |
| What changed sheet                                         | `.../sheet/changes`                                                   | 60    | phone          | Useful log; Spanish names in English sentences. b3                                                                  | s5-b-changes-sheet-en-phone                  |
| List page during a trip (member)                           | `/zones/:z/lists/:l`                                                  | 60    | phone          | Shows who is buying; empty "To buy" heading (S29). b4                                                               | s6-b-fiesta-list-during-trip-en-phone        |
| Join link page, code variants                              | `/en/join/:code`                                                      | 60    | phone          | Normalised code reads well; a 7 character link drops the code (S32). b5, later state of "Join link page"            | s7-anon-join-seven-en-phone                  |
| Line detail sheet, member on his own line                  | `.../sheet/lines/:id/detail`                                          | 60    | phone          | No title, no delete and no reason, faint Save. b5, later state of "Line detail sheet"                               | s7-b-own-line-detail-en-phone                |
| Register                                                   | `/auth/register`                                                      | 62    | phone          | Native English tooltip on an es page (F1.5); rule only on the server (S3). b1                                       | s1-a-register-bademail-es-phone              |
| Join link page                                             | `/join/:code`                                                         | 62    | phone          | A member is told "already asked" (F2.3); never names the group. b1                                                  | s2-b-joinlink-alreadyasked-en-phone          |
| Group page, owner with a private list                      | `/zones/:z`                                                           | 62    | phone          | Private list looks exactly like a shared one. b3                                                                    | s4-a-group-afterCreatePrivate-es-phone       |
| Share sheet                                                | `/shopping-lists/:id/sheet/share`                                     | 62    | phone          | Clear purpose; member on the trip shows unticked (S20). b4                                                          | s6-a-share-sheet-with-joiners-es-phone       |
| Offline overlay                                            | `/es/zones/:z/lists/:l` (offline)                                     | 62    | phone          | Calm copy, no icon (F7.9), drops the pending write (F7.3). b5                                                       | s7-a-offline-idle-es-phone                   |
| Line page, 400 character name                              | `/lists/:l/lines/:id`                                                 | 62    | phone, desktop | One ellipsized title line and nothing more (F7.10). b5                                                              | s7-a-line-api400-es-phone                    |
| Comments sheet, line deleted by another user               | `.../sheet/lines/:id/comments`                                        | 62    | phone          | Switches live; "Close" and "Cancel" do the same (S35). b5                                                           | s7-b-fight-comment-vs-delete-en-phone        |
| Choose product picker                                      | `/lists/:l/lines/:id/product`                                         | 64    | phone          | Top match has no price; the choice does not reach the list (F3.3). b2                                               | s3-a-chooseproduct-picked-es-phone           |
| Composer, no match on the list                             | `/lists/:l?search=1`                                                  | 64    | phone          | Honest no match line; misaligned card (S13). b3                                                                     | s4-b-composer-tarjeta-en-phone               |
| Group page, list shared live                               | `/zones/:z`                                                           | 64    | phone          | Arrives live but reads "List is empty" (F4.9). b3                                                                   | s4-b-group-afterShareOn-live-en-phone        |
| Line name and detail sheets, 400 characters                | `.../sheet/name`, `.../sheet/lines/:id/detail`                        | 64    | phone          | Hold the text in a one line input; double focus ring (S6). b5                                                       | s7-a-linename-api400-es-phone                |
| Delete shopping profile sheet                              | `/account/profiles/sheet/confirm/delete`                              | 64    | phone          | Offered on the only, default profile (S39). b5                                                                      | s7-a-sheetcold-profiles-delete-es-phone      |
| Supermarket sheet (line)                                   | `.../lines/:id/sheet/supermarket`                                     | 64    | phone          | El Jamón logo empty, no close, slow first open (S11). b5, later state of "Supermarket sheet"                        | s7-a-line-supermarket-sheet-es-phone         |
| Setup done                                                 | `/setup/done`                                                         | 66    | phone          | Good recap; a reload says "Skipped" (F1.4). b1                                                                      | s1-a-setup-done-en-phone                     |
| Line page, with product                                    | `/lists/:l/lines/:id`                                                 | 66    | phone, desktop | Back labelled "to the group" (F3.5), no comment count (F3.4). b2                                                    | s3-a-linepage-pan-es-phone                   |
| Basket filter and sort sheet                               | `/shopping-lists/live/sheet/filter`                                   | 66    | phone          | Sticky button cuts the third row (S16). b3                                                                          | s5-a-filter-sheet-es-phone                   |
| Settle sheet                                               | `.../sheet/rows/:k/settle`                                            | 66    | phone, desktop | Clear main action; 1400 px button on desktop (F5.8). b3                                                             | s5-a-settle-sheet-pan-es-desktop             |
| Quantity at the bounds                                     | `/lists/:l`, `/lists/:l/lines/:id`                                    | 66    | phone          | Steppers cap correctly; "100000" touches the edges (S34). b5                                                        | s7-a-list-qty100000-es-phone                 |
| Private list, owner (cold) and its settings                | `/lists/:l`, `/lists/:l/sheet/settings`                               | 66    | phone          | Loads filled; nothing says private. b5                                                                              | s7-a-privatelist-owner-cold-es-phone         |
| Delete account sheet                                       | `/account/sheet/confirm/delete`                                       | 66    | phone          | Placeholder equals the name to type (S38). b5                                                                       | s7-a-sheetcold-account-delete-es-phone       |
| Add to which list sheet                                    | `/catalog/sheet/add-list`, `/catalog/products/:id/sheet/add-list`     | 66    | phone          | Preselected radio with only "Cerrar"; stale count (S40). b5                                                         | s7-a-sheetcold-catalog-addlist-es-phone      |
| Catalog supermarket page                                   | `/catalog/supermarket`                                                | 66    | phone          | Clean grid; Deza missing (S41). b5                                                                                  | s7-a-locale-catalog-supermarket-en-phone     |
| Supermarket sheet                                          | `.../lines/:id/sheet/supermarket`                                     | 68    | phone          | Clear question; empty logo boxes (S11). b2                                                                          | s3-a-sheet-linepage-supermarket-es-phone     |
| Quantity reel on a basket row                              | `/shopping-lists/live`                                                | 68    | phone          | Reel covers the "Nueva" chip (S15). b3                                                                              | s5-a-reel-huevos-dragged-es-phone            |
| List after merges and concurrent edits                     | `/zones/:z/lists/:l`                                                  | 68    | phone          | Merges land; last write wins silently. b5                                                                           | s7-a-dblclick-add-es-phone                   |
| Home after the recovery sheet URL                          | `/es/home`                                                            | 68    | phone          | Lands on home; "5 listas" with 3 rows (S37). b5                                                                     | s7-a-sheetcold-home-recovery-es-phone        |
| New list sheet                                             | `/zones/:z/sheet/lists/new`                                           | 70    | phone, desktop | Fine on phone; full width on desktop (F5.8); lost on reload (F2.7). b1                                              | s2-a-newlist-sheet-es-desktop                |
| Member action sheets                                       | `/zones/:z/members/sheet/:m/confirm/*`                                | 70    | phone          | Clear consequences; rename opens empty; cold link lands on the group (F2.8). b1                                     | s2-a-membersheet-remove-other-es-phone       |
| List page, empty                                           | `/zones/:z/lists/:l`                                                  | 70    | phone          | Says empty twice, title truncated. b2                                                                               | s3-a-list-empty-fiesta-es-phone              |
| Purchase history                                           | `/lists/:l/lines/:id/history`                                         | 70    | phone          | Simple toggle; labels differ between locales. b2                                                                    | s3-b-linehistory-pan-empty-en-phone          |
| Change products picker                                     | `/lists/:l/lines/:id/products`                                        | 70    | phone          | Good summary; unrelated products listed first. b2                                                                   | s3-a-changeproducts-picked-es-phone          |
| Your shopping lists (history)                              | `/shopping-lists`                                                     | 70    | phone          | Clear empty state; caps chip (S4), date twice. b3                                                                   | s5-b-history-after-finish-en-phone           |
| More sheet                                                 | `.../sheet/more`                                                      | 70    | phone          | Short menu; one unclear item. b3                                                                                    | s5-a-more-sheet-live-es-phone                |
| Get shopping list sheet                                    | `/shopping-lists/sheet/get`                                           | 70    | phone          | Clear choices; sharing below the fold. b3                                                                           | s5-a-get-sheet-ticked-es-phone               |
| Guest join offer                                           | `/s/:secret`                                                          | 70    | phone          | Simple, but never says whose list. b4                                                                               | s6-g-join-offer-en-phone                     |
| List page, long names and emoji                            | `/zones/:z/lists/:l`                                                  | 70    | phone, desktop | No overflow; full name never readable (F7.10). b5                                                                   | s7-a-list-longnames-es-phone                 |
| Added this visit sheet                                     | `/catalog/sheet/added`                                                | 70    | phone          | Clear empty state; a reload empties it with no hint. b5                                                             | s7-a-sheetcold-catalog-added-es-phone        |
| Home with groups                                           | `/home`                                                               | 72    | phone          | Works; caps "PENDING" chip (S4), no invite link (F2.9). b1                                                          | s2-a-home-requests-es-phone                  |
| Members page                                               | `/zones/:z/members`                                                   | 72    | phone, desktop | Pending requests clear; no invite code or link (F2.9). b1                                                           | s2-a-members-onlyowner-es-phone              |
| Group page with lists                                      | `/zones/:z`                                                           | 72    | phone          | Lists read well; long names truncate. b2, later state of "Group page"                                               | s3-a-group-threelists-es-phone               |
| Line comments sheet                                        | `.../sheet/lines/:id/comments`                                        | 72    | phone          | Works live; no visible send action. b2                                                                              | s3-a-comments-sheet-empty-es-phone           |
| Line name sheet                                            | `.../lines/:id/sheet/name`                                            | 72    | phone          | Helpful note; current name looks like a placeholder. b2                                                             | s3-b-sheet-linepage-name-en-phone            |
| Create list sheet, private                                 | `/zones/:z/sheet/lists/new`                                           | 72    | phone          | Works; helper text describes the opposite state. b3, later state of "Create list sheet"                             | s4-a-createlist-private-filled-es-phone      |
| Change product sheet                                       | `.../sheet/rows/:k/change/:k`                                         | 72    | phone          | Focused; washed out disabled primary. b3                                                                            | s5-a-sheet-change-es-phone                   |
| Profile supermarkets                                       | `/account/profiles/:id/supermarkets`                                  | 72    | phone          | Lists Lidl that the basket picker hides (F5.3). b3                                                                  | s5-a-profile-supermarkets-es-phone           |
| Home after asking to join (lowercase link)                 | `/en/home`                                                            | 72    | phone          | Pending card clear; same state as "Home with groups". b5                                                            | s7-c-join-lower-after-en-phone               |
| Setup welcome                                              | `/setup`                                                              | 74    | phone          | Tidy intro; swallows a fresh join confirmation (F2.11). b1                                                          | s2-c-afterjoin-newcode-en-phone              |
| Group settings sheet                                       | `/zones/:z/sheet/settings`                                            | 74    | phone          | Clear actions; lost on reload (F2.7). b1                                                                            | s2-a-groupsettings-sheet-es-phone            |
| Account                                                    | `/account`                                                            | 74    | phone          | Plain list; email truncated. b1                                                                                     | s1-a-account-filled-es-phone                 |
| Create list sheet                                          | `/zones/:z/sheet/lists/new`                                           | 74    | phone          | Clear and short; double focus ring (S6). b2                                                                         | s3-a-createlist-sheet-filled-fiesta-es-phone |
| Delete line confirm                                        | `.../sheet/lines/:id/confirm/delete`                                  | 74    | phone          | Clear consequence; dark text on crimson (S7). b2                                                                    | s3-a-deleteline-confirm-es-phone             |
| Group and home seen by a plain member                      | `/zones/:z`, `/home`                                                  | 74    | phone          | Nothing leaks; "List is empty" in success green. b3                                                                 | s4-b-group-en-phone                          |
| People sheet                                               | `.../sheet/people`                                                    | 74    | phone          | Simple; caps chip. b3                                                                                               | s5-a-sheet-people-es-phone                   |
| Confirm email sheet (account)                              | `/account/sheet/email`                                                | 74    | phone          | Plain; contradictory question. b5                                                                                   | s7-a-sheetcold-account-email-es-phone        |
| Home, no groups                                            | `/home`                                                               | 76    | phone, desktop | Clear empty state; the email card takes the top. b1                                                                 | s1-a-home-empty-es-phone                     |
| Member row menu                                            | `/zones/:z/members`                                                   | 76    | phone          | Destructive items apart; menu covers a chip. b1                                                                     | s2-a-members-menu-self-es-phone              |
| Line page menu sheet                                       | `.../lines/:id/sheet/menu`                                            | 76    | phone          | Two plain items; no cancel. b2                                                                                      | s3-a-sheet-linepage-menu-es-phone            |
| Product page                                               | `/catalog/products/:id`                                               | 76    | phone          | Clear price per chain; "5000 ml" for 5 l. b3                                                                        | s5-a-product-aceite-es-phone                 |
| Finish sheet, shared trip                                  | `.../sheet/finish`                                                    | 76    | phone          | Plain consequence; does not say guests lose the list. b4, later state of "Finish sheet"                             | s6-a-finish-shared-es-phone                  |
| Landing                                                    | `/{es,en}`                                                            | 78    | phone, desktop | Clear pitch; back after a switch shows the wrong language (F1.1). b1                                                | s1-a-landing-afterback-urlES-mismatch-phone  |
| Filter and sort sheet                                      | `/lists/:l/sheet/filter`                                              | 78    | phone          | Compact; heading typeface differs. b2                                                                               | s3-a-sheet-list-filter-es-phone              |
| Total popover                                              | `/shopping-lists/live` (popover)                                      | 78    | phone          | Plain breakdown; covers the row it explains. b3                                                                     | s5-a-total-sheet-es-phone                    |
| Catalog, categories, members, line history (locale sample) | `/catalog`, `/catalog/categories`, `/zones/:z/members`, `.../history` | 78    | phone          | Clean locale switch; "Alguien compró 1" hides a known buyer. b5                                                     | s7-a-locale-catalog-en-phone                 |
| Setup shops                                                | `/setup/shops`                                                        | 80    | phone          | Readable chain list; redundant Saltar. b1                                                                           | s1-a-setup-shops-default-es-phone            |
| Create group sheet                                         | `/home/sheet/zones/new`                                               | 80    | phone          | Simple and focused. b1                                                                                              | s2-a-creategroup-sheet-empty-es-phone        |
| Finish sheet                                               | `.../sheet/finish`                                                    | 80    | phone          | Plain consequence and count. b3                                                                                     | s5-a-finish-sheet-es-phone                   |
| Use my location sheet                                      | `/account/profiles/sheet/location`                                    | 80    | phone          | Honest privacy line. b5                                                                                             | s7-a-sheetcold-profiles-location-es-phone    |
| Login                                                      | `/auth/login`                                                         | 82    | phone          | Clean and honest error; double focus ring. b1                                                                       | s1-a-login-wrongpw-es-phone                  |
| About products sheet                                       | `.../lines/:id/sheet/about-products`                                  | 82    | phone          | Plain explanation. b2                                                                                               | s3-a-sheet-linepage-about-es-phone           |
| Change name sheet (account)                                | `/account/sheet/name`                                                 | 82    | phone          | Clear scope choice and counter. b5                                                                                  | s7-a-sheetcold-account-name-es-phone         |

Score distribution (125 rows): 8 under 25, 14 from 25 to 49, 87 from 50 to 74, 16 at 75 or more.

## Page load

Source: `timings.jsonl` (349 measures) and the Timings sections of s1 to s7. Dev server with 100 ms of added latency. A cold load spends about 1.2 s on about 50 dev JS chunks before the first gateway call leaves (1150 to 1300 ms). A plain gateway read is about 100 ms on a slot. Budgets: a page over 2 s or a sheet over 1 s must name its bottleneck. A sheet reload is a cold page load and has the page budget. Values are median, range and count; one value means one measure. `‖` marks requests in parallel.

| page or sheet                                  | URL pattern                            | kind                | ms to usable                           | bottleneck                                                                                    |
| ---------------------------------------------- | -------------------------------------- | ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Landing                                        | `/{l}`                                 | cold                | 1472, 1412 to 1499, n7                 | chunks and font; no data                                                                      |
| Login, register                                | `/{l}/auth/login`, `/register`         | warm                | 213 / 70                               | lazy feature-auth chunk                                                                       |
| Register submit                                | to `/{l}/setup`                        | action              | 805, 775 to 834, n2                    | 4 serial: register, then zones ‖ baskets ‖ me, then live summary, then profiles, supermarkets |
| Setup welcome, place, shops, done              | `/{l}/setup/*`                         | cold                | 1459 to 1548, n7                       | 3 serial: me x2, shopping-profiles, supermarkets                                              |
| Setup steps                                    | `/{l}/setup/*`                         | action              | 51 to 337, n6                          | PATCH me 123; summary 126; postal codes 124, then scope ‖ summary                             |
| Home                                           | `/{l}/home`                            | cold                | 1478, 1365 to 1507, n9                 | 3 serial: me x2, zones ‖ baskets, live summary                                                |
| Login submit                                   | to `/{l}/home`                         | action              | 558                                    | login, then zones ‖ baskets ‖ me, then live summary                                           |
| Ask to join                                    | to `/{l}/home`                         | action              | 664 / 848, n2                          | POST join, zones, zones again ‖ baskets, live summary                                         |
| Account                                        | `/{l}/account`                         | cold / warm         | 1278, n2 / 290                         | me read 3 times cold; one me warm                                                             |
| Profiles                                       | `/{l}/account/profiles`                | cold                | 1406                                   | 3 serial: me x2, shopping-profiles, supermarkets ‖ scope                                      |
| Join link                                      | `/{l}/join/:code`                      | cold                | 1340, 1310 to 1411, n5                 | chunks; at most one read                                                                      |
| Group                                          | `/{l}/zones/:z`                        | cold / warm         | 1502, 1277 to 1615, n27 / 302          | cold: zone, then lists (serial); warm parallel                                                |
| Create group, create list                      | home, group                            | action              | 294; 189, n4                           | POST zones then two reads; POST lists one request                                             |
| Members                                        | `/{l}/zones/:z/members`                | cold / warm         | 1413, 1301 to 1442, n6 / 200           | staff reads zone ‖ members twice                                                              |
| List                                           | `/{l}/zones/:z/lists/:l`               | cold                | 1442, 1139 to 1548, n33                | 2 waves: 6 to 7 reads, then suggestions ‖ lookup                                              |
| Composer search                                | `...lists/:l?search=1`                 | action              | 1176, 505 to 1795, n13                 | first: profiles, supermarkets ‖ scope, suggest; later suggest alone 125 to 638                |
| Line page                                      | `.../lines/:id`                        | cold / warm         | 1336, 1296 to 1642, n15 / 483          | 3 serial waves, offers last                                                                   |
| Line history                                   | `.../lines/:id/history`                | cold / warm         | 1362, n4 / 48 to 161                   | settlements ‖ list reads, then lookup                                                         |
| Change products, choose product                | `.../products`, `.../product?q=`       | warm                | 315 / 560                              | 4 parallel; items query 377                                                                   |
| Catalog product                                | `/{l}/catalog/products/:id`            | cold                | 1532, 1488 to 1557, n3                 | 8 parallel reads                                                                              |
| Basket history                                 | `/{l}/shopping-lists`                  | cold                | 1429, 1314 to 1480, n3                 | baskets ‖ live summary                                                                        |
| Live basket                                    | `/{l}/shopping-lists/live`             | cold                | 1962, 1830 to 2277, n6                 | baskets/live 348 to 528, then participant-token; with a shop 4 serial                         |
| Basket (participant)                           | `/{l}/shopping-lists/:id`              | cold                | 2053, 1563 to 2223, n10                | token ‖ GET baskets/:id 260 to 556, then icon chunks                                          |
| Basket (not a participant)                     | `/{l}/shopping-lists/:id`              | cold                | 1381, 1350 to 1396, n4                 | token 401 ‖ basket 401                                                                        |
| Generate basket                                | to `/{l}/shopping-lists/:id`           | action              | 874, 849 to 1342, n3                   | POST baskets, then token ‖ GET basket                                                         |
| Finish, reopen                                 | basket                                 | action              | 576, 547 to 632, n3                    | PATCH, then full basket read 390 to 458                                                       |
| Share link                                     | `/{l}/s/:token`                        | cold                | 1393, 1325 to 1551, n5                 | preview 121 to 128                                                                            |
| Share link, signed in                          | `/{l}/s/:token` to basket              | cold                | 2223                                   | 4 serial: preview, join, token ‖ basket 497                                                   |
| Guest continue                                 | to basket                              | action              | 854                                    | join, then token ‖ basket                                                                     |
| Pick a shop                                    | live filter                            | action              | 798, 751 to 810, n3                    | basket?locationId, location, supermarket (serial)                                             |
| Create group sheet                             | `/{l}/home/sheet/zones/new`            | sheet open          | 236                                    | lazy chunk 131                                                                                |
| Group sheets                                   | `/{l}/zones/:z/sheet/*`                | sheet open          | 21 to 68, n8                           | none                                                                                          |
| Member action sheets                           | `.../members/sheet/:m/confirm/*`       | sheet open          | 541 to 571                             | two animations                                                                                |
| List settings                                  | `.../sheet/settings`                   | sheet open          | 177, 155 to 190, n4                    | GET access 119 to 131                                                                         |
| List filter                                    | `.../sheet/filter`                     | sheet open          | 24, n4                                 | none                                                                                          |
| Line detail                                    | `.../sheet/lines/:id/detail`           | sheet open          | 179, n4                                | GET settlements                                                                               |
| Line comments                                  | `.../sheet/lines/:id/comments`         | sheet open          | 890, 405 to 906, n5                    | GET comments; mostly the slide                                                                |
| Line delete, line name, line page delete       | `.../confirm/delete`, `.../sheet/name` | sheet open          | 546 to 558, n7                         | two slides                                                                                    |
| Line page sheets                               | `.../lines/:id/sheet/*`                | sheet open          | 11 to 153, n14                         | comments read                                                                                 |
| List sheets                                    | `.../lists/:l/sheet/*`                 | sheet reload        | 1307 to 1562, n33                      | as list cold                                                                                  |
| Line page sheets                               | `.../lines/:id/sheet/*`                | sheet reload        | 1520, 1263 to 1579, n28                | as line page cold; excludes the 8857 outlier                                                  |
| Home, group, account, profiles, catalog sheets | `*/sheet/*`                            | sheet reload        | 1476, 1280 to 1567, n19                | as the covered page                                                                           |
| Get basket sheet                               | `/{l}/shopping-lists/sheet/get`        | sheet open          | 531, n2                                | 3 serial; profiles read twice                                                                 |
| Live filter sheet                              | `/live/sheet/filter`                   | sheet open          | 1149                                   | rows 154, then basket 455 (F5.7)                                                              |
| Live sheets                                    | `/live/sheet/*`                        | sheet open / reload | 35 to 386, n5 / 2284, 2242 to 2496, n6 | reload runs the 4 step live chain                                                             |
| Basket sheets (share, people, settle)          | `/:id/sheet/*`                         | sheet open / reload | 17 to 249, n8 / 1530, n6               | share link read; reload token ‖ basket                                                        |

### Over budget

Pages over 2 s: 15 measures. Sheets over 1 s on open: 2, plus one outlier.

- **Live basket cold** (2038 and 2210 for B). The token waits for `GET /v1/baskets/live` (about 507 ms) because it needs the basket id.
- **Live basket with a chosen shop** (2277, and the six live sheet reloads 2242 to 2496). Chain of 4: baskets/live, then token ‖ baskets/:id?locationId (450), then location (111), then supermarket (107).
- **Basket cold, participant** (2037 to 2195). One slow `GET /v1/baskets/:id` (up to 556 ms), then a wave of icon chunks that only starts after the basket renders.
- **Share link, signed in** (2223). Chain of 4: preview, join, token ‖ basket.
- **Live filter sheet** (1149). The sheet needs no data, but reads rows and then the full basket (F5.7).
- **Change sheet open 4674** is a measurement artifact that spans a cold load and two clicks. The reload of the same URL is 1779.
- **Line supermarket sheet 8857** is an outlier. The gateway was done by 1389 ms; the measure waited on four hot linked chain logos (S11).

### Gateway hot spots

| route                          | median    | max       | count |
| ------------------------------ | --------- | --------- | ----- |
| GET /v1/baskets/:id?locationId | 458       | 514       | 14    |
| GET /v1/baskets/live           | 398       | 528       | 12    |
| GET /v1/catalog/suggest        | 383       | 638       | 13    |
| GET /v1/baskets/:id            | 378       | 556       | 23    |
| GET /v1/catalog/items?query    | 377       | 377       | 1     |
| GET /v1/lists/:id/access       | 215       | 233       | 10    |
| everything else                | 96 to 129 | up to 234 |       |

The basket reads are the only routes consistently over 300 ms. The extra 280 ms over a plain read is work behind the gateway, not transport. Serial chains that could run in parallel: the live basket chain, `me` before route data on every cold load, zone then lists on a cold group page, the profiles chain in setup, home and the first composer search, the three waves of a cold line page, the full basket read after finish, reopen and filter, preview then join for a signed in share link, the doubled members read for staff, and the doubled profiles read in the get basket sheet.

### Duplicate requests

| request                                     | loads                        | cost                                              |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| GET /v1/account/me twice in parallel (F1.6) | 214 of 349                   | second copy about 215 ms; route data waits for it |
| GET /v1/account/me three times              | 5 (account cold)             | one extra serial hop                              |
| GET /health/ready twice                     | 233                          | one usually aborted                               |
| GET zone and members twice                  | 4 (members, staff)           | one extra serial hop                              |
| GET /v1/zones twice                         | 2 (ask to join)              | one extra serial hop                              |
| GET shopping-profiles twice                 | 2 (get basket sheet)         | one extra serial hop                              |
| GET items/:id/offers twice                  | 1 (live change sheet reload) | about 106 ms                                      |
| baskets/live then baskets/:id?locationId    | every live load with a shop  | about 450 ms serial                               |
| full basket read on a data free sheet       | 1 (live filter, F5.7)        | about 455 ms                                      |

## Admin changes

None were made. The admin app was served on 42006, but the scenarios needed no configuration. In the copied data, postal code 14013 already had 4 chains with prices, and every supermarket source was already on.

## Infrastructure changes

- Five volumes `luna-slot2_*` (auth, core, catalog and harvester databases, and NATS data) were created as copies of slot 1's volumes.
- Backend slot 2 is claimed by this worktree and runs on those copies (gateway 43100, realtime 43101, Mailpit 43141). Migrations ran on the copies only.
- Front end slot 1 serves velista (42005) and luna-shopper-admin (42006) against backend slot 2.
- Slot 1's own volumes were only read. They stay locked.
- Slot 0 was not touched.

Cleanup, from the worktree `D:\Projects\nx-portfolio\.claude\worktrees\velista-e2e-slot1-report`:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --down 2
docker volume ls --filter name=luna-slot2_   # then remove each luna-slot2_* volume
tools/dev/ng-slot.sh --down
```

## Test users and data left in place

All of this lives in the slot 2 databases, which are copies. Deleting the `luna-slot2_*` volumes removes all of it.

| email                                | password         | userId                                                    | name                                                     | role                               | how created                                          | purpose                                                         |
| ------------------------------------ | ---------------- | --------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| e2e-smoke-1792133623533@example.test | Smoke-pass-1234  | 89c04551-0978-49c4-892a-772515033222                      | (not recorded)                                           | none                               | helper smoke test                                    | check the helper and a cold load                                |
| e2e-ana-20261016@example.test        | Velista-e2e-2026 | f69ef065-e638-4713-bd7b-804ba924be83                      | Ana Córdoba Núñez                                        | owner of Casa Córdoba              | UI register (s1), 14013, es                          | user A in every scenario                                        |
| e2e-bruno-20261016@example.test      | Velista-e2e-2026 | 4730a2b2-176c-43bd-93e4-f27897ca5b93                      | Bruno Peña (the emoji was refused, F2.1)                 | approved plain member              | UI register (s2), 14013, en                          | user B in scenarios 2 to 7                                      |
| e2e-carla-20261016@example.test      | Velista-e2e-2026 | 8f2de70c-85e2-4dea-bb8d-a01ffcc7f31a                      | Roaming Albatross (register displayName "Carla" ignored) | not a member (turned down 3 times) | API register, setup skipped with "Not now"           | invite edge cases, non member checks                            |
| (guest, no email)                    | none             | 17f84463-527d-4b57-a662-cb4999ab034c                      | Deep Keel                                                | turned down                        | signed out "Ask to join" on `/en/join/X2USCENJ` (s2) | guest join request                                              |
| (guest, no email)                    | none             | none (participantId c4b17ea5-3862-4cf6-b3f3-31150b6f5a31) | Gema invitada                                            | removed by the revoke cascade      | joined share link 1 signed out (s6)                  | guest on a shared trip; credential in `scripts/out6/guest.json` |
| (guest, no email)                    | none             | none (participantId 20bbf613-8a6c-449c-98d7-f69c8b5b4509) | Hugo                                                     | removed by A from People           | joined share link 2 (s6)                             | remove one person                                               |
| (guest, no email)                    | none             | none recorded                                             | unnamed (G3)                                             | participant of the finished trip   | joined share link 2 before the finish (s6)           | finished trip as a guest                                        |

Group:

| what                                        | id or value                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Group "Casa Córdoba 🏠" (owner A, member B) | 68c05640-724e-4d73-bfd3-b4126645d634                                        |
| Join code (current)                         | 6WQKCPKS, link `http://localhost:42005/en/join/6WQKCPKS`                    |
| Join code (dead after regenerate)           | X2USCENJ                                                                    |
| Membership A / B                            | 7c3c11ff-f380-496f-81f8-13cf73d2d0e6 / f034ea97-a92b-4aba-8be9-0a695b2dda36 |

Lists (all in Casa Córdoba):

| list                                    | id                                   | owner | sharing                                           | lines                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------ | ----- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compra semanal                          | 1a120241-03f9-4acd-a538-75a8b6583024 | A     | shared, autoApproveLines false                    | Leche semidesnatada a413f628 (2 comments), Pan de bocadillo 9d59c551 (now Pan Viena 80 g, q 2, 1 comment), Huevos 2d023d75 (q 3), Aceite de oliva a6c74155, Regalo para Begoña ff5ccaf5 (free text), Breadsticks f76d11aa (B), Velas 3da64f40 (Velas de cumpleaños 20 uds), a duplicate "Eggs" line (F3.1); Tomate kumato deleted |
| Fiesta 🎉 cumpleaños de Begoña (sábado) | 606dcfda-7caa-4be1-8ced-48484ae583cf | A     | shared                                            | Patatas fritas fc4e8f3d, Refresco cola 564c3b1d, Velas de cumpleaños cf3b836f, Globos de colores 2beed6c0, Tarta de chocolate grande 4bc56596                                                                                                                                                                                     |
| Weekend BBQ 🔥                          | 6727e76f-7c83-4e28-8f32-42fb0bb33851 | B     | shared                                            | Milk chocolate 6b9f5138, Breadsticks b7f55586, Semi cured chorizo 6c66ab01, Charcoal bag 4b34dbea (free text), Tomate kumato dbba376a (A), Hielo 2d3d91f4 (A, free text)                                                                                                                                                          |
| Privado: regalo sorpresa para Bruno 🎁  | ddcf23fd-4f5b-4fc2-901f-821bfd1d0e58 | A     | private (sharedWithZone false, no access entries) | Galletas con chocolatina c9ac491e, Tarjeta de felicitación 4b637ec6 (comment "SECRETO que no lo vea Bruno"), Papel de regalo azul c0dc4e32, Caja de bombones (300 characters) 10b68055                                                                                                                                            |
| Casos límite ñandú                      | ba90c2fd-2924-4114-92e1-779402ae0166 | A     | shared, autoApproveLines false                    | Jamón ibérico 🐖 de bellota a7da9540, Pan de pueblo aaf5a88f (q 1), Línea para pelear f7b2ba3d, 400 character lines 0acbadc2 (API) and fbe134d7 (UI), Leche semidesnatada q 4, Aceite de girasol q 2, Pelea and Fight lines from the concurrency tests                                                                            |

Trips (baskets) and share links:

| what                                            | id                                               | state                                                                                             |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| A live basket                                   | ed7e11d7-d2d3-499b-a99e-abc4254fd14c             | Leche bought at Mercadona Santa Cruz (e2a4085e-f77a-43aa-8d2f-22827f81a9c3), Huevos 1 of 3 bought |
| B live basket                                   | d8f3d78c-7d8d-4b33-8119-818c89b62a8a             | Breadsticks bought at El Jamón Calle de Ronda 5 (a35697e3-457f-4139-ab29-aec157c78ac7)            |
| A generated trip (Compra semanal + Weekend BBQ) | 2cff9488-4dd1-45c1-82cf-ae9c45600eb8             | FINISHED (reopened once, finished again)                                                          |
| B generated trip (Weekend BBQ)                  | 21766b1c-755f-482f-b98f-afa17c1402a6             | FINISHED                                                                                          |
| A shared trip (Fiesta)                          | fb36b369-2e56-4436-a0df-796bf055a517             | FINISHED; B is a non expiring participant                                                         |
| Share link 1                                    | `/s/PjLG6E1bUXxEcS5l8ve8ewmuq3mAIxreGdn-3McqYf4` | revoked with the cascade                                                                          |
| Share link 2                                    | `/s/7-qcthEEDLArtXr-l6OxWudKuHDInYqD53198Z6ZcBE` | dead after the finish                                                                             |

The share links were issued with the origin `http://localhost:4205`. Open their paths on `http://localhost:42005`.

## Good practices to keep

- **Errors sit inline beside their control, in the page's language and plain words.** s1-a-login-wrongpw-es-phone, s1-a-register-mismatch-es-phone, s2-c-joinlink-oldcode-en-phone.
- **Confirm sheets state the consequence in one sentence before the destructive action, and name the person.** s2-a-membersheet-remove-other-es-phone, s3-a-deleteline-confirm-es-phone, s6-a-revoke-sheet-es-phone.
- **Sheets keep their own URL, keep the covered page visible under a scrim, and reopen with content on a cold reload.** s3-a-linedetail-sheet-es-phone, s6-a-sheet-share-es-phone-reloaded, s7-a-sheetcold-account-email-es-phone.
- **Spanish and English copy is complete and parallel, and a locale switch by URL leaves no stray words.** s1-a-setup-shops-default-es-phone, s2-a-members-filled-en-phone, s7-a-locale-catalog-en-phone.
- **Money and dates follow the locale everywhere ("17,25 €" against "€17.25"), and estimates carry "~" with the caveat spelled out.** s3-a-list-filled-compra-es-phone, s5-b-live-en-desktop, s5-a-total-sheet-es-phone.
- **Product names render in each viewer's locale on a shared list.** s3-b-list-qty-zero-reload-en-phone, s3-b-comments-sheet-filled-en-phone, s3-b-linepage-velas-afterAchoose-en-phone.
- **Every bought or refused row names who did it, the same way for owner, member and guest.** s5-a-live-huevos-partial-es-phone, s6-a-e1-after-es-phone, s6-g-qty-changed-live-en-phone.
- **Basket rows name the lists they come from, so merged rows stay traceable.** s5-a-live-cold-es-phone, s5-a-generated-basket-es-phone, s5-b-live-after-a-finish-en-phone.
- **Long and accented names never cause horizontal overflow; they ellipsize on one line.** s7-a-list-longnames-es-phone, s7-a-line-api400-es-phone, s7-a-privatelist-owner-cold-es-phone.
- **Empty states carry an illustration, a reason and one primary action, and private data stays out of a member's UI.** s1-a-home-empty-es-phone, s2-a-group-empty-es-phone, s4-b-home-en-phone.

## Not tested and why

- The walks feature (`/lab/walk`, `/shops/:loc/walks`, `/shops/:loc/map/...`) and the assistant (`/assistant`): out of scope for this run.
- Scenario 1: the postal code on the account page (the account page has none; it is on `/account/profiles`, checked there). Shop chain adjustment in setup (all four chains reach 14013, so all stayed on). The Mailpit verification link (out of scope).
- Scenario 2: the "Copy code" clipboard content (headless clipboard permission). Transferring, removing, banning or making B admin (sheets opened and closed only, to keep B a plain member). Group rename and delete (opened, not submitted).
- Scenario 3: a second Undo for delete (not offered, documented as no undo). Typing an exact quantity (no numeric field exists, by design per `quantity-stepper.ts:19`). Settle and approvals (out of scope for the scenario). F2.2 and the create list sheet reload drop were not seen again or retested.
- Scenario 4: a live capture of `list.created` and `list.updated` of a private list on B's socket (inferred from code, F4.1). Whether private lines entered B's live basket while sharing was on. In app navigation to the comments sheet URL (the settings sheet scrim covered the header back; the cold check was done). The POST /lines/batch probe (answered 400 to the body shape, so its auth was not reached).
- Scenario 5: scroll restore on reload (the page scrolls inside `main.page`; unverified). A separate product pane (none exists; the settle sheet is the product view, and "Añadirlo a otra lista" was checked only as present). Composer suggestion prices (the listbox was empty in the probe, probably the selector). A non owner participant's 409 copy (B was not on A's trip). Browser back from a cold `/shopping-lists/live` is now counted under F7.2.
- Scenario 6: B deleting a line from the trip (B may not delete approved lines, 403, by design). A quantity change on the list page during a trip (the list shows trip lines without a reel). A guest 3 tick after the finish (the click sent no request; likely the shop sheet; unverified). A settle sheet Cancel (it has none; Escape and scrim only). Scroll restore on reload (unverified).
- Scenario 7: an add typed while already offline (the overlay blocks all input offline, by design; only the in flight case was tested). A quantity change by A against a delete by B (B may not delete approved lines, so it ran the other way round). Basket and trip sheets (owned by scenario 6). Desktop shots only for B's list and line page.
- Scoring pass b5: the profile supermarkets page was only seen at `/account/profiles/undefined/supermarkets` in the locale run, so the real page was not checked in either locale there. It was seen once in s5 (s5-a-profile-supermarkets-es-phone).
