# Contributing

## Pull request titles

Every pull request into `dev` (and every rollup into `main`) is titled with
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
using the Angular type set and the scopes this workspace actually has:

```
type(scope): summary
type(scope)!: summary          a breaking change
type(scope): summary (plan 0045)
```

The title is not decoration. Release notes are generated from it
(`tools/release/release-notes.mjs`), so a title that cannot be read is a change
that does not appear in the notes for the release that shipped it. A check on
every pull request rejects a title that breaks these rules, which is the point
at which it is cheap to fix.

### Type

| Type       | Use it for                                | In the notes    |
| ---------- | ----------------------------------------- | --------------- |
| `feat`     | a capability that was not there before    | **Features**    |
| `fix`      | behaviour that was wrong and now is not   | **Fixes**       |
| `perf`     | the same behaviour, faster or lighter     | **Performance** |
| `revert`   | undoing something that shipped            | **Reverts**     |
| `refactor` | shape of the code, no change in behaviour | not shown       |
| `docs`     | prose, plans, comments, READMEs           | not shown       |
| `test`     | specs, fixtures, e2e coverage             | not shown       |
| `build`    | the build itself, Nx targets, Dockerfiles | not shown       |
| `ci`       | workflows, deploy scripts, the chart      | not shown       |
| `chore`    | dependencies, housekeeping                | not shown       |
| `style`    | formatting only                           | not shown       |

"Not shown" means the change is left out of the release notes unless they are
generated with `--all`. It is a statement about the reader of a release, not
about the worth of the change.

A plan that is written but not built is `docs`. The pull request that builds it
is `feat` or `fix`, and both may name the same plan number.

### Scope

The scope names an area of the workspace, not an Nx project: `velista` covers
the app and every `libs/velista/*` library, `luna` covers the whole backend, and
a service name covers one service. The list is in `tools/release/rules.mjs` and
that file is the authority:

`shell`, `odontogram`, `damoclesSword`, `landingV2`, `velista`, `luna`,
`luna-shopper`, `gateway`, `realtime`, `auth`, `core`, `catalog`, `harvester`,
`assistant`, `contracts`, `shared`, `i18n`, `k8s`, `helm`, `docker`, `ci`,
`tools`, `e2e`, `deps`, `release`.

The scope is optional, and a change that genuinely spans areas may carry several
separated by commas: `docs(luna,velista): ...`. Adding a new area to the
workspace means adding it to `rules.mjs` in the same pull request, or that pull
request's own title cannot pass the check.

### Summary

Written the way the rest of the repository is written: say what the change does
in the reader's terms, not which files moved.

- 100 characters for the whole title, 10 at the least after the colon.
- No full stop at the end. A title is not a sentence.
- No issue or pull request number. GitHub adds that itself.
- Do not repeat the type (`fix(velista): fix the gap` says `fix` twice).

Where a plan drove the work, name it at the end in parentheses, with the number
in the four digit form the plan files use: `(plan 0045)`, `(plans 0040, 0041)`,
`(plan velista 0037)` when the plan belongs to an area other than the scope.

### Breaking changes

A `!` before the colon lifts the change into its own section at the top of the
notes, whatever its type. Use it when a deployed thing that used to work stops
working: a gateway contract, a route, an env var a cluster has to set, a stored
shape a migration cannot round trip.

### Examples

```
feat(velista): a way to the history when there is no card to hold it (plan 0045)
fix(luna): the confirmation link points at a route velista has
feat(gateway)!: every list response answers inside an envelope
docs(luna,velista): the kept list, and a basket you can share with guests
ci(k8s): the staging deploy waits for the rollout it started
chore(deps): bump the pinned node image
```

And the shapes that fail the check:

```
Velista 0045: your shopping list on the home page      no type
feat(luna-backend): ...                                not a scope
feat(velista): update files.                           says nothing, and ends in a full stop
fix: the gap (#87)                                     GitHub adds the number
```

## Release notes

`tools/release/release-notes.mjs` reads the titles above and writes the notes.
It walks the commits between two refs, finds the pull requests that produced
them, and groups the conforming titles by section. It runs on plain Node with no
install step, so a release can be cut from a bare checkout.

```sh
# Everything since the last tag, ready to paste into a draft release
node tools/release/release-notes.mjs

# One release exactly, written to a file
node tools/release/release-notes.mjs --from v0.3.1 --to v0.3.2 --out notes.md
gh release create v0.3.2 --title v0.3.2 --notes-file notes.md

# Which titles in a range would need renaming (exit 1 if any)
node tools/release/release-notes.mjs --audit --from v0.3.1

# Validate one title, which is what CI does with the pull request's own
node tools/release/release-notes.mjs --check "feat(velista): a card for the list"

node tools/release/release-notes.mjs --help
```

Three things it does on purpose:

- **A rollup is skipped.** A pull request whose head branch is `dev` or `main`
  carries no work of its own, and counting it would list every change in the
  release twice, once as itself and once inside the rollup.
- **A bad title is named, not dropped.** It gets its own section at the end,
  with the reasons. A merged pull request can still be retitled, so the fix is
  to rename it and run the script again.
- **Work that reached the branch without a pull request is still listed**, by
  commit hash rather than by number, and the count at the foot of the notes says
  how much of it there was. The notes are meant to be a complete account of a
  range rather than a best effort one.

Its tests run without Nx, and cover the rules themselves:

```sh
node --test tools/release/release-notes.test.mjs
```

## Branches and merging

`main` is off limits: never push to it, never force push, never merge into it by
hand. Work lands through a pull request into `dev`. Wait for the checks on it
(`gh pr checks --watch`) and fix a red one rather than handing it over.

Working from a second checkout means claiming a dev slot rather than editing
ports; see `tools/dev/README.md` and the CLAUDE.md section on slots.
