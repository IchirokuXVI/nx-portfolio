# 0002 The groups walk runs

> Found by `apps/luna-shopper-backend/plans/0150` (report finding 6, shopper F13). Blocked on
> curation cli plan `0005`, which makes the orchestrator send `--row` and adds the alias here.
> Build that first.
>
> In `0150`, the groups walk failed on its first row, so no product group was curated. A
> shopper then found the group "Huevos" holding one SuperCash product and none of the four
> Mercadona egg packs, and "Atún en lata" holding one product and not the two Hacendado tins.
> Once the flag is fixed, the groups decider still has three defects the orchestrator reaches.

## Brief for the agent

### Objective

Make the groups decider complete a walk under the orchestrator: cap its search text, answer
success for a run with only reviews, and honour or refuse the flags it ignores today.

### Context

- The search text has no length cap (`groups/src/gateway.mjs:81-89`, `rules.mjs:105`,
  `commands.mjs:212-228`). The gateway refuses a query over 120 characters, for items
  (`catalog-admin.dto.ts:47`) and for groups (`catalog.dto.ts:1273`). The same crash ended the
  Mercadona suggestions walk at row 173.
- `apply` answers `applied: false` when every decision is a `REVIEW`
  (`groups/src/commands.mjs:685-693`). The suggestions decider answers `applied: true` in the
  same case.
- `start` ignores `--chain` and `--local` without a word.
- The packet carries `nameEs` and `nameEn` (`groups/src/packet.mjs:167-170`). Cli plan `0005`
  makes the progress line read them.
- The apply route and operation shapes match the backend DTO (`catalog.dto.ts:1151-1241`).
  Groups has no batches, so it walks one row at a time, which is correct.
- Plan `0001` in this folder is the design.

### Target state

- Every search text is cut to 120 characters at a word boundary.
- A run with only reviews applies nothing and answers `applied: true` with zero operations.
- `start` either honours `--chain` and `--local` or refuses them with a message naming the
  flag. Pick one per flag, from what plan `0001` says the decider is for.
- A walk of 50 items on a slot with Mercadona and SuperCash eggs and tuna puts the four
  Mercadona egg packs in "Huevos" and the two Hacendado tins in "Atún en lata", or leaves them
  for review with a reason.

### Scope

Work only in `libs/luna-shopper/tools/curation/groups/` (source and tests).

Do not touch: the orchestrator, the suggestions decider, or the gateway.

### Constraints

- No new npm dependency.
- Only make changes directly requested.

### Action boundaries

Stop and ask before: changing the decision format or the apply route.

### Progress evidence

- Tests for the cap, the review only run, and each flag.
- `npx nx test` passes for the groups project.
- The 50 item walk above, with its summary pasted in the PR. Use
  `--engine ollama --model gemma4-32k` unless the person asks for another engine, and stop the
  model afterwards.
