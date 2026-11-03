# 0006: The owner's runbook

> **The reader of this file is an agent that guides a person, the owner, through the steps
> that only the owner can do.** The other plans of the series are written for builders that
> change code. This one is not built. It is walked, from top to bottom, across the whole
> series, often weeks apart. Every step names what the person does, where they do it (the
> GitHub web interface, a terminal on the owner's machine, the Google console, a host over
> SSH), what the agent checks afterwards and with which command, what the step unblocks, and
> what fails later if it is skipped.
>
> The series renames Luna Shopper to Velista (docs `0003`), adds a license (docs `0004`),
> gives the server one baseline migration per service and an environment with one source
> (backend `0240` to `0243`), builds one client image for every deployment (velista `0178`),
> renames the namespace and the databases on both clusters (k8s `0019`), adds the Compose
> path and the cluster independent chart (k8s `0020`, `0021`), and moves Velista into its own
> public repository (docs `0005`). Paths below are written as they are today (2026-11-03);
> after docs `0003` the plan directories and projects carry the new names (`velista-server`,
> `velista-client`, `velista-admin`), and the agent reads the new path when the old one is
> gone. The plan directories of the apps move with docs `0003`
> (`apps/luna-shopper-backend/plans` to `apps/velista-server/plans`, `apps/velista/plans`
> to `apps/velista-client/plans`); this file lives in `docs/plans`, which does not move.
>
> Prerequisite reading for the agent: docs `0003`, `0004`, `0005`, k8s `0019` once it
> exists, `k8s/README-new-cluster.md` sections 7, 10b and "Existing clusters: the cutover",
> `k8s/bootstrap/github-environments.sh`, `.github/actions/deploy-unit/action.yml`, and
> the owner's memory notes on the backup bucket and on worktree cleanup.
>
> **Build order.** This file is read from the start of the series, before docs `0003`,
> because phase 1 comes before the rename. Phase 2 follows the merge of docs `0003`. Phase 3
> starts before the merge of k8s `0019` (step 3.0) and follows its staging and production
> runs. Phases 4 and 5 belong to docs `0005`, which is last. The
> plans of step 2 of the series order (docs `0004`, backend `0240` to `0243`, velista
> `0178`, k8s `0020`, `0021`) need no owner step beyond the merges and the decisions
> collected at the end of this file. The series order, as every plan of the series states
> it: docs `0003` first, alone, after the pull request gate; then in parallel docs `0004`,
> backend `0240` to `0243`, velista `0178`, k8s `0020` and `0021` (backend `0242` after
> velista `0178` for the admin mechanism, k8s `0020` after backend `0241` for the generated
> files); k8s `0019` after docs `0003` and backend `0240`, in the same rollup to `main` as
> `0240`; docs `0005` last, with docs `0006` read from the start.

## How to use this runbook

- **Walk the phases in order.** A phase starts only when the plan it serves has reached the
  moment it names. Tick a box (`- [x]`) in the agent's own working copy of this list, or in
  a note the owner keeps; do not commit ticks to the repository.
- **Every step has the same parts.** *Who* does it, *Where*, *Do* (the exact command or click
  path when it is known), *Check* (how the agent verifies it), *Unblocks*, and *If skipped*.
  Run the check after the person says the step is done. A step is done when the check
  passes, not when the person says so.
- **Secrets are never seen by the agent.** SSH private keys, tokens, passwords and the
  backup credentials are pasted or chosen by the owner in their own terminal or browser.
  The agent never asks for a value, never prints one, never writes one to a file, and checks
  only that a secret exists (`gh secret list`), never what it holds. When a command needs a
  secret file (`--key-file`), the owner runs the command.
- **Commands on a host** run as the `deploy` account over SSH only when the owner allows it
  in the conversation; otherwise the owner runs them and pastes the output. The agent never
  runs a command that changes a cluster. Every change to a cluster goes through a pipeline
  or through the owner's own hand.
- **Decisions are recorded** in "Owner decisions collected here" at the end, with the
  answer and the date, as the owner gives them. A builder of a later plan reads that list.
- **When a check fails**, stop the phase, tell the owner what failed and which plan section
  explains it, and do not go on to the next step.
- In commands, `<owner>` is the GitHub account or organisation of owner decision D5 and
  `<registry>` the registry path of D6.

## Phase 1. Before the rename (docs `0003`, `0004`, `0005`)

