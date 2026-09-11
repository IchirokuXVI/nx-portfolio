# 0001 A tools folder, and the model library everything asks

Nothing in this plan changes a line of logic. It moves seven projects, renames
none of them, and adds one target to each of the two command line tools so that
an operator stops typing a path. It is first in the build order because the
leaflet tool (`leaflet/cli` plan 0001) is built into the folder this plan
creates, and building it first and moving it afterwards would mean doing the
same rename twice.

This plan lives in `libs/luna-shopper/tools/plans/` rather than under one of the
projects it moves, because the thing it describes is the folder, and no single
project inside it owns the arrangement of its siblings.

## 1. Why the scope folder had to split

`libs/luna-shopper/` holds fourteen entries today and they are not one kind of
thing. Eleven are libraries the running system imports: `contracts`, `platform`,
`mercadona`, `deza`, `carrefour`, `lidl`, `osm-places`, `postal-codes`,
`test-fixtures`. Five are an operator's tooling that no deployed process ever
loads: `curation-cli`, `curation-auth`, `curation-groups`,
`curation-suggestions` and `model-engines`.

The second group is about to grow by two, because the leaflet reader is the same
kind of thing as the curator: a person runs it from a terminal, it asks a model
a question, and it posts the answer to the gateway. Adding `leaflet-cli` and
`leaflet-chains` to a flat scope folder would make it sixteen entries with no
sign of which seven are shipped code.

So the operator tooling gets a folder of its own, and inside it one folder per
tool.

## 2. What moves

| From                                     | To                                             |
| ---------------------------------------- | ---------------------------------------------- |
| `libs/luna-shopper/model-engines`        | `libs/shared/model-engines`                    |
| `libs/luna-shopper/curation-cli`         | `libs/luna-shopper/tools/curation/cli`         |
| `libs/luna-shopper/curation-auth`        | `libs/luna-shopper/tools/curation/auth`        |
| `libs/luna-shopper/curation-groups`      | `libs/luna-shopper/tools/curation/groups`      |
| `libs/luna-shopper/curation-suggestions` | `libs/luna-shopper/tools/curation/suggestions` |

`model-engines` leaves the Luna scope entirely, because nothing in it is about
supermarkets. It knows how to ask a model a question and it is asked one by a
curator today and by a leaflet reader tomorrow. A library two tools share, in a
scope named after one of them, is a library that gets a wrong dependency edge
drawn through it the first time somebody reads the tree.

The `plans/` directory of each project moves with the project and keeps its
numbering, which is what the per directory numbering rule is for. After this
plan, `model-engines` plans 0001 to 0003 are at
`libs/shared/model-engines/plans/`, and the next model engines plan is 0004
there.

## 3. Project names do not change, and that is the point

Nx reads a project's name from the `name` field of its `project.json`, not from
where the file sits. Every project here sets that field already. So the move is
a directory move and the names stay exactly as they are:

| Directory                                      | Project name                        |
| ---------------------------------------------- | ----------------------------------- |
| `libs/shared/model-engines`                    | `shared/model-engines`              |
| `libs/luna-shopper/tools/curation/cli`         | `luna-shopper/curation-cli`         |
| `libs/luna-shopper/tools/curation/auth`        | `luna-shopper/curation-auth`        |
| `libs/luna-shopper/tools/curation/groups`      | `luna-shopper/curation-groups`      |
| `libs/luna-shopper/tools/curation/suggestions` | `luna-shopper/curation-suggestions` |
| `libs/luna-shopper/tools/leaflet/cli`          | `luna-shopper/leaflet-cli`          |
| `libs/luna-shopper/tools/leaflet/chains`       | `luna-shopper/leaflet-chains`       |

`model-engines` is the one rename, from `luna-shopper/model-engines` to
`shared/model-engines`, because its name states its scope and its scope changed.
Four `implicitDependencies` entries and two `project.json` test globs name these
projects and paths. Section 7 lists every one of them.

The rule this fixes for good: **a project's directory may be as deep as the
arrangement needs, because nobody types the directory.** A four level path is
only a cost if the path is the address, and in Nx it never is.

## 4. The alias an operator actually wanted

Today the curator is started like this, from the repository root:

```sh
node libs/luna-shopper/curation-cli/src/cli.mjs --implementation suggestions --engine ollama
```

After the move that path is one level longer, which is the wrong direction. So
each command line tool gets a `run-commands` target named after what it does,
and the project name becomes the address:

```sh
npx nx run luna-shopper/curation-cli:curate -- --implementation suggestions --engine ollama
npx nx run luna-shopper/leaflet-cli:read -- --pdf tmp/dia_leaflet.pdf --chain dia
```

The target is three lines:

```json
"curate": {
  "//": "The alias. Nx addresses a project by name, so the operator never types the path, and the path is free to be as deep as the arrangement needs.",
  "executor": "nx:run-commands",
  "options": {
    "command": "node libs/luna-shopper/tools/curation/cli/src/cli.mjs",
    "forwardAllArgs": true
  }
}
```

Three details that are easy to get wrong:

- **Keep the `--`.** Nx consumes flags it recognises before forwarding, and
  `--verbose` is one of them. Passing tool arguments after `--` hands them
  through untouched, and the usage text in both CLIs must show the `--` so the
  operator never learns the shorter form that silently drops a flag.
- **`cwd` stays the workspace root**, which is the default. Both CLIs already
  resolve their own paths against the root, and a target that moved the working
  directory would break every relative `--run-dir` an operator has typed before.
