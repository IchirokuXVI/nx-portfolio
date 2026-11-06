# 0255: a stale run alert says when the run stopped

> Found on 2026-11-06 when a power outage stopped Luna slot 4 in the middle of a scheduled
> Carrefour walk (run `6fd4b58c-0dff-4193-b244-0a97dff3c708`). Recovery worked: on boot the reaper
> marked the run `STALE` at its first tick, the `RUN_STALE` alert of plan `0218` was mailed 30
> seconds later, the scheduler's one retry started run `04203ecd-910e-4aa2-94ef-7e7457c93c6d` on
> the next tick, and that run completed. The mail misled in two places. It said "Duration: 1 h 42
> min" for a run whose last heartbeat came 18 minutes after it started, because the duration is
> measured to the reap. And it named the preset by its uuid. It also did not say that the 10,279
> listings the run had read were lost: Carrefour writes at the end, so the run left no rows.
>
> Prerequisite reading: plan `0218` (the outbox, `runAlertFor`, the message), plan `0206` section
> 7 (the retry), plan `0038` section 6.6 (the reaper),
> `harvest/alerts/harvest-alert.rules.ts`, `harvest/alerts/harvest-alert.message.ts`
> (`durationOf`, the run lines near line 147), `harvest/harvest-run.store.ts` (`reapStale`).
> **This plan lands after plan `0247` (PR #934)**, which changes both alert files.

## Brief for the agent

### Objective

Make the `RUN_STALE` mail state when the run last showed life, how long it ran until then, how
long it was dead before the reap, the preset by name, and whether the run left any rows. Change
only the stale alert and the shared preset line.

### Context

- The mail of 2026-11-06, as Mailpit received it: `Started: 14:30:31`, `Finished: 16:13:05`
  (the reap), `Duration: 1 h 42 min`, `Preset: 2ddb77c5-f169-468a-a467-376c7521c83e`,
  `Failed: 1 of 18280 planned items`, `Stale window: no heartbeat for 900 seconds`.
- Before the reap the run row held `heartbeatAt` 13:49:05 UTC (14:49:05 Madrid), `processed`
  10,279, `totalPlanned` 18,280 and `created` 0. **The row no longer shows that heartbeat**:
  `finish` (`harvest-run.store.ts`, near line 552) overwrites `heartbeatAt` with the reap time.
  The last heartbeat exists only on the run object `staleAlertOf` receives before `finish`, so
  the payload must take it there.
- The payload is built from the run (`presetId` and no name) in `staleAlertOf`, before `finish`
  opens its transaction. The preset row is in the harvester's own database.
- The text "The scheduler starts a scheduled run again one time while its slot is young enough"
  held: the retry started.

### Target state

Every acceptance criterion holds and `harvest-alert.message.spec.ts` covers the new lines.

### Scope

`harvest-alert.rules.ts` (the payload carries `heartbeatAt`, `processed`, `created` and the
preset name) and `harvest-alert.message.ts`, with their specs. Every alert kind that prints a
preset line prints the name.

### Constraints

- The draft is still written in the transaction of the reap, as today. The preset name is read
  in `staleAlertOf`, with the last heartbeat, before that transaction opens.
- A preset deleted since keeps the uuid line.

### Action boundaries

Stop and ask before changing the reaper, the retry, or any other alert kind's text beyond the
preset line.

### Progress evidence

`npx nx test luna-shopper-backend-harvester` and the text of one stale alert mailed from an
ephemeral slot (stop a run's process and wait 15 minutes), quoted in the PR.

## 1. The lines

For `RUN_STALE`, in place of `Finished` and `Duration`:

```
Last sign of life: 2026-11-06 14:49:05 Madrid time (18 min after it started)
Marked stale: 2026-11-06 16:13:05 Madrid time
Read before it stopped: 10279 of 18280 planned items
Rows it left: none
```

The last line reads "Rows it left: <created + updated>" when the run wrote any. Which chains
write only at the end is not guessed: the line states the run's counters, and says "none" when
both are 0. Every alert with a preset prints `Preset: <name> (<uuid>)`: the run lines and the
slot lines of `harvest-alert.message.ts` (near lines 148 and 185) and the `SLOT_PROBE_FAILED`
message that plan `0247` adds.

## Tests

The message spec with the numbers of the Context, a stale run that wrote rows, and a preset that
no longer exists.

## Acceptance criteria

- [ ] The stale mail of the Context would read 18 min and name the preset.
- [ ] A run that wrote rows says how many.
- [ ] Other kinds keep their text, except the preset line.

## Verification

One stale alert from an ephemeral slot, read in Mailpit, quoted in the PR.

## Decisions

None for the owner.