- [ ] **1.1 The name check** (serves docs `0003`).
  - *Who:* the owner, with the agent preparing the searches.
  - *Where:* a web browser; the agent's terminal for npm and GitHub.
  - *Do:* search "Velista" as a company name and as an app name in the EU and the US; the
    trademark registers EUIPO (eSearch plus, or TMview, which also covers the national
    offices) and USPTO (Trademark Search); the Google Play Store and the Apple App Store;
    the national company register of the owner's country. The agent runs `npm view velista`
    and `gh search repos velista --limit 30` and reports the hits.
  - *Check:* the owner states a conclusion (clear, or a conflict with whom and in which
    class). The agent records it under D1 with the date and the registers searched.
  - *Unblocks:* docs `0003`, which renames every identifier to Velista.
  - *If skipped:* the rename, the repository and the Play listing may carry a name another
    party holds, and a later rename costs all of docs `0003` again.

- [ ] **1.2 The license** (serves docs `0004`).
  - *Who:* the owner. *Where:* the conversation.
  - *Do:* choose the license from the options and the recommendation of docs `0004`
    (owner decision 1 recommends AGPL-3.0-only; owner decision 3 recommends, with AGPL,
    MIT for the seven `scope:shared-core` libraries). Nothing is decided until the owner
    answers; `package.json` saying MIT today is not a decision.
  - *Check:* the agent records the license under D2 and the shared core exception under
    D4. `package.json` says `"license": "MIT"`
    today and no `LICENSE` file exists; docs `0004` changes both to agree with the choice.
  - *Unblocks:* docs `0004`, and through it commit one of the new repository (docs `0005`).
  - *If skipped:* the new repository cannot be created as docs `0005` describes, because
    its first commit is that file.

- [ ] **1.3 The repository owner and the registry path** (serves docs `0005`, also read by
  docs `0003` for the image names).
  - *Who:* the owner. *Where:* the conversation; GitHub web if an organisation is created.
  - *Do:* decide between the account `IchirokuXVI` and an organisation (docs `0005` owner
    decisions 1 and 2). To create an organisation: GitHub, the avatar menu, "Your
    organizations", "New organization", the free plan.
  - *Check:* `gh api orgs/<organisation> --jq .login` answers, when an organisation was
    chosen. The agent records D5 and D6.
  - *Unblocks:* the registry line of docs `0003` and every CI edit of docs `0005`.
  - *If skipped:* docs `0003` renames the images under one path and docs `0005` moves them
    again, which changes every Deployment twice.

- [ ] **1.4 No open pull request against `dev` except Renovate's** (serves docs `0003`; the
  owner's decision 8 of 2026-11-02).
  - *Who:* the owner merges or closes; the agent lists.
  - *Where:* GitHub web, or the agent's terminal.
  - *Do:* the agent runs the command of docs `0003` target state 1, in a checkout of
    `nx-portfolio`:

    ```sh
    gh pr list --state open --limit 200 --json number,author,headRefName,title \
      --jq '.[] | select(.author.login != "app/renovate") | select(.headRefName != "dev")
            | "#\(.number) \(.author.login) \(.title)"'
    ```

    It covers every base, not only `dev`, because a stacked pull request also lands in
    `dev` later, and it leaves out a `dev` to `main` rollup by its head. The agent reads
    the list to the owner. The owner merges or closes each one. Renovate pull requests
    (author `app/renovate` as `gh pr list --json author` reports it, `renovate[bot]` in
    the REST API, titles `chore(deps): ...`) stay open.
  - *Check:* the same command prints nothing.
  - *Unblocks:* the start of docs `0003`.
  - *If skipped:* every open branch conflicts with a rename of every path and alias, and
    each one must be redone by hand after it.

