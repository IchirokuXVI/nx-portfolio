# 0003: a slot you can give back, and an .env you can edit

> Prerequisite reading: `tools/dev/README.md` (what a slot is, and why the remote ports
> cannot come from the project graph) and
> `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` for the backend half.
>
> One plan for both scripts, on purpose. `tools/dev/ng-slot.sh` and
> `k8s/e2e/luna-shopper-backend/luna-slot.sh` are independent files with no shared
> library, so every rule they hold in common is held twice. Writing the rules once, here,
> is what stops the two copies drifting apart. Where a rule applies to one script only,
> this plan says which one and why.

## 1. Why this was needed

Four separate defects, and they are unrelated except that all four live in the two slot
scripts.

**A re-run destroys what you edited.** `write_config` writes every file with `cat >` from
a heredoc. So a `GEMINI_API_KEY` pasted in by hand, a `HARVEST_ENABLED=true` flipped for a
crawl, or a `MERCADONA_BASE_URL` pointed at a local recording all disappear the moment
anybody moves the slot or re-runs `--up`. The values worth keeping are exactly the ones
nobody can regenerate.

**A slot is claimed forever.** `--down` stops the processes and leaves the descriptor on
disk, so the claim outlives the work. Nine slots fill up with worktrees that finished days
ago, and `--auto` then reports that nothing is free while nothing is running.

**Volumes outlive the claim with nothing recording them.** `--down --keep-data` keeps this
slot's databases on purpose, so somebody can look at the result next session. Once the
claim is released, the next worktree to take that number inherits those databases without
being told.

**Two scripts are maintained where one is used.** The `.ps1` twins are a second
implementation of every rule above, and the memory note `luna-slot-ps1-has-no-harvester`
records what happens when they fall behind. Windows work happens in Git Bash, and the
bash scripts already handle Windows through `taskkill //F //T` and `netstat -ano`.

## 2. Only what the slot decides is rewritten

One function per script, `merge_env`. Every heredoc in `write_config` stays exactly as it
is, and the rendered text passes through `merge_env` on its way to disk. The new logic
lives in one place, and the diff stays readable.

Beside the port table each script gains one set, `DERIVED_KEYS`, naming the keys the slot
decides. A comment on that set states the rule for later: a new slot-dependent key must be
added here.

The merge, per key in the rendered template:

| the key is                   | the result                     |
| ---------------------------- | ------------------------------ |
| in `DERIVED_KEYS`            | the freshly computed value     |
| present in the file on disk  | the value on disk, verbatim    |
| absent from the file on disk | the template default, inserted |

A key on disk that the template does not name is kept, appended under a marked comment.

The list is inclusive, never an exception list. An exception list defaults to rewriting,
so a key nobody classified gets a fresh value and stays correct. An inclusive list
defaults to preserving, so a key nobody classified keeps a stale value. Section 2.5 is the
net under that.

### 2.1 What each file counts as derived

| file                                      | derived keys                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/shell/.env`                         | `MFE_REMOTE_URLS`                                                                                        |
| `apps/velista/.env`                       | `LUNA_GATEWAY_URL`, `LUNA_REALTIME_URL`                                                                  |
| `apps/luna-shopper-admin/.env`            | `LUNA_GATEWAY_URL`                                                                                       |
| `.env.luna-shopper-backend`               | `NATS_URL`, `REDIS_URL`, `CORS_ORIGINS`                                                                  |
| `gateway/.env`                            | `PORT`, `APP_BASE_URL`, `GOOGLE_CALLBACK_URL`                                                            |
| `realtime/.env`                           | `PORT`                                                                                                   |
| `auth/.env`                               | `PORT`, `AUTH_DB_URL`, `SMTP_PORT`, `MAIL_VERIFY_BASE_URL`, `MAIL_RESET_BASE_URL`, `GOOGLE_CALLBACK_URL` |
| `core/.env`                               | `PORT`, `CORE_DB_URL`                                                                                    |
| `catalog/.env`                            | `PORT`, `CATALOG_DB_URL`                                                                                 |
| `harvester/.env`                          | `PORT`, `HARVESTER_DB_URL`                                                                               |
| `assistant/.env`                          | `PORT`, `GATEWAY_INTERNAL_URL`                                                                           |
| the telemetry block in every service file | `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                            |
| the four `.env.test` files                | that service's `*_DB_URL`                                                                                |

