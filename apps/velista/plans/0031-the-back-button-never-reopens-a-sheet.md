# 0031: the back button never reopens a sheet

> Back belongs on the previous **page**. From a group to the dashboard, from the
> dashboard to wherever somebody came from. It must never put a panel asking for a name
> or an option back on the screen, and until now it did, from every sheet in the app.

## 1. What happened

Two presses reproduce it, and the second form needs no group at all.

- Dashboard, open a group, open the group's options, cancel, press back. The options
  sheet comes back up.
- Dashboard, press **New group**, cancel, press back. The create sheet comes back up,
  with the field as it was left.

## 2. Why

Rule E1 (plan `0008`) makes every sheet a **child route** of the page it covers, and
that decision is right: it is what gives the back button something to pop, and it is why
back over an open sheet has always closed the sheet rather than the app.

The dismissal is what was wrong. Every one of the eleven sheets closed by navigating to
the page underneath:

```ts
async dismiss(): Promise<void> {
  await this._router.navigateByUrl(appPath(this._locale(), this._basePath, 'home'));
}
```

`navigateByUrl` **pushes**. So cancelling a sheet did not remove its entry from the
history stack, it added a third entry on top of it:

```
dashboard → dashboard/zones/new → dashboard      (three entries, not one)
```

and the next back press landed on the middle one, which is the sheet's own URL. The
router did exactly what it was asked to. Nothing about the panel was reopened by a
signal or restored by a component: the person really was navigated to the sheet.

The same push closed the sheets that end somewhere other than the page beneath, and
there it costs more than a stray panel. Creating a group navigated to the dashboard,
which left `zones/new` one press behind with the name still in the field and the group
already made, so back and a second **Create** made a second group.

## 3. The rule

**A sheet never pushes.** It pops the entry it was opened with, and when there is no such
entry it replaces its own. Either way the sheet's URL stops existing, so the press after
the dismissal goes on to whatever the person was looking at before the page beneath.

It lives in one place, `SheetNavigation` in `@portfolio/velista/platform`, because all
eleven sheets were closing the same way and a rule written out eleven times is a rule
that holds in ten of them a year from now.

```ts
dismiss(fallbackUrl); // cancel, Escape, the scrim, a save that returns to the page
leaveTo(url); // done here, but the destination is somewhere else
```

`dismiss` is a `Location.back()` and `leaveTo` is a `navigateByUrl` with
`replaceUrl: true`. `dismiss` falls back to `leaveTo` when there is nothing to pop.

### 3.1 How it knows there is something to pop

The router stamps every history entry it writes with the id of the navigation that
wrote it, counting from one. An id above one means this document navigated at least once
before arriving here, so `back` returns to a page of this app's own.

An id of exactly one is the sheet's URL opened cold: a link straight to it, or a reload
with the panel on screen. There is nothing of ours behind it and popping would leave the
app, so the dismissal **replaces** instead, which keeps the sheet out of the stack in
that case too. Anything unreadable, a null state or an entry this app did not write, is
read the same way. Being wrong in that direction costs a replaced entry; being wrong in
the other would throw somebody out of the app.

### 3.2 What `leaveTo` is for

Four dismissals do not return to the page underneath, and each one is a form whose work
is finished: the group exists, the list is deleted, the account is gone. A push would
leave that spent form one press away, so all four replace.

## 4. What is tested

`create-group-sheet-back-button.spec.ts` is the report, driven over the real router and
a real history stack rather than a `Router` double: the defect is not *where* a
dismissal navigates but *how*, and a double records the URL and not the entry. It opens
the dashboard, presses New group, cancels, presses back, and expects the page before the
dashboard. It fails on the old code, on exactly the two assertions the report describes.

`sheet-navigation.spec.ts` states the decision itself, so a future edit that quietly
turns the pop back into a push fails there as well.
