# 0002: e2e runs that say what they are doing, and stop when they do not

> Written after the fact, from commit `74af99f`. The work is on `dev`; this plan records
> the design it was built to rather than the one it was built from.
>
> Prerequisite reading: `0001` in this directory, which is where the Playwright configs
> last changed, and `k8s/plans/0003` on why a CI step that cannot fail is worse than one
> that fails.

## 1. The report

The staging e2e step looked hung. One run was killed by hand after 3m16s of silence.
Another reached **2h10m**. Both died on the same line:

```
Running 34 tests using 1 worker
```

with nothing after it. There was no way to tell a working run from a wedged one, and no
way to know which test was on screen when either ended.

Two separate causes, and the run was both invisible **and** genuinely burning time.

## 2. Invisible: the preset configures no reporter that prints

`nxE2EPreset` configures `html`, plus `blob` on CI. Neither prints to stdout, so
Playwright prepends a terminal reporter of its own, and on CI that fallback is `dot`
(`printsToStdio` in `playwright/lib/runner/reporters.js`).

`dot` writes one character per finished test and breaks the line only every 80
characters. The GitHub Actions runner surfaces a log line only once it sees a newline. So
**a suite of fewer than 80 tests prints its opening line and then nothing whatsoever
until the run ends.** A job that is working looks exactly like a job that is wedged.

`luna-shopper-backend-e2e` looked fine only by accident: it skips itself without a stack,
and the skip summary flushes the buffer immediately.

### 2.1 `withProgressReporter`

`list` in front of the preset's reporters, on CI only. In a non TTY it prints a complete
line per finished test, so the log always names the test that was running when a run
dies.

Four decisions in a very small file:

- **In front of, not instead of.** The html and blob artifacts are untouched.
- **CI only.** Locally Playwright's fallback is `line`, which rewrites one status line in
  place and is pleasanter to watch.
- **One shared file at the workspace root**, `playwright.reporters.ts`, because four
  suites need the identical rule and four copies would drift.
- **A bare string reporter is returned untouched.** That form always names a reporter
  that prints to stdout, so it never had the problem.

## 3. Burning: waits with no upper bound

### 3.1 The two timeouts that default to no limit

Under the test runner `navigationTimeout` and `actionTimeout` both default to `0`, and
**`0` means no limit**, not the documented 30s: the runner calls
`setDefaultNavigationTimeout(0)` unconditionally, and a defined `0` wins over the built
in default.

A navigation that never completes was therefore bounded only by the **test** timeout. One
unreachable page cost a full 60s, or the whole 300s budget in
`no-horizontal-scroll.spec.ts`, and `retries: 2` paid that three times over. Seven crawl
tests at 300s times 3 is 105 minutes on its own, which is most of the 2h10m.

Every config now sets them explicitly: `actionTimeout: 15s`, `navigationTimeout: 30s`.

### 3.2 `settle` awaited fonts with the cap behind it

`settle` awaited `document.fonts.ready` and then a 400ms DOM quiet window, with the 8s cap
sitting on the quiet window **behind** the fonts await. `document.fonts.ready` has no
timeout of its own and never rejects, so a font request that goes out and never comes
back parked the evaluate until the test timeout.

One budget now races the whole wait, fonts included, and the two specs that awaited
`fonts.ready` directly use a bounded helper.

### 3.3 A ceiling on the step itself

Both e2e steps get a `timeout-minutes`, so a stall fails on its own rather than running
against the job's six hour default. This is `k8s/plans/0003`'s rule applied to the test
step: a step that cannot fail will eventually cost more than one that does.

## 4. Two stale assertions, fixed while here

Both were guaranteed failures left over from the plan `0003` URL reorder, and every one
of them fed the retry multiplier in section 3.1, so they were paying for themselves three
times per run:

- damoclesSword's `currentUrlLocale` read segment 0, which is the **mount** now and not
  the locale.
- velista's landing spec still expected `/es/velista` rather than `/velista/es`.

Note that the two suites' locale helpers read different path segments **on purpose**, and
making them identical would break one of them.

## 5. Acceptance

1. A CI e2e run prints a line per finished test, so the log names the test that was
   running when it ends.
2. The html and blob artifacts are unchanged, and local runs still use `line`.
3. An unreachable page fails a test in tens of seconds, not in the test's whole budget.
4. A font that never loads does not park `settle` past its 8s budget.
5. A wedged e2e step fails on its `timeout-minutes` rather than at the job's six hour
   default.
6. The damoclesSword and velista suites pass against the current URL order.