Everything else is preserved. `SMTP_HOST=localhost` is a host and not a port, so it stays.
The `AUTH_JWT_*_FILE` and `ADMIN_JWT_*_FILE` paths are the same on every slot, so they
stay. `OTEL_ENABLED` stays, because turning telemetry off is a choice somebody made.

The two descriptors, `tools/dev/.env.ng-slot` and `k8s/e2e/luna-shopper-backend/.env.slot`,
are the exception: they are generated whole, with no merge. They are the scripts' own
bookkeeping, every value in them is derived, and the two choices they carry across a
re-run, `NG_BACKEND_SLOT` and `LUNA_APP_SLOT`, already have functions that read the
recorded value back (`detect_backend_slot` and `current_app_slot`).

The front end half gains little from this today, because every key it writes is derived.
It gains everything the first time somebody adds a key to `apps/velista/.env` by hand, and
the rule then reads the same on both sides of the stack.

### 2.2 A blank value is not a missing key

`GEMINI_API_KEY=` present and empty is a decision. It means "use no key, answer 501, and
do not ask me again". Ten keys ship blank for that reason, among them `MERCADONA_BASE_URL`,
`OVERPASS_URL`, `MIN_CLIENT_VERSION` and `VOICE_COMMENT_CONTENT_TYPES`, where blank means
"use the value built into the code".

So a blank on disk is preserved like any other value, and only a key that is absent gets
the template default inserted. Treating blank as absent overwrites a deliberate
choice on every run, which is the defect this section exists to fix.

One risk comes with it, and it is worth stating rather than hiding. If a key ever moves
from optional-and-blank to required-and-not-blank, a file that already holds the blank
keeps it, and the service dies at boot. Every required key added so far arrived as a new
key, which the insert path covers. `--reset-env` is the repair, and the boot failure names
the variable.

### 2.3 Parsing rules

Stated in the code, because each one is a way to be silently wrong:

- Only an uncommented `^[A-Za-z_][A-Za-z0-9_]*=` line counts as a key. `# GEMINI_API_KEY=x`
  is a comment, so that key is absent.
- The value is the rest of the line, verbatim, so quotes and a `#` inside a value survive.
- A key that appears twice keeps its first value, which is what dotenv does when it reads
  the same file.
- Multi-line values are not supported. No file this script writes has one.

### 2.4 `--reset-env` and `--keep-env`

Preservation makes the shipped defaults unreachable, which is a problem the first time a
preserved value is the thing that broke the stack. Two flags, on both scripts:

```
--reset-env          put every non-derived key back to its template default
--keep-env A,B       with --reset-env, leave these keys alone
```

One flag was considered and rejected. "Reset everything" and "reset everything except
these" are complements, so a single list cannot serve both without a polarity marker, and
a misread reset flag destroys work. Two names, each unambiguous on its own line of
`--help`, is the safer trade.

`--keep-env` without `--reset-env` is an error rather than a silent no-op, because it
reads like a promise the script does not keep.

### 2.5 The warning that catches a forgotten derived key

After the merge, each script scans the preserved values for a port in the 42000 or 43000
band that is not one of this slot's. It prints a warning naming the file and the key, and
it changes nothing.

That is the net under the inclusive list. A slot-dependent key nobody added to
`DERIVED_KEYS` keeps a stale port, and a stale port is the worst failure this whole area
has: a service pointed at another worktree's database. The warning turns that into one
line of output. It does not override the value, because
`MERCADONA_BASE_URL=http://localhost:43000/recording` is a legitimate hand edit and the
script cannot tell the two apart.

## 3. `--down` gives the slot back

Today `--down` stops the processes and leaves the claim. It now releases it.

The order matters, because an interrupted run must still know its own slot:

1. Read the descriptor.
2. Stop the services, and take the compose stack down, exactly as today.
3. Rewrite each `.env` this script owns, with the derived key lines left out and every
   preserved value kept.
