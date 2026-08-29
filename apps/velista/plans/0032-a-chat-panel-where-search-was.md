# 0032: a chat panel where search was

> The app bar's search button has never done anything. `HomePage.search()` calls
> `_notYetRouted('search')` and always has, and there is no search page, no search service
> and no search route behind it. So this plan does not remove a feature. It spends a
> placeholder: the button becomes the way into the assistant, and search comes back later
> with a plan of its own, when there is something to search.
>
> Prerequisite reading: backend plan `0039`, which is the service this talks to and whose
> rules A2 and A3 decide who holds the transcript and where links come from.

## 1. The button

`AppBar` keeps its shape and its two slots. The search icon becomes a chat icon, and the
`openSearch` output becomes `openAssistant`.

Two things follow from house rules rather than from taste:

- **The icon is a component in `libs/shared/ui`**, beside `home-icon`, `save-icon` and the
  rest, built the same way: an `*-icon.svg` inlined through `import('./*.svg?raw')` and
  `DomSanitizer`, exported from that lib's `index.ts`. Not raw `<svg>` in a velista
  component. Check whether one there already fits before adding another.
- `SearchIcon` stays where it is and stays exported. Nothing else imports it today, and
  deleting it saves nothing while search is coming back.

`HomePage.search()` goes with its `_notYetRouted('search')` line, and the doc comment above
it that lists what the dashboard cannot yet do loses search and keeps starting a list.

## 2. A destination, not a sheet

The panel is a **route at `{mount}/{locale}/assistant`**, reached from the app bar wherever
the caller happens to be.

The app bar lives in `AppLayout`, so its button is on every page, and that is what decides
this. Rule E1 (plan `0008`) makes a sheet a child route of the page it covers, so a sheet
reachable from everywhere would be a child of everywhere: eight identical entries that must
not drift, for a panel that covers a page it has nothing to do with.

So it follows `account` (plan `0015`) instead, for the reasons that plan gave: it is deep
linkable, it has its own scroll, and it is somewhere somebody goes deliberately rather than
something drawn over what they were reading. `authenticatedGuard` and nothing more.

Declared before the `''` front door like every other non empty path, which `routes.spec.ts`
already asserts for the table as a whole.

Rejected: a floating panel toggled by a signal. Nothing would be pushed onto the history
stack, so Android's back button would close the app rather than the panel. That is the
defect rule E1 exists to prevent, and plan `0031` spent a whole plan repairing the last
version of it.

## 3. What is on the screen

A transcript, a composer, a send button, and nothing else in this plan.

- The caller's messages and the bot's, in order, visually distinct, and selectable.
- A pending state while a turn is in flight, with the composer disabled for its duration.
- **Errors are messages in the transcript, not banners.** A transport failure gets a local
  string that reads like everything else in the column. One kind of thing, in one place,
  whatever went wrong.
- An empty state that says what the bot can do, in three lines, because a text box with a
  cursor in it tells nobody what to type. The three lines are the three tools.

### 3.1 The rate limit is a countdown, not an apology

The free tier's limits are shared across every user of the app (backend `0039` section 9),
so being told to wait is an ordinary event here rather than an edge case, and it has to
read like one.

The service answers a rate limited turn with `retryAfterSeconds` (backend `0039` rule A5).
The panel **counts it down**: a message in the transcript saying how many seconds are left,
ticking, with the composer disabled until it reaches zero and then re-enabled by itself.

"Try again later" is the wrong string and is specifically wrong for the people this feature
is for. Somebody who cannot easily type is left guessing, and guessing means pressing send
again, which spends the next slot and makes the wait longer. A number that visibly shrinks
asks nothing of them and is honest about the cause.

The countdown is a display of a value the server sent. The panel never invents one, and if
the field is somehow absent it says the bot is busy without a number rather than guessing.

## 4. The client holds the transcript

Backend `0039` rule A2 makes the service stateless, so the conversation lives here and is
sent whole on every turn.

- It lives in a signal in a store provided by the route, so leaving the panel and coming
  back within a session keeps the conversation, and a reload does not. That is the
  backend's choice and this plan does not work around it.
- It is capped here as well as on the server, at the same numbers, read from one place. The
  server caps because the client is untrusted; the client caps so that a person sees the cap
  happen instead of having a turn silently truncated somewhere they cannot see.
- When the cap bites, the oldest turns drop and the panel says so on a line of its own.

## 5. It is an ordinary gateway call

The panel talks to `/v1/assistant` on the **gateway base URL the app already has** (backend
`0039` section 3). There is no second origin and no new environment value.

That is worth a sentence because of what it means in practice: `gatewayInterceptor` already
attaches the token and the `Accept-Language` header, the existing data-access helpers
already resolve the base URL per environment, and a signed out caller is already handled.
The data-access piece for this feature is one method, not a client.

