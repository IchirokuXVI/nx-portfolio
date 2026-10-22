> **PR:** [#804](https://github.com/IchirokuXVI/nx-portfolio/pull/804)

# 0225: a query that matched nothing says so

> The evaluation of 2026-10-22 (plan `0224`, section 10) ran the assistant's prompt and
> tools, unchanged, through seven model variants and 48 scenarios. Three failures were
> not about the model. Every Haiku and Gemini run answered "Hay 2 huevos" for a list with
> no eggs, because the `query_lists` result puts `total: 2` beside an empty `matches`
> array. Every Claude run that listed several lists wrote markdown, which the prompt
> forbids in half a sentence. And one Haiku run called `rename_me` with `confirmed: true`
> on the first message of a conversation, so a name changed without a question. This plan
> fixes the three in the tool result, the prompt and the two confirming tools, for every
> provider at once. It changes no model call and no contract.
>
> Prerequisite reading: `0039` sections 7 and 8 (the prompt, references from tool results),
> `0043` sections 3.3 and 6 (the confirmation round trip, the record), `0047` section 2.4
> (`settle_lines` confirms nothing, on purpose), `0224` section 10 (the measurements), and
> in the code `assistant/tools.ts`, `assistant/prompt.ts`, `assistant/assistant.service.ts`.

## Brief for the agent

### Objective

Make three small changes in `apps/luna-shopper-backend/assistant`: the `query_lists`
result names its counts so that an empty match cannot be read as a quantity; the prompt
states the plain text rule in a form a model follows for a long list, and the service
strips what slips through; `remove_lines` and `rename_me` treat `confirmed: true` on a
turn with no earlier assistant message as unconfirmed. Then prove the first two with the
evaluation harness.

### Context

Every statement below was read on `dev` on 2026-10-22.

- `queryLists.execute` (`tools.ts:468` to `:527`) returns, per list, `{ list, zone, total:
  lines.length, matches: [...] }` (`:502` to `:520`). `total` is the number of lines on the
  list, whatever `item` asked for. In the evaluation, `{"total":2,"matches":[]}` was read
  as "two eggs" by Haiku 5.5 in 9 of 9 runs and by both Gemini models in 4 of 4; Sonnet
  5.5 read it right in 6 of 6 and still said "the list says 6 in total but only five came
  back" when `pendingOnly` had excluded a line at zero.
- The prompt's plain text rule is one clause: `prompt.ts:57`, "never write a link, an id,
  or markdown", and `:128` in the scoped prompt. Claude wrote `**bold**` and `- ` bullets
  in all 15 runs of "tell me everything on all my lists" and in several runs of two other
  scenarios; Gemini never did.
- `renameMe.execute` (`tools.ts:578` to `:620`) and `removeLines.execute` (`:665` to `:790`)
  read `args['confirmed'] === true` and nothing else (`:590`, `:722`). The description
  says "true only after they have agreed, in this conversation" (`:570`, `:658`). Haiku at
  effort medium sent `confirmed: true` on the first message in 1 of 3 runs of "rename me
  to Dan but leave the groups alone", and the username changed.
- `ToolRuntime.transcript` (`tools.ts:73`) is the conversation as `string[]`, built in
  `assistant.service.ts:332` to `:335` from the capped transcript's contents and the
  message, with no roles. `capTranscript` (`:850`) keeps `AssistantMessage` entries with
  `role` and `content`.
- The reply text leaves the service at `assistant.service.ts:447` to `:471` with no
  processing. The client renders it as text.
- The evaluation harness lives outside the repository, at
  `C:\Users\Ichi\.claude\jobs\4999a9e2\tmp\assistant-eval\` on the owner's machine:
  `run.sh` runs the matrix under ts-node against the repository's sources through the
  path aliases, `scenarios.ts` holds the 48 scenarios, `results/` the baseline. It reads
  the Claude key from `D:\Projects\nx-portfolio\tmp\claude-until-21-nov-2026.txt` and the
  Gemini key from `D:\Projects\nx-portfolio\apps\luna-shopper-backend\assistant\.env`.
  Rule A4 is about the repository's suite; the harness is a tool on the owner's machine
  and is never committed.

### Target state

- `npx nx test luna-shopper-backend-assistant`, `lint` and `build` pass.
- The harness, run against this branch for scenarios s13, s15, s17, s47 on `haiku-low`
  (3 runs each), passes s15 in 3 of 3 and s17 in 3 of 3, and s13 and s47 no worse than
  the baseline.
- `confirmed: true` with no earlier assistant message writes nothing, and the result
  tells the model to ask.

### Scope

- Work only in: `apps/luna-shopper-backend/assistant/src/app/assistant/tools.ts`,
  `prompt.ts`, `assistant.service.ts`, `assistant.service.spec.ts`, a new `plain-text.ts`
  and `plain-text.spec.ts` beside them, and this plan file.
- Do NOT touch: `gemini.provider.ts`, `model-provider.ts`, `app-config.ts`,
  `list-resolution.ts`, `turn-context.ts`, the contracts, the gateway, the chart, any
  `.env`, `package.json`, `package-lock.json`.

### Constraints

- No new dependency.
- The wire contract (`AssistantTurnResponse`) does not change. The tool result shape is
  internal to the turn and may change freely; nothing outside this service reads it.
- Prettier on each changed file, never on a directory.
- Only make the changes this plan asks for.

### Acceptance criteria

- [ ] The `query_lists` result carries `linesOnList` and `found`, never `total`, and a
      `message` when `found` is 0 (section 1).
- [ ] The prompt, both variants, states the plain text rule as section 2 writes it.
- [ ] `plainText` strips bold markers, bullet markers, heading markers and markdown links,
      with a spec, and the service applies it to the reply and counts what it stripped in
      the record (section 2).
- [ ] `remove_lines` and `rename_me` ignore `confirmed: true` when the conversation holds
      no earlier assistant message (section 3), with service spec cases for both.
- [ ] The harness runs of section 4 are in the PR body as a small table.

### Action boundaries

- Proceed with in-scope edits, specs, lint, build, and the harness runs (they spend a few
  cents of the owner's Claude credit, which the owner allowed for this evaluation).
- Stop and ask before changing a contract, a tool description beyond what section 1 says,
  or `settle_lines`.

### Progress evidence

Report when the spec passes and when the harness runs are in. Ground each claim in a
command's output.

## 1. The count that was read as a quantity

`queryLists.execute` returns, per list:

```ts
{
  list: list.listName,
  zone: list.zoneName,
  linesOnList: lines.length,
  found: matching.length,
  matches: [...],
  ...(matching.length === 0
    ? { message: item
        ? `Nothing on this list matches "${item}". Say so; do not use linesOnList as a count of anything.`
        : 'This list is empty.' }
    : {}),
}
```

`linesOnList` says what the number is. `found` says what `matches` holds, so a zero sits
next to an empty array rather than a two. The `message` says the sentence to say. The top
level keeps `{ ok: true, item, pendingOnly, lists }`.

One sentence is added to the description of `query_lists`, both declarations, after
"Never answer such a question from memory.": "The result names how many lines matched;
when it says nothing matched, say that nothing is on the list."

## 2. Plain text

The rule line in both prompts becomes two:

```
- The app shows your reply as plain text, so write plain sentences. No bullet points, no
  asterisks, no headings, no numbered list, no link and no id, also when you list many
  things: several things go in one sentence separated by commas, and each list gets one
  sentence of its own.
- The app draws its own link to the list your answer is about, so write "it is on the
  flat list" and never a link.
```

(The scoped prompt keeps its own second sentence, "it is on the list".)

And a backstop, because the evaluation showed the half sentence being ignored 15 times
out of 15 by one model family. `plainText(text: string): { text: string; stripped: number }`
in `assistant/plain-text.ts`:

- `**x**` and `__x__` become `x`.
- A line that starts with `- `, `* `, `• ` or `N. ` loses the marker, and consecutive
  such lines are joined with `, ` into one line, the last with `.` if it has no end
  punctuation.
- A line that starts with one or more `#` and a space loses them.
- `[text](url)` becomes `text`.
- `stripped` counts the replacements. Nothing else is touched: a lone `*` in "2 * 3" and
  an underscore inside a word stay.

The service applies it to `text` at `assistant.service.ts:447` before the record and the
response, and the record gains `strippedMarkdown: number` so the prompt change can be
judged from the logs rather than from a hunch.

## 3. A confirmation needs a question before it

`ToolRuntime` gains `priorAssistantTurns: number`, the number of entries of the capped
transcript whose role is `ASSISTANT`. The service fills it beside `transcript`.

In `renameMe.execute` and `removeLines.execute`, the check `args['confirmed'] !== true`
becomes `args['confirmed'] !== true || runtime.priorAssistantTurns === 0`. When the second
half is what made it unconfirmed, the result carries one more line in its `message`:
"You have not asked yet in this conversation, so this does not count as confirmed. Ask
first." and the call is recorded with `refused: true` (plan `0043` section 6: the number
to watch is a write the model tried without the question).

The cost is one extra turn for somebody who says "quita la leche, sí, confirmo" in one
breath on a fresh conversation. The gain is that no first message can rename somebody or
delete a line, whatever the model decides `confirmed` means. `settle_lines` is untouched:
it confirms nothing by design (plan `0047` section 2.4).

## 4. Proof with the harness

From the worktree root, run the harness for the scenarios this plan touches, on
`haiku-low`, 3 runs each: s13, s15, s17, s47 for sections 1 and 2, and s32 for section 3
(it must now never reach `setUsername`). The harness resolves the repository through the
path aliases of the directory it runs in, so running it from the worktree runs it against
the branch. Put the before and after pass counts in the PR body. If the Gemini key has
quota, add `gemini-35-lite` for s15 and s17, 1 run each.

## 5. What this plan does not do

- It does not change `list-resolution.ts`, although the evaluation found that when the
  model omits `list` for "put milk on the weekly shop" the question names two zones while
  the chips carry all four lists. That is a defect of the candidate set and gets its own
  plan.
- It does not cap `quantity` below the schema's maximum, although every model sent 500
  for "añade 500 huevos" without a question. Whether that is wrong is a product decision.
- It does not touch `settle_lines`.