4. Delete the descriptor.

Step 3 rewrites rather than deleting single lines, so the comment blocks do not end up
describing keys that are no longer in the file. It is `merge_env` again, in a second mode
that omits the derived keys instead of computing them. The next `--up` puts them back
through the insert path in section 2, because a key absent from the file takes the
template default, and for a derived key the template default is the freshly computed
value.

The files are not deleted. Deleting them throws away the `GEMINI_API_KEY` that
section 2 exists to protect. What is removed is only what points at a slot this worktree
no longer holds.

`--keep-slot` skips steps 3 and 4. The claim stays, every value stays, and a plain
`npx nx serve velista` still works. **Slot 0 always behaves as though `--keep-slot` were
given**, whether or not it was: slot 0 is the developer's own, nothing takes it, and
there is nothing to give back.

Two consequences to write down rather than let people discover:

- **After a releasing `--down`, `--up` can return a different number.** Another worktree
  can take yours in between. Do not depend on getting the same slot back. When the
  number matters, `--restart` bounces without releasing, and `--down --keep-slot` stops
  everything and holds the number.
- **The four `.env.test` files hold nothing but a derived connection string.** After a
  releasing `--down` they are comments and no value, so a `LUNA_ENV=test` db target fails
  with a missing connection string until the next `--up`. That is the correct failure, and
  it is better than the alternative, which is a test run against another worktree's
  database.

## 4. `--keep-data` locks the slot

`--down --keep-data` keeps this slot's volumes so somebody can look at the result later.
Once section 3 releases the claim, those volumes belong to a slot that `--auto` will hand
to the next worktree that asks. So `--keep-data` now writes a **lock**.

A lock and a claim are different things and are independent. A claim says a worktree is
configured for this slot. A lock says data on this slot is being kept on purpose. A slot
can be locked and claimed at the same time, and `--down --keep-data --keep-slot` produces
exactly that.

The only thing a lock changes is `--auto`, which skips a locked slot. Everything else
ignores it.

### 4.1 Where the lock lives

`$(git rev-parse --git-common-dir)/luna-slot-locks/<n>`, one file per locked slot.

It cannot live in the worktree, and that is the whole reason for the path. The lock has to
outlive the descriptor, which `--down` deletes, and it has to outlive the worktree itself,
which gets removed when a task ends. The volumes outlive both. `git rev-parse
--git-common-dir` resolves to the main `.git` directory from any worktree, so every
checkout reads the same directory, and nothing there is committed.

The file names the worktree that wrote it and the date, so `--list` can say who is holding
the slot and since when.

### 4.2 Taking a locked slot

Naming the number takes it. `luna-slot.sh --up <n>` on a locked slot warns, names the
volumes it found, proceeds, and clears the lock.

It does not block, because inheriting those volumes is the point of the mechanism. The
lock exists so that nobody takes them **by accident**, through `--auto`. Typing the number
is the confirmation.

`--down --keep-data` on that slot writes the lock again.

### 4.3 `--unlock`

`luna-slot.sh --unlock [<n>]` drops a lock and touches nothing else. With no number it
means this worktree's slot.

Without it, a lock ends only when somebody brings that slot up and inherits its databases,
so a lock nobody wants any more removes a slot from `--auto` permanently.

### 4.4 The front end has no lock

`ng-slot.sh` has no `--keep-data`, because it has no data. `--keep-slot` is what holds a
front end slot, and a claim already makes `--auto` skip it. Both help texts say this, so
nobody looks for the flag on the wrong script.

## 5. `--auto`, and the error when nothing is free

Three of the behaviors asked for already work and must keep working. `--auto` never takes
slot 0. `--auto` skips a slot another worktree claims. Two worktrees can be configured for
one slot when the number is given explicitly, and `--list` prints such a slot as two
lines.

Three changes:

- `--auto` skips a locked slot as well as a claimed one (`luna-slot.sh` only).
- `--up --auto` in a worktree that already holds a claim **keeps the recorded slot** and
  says so. Today it takes a fresh one and abandons whatever is still running on the old
  number. This is what makes `--up --auto` the one command an agent can always run.