- [ ] **1.5 Every session that holds a worktree stops** (serves docs `0003`).
  - *Who:* the owner tells each running session to stop; the agent lists them.
  - *Where:* a terminal in the main checkout.
  - *Do:* `git worktree list`, `bash tools/dev/ng-slot.sh --list` and
    `bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list` show what runs. Each session
    finishes or abandons its task and runs `--down` on its slots.
  - *Check:* both `--list` commands show only slot 0 (the owner's own) or nothing.
  - *Unblocks:* the rename branch, which a running session would otherwise race.
  - *If skipped:* a session pushes to a branch with the old names after the rename, and its
    work is lost in conflicts.

- [ ] **1.6 The quiet window** (serves docs `0003` and k8s `0019`).
  - *Who:* the owner. *Where:* the conversation.
  - *Do:* pick a day and an hour for the rename merge and the rollup from `dev` to `main`,
    which starts the staging deploys. Production comes later (phase 3).
  - *Check:* the agent records the window under D7.
  - *If skipped:* the rename lands while other work is in flight, which 1.4 and 1.5 exist
    to prevent.

## Phase 2. For the rename (docs `0003`)

- [ ] **2.1 Merge the rename** into `dev`, then the rollup into `main`.
  - *Who:* the owner. *Where:* GitHub web, the pull request page, "Merge pull request".
  - *Check:* `gh pr view <number> --json state,mergedAt` shows `MERGED` for both.
  - *Unblocks:* every plan of step 2 of the series order, which is written against the new
    names.
  - *If skipped:* nothing else in the series can start.

- [ ] **2.2 The staging runs are green.**
  - *Who:* the agent. *Where:* the agent's terminal.
  - *Do:* `gh run list --repo IchirokuXVI/nx-portfolio --workflow staging-velista.yml --limit 3`
    and the same for `staging-portfolio.yml`. Open a failed run with `gh run view <id> --log-failed`.
  - *Check:* the run of the rollup commit is `completed success` for both units, and
    `bash k8s/bootstrap/check-endpoints.sh $(node tools/deploy/units.mjs endpoints staging)`
    prints `ok` for every URL.
  - *If skipped:* a broken staging is found only at the production release.

- [ ] **2.3 The registry holds the new image names.**
  - *Who:* the agent checks; the owner looks if the agent's token cannot list packages.
  - *Where:* the terminal, or GitHub web, the profile, "Packages".
  - *Do:* `gh api "users/IchirokuXVI/packages?package_type=container" --jq '.[] | "\(.name) \(.visibility)"'`
    (needs the `read:packages` scope).
  - *Check:* every image of `node tools/deploy/units.mjs images` is listed, and each is
    `public`. The chart sets no `imagePullSecrets`, so a private package fails to pull.
  - *If skipped:* a Deployment stays in `ImagePullBackOff` on the next production release.

- [ ] **2.4 Decide when the old packages go.**
  - *Who:* the owner. *Where:* GitHub web, each package, "Package settings", "Delete this
    package".
  - *Do:* nothing yet. Recommendation: delete the old names only after production runs the
    new names and one more velista release has shipped, because `redeploy.yml` can deploy
    an older version again only while its images exist. The agent records the decision under
    D8 and brings it back at step 5.6.
  - *If skipped:* old packages cost storage and confuse the image scan; deleting them too
    early removes the way back to a version from before the rename.

## Phase 3. For the cutover (k8s `0019`)

The cutover renames the namespace `luna-shopper` to `velista`, the databases and roles
`luna_*` to `velista_*`, and the Secrets, StatefulSets and Services that follow the project
names, with `k8s/bootstrap/rename-release.sh` run from the deploy preflight. Staging runs it
by itself. Production runs it only when the variable `ALLOW_RENAME` of the environment
`velista-production` is `true` (k8s `0019` D10), the way `ALLOW_CUTOVER` gated k8s `0016`
D5; otherwise a production deploy stops before any change with one summary line.
`rename-release.sh --unit velista --status` answers `none`, `pending` or `cleanup`.

- [ ] **3.0 Before the merge of k8s `0019`: the portfolio mount and the release task window.**
  - *Who:* the owner. *Where:* the conversation, then GitHub web.
  - *Do:* decide k8s `0019` D7 (D18 below): A keeps `/velista` on the portfolio host, B
    turns it into a redirect to the velista host (recommended), C drops it. For B, merge the
    portfolio redirect pull request that k8s `0019` names and let it reach both clusters
    first. Under B or C the owner's values leave velista `0178`'s `VELISTA_MOUNT_PATH`
    (`velistaClient.mountPath`) empty; under A they keep `/velista`. Also: release task `0005` has a window that closes on 2026-11-12, and the
    rename script refuses an open window, so the cutover waits until the task is `done` or
    `expired` on both clusters (k8s `0019` owner decision 3).
  - *Check:* for B, `curl -sI https://staging.ichirokuxvi.com/velista/en` and the same on
    the production host answer `301` with a `location` on the velista host. For the task,
    `kubectl get cm release-tasks -n luna-shopper -o yaml` on each host (owner, or the
    agent as `deploy` if allowed) shows `0005` as `done` or `expired`.
  - *Unblocks:* the merge of k8s `0019`, and docs `0005` section 3.2.
  - *If skipped:* with A or B undecided the builder of k8s `0019` cannot finish; with the
    window open, the first staging deploy after the merge stops in its preflight.

- [ ] **3.1 Staging cuts over by itself.**
  - *Who:* nobody by hand. The first `staging-velista.yml` run after the merge of k8s `0019`
    runs the cutover in its preflight.
  - *Check:* the run is green and its summary shows the cutover steps. The owner (or the
    agent, if allowed, as `deploy`) runs on the staging host `helm list -A` (release
    `velista` in namespace `velista`) and `kubectl get pods -n velista`. Then
    `check-endpoints.sh` over the staging endpoints, as in 2.2, and the owner signs in on
    `staging.velista.app` with an existing account.
  - *Unblocks:* the production cutover, which runs only after staging has proven it.
  - *If skipped:* not possible; a red run here stops the phase.

- [ ] **3.2 Production: the hour and the gate.**
  - *Who:* the owner. *Where:* the conversation, then a terminal with `gh`.
  - *Do:* pick an hour with little traffic and no harvest schedule due within it (the
    backend is out for two to four minutes, k8s `0019` owner decision 2). At that hour:
    `gh variable set ALLOW_RENAME --repo IchirokuXVI/nx-portfolio --env velista-production --body true`,
    then publish the next Release `velista-vX.Y.Z` or re-run the failed deploy job of the
    last one. Set the variable only on the environment, never on the repository: the
    pipelines read `vars.ALLOW_RENAME`, which also resolves a repository variable. Afterwards:
    `gh variable delete ALLOW_RENAME --repo IchirokuXVI/nx-portfolio --env velista-production`.
    The owner may instead run the script by hand on the host with `--plan` first, as the
    "Owner steps outside the code" of k8s `0019` show.
  - *Check:* the release run is green; `gh variable list --repo IchirokuXVI/nx-portfolio --env velista-production`
    no longer shows `ALLOW_RENAME`.
  - *Unblocks:* 3.3 to 3.5, and docs `0005`, which needs both clusters under the new names.
  - *If skipped:* every production deploy of velista stops with one summary line, and
    docs `0005` cannot start.

- [ ] **3.3 Smoke checks after the production cutover.**
  - *Who:* the agent. *Where:* the agent's terminal.
  - *Do:* `bash k8s/bootstrap/check-endpoints.sh $(node tools/deploy/units.mjs endpoints production)`.
    The owner signs in to `https://velista.app` and to the admin app and opens a list.
  - *Check:* every URL prints `ok`; the owner confirms the session survived (the JWT keys
    were copied, not regenerated).
  - *If skipped:* a broken production is reported by users.

- [ ] **3.4 The backups write under the new database names.**
  - *Who:* the owner, or the agent as `deploy` if allowed.
  - *Where:* the production host over SSH.
  - *Do:* the morning after the cutover (the CronJobs run from 02:17 to 03:07 Central
    European time), list the bucket from a throwaway pod that takes its environment from the
    backup Secret with `envFrom` (its name after k8s `0019`), as the owner's note on the
    backup bucket describes: image `amazon/aws-cli`, command
    `aws --endpoint-url $S3_ENDPOINT s3 ls s3://$S3_BUCKET/velista_core/`, then
    `kubectl logs` and `kubectl delete pod`. Repeat for `velista_auth/`, `velista_catalog/`,
    `velista_harvester/`. Never print the Secret.
  - *Check:* each prefix holds a `<stamp>.dump` of that night.
  - *If skipped:* the first restore after a loss finds the newest dump under the old name,
    days old.

- [ ] **3.5 The old objects are gone, and nothing is deleted by hand.**
  - *Who:* the agent checks; the owner runs the host commands or allows the agent as
    `deploy`.
  - *Where:* each host over SSH.
  - *Do:* nothing by hand. k8s `0019` step 9 deletes the namespace `luna-shopper` and the
    PriorityClass `luna-stateful` from a later deploy, once the swap is an hour old and
    every Certificate is Ready; the volumes stay, the same objects, bound in `velista`.
    The old dumps under `luna_<x>/` stay in the bucket until its lifecycle rule deletes them,
    14 days after they were written (`retentionDays: 14` in `k8s/helm/velista/values.yaml`).
    Nothing renames or deletes objects in the bucket, whose credential is write only.
  - *Check:* `kubectl get ns luna-shopper` answers NotFound and
    `bash ~/deploy/velista/k8s/bootstrap/rename-release.sh --unit velista --status`
    answers `none` on each host. After 14 days, the listing of 3.4 for `luna_core/` is empty.
  - *If skipped:* a namespace that the cleanup did not reach keeps old pods and Secrets, and
    docs `0005` assumes it is gone. If the check fails, read the deploy summary for the
    reason step 9 waited; never delete a PersistentVolume by hand.

## Phase 4. For the new repository (docs `0005`)

Start this phase only when docs `0005`'s build order is met: every plan of the series merged
and both clusters cut over (phase 3 done). Steps 4.1 to 4.12 prepare the repository. The
velista environments of the new repository are **not** written in this phase, because the
first push to its `main` starts a staging deploy; they are written at step 5.2.

- [ ] **4.1 Stop every slot and worktree of the old checkout.**
  - *Who:* the owner. *Where:* a terminal in the main checkout.
  - *Do:* `bash k8s/e2e/velista-server/server-slot.sh --list` (the name docs `0003` gave
    `luna-slot.sh`) and `bash tools/dev/ng-slot.sh --list`; `--down` on each slot (and `--unlock <n>` on a slot
    whose data the owner no longer needs; a locked slot's Docker volumes survive the move,
    since they are not files of the checkout). Then `~/clean-worktrees.sh --dry-run`, read
    it, and `~/clean-worktrees.sh`. Run it only while no agent works in a worktree.
  - *Check:* both `--list` commands show nothing running; `git worktree list` shows the
    main checkout and the worktrees the owner chose to keep.
  - *If skipped:* processes keep old paths open, and slot claims block `--auto` in the new
    checkout.

- [ ] **4.2 Create the repository.**
  - *Who:* the owner. *Where:* GitHub web, "New repository".
  - *Do:* owner `<owner>`, name `Velista`, **Public**, and leave "Add a README", ".gitignore"
    and "license" all unset, because the first commit is the `LICENSE` file of docs `0004`.
    The same from a terminal: `gh repo create <owner>/Velista --public`.
  - *Check:* `gh repo view <owner>/Velista --json visibility,isEmpty` shows `PUBLIC` and
    `true`.
  - *Unblocks:* every later step of this phase.
  - *If skipped:* not possible.

- [ ] **4.3 The two first commits reach `main`.**
  - *Who:* the builder of docs `0005` prepares them; the owner allows the push to `main` of
    the new repository (it is not `nx-portfolio`'s `main`, which stays off limits), or
    pushes them.
  - *Where:* the builder's clone.
  - *Check:* `git log --format='%h %s' --reverse origin/main | head -2` in a fresh clone shows
    the license commit, then the import commit naming its source SHA. Then `dev` exists:
    `git ls-remote --heads origin dev`.
  - *Unblocks:* everything that needs code in the repository.
  - *If skipped:* not possible.

- [ ] **4.4 Install Renovate on the new repository.**
  - *Who:* the owner. *Where:* GitHub web, the avatar menu (or the organisation), "Settings",
    "Applications" (or "GitHub Apps"), Renovate, "Configure", "Repository access", add
    `Velista`, "Save".
  - *Check:* within an hour the issue "Dependency Dashboard" appears:
    `gh issue list --repo <owner>/Velista --search "Dependency Dashboard"`.
  - *If skipped:* no dependency update and no security update reaches the new repository.

- [ ] **4.5 Dependabot alerts** (Renovate's `vulnerabilityAlerts` rules read them).
  - *Who:* the owner. *Where:* GitHub web, the repository, "Settings", "Advanced Security"
    (or "Code security"), "Dependabot alerts", "Enable".
  - *Check:* `gh api repos/<owner>/Velista/vulnerability-alerts -i` answers `204`.
  - *Note:* `osvVulnerabilityAlerts` reads OSV and works without this. On 2026-11-03 the
    same request for `nx-portfolio` answered 404, so today's repository may have them off;
    the owner decides (D12).

- [ ] **4.6 The repository secret `AUTOMATION_TOKEN`** (read by `nx-migrate.yml`).
  - *Who:* the owner. *Where:* GitHub web, the avatar menu, "Settings", "Developer
    settings", "Fine-grained tokens", "Generate new token": resource owner `<owner>`, only
    the repository `Velista`, permissions Contents and Pull requests read and write. Then
    `gh secret set AUTOMATION_TOKEN --repo <owner>/Velista` and paste the token at the
    prompt.
  - *Check:* `gh secret list --repo <owner>/Velista` lists `AUTOMATION_TOKEN`.
  - *If skipped:* the monthly Nx migration fails its first step with "AUTOMATION_TOKEN is
    unset".

- [ ] **4.7 Package write access.**
  - *Who:* the owner. *Where:* GitHub web, each package of `node tools/deploy/units.mjs
    images` and `local-http-server`, "Package settings", "Manage Actions access", "Add
    repository", `Velista`, role **Write**.
  - *When:* only with a registry path under the account (D6). Under an organisation the new
    repository creates its own packages; after its first push, set each one **Public**
    ("Package settings", "Change visibility").
  - *Check:* the first `staging-velista.yml` run of the new repository passes its
    "Build & push the staging images" step (step 5.1 reads it).
  - *If skipped:* the build job fails with a `permission_denied` on push, or the cluster
    cannot pull a private package.

- [ ] **4.8 Rulesets for `main` and `dev`.**
  - *Who:* the owner. *Where:* GitHub web, the repository, "Settings", "Rules",
    "Rulesets", "New branch ruleset".
  - *Do:* for `main`, as in `nx-portfolio` (ruleset "PR main"): target the default branch,
    restrict deletions, block force pushes, require a pull request. For `dev` (D11): require
    the status checks `verify` and `verify-infra` (`pr.yml`) and `title` (`pr-title.yml`).
    A check can be picked only after it has run once, so add them after the first pull
    request of step 5.1.
  - *Check:* `gh api repos/<owner>/Velista/rulesets --jq '.[].name'` lists both.
  - *If skipped:* a red pull request can merge into `dev`, which `CLAUDE.md` forbids.

- [ ] **4.9 Things that stay as they are.** Tell the owner, so that nobody changes them.
  - The Play Console listing, the Google Cloud project `velista-512817`, its web and Android
    OAuth clients: the package names (`app.velista`, `app.velista.staging`) and the client
    ids do not change.
  - The Cloudflare DNS of both domains: the hosts and addresses do not change.
  - The backup bucket: same bucket, same credentials; only the prefixes changed in phase 3.
  - No GitHub Pages, no issue templates, no wiki.
  - *Check:* none. *If skipped:* a needless change to OAuth or DNS breaks sign in or the site.

- [ ] **4.10 The `tmp/` folder and the Android keystore move by hand.**
  - *Who:* the owner. *Where:* the file explorer or a terminal.
  - *Do:* clone the new repository next to the old one. Copy from
    `D:/Projects/nx-portfolio/tmp/` into the new clone's `tmp/` the velista files: the
    admin and user logins (`luna-admin-user-production`, `luna-curator-user-production`,
    `velista-user-staging`), `velista-android/` (the release keystore and its
    `keystore.properties`), and the curation and leaflet run folders the owner wants. If
    `apps/velista-client/android/keystore.properties` (today `apps/velista/android`; the
    local file mover of docs `0003` moves it) exists in the old checkout, copy it to the
    same path in the new one and edit its store file line to the new location; the owner
    edits it, because the file holds the keystore passwords. Keep the old copies until the
    new checkout has signed one build. Keep an offline backup of the keystore.
  - *Check:* the agent runs `git status --ignored --short tmp apps/velista-client/android` in the
    new clone (names only, no content) and sees the files listed as ignored; it never opens
    them.
  - *If skipped:* the next Android bundle is signed with the debug key and Play refuses it;
    the agent cannot sign in to the admin API.

- [ ] **4.11 The deploy keys are at hand.**
  - *Who:* the owner. *Where:* the owner's machine.
  - *Do:* confirm the private keys of the deploy account exist as files, as section 1 of
    `k8s/README-new-cluster.md` names them (`~/.ssh/nx_staging_deploy`,
    `~/.ssh/nx_production_deploy`, or the one shared key). GitHub cannot show a secret back,
    so the copy in `nx-portfolio`'s environments is no source. If a key is lost, make a new
    pair and add its public half on each host with
    `sudo bash ~/nx-portfolio/k8s/bootstrap/provision-host.sh --deploy-key '<the .pub line>'`.
  - *Check:* the agent runs `ls ~/.ssh/` with the owner's consent (names only) or the owner
    confirms.
  - *Unblocks:* step 5.2.
  - *If skipped:* step 5.2 cannot write `SSH_DEPLOY_KEY`.

- [ ] **4.12 The host maintenance decision** (docs `0005` owner decision 6, D10 here).
  - *Who:* the owner. *Where:* the conversation.
  - *Do:* decide which repository patches the hosts. The plan recommends the new one.
  - *Check:* the agent records D10.
  - *If skipped:* both repositories patch the same hosts every Monday, or neither does.

## Phase 5. After the first green run of the new repository (docs `0005`)

- [ ] **5.1 The dry run is green up to the deploy.**
  - *Who:* the agent. *Where:* the terminal.
  - *Do:* `gh run list --repo <owner>/Velista --workflow staging-velista.yml --limit 3`.
    The run of the import push (or a dispatch, `gh workflow run staging-velista.yml --repo
    <owner>/Velista --ref main`) must pass setup, lint and test, build and both gates, and
    stop in the deploy job at "The environment names a host". Also a pull request into
    `dev` of the new repository passes `verify`, `verify-infra` and `title`.
  - *Check:* `gh run view <id>` shows the jobs green except `deploy`, whose summary says the
    environment `velista-staging` lacks its values.
  - *Unblocks:* 5.2. Add the required checks of step 4.8 now.
  - *If skipped:* the first real deploy is also the first build, and a failure then leaves
    velista with no working pipeline in either repository.

- [ ] **5.2 Disable the old callers, then write the new environments.** The order matters:
  two repositories must never deploy one namespace.
  - *Who:* the owner. *Where:* a terminal with `gh` logged in as a repository admin.
  - *Do, in this order:*
    1. `gh workflow disable staging-velista.yml --repo IchirokuXVI/nx-portfolio` and
       `gh workflow disable release-velista.yml --repo IchirokuXVI/nx-portfolio`. When D10
       moves host maintenance, also `gh workflow disable host-maintenance.yml --repo IchirokuXVI/nx-portfolio`.
    2. From a terminal in the new clone (the script reads `k8s/units` of the checkout it runs
       in, so it writes velista environments only):
       `bash k8s/bootstrap/github-environments.sh --env staging --host <staging host> --key-file <staging key> --repo <owner>/Velista`
       and
       `bash k8s/bootstrap/github-environments.sh --env production --host <production host> --key-file <production key> --soak-host <staging host> --reviewer <owner login> --repo <owner>/Velista`.
       The hosts are today's, `staging.ichirokuxvi.com` and `ichirokuxvi.com` as the
       `velista-staging` and `velista-production` known hosts of `nx-portfolio` show. Add
       `--units-only` to both when D10 keeps host maintenance in `nx-portfolio`. The script
       prints the host key fingerprints; the owner compares them with
       `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on each host before going on.
  - *What the script writes:* in `velista-staging`, `velista-production` and
    `velista-production-redeploy` the secrets `SSH_DEPLOY_HOST`, `SSH_DEPLOY_USER`,
    `SSH_DEPLOY_KEY` and the variable `SSH_KNOWN_HOSTS`; the tag rule `velista-v*` on
    `velista-production`; the branch rule `main` and the reviewer on
    `velista-production-redeploy`; without `--units-only`, also `host-staging` and
    `host-production` with `SSH_SOAK_CHECK_HOST` and the two day wait timer. No
    `ALLOW_CUTOVER` and no k8s `0019` gate: both clusters are cut over.
  - *Check:* `gh workflow list --repo IchirokuXVI/nx-portfolio --all` shows the two callers
    `disabled_manually`. For each environment:
    `gh secret list --repo <owner>/Velista --env velista-staging` lists the three secrets
    and `gh variable list --repo <owner>/Velista --env velista-staging` the known hosts; the
    same for `velista-production` and `velista-production-redeploy`.
  - *Unblocks:* 5.3.
  - *If skipped (the disable):* a push to `main` of `nx-portfolio` and a push to the new
    repository deploy the same release from two trees.

- [ ] **5.3 The first real staging deploy.**
  - *Who:* the owner re-runs; the agent checks.
  - *Do:* `gh run rerun <id> --failed --repo <owner>/Velista` on the dry run of 5.1.
  - *Check:* the deploy job is green and its summary shows `kubectl rollout status`
    successful for each velista Deployment; `check-endpoints.sh` over the staging endpoints
    prints `ok`. Before the re-run, the builder of docs `0005` has shown the `helm template`
    comparison of its section 4.2.
  - *Unblocks:* 5.4 and 5.5.

- [ ] **5.4 Remove velista from `nx-portfolio`.**
  - *Who:* the owner merges the removal pull request of docs `0005` section 3.1 into `dev`
    of `nx-portfolio`, then the next rollup into `main`.
  - *Check:* `gh workflow list --repo IchirokuXVI/nx-portfolio` lists no velista caller; the
    next `staging-portfolio.yml` run is green.
  - *If skipped:* the disabled callers stay in the tree, and anyone who enables them deploys
    an old velista.

- [ ] **5.5 The first production release from the new repository.**
  - *Who:* the owner. *Where:* GitHub web, the new repository, "Releases", "Draft a new
    release", tag `velista-vX.Y.Z` on `main` with a number above the last `velista-v*` of
    `nx-portfolio` (`velista-v0.18.0` on 2026-11-03; check with
    `gh release list --repo IchirokuXVI/nx-portfolio`). The notes are written by hand or
    with `node tools/release/release-notes.mjs --unit velista --from <import tag> --version velista-vX.Y.Z --out notes.md`.
  - *Check:* `gh run list --repo <owner>/Velista --workflow release-velista.yml --limit 1`
    green; `check-endpoints.sh` over the production endpoints prints `ok`.
  - *Unblocks:* `redeploy.yml` of the new repository, which refuses every version until this
    Release exists. Until then the way back is `helm rollback velista <revision> -n velista`
    on the host.

- [ ] **5.6 Delete the old packages** (D8).
  - *Who:* the owner. *Where:* GitHub web, each old package, "Package settings", "Delete
    this package".
  - *Do:* only the packages whose names docs `0003` retired, and only when D8's condition
    holds. Packages the new repository still pushes to stay.
  - *Check:* the list of 2.3 shows only current names.

- [ ] **5.7 Archive nothing.** `nx-portfolio` keeps the portfolio and the history every
  velista plan links to. Tell the owner not to archive it.

- [ ] **5.8 The hosts' admin clones** (only when D10 moves host maintenance).
  - *Who:* the owner. *Where:* each host over SSH, as the admin account.
  - *Do:* clone the new repository where the new `provision-host.sh` expects it (docs `0005`
    owner decision 6 sets the directory), then run
    `sudo bash <clone>/k8s/bootstrap/provision-host.sh --k3s` so that `nx-host-patch` comes
    from the repository that now patches.
  - *Check:* `sudo nx-host-patch status` as `deploy`; the next Monday's
    `host-maintenance.yml` run of the new repository is green.

- [ ] **5.9 Bookmarks and the assistant's memory.**
  - *Who:* the owner updates bookmarks; the agent writes the memory update.
  - *Do:* the agent updates the memory files under the owner's profile: the new repository
    and checkout path, the new names of docs `0003`, the new namespace and database names of
    k8s `0019`, where `tmp/` lives now, which repository runs host maintenance, and that
    plan numbers continue in the new repository. It marks the series done in its notes.
  - *Check:* the owner reads the memory index entry.

## Owner decisions collected here

Every decision the series defers to the owner. The agent fills the answer and the date as
the owner gives them, and the plan named in brackets reads it.

| # | Decision | Recommendation | Answer | Date |
| --- | --- | --- | --- | --- |
| D1 | Name check result, registers searched (docs `0003`) | clear before the rename | | |
| D2 | The license (docs `0004` decision 1) | AGPL-3.0-only, the owner's choice among MIT, Apache-2.0 and AGPL-3.0 | | |
| D3 | Everything else docs `0003` defers (its owner decisions section) | as docs `0003` recommends | | |
| D4 | Everything docs `0004` defers beyond the license, first the shared core exception (decision 3) | with AGPL, MIT for the seven `scope:shared-core` libraries; the rest as docs `0004` recommends | | |
| D5 | Repository under the account or an organisation (docs `0005` 1) | the account, unless the registry path matters | | |
| D6 | Registry path (docs `0005` 2) | follow D5 | | |
| D7 | The quiet window of the rename (this runbook 1.6) | a weekday morning | | |
| D8 | When the old packages are deleted (2.4, 5.6) | after production runs the new names and one more release | | |
| D9 | History mode (docs `0005` 3) | fresh history, license first | | |
| D10 | Which repository runs host maintenance (docs `0005` 6) | the new repository | | |
| D11 | A ruleset with required checks on `dev` (docs `0005` 7) | yes | | |
| D12 | Dependabot alerts on in the new repository (4.5) | yes | | |
| D13 | `docker/ddns` and the homelab files (docs `0005` 4) | ddns stays, homelab moves | | |
| D14 | The owner's values public or private, k8s backlog `0003` (docs `0005` 5) | public for now, backlog later | | |
| D15 | The import tag for release notes (docs `0005` 8) | `velista-import` | | |
| D16 | The `name` of `package.json` (docs `0005` 9) | `@velista/source` | | |
| D17 | The production cutover hour and who runs it (k8s `0019`) | a weekday early morning, through the release with `ALLOW_RENAME` | | |
| D18 | Whether `/velista` on the portfolio host survives (k8s `0019`) | B, a redirect (k8s `0019` D7) | | |
| D19 | Each other decision of backend `0240` to `0243`, velista `0178`, k8s `0020`, `0021` | as each plan recommends | | |
| D20 | Release task `0005` before the rename: let its window close on 2026-11-12 or finish it (k8s `0019` owner decision 3) | let the window close | | |
| D21 | Retire `k8s/catalog-import/restore-first-catalog.sh`, which refuses every dump taken before the baseline adoption (k8s `0019` owner decision 5, backend `0240`) | retire it in k8s `0019` | | |

When a plan of the series is written after this file and adds an owner decision, the agent
adds a row here with the plan's number before the decision is needed.