## 6. The links, and where they come from

Every reply carries a `references` array (backend `0039` section 8): the zones, lists and
lines the turn genuinely read or wrote. The panel renders those as links under the message.

**The reply text is never parsed for ids, and never rendered as markdown.** An id in a
`references` entry came back from the gateway during that turn, so the target exists and
the caller can see it. An id inside a sentence has neither property, and a link to a list
that was never there is worse than no link at all.

Each reference becomes a `routerLink` built with `appPath(locale, basePath, ...)` from
`@portfolio/velista/platform`, never an assembled string. That helper is what makes one
link correct at `/velista/en/...` when mounted in the portfolio shell and at `/en/...` on
velista's own origin. A hardcoded path is wrong in exactly one of the two run modes, and it
is the mode nobody looks at.

| kind | goes to |
|---|---|
| `zone` | `zones/:zoneId` |
| `list` | `zones/:zoneId/lists/:listId` |
| `line` | `zones/:zoneId/lists/:listId`, with `?line=:lineId` |

## 7. A line has no route, so it gets a query parameter

The list page has four sheets over it and three of them address a line: `lines/:lineId/edit`,
`lines/:lineId/comments`, `lines/:lineId/confirm/delete`. All three **do something** to the
line. None of them simply shows it.

So a line link cannot reuse them. A link in a chat message that opens an edit form is a link
that changed what the app is doing because somebody wanted to look at something, and for the
users this feature exists for, an unasked-for form over the screen is the failure mode, not
a convenience.

`ListPage` therefore takes an optional `?line=<uuid>`: on arrival it scrolls that line into
view and marks it briefly, and opens nothing. An id that is unknown, or on a line the caller
cannot see, is ignored and the page renders normally, because a stale link should be inert
rather than an error.

This is the only change this plan makes outside the panel.

## 8. Language

The panel is localized like everything else here, with its own namespace of keys.

The bot's replies are not. They arrive in whatever language the service answered in, which
is the caller's, because the request carries `Accept-Language` like every other gateway call
in this app and the existing `gatewayInterceptor` already sets it. Nothing here translates a
reply and nothing should try.

## 9. This is the ground for the voice work

Worth saying once, because it decides some small things now.

This exists because a portion of this app's intended users are of advanced age or have
impaired motor control, and typing or tapping through several screens to put one item on a
list is precisely what fails them. Backlog `0005` section 6 holds the voice design, and it
is deliberately layered over a text in, text out service so that adding it later changes no
server code.

What that costs this plan, and it is little: the composer is an ordinary text input with an
ordinary submit, with no custom key handling and nothing that assumes a hardware keyboard,
so a dictation button on the platform keyboard works into it on day one for free. Touch
targets keep the app's existing sizes and are not shrunk to fit more transcript on screen.

## 10. Testing

- The route exists, carries `authenticatedGuard`, and sits before the front door.
  `routes.spec.ts` is where that ordering assertion already lives.
- `AppBar` emits `openAssistant`, and no longer emits `openSearch`.
- A reply with references renders one link per reference, with the right href in **both**
  run modes, which means the spec supplies both base paths rather than one.
- A reply whose text happens to contain something link shaped renders it as text.
- The cap drops the oldest turns and says so.
- A failed turn appears in the transcript and re-enables the composer.
- A rate limited turn renders a countdown from the server's `retryAfterSeconds`, keeps the
  composer disabled while it runs, and re-enables it at zero without a reload.
- A rate limited turn with no `retryAfterSeconds` says the bot is busy and invents no number.
- `ListPage` scrolls to and marks `?line=`, ignores an unknown one, and opens no sheet.

## 11. Open decisions

- Whether the panel survives a full reload. It cannot without either client storage or the
  backend's, and both are the next plan's call.
- Whether the entry point should also sit on the list page, which is where somebody actually
  stands when they want to add something. Leaning yes, later, once the transcripts say what
  people use it for.
- Whether a line the bot created is marked as such. Depends on the open decision of the same
  name in backend `0039` section 14.

## 12. Exit criteria

- The app bar's second button opens the assistant, and search is gone from the bar and from
  `HomePage`.
- The panel is a route, is deep linkable, and the back button leaves it without closing the
  app.
- A conversation can add a line, edit one, answer a question about a list, and change the
  caller's name, each end to end against the real service.
- Every link under a reply comes from `references`, resolves in both run modes, and none of
  them 404s.
- A line link scrolls to the line and opens nothing.
- A busy provider and a dead network both read as a message in the transcript, and the busy
  one carries a countdown that re-enables the composer by itself.
- The panel added no new origin and no new environment value.
- The composer accepts platform keyboard dictation with no special handling.
