> **PR:** [#761](https://github.com/IchirokuXVI/nx-portfolio/pull/761)

# 0160: a form says what is wrong before the request

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Four findings of `docs/reports/2026-10-16-velista-e2e-slot1.md`
> about a field that is wrong on screen and refused by the server: F2.1 (major, a name with
> an emoji is echoed as valid, "Continue as Bruno 🍋 Peña", and refused by PATCH 400 with the
> rule shown only after the request and no `aria-invalid`), F1.5 (the register email shows
> the browser's native tooltip in the browser's language instead of the app's sentence),
> S3 (the short password rule shows only after a 400) and F7.4 (a join code pasted with a
> space in front loses its last character).
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0009` (credential flows) section 5.5 (why the password
> rules are not conditions on the button), `libs/luna-shopper/platform/src/lib/validation/username.ts`
> (the server rule, lines 14 to 103), `libs/velista/models/src/lib/limits.ts:30-31`,
> `libs/velista/feature-setup/src/lib/name-step/name-step.ts:96-99`, `:185-186`,
> `name-step.html:1`, `:16`, `:20-30`, `:62-66`,
> `libs/velista/feature-auth/src/lib/register-page/register-page.html:7`, `:29`,
> `register-page.ts:113-127`, `:142-150`, `libs/velista/ui/src/lib/auth/email-field.ts:11`,
> `password-field.ts:12`, `auth-error-copy.ts:126-132`,
> `libs/velista/ui/src/lib/entry/join-code-field.html:21` and `join-code.ts`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

A name, an email, a password or a join code that the server will refuse is marked on
screen before the request, in the app's words and language, and the screen never echoes a
refused value as accepted.

### Context

- **The server's name rule is five checks.** `username.ts` refuses control and bidi
  characters (`:48-50`, `:78-82`), a length outside 2 to 40 code points after NFC (`:14`,
  `:22`, `:84-90`), anything outside `ALLOWED_CHARACTERS = /^[\p{L}\p{M}\p{N} ._'-]+$/u`
  (`:37`, `:91-95`, where the emoji fails), a name with no letter (`:40`, `:96-98`) and the
  reserved prefix `former member` (`:30`, `:99-103`). The client has only `canContinue`
  (`name-step.ts:96-99`), a trimmed UTF-16 `.length` of at least 2, and the counter at
  `name-step.html:16` counts the same way. The input (`:20-30`) has no `aria-invalid` and no
  `aria-describedby`; the error renders only from `failure()` after the request (`:62-66`),
  mapped from `validation_failed` to `account.error.badName` (`name-step.ts:185-186`).
  `limits.ts:30-31` copies only the two lengths. The platform lib is backend code, and rule
  D4 means velista owns its own copy of the rule.
- **The register form is not `novalidate`.** `register-page.html:7` is a plain `<form>` and
  `lib-email-field` renders `type="email"` (`email-field.ts:11`), so the browser blocks the
  submit with its own tooltip. The same form tag is at `forgot-password-page.html:36`,
  `reset-password-page.html:18`, `sign-in-page.html:9` and `upgrade-page.html:11`. The name
  step already sets `novalidate` (`name-step.html:1`). The app's sentence exists
  (`auth.error.badEmail`, used by `auth-error-copy.ts:126-132` for a server 400).
- **The short password rule after a 400 is a recorded choice.** `register-page.ts:113-127`
  cites plan `0009` section 5.5: neither the length rule nor the match is a condition on
  the button, and the rule text is on screen (`register-page.html:29`). The mismatch is
  already checked locally before the request (`:142-150`). `PASSWORD_MIN_LENGTH` is 8
  (`password-field.ts:12`).
- **The join code field cuts the paste before it normalizes it.** `join-code-field.html:21`
  has `maxlength="8"`, so " 6WQKCPKS" is cut to " 6WQKCPK" before `normalizeJoinCode`
  (`join-code.ts`) drops the space. The link page and the Paste button normalize first.

### Target state

1. `libs/velista/models/src/lib/limits.ts` gains a pure `usernameProblem(raw)` that answers
   `'length' | 'characters' | 'letter' | 'reserved' | null`, mirroring `username.ts` and
   counting code points after NFC. Its spec mirrors the server's cases, including the
   emoji, so the two rules cannot drift without a red spec.
2. The name step draws the matching rule under the field as the person types, sets
   `aria-invalid` and `aria-describedby` on the input, and disables Continue while a
   problem exists. The button and the note never echo a refused name as accepted. The
   counter counts code points. The account rename sheet uses the same function.
3. The five auth forms carry `novalidate`. The register page checks the email shape
   locally and sets `{ key: 'auth.error.badEmail', placement: 'email' }` before any
   request, the same sentence as for a server 400.
4. The register page checks the password length locally in `submit()`, sets
   `auth.error.shortPassword` with placement `password` and sends nothing. The button stays
   enabled, which keeps the letter of plan `0009` section 5.5 (the rule is not a condition
   on the button) while the request is spared. Record this as a decision for the owner in
   "What the build decided", because it touches a recorded choice.
5. The join code field drops `maxlength` and normalizes on input and on paste before it
   cuts to eight characters, so " 6WQKCPKS" and "6WQK CPKS" both land as "6WQKCPKS".

### Scope

- `libs/velista/models/src/lib/limits.ts` and a spec beside it.
- `libs/velista/feature-setup/src/lib/name-step/name-step.ts`, `.html`, `name-step.spec.ts`;
  the account name sheet in `libs/velista/feature-account` that takes a username.
- `libs/velista/feature-auth/src/lib/register-page/register-page.ts`, `.html`,
  `register-page.spec.ts`, and the `<form>` tag of the four other pages.
- `libs/velista/ui/src/lib/entry/join-code-field.html`, `.ts` and its spec; `join-code.ts`
  if the normalizer must accept a longer raw string.
- `libs/velista/ui/assets/i18n/en.json` and `es.json` for the per rule name sentences.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- The server rule stays the authority. The client check spares a request and marks the
  field; a server 400 still draws its sentence.
- Copy for people not at home with apps: one short sentence per rule, the reason first
  ("Only letters, numbers, spaces and . _ ' -").
- `velista/ui` may not inject `Router`, and `label-has-associated-control` cannot see
  through `@if`; keep the field markup flat.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change the server rule, the
  `ALLOWED_CHARACTERS` set on the client to accept emoji, or the register button's
  enabled state.
- If the owner wants emoji in names, that is a backend decision; build the mirror of the
  current rule and note it.

### Progress evidence

- New specs, each failing before the change:
  - `usernameProblem('Bruno 🍋 Peña')` answers `'characters'`, `'a'` answers `'length'`,
    `'123'` answers `'letter'`, `'former member x'` answers `'reserved'`, `'Ana Núñez'`
    answers null;
  - the name step with an emoji draws the rule, marks the input invalid and disables
    Continue, with no request sent;
  - the register page with `ana-sin-arroba` draws `auth.error.badEmail` and sends nothing;
  - the register page with a 7 character password draws `auth.error.shortPassword` and
    sends nothing;
  - the join code field with " 6WQKCPKS" pasted holds "6WQKCPKS" and enables Ask to join.
- `npx nx run-many -t lint test -p velista/models velista/feature-setup velista/feature-auth velista/ui velista/feature-account`
  passes.
- `npx nx build velista` passes.

## 1. Not in this plan

- The password mismatch painting the correct first field red (S2). One class on one
  field, worth doing in the same PR if it is a one line change, otherwise a follow up.
- Allowing emoji in names. A backend decision.

## 2. Choices that are mine

- **A mirror with a spec, not a shared library.** The platform validation lib is backend
  code, and rule D4 keeps velista's models its own. The spec is what keeps the mirror
  honest.
- **The password rule spares the request and keeps the button enabled.** It keeps the
  letter of plan `0009` section 5.5 and still answers before a round trip.

## What the build decided

The build of 2026-10-18 (PR #761) follows the plan, items 1 to 5. It made the choices
below, and each one is a choice of the builder that the owner can overturn.

- **For the owner: the register page checks the password length locally and the button
  stays enabled.** `submit()` counts code points against `PASSWORD_MIN_LENGTH`, draws
  `auth.error.shortPassword` with placement `password`, focuses the password box and
  sends nothing. The button is still pressable, which keeps the letter of plan `0009`
  section 5.5. This changes a recorded choice (a short password used to reach the
  server), so it is the owner's to confirm or reverse.
- **For the owner: emoji in names stay refused.** The client mirrors the current server
  rule. Allowing them is a backend change to `ALLOWED_CHARACTERS`.
- **The checks run in the server's order**, and the forbidden characters are tested on
  the raw value before the spaces collapse, as on the server. So a tab inside a name is
  `'characters'`, not a space, and a lone emoji is `'length'` (one code point) before it
  is `'characters'`.
- **The name step says only "Continue" while a name breaks a rule** (a new key,
  `setup.name.continuePlain`) and hides the note that repeats the name. The button is
  disabled, so it never promises a name it would not keep.
- **The rule sits in a polite live region** that stays in the page, so a screen reader
  hears it while the person is still typing. The field is marked with `aria-invalid`
  only; the setup field mixin draws no red border, and none was added.
- **The rename sheet draws three rules, not four.** The length rule is already on screen
  beside its counter, and its section 3.3 says a name is too short for most of the time
  it takes to write one, so a short name only disables the primary, as before.
- **The register address check is looser than `@IsEmail()`** (something, an @,
  something, a dot, something, no spaces). It answers the obvious miss and never refuses
  an address the server accepts in practice.
- **Anything that grows a full join code field is ignored, except a paste**, which is
  what `maxlength` did for typing. The rule names the whole value input types
  (`insertFromPaste`, `insertFromDrop`, `insertFromYank`) and not the typing ones,
  because Gboard types with `insertCompositionText` and autocorrect with
  `insertReplacementText`: a rule that waited for `insertText` let both reach the cut,
  which drops the first character (review of PR #761). A paste is cleaned and cut from
  the front, so a share link still yields its code.
- **S2 is in the PR.** A mismatch no longer marks the first password box invalid, only
  the confirmation. It was one attribute.
- **Neither name field has a `maxlength`** (review of PR #761). The attribute counts
  UTF-16 units and the counter code points, so 20 letters outside the basic plane read
  `20 / 40` and the field took no more. `usernameProblem` answers `'length'` instead.
- **Both name counters count the name that is sent**, `usernameLength(normalizedUsername(typed))`
  (spaces collapsed, trimmed, NFC), so "Ana  " reads 3 in the setup step as in the
  rename sheet (review of PR #761).
- **The two name steps keep their own sentence maps.** The rename sheet's has no
  `length` entry and the setup step's has one, so one shared map would need a second
  shape anyway. The rename sheet's map now sits above the component's doc block, which
  had attached itself to the map (review of PR #761).
- The sentences sit after the last key of `account.error` (shared by the name step and
  the rename sheet), in the same positions in `en.json` and `es.json`.
