# 0001 A decider that sorts the shelf

Part of the curation toolchain: `curation-auth` (sessions),
`curation-suggestions` (its sibling and its template), `curation-cli` (the
orchestrator), and backend plan 0100 (the bulk routes). It replaces the loop
and CLI layer of the single file tool from backend plan 0099 (PR #288); that
tool's grouping rules, validators, decision contract, prompt and tests are the
starting material.

## What this is

The same CLI contract as `curation-suggestions`, over a different domain:
items with no `productGroupId`, decided into `ASSIGN`, `CREATE_GROUP` or
`REVIEW`. Read that plan first; this one states only what differs.

## What differs from the suggestions decider

- **The rows** are ungrouped catalog items
  (`GET /v1/admin/catalog/items?productGroupId=none`), paged 10 to 20
  internally, answered one at a time by `next`.
- **The candidates are groups, found by search, never a directory.** The user
  fixed this: there may be thousands of groups, and a directory in the prompt
  does not survive that. `next` searches groups by the item's name on the main
  gateway and the rehearsal gateway through the plan 0100 query filter, merges
  with origin labels (`catalog` / `run`), and answers only the matches. A run
  created group is therefore found by the same tsvector search production
  uses, not by a local scan, which also retires the old in-memory
  `GROUP_DUPLICATE` check: duplicate detection is the same search.
- **The rehearsal write** for `CREATE_GROUP` is a plain product group create on
  the rehearsal gateway, recorded with a `ref`. An `ASSIGN` to a run created
  group records the `ref`; an `ASSIGN` to a real group records the id.
- **Validators**: `GROUP_TARGET_MISSING`, `SLUG_INVALID` (agreeing with
  `product-group.service.ts#validateSlug`), `SLUG_TAKEN` and `GROUP_DUPLICATE`
  (both answered by searching, main and rehearsal), `UNIT_FAMILY_MISMATCH`
  (families derived from the `UnitOfMeasure` vocabulary in the committed
  `openapi.json`; an unknown unit is a REVIEW). The 0.9 threshold is
  unchanged.
- **`decisions.jsonl` records**, per item, the ungrouped state as its `expect`
  (plan 0100's catalog bulk route asserts the item still has no group), and
  for `CREATE_GROUP` the group payload plus `ref`.
- **`apply`** builds one request against the plan 0100 catalog bulk route:
  `createGroup` operations first, then `assignItem` operations naming ids or
  refs. One transaction on the server, truly all or nothing, cap 1,000.
- **One group per item** stays the schema's rule; a product in more than one
  group remains backlog 0010 and is out of scope.

## Shape and verification

Same as the suggestions decider: zero npm dependencies, ESM `.mjs`, never
browser reachable, an Nx project with `lint` and `node --test` targets, state
in a run directory, resumable. Tests mirror the sibling's, plus: a
`CREATE_GROUP` followed by an `ASSIGN` that only matches because the rehearsal
search answers the run created group; slug cases matched to `validateSlug`;
`apply` ordering creates before assigns and mapping refs.
