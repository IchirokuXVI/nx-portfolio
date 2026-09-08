> **PR:** [#288](https://github.com/IchirokuXVI/nx-portfolio/pull/288)

> **Superseded in part.** The single file CLI this plan describes is being split
> into the curation toolchain: `libs/luna-shopper/curation-groups` (the decider),
> `curation-auth`, and `curation-cli` (the orchestrator), with bulk apply from
> backend plan 0100. The grouping rules, the validators, the decision contract
> and the prompt in this plan remain the reference; the loop, the flags and the
> in-prompt group directory do not survive.

# 0099 A model sorts items into product groups

## Where this starts

`product_groups` (plan 0048) answers the question a chain-agnostic catalog
cannot: which items are the same purchase. Every Pascual, Central Lechera and
Hacendado semi-skimmed milk belongs in one group, because a shopper choosing
between them is making one decision. Membership is `items.productGroupId`, one
group per item; a product in more than one group is backlog 0010 and stays out
of scope here.

The entity's own doc-comment says assignment is owner curation only, and that
the matching ladder which would let a run classify items is backlog 0001
section 6.2, waiting on a review queue. This plan is that step, taken the same
way plan 0098 took the entry queue: an offline CLI, a model in the judgment
seat, deterministic validators around it, every write through the admin gateway
routes under the operator's session. No backend change.

The gateway already exposes everything the tool needs:

- `GET  /v1/admin/catalog/items?productGroupId=none` lists the ungrouped items
  (the `none` literal on the reference parameter, admin plan 0012).
- `PATCH /v1/admin/catalog/items/:id` sets `productGroupId`.
- `GET  /v1/admin/catalog/product-groups` lists groups; `POST` creates one.

## What this plan builds

- `apps/luna-shopper-backend/catalog/tools/assign-groups.mjs`, the tool.
- `apps/luna-shopper-backend/catalog/tools/assign-groups-prompt.md`, the system prompt.
- Fixtures under `apps/luna-shopper-backend/catalog/tools/fixtures/` and
  `assign-groups.test.mjs` beside them, run with `node --test`, no network.

The tool lives with the catalog service, whose data it curates, the same way
the leaflet toolchain lives under `harvester/tools/`.

Same hard constraints as plan 0098: zero npm dependencies, plain ESM Node,
the Claude API over raw `fetch`, and shared conventions with `review-entries.mjs`
(auth, base url, output shape, backoff). Small helpers may be copied rather than
extracted into a shared module; two self-contained tools beat a premature
library.

## The loop

For each item with no `productGroupId`, oldest first:

**1. Context, no model.** Fetch the full group directory once at startup:
id, name in both locales, slug, `referenceUnit`, synonyms. Keep it in memory
and append to it when the run creates a group, so entry 200 can be assigned to
the group entry 40 created.

**2. One model call.** Same request shape as plan 0098: `claude-sonnet-5`,
adaptive thinking, `effort` medium, `max_tokens` 8000. The system prompt is two
blocks, both with `cache_control: {"type": "ephemeral"}`: first the stable
rules, then the group directory. A created group rewrites the second block and
pays one cache write; between creations the whole prefix reads from cache. The
user message is the item: name in both locales, brand, `unitSize`,
`defaultUnit`, `category`, EAN. The model answers with exactly one JSON object:

```json
{
  "decision": "ASSIGN" | "CREATE_GROUP" | "REVIEW",
  "groupId": "uuid, ASSIGN only",
  "group": {
    "nameEs": "…", "nameEn": "…", "slug": "leche-semidesnatada",
    "referenceUnit": "L", "synonyms": { "es": ["…"], "en": ["…"] }
  },
  "confidence": 0.95,
  "issues": [{ "code": "…", "detail": "…" }],
  "reasoning": "one or two sentences"
}
```

The prompt states the grouping rule from the entity itself: a group is one
purchase decision, not a category. Semi-skimmed milk is a group; dairy is not.
Brand never separates items into different groups; format does when a shopper
would not substitute one for the other.

**3. Threshold.** `confidence < 0.9` demotes to `REVIEW`; issues must name the
uncertainty. `REVIEW` writes nothing, and the item stays visible in the back
office under the existing `withoutProductGroup` filter, which is the review
queue this tool needs and already has.

**4. Validators, before any write.** Failing any check demotes to `REVIEW`
with a named issue:

- `GROUP_TARGET_MISSING`: an `ASSIGN` whose `groupId` is not in the directory.
- `SLUG_INVALID`: a new slug that would fail the catalog's `validateSlug`
  (lowercase, digits, single dashes).
- `SLUG_TAKEN`: a new slug already in the directory.
- `GROUP_DUPLICATE`: a new group whose normalized name or synonyms collide with
  an existing group's name or synonyms. The model was supposed to `ASSIGN`;
  a human decides which of the two rows is right.
- `UNIT_FAMILY_MISMATCH`: the group's `referenceUnit` and the item's
  `defaultUnit` sit in different families (weight, volume, count). Family
  membership is derived from the unit vocabulary in the committed
  `gateway/docs/openapi.json`, and an unknown unit is itself a `REVIEW`.

**5. Write.** `ASSIGN` patches the item with the group id. `CREATE_GROUP`
posts the group, appends it to the in-memory directory, then patches the item;
if the patch fails after the post, the group stays (it is valid on its own),
the failure is recorded, and the run continues. The tool never deletes or
renames a group and never touches an item that already has one.

## Output, modes, configuration

Identical to plan 0098, deliberately: stdout is one JSON line per item, stderr
is `52/349 - <item name es>`, the run writes
`catalog/tools/out/groups-<timestamp>.jsonl` and a report with per-decision
counts, every `REVIEW` with issues, groups created, and token usage. Dry run by
default, `--apply` to write, `--limit`, `--base-url`, same auth environment
variables, refuse to start without `ANTHROPIC_API_KEY`.

## Verification

`node --test apps/luna-shopper-backend/catalog/tools/assign-groups.test.mjs`
with `fetch` injected. Cover:
each validator on a crafted bad decision and a good one; the confidence
demotion; the directory growing mid-run and a later `ASSIGN` hitting the new
group; slug validation agreeing with `product-group.service.ts#validateSlug`
cases; a full dry run over fixtures producing the expected stdout and report.
A live smoke run against a dev slot is manual and documented at the top of the
tool file.
