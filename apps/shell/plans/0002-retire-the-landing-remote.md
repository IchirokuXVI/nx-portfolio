# 0002: Retire the landing remote

## Implementation status

Not started. **Do this first.** It is independent of everything else and it removes one
whole app from the surface that `0003` has to migrate.

## Goal

Delete the original `landing` remote and every trace of it. `landingV2` replaced it and
already owns the root of the site; `landing` is dead code that is still built, still
imaged, still deployed and still confusing every reader who meets two apps with almost the
same name.

## Why it is safe

Verified rather than assumed, because "delete an app" deserves evidence.

**It is already unreachable.** `apps/shell/src/app/app.routes.ts` has no `landing` entry.
Its children are `odontogram`, `damoclesSword`, `velista`, then `''` for `landingV2`, then
a wildcard. Nothing routes to `landing`, so no URL reaches it.

**Nothing imports it.** Every reference to `@portfolio/landing/*` comes from inside
`libs/landing/` itself or from `apps/landing/src/app/remote-entry/entry.routes.ts`. There
is no inbound edge from another scope. `landingV2` has its own `data-access`, its own
`models` and its own content components, and shares nothing with it.

**It is still costing something.** It is in the shell's `remotes` list, in the hardcoded
tuple list in `webpack.prod.config.ts`, in four `tsconfig.base.json` aliases plus the
`landing/Routes` alias, in `values.yaml` twice (production and staging), in the local
values files, and it holds a permanent slot in every affected build CI runs.

## What gets deleted

| Path | Note |
| --- | --- |
| `apps/landing/` | the remote |
| `apps/landing-e2e/` | its e2e project |
| `libs/landing/data-access/` | |
| `libs/landing/feature-shell/` | |
| `libs/landing/models/` | |
| `libs/landing/ui/` | includes its i18n assets |

## What gets edited

1. **`apps/shell/module-federation.config.ts`**: drop `'landing'` from `remotes`.
2. **`apps/shell/webpack.prod.config.ts`**: drop the `['landing', ...]` tuple.
3. **`tsconfig.base.json`**: drop the four `@portfolio/landing/*` aliases and
   `landing/Routes`. Leave every `landing-v2` / `landingV2` alias alone; they are a
   different app and the names are close enough to delete the wrong one by eye.
4. **`k8s/helm/values.yaml`**: drop the `landing` and `landing-staging` entries from
   `apps`.
5. **`k8s/helm/values.localhost.yaml`, `values.localhost-mfe.yaml`, `values.local.yaml`**:
   drop the `landing` entries and the `landing=...` pair in the `MFE_REMOTE_URLS` example
   comment.
6. **`.github/workflows/docker-ci.yml:223`**: the affected e2e filter excludes
   `landing-e2e` and `odontogram-e2e` for pre existing tsconfig breakage. Remove
   `landing-e2e` from that `grep -vE`, leaving `odontogram-e2e`. Half the workaround goes
   away with the project it was working around.
7. **`libs/shared/localization/rokutranslator-angular/src/lib/locale-routing/locale-guard.ts:5`**:
   rename `ROOT_APP_KEY` from `'landing'` to `'landingV2'`.
8. **Registry images**: `ghcr.io/ichirokuxvi/nx-portfolio/landing` stops being built.
   Existing tags can stay; nothing pulls them once the Helm entries are gone.

## The `ROOT_APP_KEY` rename, and the one thing it changes

`ROOT_APP_KEY` is the app key used for the app mounted at the empty path, and it feeds the
localStorage key `roku-locale:{appKey}`. It has said `'landing'` since before `landingV2`
existed, and it now names an app that will not exist at all, which is exactly the kind of
stale name that makes a reader hunt for a deleted app.

Renaming it to `'landingV2'` changes the storage key from `roku-locale:landing` to
`roku-locale:landingV2`. **Every existing visitor's remembered language for the front page
is dropped once**, and the next visit falls back to the browser locale, which for almost
everyone is the same answer. That is the correct trade against carrying a wrong name
forever, and it is recorded here so it is a decision rather than a surprise.

No migration shim. Reading the old key to seed the new one means shipping code that exists
solely to serve a value that a single navigation regenerates.

## Content sweep

The ask is that no content about the old landing page is left in the project, so the
deletion is not finished when the code compiles.

- Grep for `@portfolio/landing/`, `landing/Routes`, `nx-portfolio/landing` and
  `apps/landing` across `*.ts`, `*.json`, `*.yaml`, `*.yml`, `*.md`, `*.html`, `*.sh`.
  Every hit must be inside a deleted directory or in the edit list above.
- Grep `CLAUDE.md` for `landing` and correct the repository overview, which lists
  `landing` as one of the remote micro frontends.
- Check `README`s and any docs under `k8s/` for the app list.
- Check `libs/landing-v2/ui` for copy that refers to the old page. `landingV2` is a
  redesign of the same portfolio, so a stale sentence about "the new landing" is worth
  catching while looking.
- Ignore `.claude/worktrees/`. Those are other sessions' checkouts, not this project's
  content.

Two names that look like hits and are not: `libs/velista/feature-landing` (velista's own
front door, unrelated) and the many `landing` mentions inside `.agents/skills/`, which are
tool documentation about landing pages in general.

## Acceptance criteria

1. `nx show projects` lists no `landing` and no `landing-e2e`, and still lists `landingV2`
   and `landingV2-e2e`.
2. `nx run-many --all --target=lint test build` is green.
3. `nx build shell --configuration=production` succeeds and its `mf-manifest.json` names
   four remotes, not five.
4. `helm template k8s/helm` renders no `landing` Deployment, Service or HTTPRoute, and
   still renders the `landingv2` ones.
5. The site's root still serves `landingV2` in every supported locale.
6. A grep for the strings in the content sweep returns nothing outside
   `.claude/worktrees/` and `.agents/`.

## Out of scope

`landingV2` keeps its name. Renaming it to `landing` now that the slot is free is a
tempting tidy up and a separate, riskier change: it touches the `landingV2/Routes`
federation alias, the image name, the Helm entries and the deployed URL path, all for
cosmetics. If it is wanted, it is its own plan, after `0003`.