- **`node <path>` stays a plain command and does not become a bin entry.** These
  libraries have zero npm dependencies on purpose. A `bin` field would mean a
  `package.json` per library and a workspace install step to make it resolve.

## 5. `libs/shared/model-engines` has no TypeScript alias, and needs a guard

Every other entry under `libs/shared/` is browser code with a
`@portfolio/shared/*` path alias in `tsconfig.base.json`. `model-engines` is not:
it is plain `.mjs`, it names `process`, `node:child_process` and `node:fs`, and
the Angular apps must never reach it. It is imported today by a relative path
(`../../model-engines/src/index.mjs`) and Nx draws that as a real static edge,
which is the arrangement the curation plans chose and it does not change here.

Moving it under `shared/` makes a wrong alias more tempting, not less, so the
move adds the guard that stops it. A test in `model-engines` reads
`tsconfig.base.json` and fails if any alias resolves into this library:

```js
// The Angular apps compile every alias in tsconfig.base.json. This library
// names `process` and spawns child processes, so an alias here is a broken
// browser build with a confusing message. See the rule in libs/luna-shopper's
// browser reachable libraries note.
```

That guard is the whole of what this section costs, and it converts a
convention that lives in two memories and a plan into a red test.

**The alternative considered and refused**: a path that says Node in it, such as
`libs/shared/node/model-engines`. It documents the constraint without a test,
but it also invents a scope level that nothing else in the workspace uses, and
one directory named for a runtime would not stop the alias either. A test does.

## 6. What the folders inside a tool are for

Each tool folder holds projects, never source. `libs/luna-shopper/tools/leaflet`
is not a project and has no `project.json`, while `.../leaflet/cli` and
`.../leaflet/chains` are. This is the one rule that keeps the arrangement
readable as tools are added: **a directory either holds a project or holds
folders, never both.**

The curator's four projects keep the split they already have, and only their
prefix is dropped: `curation-cli` becomes `curation/cli`, and the word `curation`
is said once by the folder instead of four times by the children.

## 7. Every reference that has to change

The move is contained. Outside the five moved directories, exactly five files
name them:

| File                                                        | What it says                                       |
| ----------------------------------------------------------- | -------------------------------------------------- |
| `.gitignore`                                                | the comment above `.curation-runs/` names the path |
| `CLAUDE.md`                                                 | the ephemeral slot paragraph names `curation-cli`  |
| `apps/luna-shopper-backend/plans/0098`                      | a blockquote naming the libraries                  |
| `apps/luna-shopper-backend/plans/0099`                      | the same blockquote                                |
| `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` | names the rehearsal slot's owner                   |

The two backend plans are history and describe what was built at the time, so
they are left alone. `CLAUDE.md`, `.gitignore` and the e2e document are current
and are updated.

Inside the moved directories, four kinds of reference change:

- **`project.json`**: `sourceRoot` and the `node --test` glob carry the full
  path, so both change in all five files. The `implicitDependencies` lists carry
  project names, and only the `model-engines` rename touches them.
- **`eslint.config.mjs`**: every one is `import baseConfig from '../../../eslint.config.mjs'`.
  The depth changes to `../../../../../` for a curation project and stays at
  `../../../` for `model-engines`. Get this wrong and lint fails with a module
  resolution error rather than a lint error, which reads like a broken install.
- **`cli.mjs` and `orchestrator.mjs`**: the relative import of `model-engines`
  changes, because both ends moved.
- **`decider.mjs`**: it spawns the two deciders **by path**, so those strings
  change and no import checker will catch them. The `implicitDependencies` entry
  that exists because of that spawn is unchanged in name.

The usage comments at the top of `cli.mjs` also print the old path. They are the
place the `nx run` form from section 4 is now documented instead.

## 8. Order of work

1. `git mv` the five directories. Nothing else in the same commit, so the move
   is reviewable as a move.
2. Fix `sourceRoot`, the test glob and the eslint depth in all five
   `project.json` and `eslint.config.mjs`. Rename `model-engines` and update the
   four `implicitDependencies` lists that name it.
3. Fix the relative imports and the spawned decider paths.
4. Add the `curate` target and the alias guard test.
5. Update `CLAUDE.md`, `.gitignore` and the e2e document.

## 9. How it is checked

The proof that a pure move is a pure move is that the tests that passed before
pass after, unchanged:

```sh
npx nx run-many --target=test --projects=shared/model-engines,luna-shopper/curation-cli,luna-shopper/curation-auth,luna-shopper/curation-groups,luna-shopper/curation-suggestions
npx nx run-many --target=lint --projects=shared/model-engines,luna-shopper/curation-cli,luna-shopper/curation-auth,luna-shopper/curation-groups,luna-shopper/curation-suggestions
npx nx graph --file=graph.json
```

Three assertions beyond the suites, and the first two are the ones a move gets
wrong:

- `nx graph` still shows `luna-shopper/curation-cli -> shared/model-engines` as
  a **static** edge. A broken relative import turns it into no edge at all, and
  nothing else fails, so the graph is the only place it shows.
- `nx run luna-shopper/curation-cli:curate -- --help` prints the usage text. A
  wrong path in the target is a silent success with no output otherwise.
- The new alias guard fails when `@portfolio/shared/model-engines` is added to
  `tsconfig.base.json`. Prove it by adding the alias, running the test, and
  removing it again.

A rehearsal run against a slot is **not** part of this plan's proof. Nothing in
the decision path changed, and a rehearsal costs a Luna slot for a result the
unit suites already give.
