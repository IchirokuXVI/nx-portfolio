# 0047 What the remodel leaves behind

> Last of the seven remodel plans. Needs `0041` to `0046`, all merged. Each of those plans has
> a section "What this plan deletes", and this plan removes what only becomes dead once all
> six have landed, then adds the checks that keep it so.

A remodel done in six pull requests leaves things behind: redirects from addresses nobody
visits, parts of the descriptor contract that lost their last user, exports that nothing
imports, translation keys that nothing reads. Each one is small, and together they are what
makes the next change slow.

## Brief for the agent

### Objective

Remove everything in `luna-shopper-admin` that the remodel made dead, and add specs that fail
when dead navigation, dead translation keys or dead public exports come back. Use the
`nx-portfolio-angular-developer` skill.

### Context

- The app is `apps/luna-shopper-admin` plus ten libraries under `libs/luna-shopper-admin/`.
  Before the remodel it had 261 source files and 118 spec files, and `en.json` had 1,507 keys.
- A survey on 2026-10-03 found no unused component and no unused service. It found 183
  symbols exported from an `index.ts` and used only inside their own library, about 110 more
  that no other file names at all, and one translation key that only a spec reads
  (`harvest.nav.postalCodes`).
- No e2e project drives this app. The specs are Jest specs.

### Target state

1. **Old addresses.** Every redirect that `0042` to `0045` added from a `/catalog/...`,
   `/harvest/...` or `/shoppers/...` address is deleted, with its spec. Links inside the app,
   in `errorLinks` and on the Overview name the new addresses directly. See section 2.
2. **The section model.** `AdminSection` describes what the frame draws now: a key, a label,
   an icon, a path, an optional count, and its tabs. Fields that only the two row header read
   (`links`, the `resources` row, `home` as a dashboard) are deleted, with `sectionScreens`.
3. **The descriptor contract.** Delete each optional feature that has no user left. Check
   `requires`, `collectionPath` with `pathParams` from a filter, `note`, `formNote`,
   `ErrorLink.filter` and `ErrorLink.label` by search, and delete only what has none.
4. **Public exports.** Each library's `index.ts` exports only what another project imports.
   A symbol used only inside its library is still there, without the export. A symbol that
   nothing names is deleted. `wire-types.ts` is generated and is not touched.
5. **Translation keys.** Every key of `en.json` that no source file reads, as a literal or
   through a prefix it builds, is deleted.
6. **Styles.** No component restates a style that a `ui` part or a token gives. The global
   rule for `button, input, select` in `styles.scss` matches the control sizes of `0041`.
7. **Specs of things that are gone.** Delete assertions that a removed thing is absent, such
   as the three `harvest.nav.*` checks in `feature-harvest/src/lib/routes.spec.ts`.
8. **Three new specs**, in `apps/luna-shopper-admin`:
   - every key in `en.json` is read by some source file,
   - every name exported from a library `index.ts` is imported by another project,
   - every route in the table belongs to a section of the rail or is `sign-in`.
9. **The plan status.** A new status plan replaces `0039`, as `0039` replaced `0031`.

### Scope

- In: `apps/luna-shopper-admin/src/**` and `libs/luna-shopper-admin/**`.
- Out: the gateway, `wire-types.ts`, `tools/**`, any behavior.

### Constraints

- This plan changes no screen. A screenshot before and after is the same.
- Delete only what a search proves dead. For a translation key, search for the full key and
  for each prefix that a template string builds.
- The three specs read the source tree. They do not start the app.

### Action boundaries

- Do not delete a route that a person can reach from the rail, a tab or a link.
- Do not rename anything. A rename hides a deletion in the diff.
- If a thing looks dead and a spec reads it, say so in the pull request and leave it.

### Progress evidence

- `npx nx run-many -t lint test -p` for the app and its ten libraries, and
  `npx nx build luna-shopper-admin`.
- In the pull request: the count of source files, spec files and translation keys before and
  after, and the list of deleted exports by library.
- The three new specs pass, and each one fails when you add one dead key, one dead export and
  one orphan route by hand. Say that you tried it.

## 1. Not in this plan

- An e2e project for the back office. It is worth its own plan, and the remodel is the moment
  the addresses stop moving.

## 2. Decision made

- **Redirects from old addresses are deleted** (the owner, 2026-10-03). One operator uses the
  app, and a bookmark is easy to fix.