- The exhaustion message names every slot and the reason it is unavailable: claimed by a
  path, locked by a path, or a port somebody outside this repository is listening on. The
  three have different fixes, so one message for all three is not enough.

That message ends by telling the reader to stop and ask the user rather than to improvise
a port. The instruction belongs in the error text and not only in a document, because an
instruction the reader is already looking at is the one that gets followed.

## 6. The PowerShell twins are deleted

`tools/dev/ng-slot.ps1` and `k8s/e2e/luna-shopper-backend/luna-slot.ps1` are removed. Git
Bash is the supported shell on Windows.

**Those two files, and nothing else.** `k8s/bootstrap/install.ps1` is a different tool,
for a step run once per cluster on a Windows machine, and it stays. So does every other
`.ps1` in the workspace. Delete by name, never by pattern.

Fifteen live files name the two twins and change with them: `CLAUDE.md`, `README.md`,
`.gitignore`, `k8s/e2e/luna-shopper-backend/compose.yml`, `tools/dev/README.md`,
`k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md`, `k8s/README-homelab.md`, and
the eight `.env.example` headers under `apps/luna-shopper-backend`.

Two of those name no filename, so a search for `ng-slot.ps1` misses them. `CLAUDE.md` and
`README.md` both say "Both have `.ps1` twins". Search for `ps1` and read every hit.

Eight plan files also name them, and all eight keep the mention:
`apps/luna-shopper-backend/plans/0039`, `0041`, `0045`, `0071`, `0072`, `0083`,
`apps/luna-shopper-admin/plans/0001`, and `k8s/plans/0001`. A plan records what was
designed at the time and names the pull request that built it. Editing one to hide a file
that has since been deleted rewrites history for no reader's benefit.

## 7. What the documents have to say afterwards

`CLAUDE.md`, in the dev slots section:

- Pass `--keep-slot` when you were told to use a specific slot, or when you need the slot
  to survive for any other reason. `--down` without it gives the slot back.
- `--down --keep-data` keeps the databases and locks the slot, so `--auto` will not hand
  it to anybody else. Take it back by naming the number, or clear it with `--unlock`.
- After `--down`, `--up` can give you a different number. Use `--restart` to bounce.
- There are no `.ps1` twins any more.

`tools/dev/README.md` and `k8s/e2e/luna-shopper-backend/parallel-worktree-testing.md` say
the same, and lose their PowerShell examples.

Two memory entries change with this work. `dev-slots-are-how-instances-start` gains the
`--keep-slot` and lock rules. `luna-slot-ps1-has-no-harvester` describes a file that no
longer exists, so it is deleted.

## 8. Acceptance

1. A hand edited `GEMINI_API_KEY` survives a re-run on the same slot, and survives a move
   to another slot.
2. A key that is blank on disk stays blank. A key absent from disk is inserted with its
   template default.
3. After a slot move, no `.env` in the worktree names a port outside the new slot's block.
4. `--reset-env` puts every non-derived key back to its template default.
   `--reset-env --keep-env GEMINI_API_KEY` leaves that one alone. `--keep-env` alone is an
   error.
5. A preserved value naming a 42000 or 43000 band port that is not this slot's produces a
   warning, and no value changes.
6. `--down` deletes the descriptor and strips every derived key from the files it owns,
   keeping the rest. `--list` in another worktree then shows the slot free.
7. `--down --keep-slot` leaves the descriptor and every value in place, and `--list` still
   shows the claim.
8. `--down` on slot 0 stops the processes and changes no file.
9. `--down --keep-data` writes a lock. `--auto` in another worktree skips that number.
   `--up <n>` on it warns, proceeds, and clears the lock. `--unlock <n>` clears it without
   starting anything.
10. Two worktrees configured for one slot both appear in `--list`, and `--auto` still
    refuses that number.
11. `--up --auto` in a worktree that already holds a claim keeps its number.
12. With every slot from 1 to 9 unavailable, `--auto` exits non-zero and names each slot
    and its reason.
13. Neither slot script has a `.ps1` twin, and no live document names one.
    `k8s/bootstrap/install.ps1` is still there.
