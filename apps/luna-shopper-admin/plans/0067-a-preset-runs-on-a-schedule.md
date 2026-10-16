# 0067 A preset runs on a schedule

> Backend half: plan `0206` of `apps/luna-shopper-backend/plans/` (a preset runs on a
> schedule), built in PR #708. Its header says: "Admin half: not written." This is that half.
> It shares no file with `0065` or `0066`.
>
> Mock: none. Backend `0206` asked for a mock before the screens. The owner asked for this plan
> on 2026-10-17 without one. Section 3 says what is drawn, in the parts the back office
> already has. **Ask the owner before you build whether a mock comes first.**

Since backend `0206` a preset can start by itself: a schedule names a preset, a time of day,
days of the week and a timezone, and a timer in the harvester starts the preset when the time
comes. Production has the timer on. Today a schedule can only be made by a request by hand.
The person who sets up the cadence is the owner, from the back office (owner decision of
2026-10-11, backend `0206` section 17).

## Brief for the agent

### Objective

Let a person list, add, change, turn on and off, and delete the schedules of the harvester,
see why a schedule will not run and what its last slot did, and see on a run that a schedule
started it. Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui`, `antislop-human`, `antislop-layoutmobile` and `antislop-copywriting` skills.

### Context

- **Routes** (`AdminHarvestSchedulesController`, `openapi.json`):
  - `GET /v1/admin/harvest/schedules?supermarketId&presetId&cursor&limit`: a page of views,
    ordered by `nextRunAt`, schedules that are off last.
  - `POST /v1/admin/harvest/schedules`: `{ presetId, timeOfDay, daysOfWeek, timezone?,
    acknowledgedAutomaticFetch }`, 201 with the view.
  - `GET /v1/admin/harvest/schedules/:id`, `PUT /:id` (`timeOfDay?`, `daysOfWeek?`,
    `timezone?`), `PUT /:id/enabled` (`{ enabled, acknowledgedAutomaticFetch? }`),
    `DELETE /:id` (200 `{ id }`).
- **Rules.** `timeOfDay` is `HH:mm`. `daysOfWeek` is one to seven ISO days (1 is Monday).
  `timezone` is an IANA name, absent means `Europe/Madrid`. `acknowledgedAutomaticFetch` must
  be the JSON `true` on create and on turning on, or the answer is 400 `validation_failed`
  naming the field. The preset of a schedule never changes: to point at another preset, delete
  and add.
- **The view** (`HarvestHarvestScheduleView` in `wire-types.ts`): `id`, `presetId`,
  `presetName`, `supermarketId`, `timeOfDay`, `daysOfWeek`, `timezone`, `enabled`,
  `nextRunAt`, `blockedBy`, `lastSlotAt`, `lastOutcome`, `lastOutcomeAt`, `lastOutcomeNote`,
  `lastRun { id, status, requestedAt }`, `estimate { seconds, basis, samples }`, `createdAt`,
  `updatedAt`.
- **`blockedBy`**, the first that applies, filled even on a schedule that is off:
  `HARVEST_DISABLED`, `SCHEDULER_DISABLED`, `SOURCE_DISABLED`, `SOURCE_FAILING`.
- **`lastOutcome`**: `STARTED`, `SKIPPED_LATE`, `SKIPPED_FAILING`, `REFUSED`, `SKIPPED_BUSY`.
- **Behaviour a person must be told** (backend `0206` sections 5 to 7): a slot that cannot
  start is skipped, not queued. A late slot runs only if less than half of the gap to the next
  slot has passed. A run that a deploy stopped is started again one time. Three failures in a
  row stop the schedules of a chain until a run that a person starts completes. The source row
  of the chain must stay on.
- **Runs** gain `trigger` (`MANUAL` or `SCHEDULED`), optional `scheduleId`, `interrupted` and
  `estimate`. The runs list takes `scheduleId` and `trigger` filters. A preset view gains an
  optional `estimate`.
- **The harvest feature** (`libs/luna-shopper-admin/feature-harvest`): three tabs, Review,
  Runs and Setup (`routes.ts`, address map in its doc comment). Setup has the parts `sources`
  (the `SOURCES` descriptor and its record page, admin plan `0059`), `brands` and
  `postal-codes`. Presets are a panel in the side column of the Runs tab
  (`presets-panel.ts`). Address builders live in `models/src/lib/harvest/harvest-addresses.ts`.
- **Data access**: `HarvestServiceI` (`data-access/src/lib/harvest/harvest-service.ts`),
  `harvest-api.ts` (`ROOT = '/v1/admin/harvest'`) and `harvest-memory.ts` with
  `harvest-seed.ts`. The memory back end has no schedules, writes `trigger: 'MANUAL'` on every
  run, and its `deletePreset` has no schedule check.
- **Staging** keeps the timer off, so every schedule there reads `SCHEDULER_DISABLED`. That is
  correct and the screen must say it plainly.

### Target state

1. **Setup gains a part "Schedules"** at `/harvest/setup/schedules`, beside Sources: a
   `SCHEDULES` descriptor with a gateway that wraps `HARVEST_SERVICE`, the generic list, and a
   record page at `/harvest/setup/schedules/:id` and `/new`.
2. **The list** shows the preset, the chain, when it runs ("Mon, Wed, Fri at 06:00"), the next
   run, and a state: "On", "Off", or "Will not run" in the warning tone when `blockedBy` is
   set. A filter by chain.
3. **The record page.** Details has two sections:
   - "What runs": the preset (a picker on a new schedule, read only after), the chain (read
     only, from the preset), the estimate ("About 20 min, from 6 runs of this preset").
   - "When": the time, the days, the timezone.
   The Record block holds the next run, the last slot, what the last slot did with its note,
   a link to the last run, and `blockedBy` as a sentence.
4. **Adding a schedule asks for consent.** Above Save, a box the person must tick: "Velista
   will fetch {chain}'s website by itself at these times, with nobody watching. A chain can
   block a crawl that comes too often or too fast." Save sends
   `acknowledgedAutomaticFetch: true` only when it is ticked. Without the tick Save is
   refused under the box.
5. **Turning on and off** are named actions, "Turn this schedule on" and "Turn this schedule
   off", in the More menu and on list rows. Turning on asks the same consent as target 4 in
   its question. Delete is in the More menu and asks first.
6. **Why a schedule will not run**, one sentence for each `blockedBy`:
   - `HARVEST_DISABLED`: "This cluster cannot start harvest runs."
   - `SCHEDULER_DISABLED`: "Schedules do not start by themselves on this cluster. Only
     production starts them."
   - `SOURCE_DISABLED`: "{chain} may not be fetched. Turn its source on and leave it on."
     with a link to the source.
   - `SOURCE_FAILING`: "{chain} failed three runs in a row. Start the preset by hand. When it
     completes, the schedule runs again." with a link to the Runs tab.
7. **What the last slot did**, one phrase for each `lastOutcome`: "Started", "Skipped, too
   late", "Skipped, the chain is failing", "Refused", "Skipped, a run was already going", and
   the note after it when there is one.
8. **The help of the "When" section** says the three rules: a slot that cannot start is
   skipped, not queued; a late slot runs only before half the gap to the next one; a run that
   a deploy stopped starts again one time.
9. **The presets panel** shows under each preset its schedules in one line ("Mon, Wed, Fri at
   06:00") as a link to the schedule, and "Add a schedule" that opens `/new` with the preset
   chosen. A preset that a schedule names already refuses a delete with 409, and the dialog
   shows it; the text names the schedule.
10. **Runs** show "Scheduled" beside a run that a schedule started, with a link to the
    schedule, and the runs list gains a filter "Started by: anyone, a person, a schedule".
11. **The memory back end** holds schedules with the same rules: the consent check, the
    `blockedBy` order from the memory sources, `deletePreset` refused for a named preset, and a
    seed with one schedule that is on and one that is blocked. It never starts a run by
    itself.

### Scope

- In: `feature-harvest/src/lib/` (new `schedules.ts` and `schedules-gateway.ts`, `routes.ts`,
  `setup-page.ts`, `presets-panel.ts`, the runs list and run page), `harvest-addresses.ts`,
  `HarvestServiceI` with both implementations and the seed, their specs, the guard specs that
  pin named actions, and `en.json`.
- Out: the gateway, `openapi.json`, `wire-types.ts`, the harvester, the run form
  (`RunRequestForm`), the review queues.

### Constraints

- `acknowledgedAutomaticFetch` is sent as the JSON `true` and only after the person ticked
  the box or confirmed the question in that same act. Never remember the consent.
- `enabled` is changed by the named actions and by nothing else.
- Days are sent sorted and once each. Show them Monday first.
- Times are the schedule's own timezone. Show the next run in the person's time as well when
  the two differ ("06:00 Madrid, 05:00 your time").
- If no field kind draws seven day toggles or a time, read how the descriptors listed in
  `no-page-outside-the-record-page.spec.ts` use `editor`, and use that. Stop and ask before
  you add a field kind to the descriptor contract.
- The constraints of plans `0053`, `0054` and `0059` hold.

### Action boundaries

- Do not change a gateway route, a DTO or the harvester.
- Do not add, change or turn on a schedule on staging or production. On your own Luna slot
  you may, with `HARVEST_ENABLED` and `HARVEST_SCHEDULER_ENABLED` false, which is what the slot
  writes: the screen then shows `HARVEST_DISABLED`. To walk a slot that starts, set both true
  by hand, and set them back after.
- Do not start, stop or migrate Luna slot 0, 1 or 3.

### Progress evidence

- `npx nx lint` and `npx nx test` are green for `luna-shopper-admin/feature-harvest`,
  `luna-shopper-admin/data-access`, `luna-shopper-admin/models` and `luna-shopper-admin`.
- `npx nx build luna-shopper-admin` is green.
- Specs for the consent (absent, ticked, the body sent), each `blockedBy` sentence, each
  `lastOutcome` phrase, the preset line in the panel, and the run filter.
- The walk of section 4, with screenshots at 1360 px and 390 px.

## 1. Not in this plan

- A notice to anybody when a slot is skipped. Backend `0206` section 13 sends none.
- A schedule that is not a preset. Backend `0206` starts presets only.
- A circuit breaker for a chain that answers 403. That is a harvester plan, not written.

## 2. Where it lives, and why

A schedule is set up once and then left, which is what Setup holds (the doc comment of
`routes.ts`). Its link to a preset is drawn on the preset in the Runs tab (target 9), so a
person who looks at presets sees their cadence without a trip to Setup.

If the owner prefers schedules under each preset in the Runs tab only, target 9 grows into the
list and target 1 goes. Ask before you build, together with the question of the mock.

## 3. What the record page draws

| Section | Row | Editable |
| --- | --- | --- |
| What runs | Preset | on a new schedule only |
| What runs | Chain | never |
| What runs | How long it takes | never |
| When | Time | yes |
| When | Days | yes, seven toggles |
| When | Timezone | yes, a choice with `Europe/Madrid` first |
| Record | Next run, last slot, what it did, last run, why it will not run | never |

## 4. The walk

On your own Luna slot with a preset for Mercadona and its source on:

1. With both harvest switches false, add a schedule. Save without the tick is refused. With
   the tick, the page opens and says "This cluster cannot start harvest runs."
2. Set both switches true and restart the harvester. The sentence goes. The next run is
   today, two minutes ahead.
3. Wait for the slot. The schedule says "Started", links to the run, and the run says
   "Scheduled".
4. Turn the Mercadona source off. The schedule says it will not run, with the link to the
   source.
5. Try to delete the preset. The dialog says a schedule names it.
6. Delete the schedule. Set both switches back to false.
