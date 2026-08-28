<img src="https://raw.githubusercontent.com/nickdenys/RabbitHole/main/public/icons/icon128.png" alt="RabbitHole" width="96">

# RabbitHole

**Turn a CodeRabbit review into a checklist you work down to zero.**

CodeRabbit reviews your pull request and leaves 30 comments in the timeline. Some are blockers, most are nitpicks, and you find out which is which by scrolling. There is no way to see them all at once, no way to sort by severity, and no way to know how many are left. You scroll, you fix something, you scroll back, you lose your place. The review is a list of tasks presented as a wall of prose.

Everyone's coping strategy is the same: hide the bot. At least four tools do exactly that, including CodeRabbit's own extension, Houdini. They set `display: none` and you are done, along with the findings.

RabbitHole takes those comments out of the timeline and puts them in a side drawer instead. Every finding in one place, sorted the way you want, resolved through GitHub's own button, with a running count of what is left.

**The checklist is the point. The hiding is just how the findings get somewhere you can work them.**

**Status: v0.3 works.** It builds, loads unpacked, and takes a real review from 30 comments to zero.

## What you get

* **One list instead of 30 comments.** Findings group by severity, sort four ways in either direction, and split across Open and Resolved tabs.
* **A count of what is left.** The footer tracks how far down the review you are. Closed, the drawer is a tab on the edge of the page carrying the number still to do and a meter breaking it down by severity, so three blockers never look like ten nitpicks from across the screen.
* **Resolution that is real.** Every row resolves or reopens through GitHub's own button, and done state comes from GitHub rather than from local bookkeeping.
* **Context without losing the list.** Press a row's title to put that one finding back in the timeline and scroll to it. Press it again to take it out. You read a comment where it was written without giving up the hiding for the rest of the review.
* **The rest of what a row needs.** Copy CodeRabbit's agent prompt, open the finding on Files changed, and read its category and effort off a single pill.
* **Silence where there is nothing to say.** On a pull request CodeRabbit never reviewed there is no tab, no drawer, and nothing of the extension's on the page.
* **An off switch that means off.** A checkbox on the toolbar icon stops the extension in every open tab, immediately, and the icon carries an `OFF` badge while it is unchecked.

It survives the way GitHub actually moves. Clicking between the tabs of one pull request keeps your progress, arriving at a different pull request is a reset rather than a merge, and leaving pull requests puts every comment back and takes the panel away.

## The invariants

**The dangerous failure is not a broken panel. It is a page that quietly hides findings you never see.** Four rules prevent that, and they are tested.

1. Never hide a thread that could not be parsed.
2. Never hide a thread that cannot be positively proven to be CodeRabbit's.
3. Always distinguish "zero findings" from "could not read this page".
4. The panel is only ever absent from a page it has not touched.

Rule 3 exists because GitHub is rewriting the Conversation page in React. On a build the extension does not recognise it hides nothing, and the drawer handle says so instead of showing a reassuring empty list.

Rule 4 is what makes the edge tab safe to leave off. An untouched page cannot be hiding anything, because every route to a hide has to prove the comment is CodeRabbit's first. A page holding no such proof still has its whole timeline. An unreadable build is not that case and keeps its handle, because rule 3 outranks rule 4.

The test for "is CodeRabbit here at all" is positive proof, never an empty list: one of CodeRabbit's own comments, or one thread the policy can attribute to it. A resolved thread does not count, whoever wrote it, because GitHub collapses those and nobody can say whose they are until the deferred fetch answers. Counting them would draw the tab and take it away again a round trip later. So within one pull request the tab can appear, when CodeRabbit posts a review while you are reading, and it never disappears.

## How it works

A Manifest V3 extension, panel in Preact, everything read off the rendered page. No API token, no backend, no OAuth, and two permissions: `storage`, plus `contextMenus` for the toolbar toggle.

* **Your worklist costs zero network requests.** Unresolved threads are already in the page.
* **Resolved threads are fetched as soon as the page settles**, six at a time, through GitHub's own deferred thread endpoint using your session cookie. They arrive collapsed and authorless, so there is no other way to read them. Private repos work without a token. Responses are parsed with `DOMParser` and never injected, and the panel renders text, so no sanitizer is needed. A thread whose fetch fails is listed as unreadable and stays in the timeline, because a finding nobody could read is exactly what must never disappear quietly.
* **Severity, category and effort** come from CodeRabbit's emoji prefixed triple, read by position off the first three `em` elements of the comment body. Reading by position and requiring the emoji is a correctness fix rather than a style preference: a text search over the body also matches prose inside the finding itself.
* **Resolve and unresolve click GitHub's own buttons.** A click only means the click happened: the row stays under Open, with an empty tick box, until a pass confirms the change on the page. GitHub renders that button for write access rather than for a session, so a row on a repository you cannot write to says that instead.
* **The panel mounts only where there is something of CodeRabbit's.** A repository without it pays one scan per page and nothing more: no shadow host, no stylesheet, no handle.

### Hide policy

**Safe mode is the default: a thread is hidden only if every comment in it is CodeRabbit's.** One human reply, or one unsubmitted comment of your own, keeps the thread in the timeline and badges it in the panel.

**Aggressive mode hides every CodeRabbit rooted thread.** It is an explicit choice on the settings sheet, behind the gear in the footer, for teams that never discuss findings inline. Both invariants hold in both modes. Neither one hides a thread it could not read or could not prove is CodeRabbit's.

**A hide reverses one finding at a time, and only by you.** No pass may reverse either direction, so a page that keeps changing under you never swallows a thread you asked to see. A finding the policy left in the timeline has only one state to be in, so its title only scrolls. The panel can put a thread back on the page but never take one off it.

**Five preferences live in `chrome.storage.local`**, per browser and never synced: hide mode, sort axis, sort direction, theme, and whether the drawer is open. They are read before the first hide pass, so a page is hidden once, in the mode you chose. Nothing about a pull request is stored, and a storage read that fails means safe mode.

### The count check

CodeRabbit posts an "Actionable comments posted: N" summary. RabbitHole hides it, but reads it first and compares that total against the threads it found. GitHub renders a long conversation in pieces, so a big pull request opens with a handful of threads in the page and a reassuringly small number on the handle.

By default the panel closes the gap itself, clicking GitHub's own "Load more" for every batch still on the page until nothing is missing or nothing is left to click. A preference turns that off for anyone who would rather load the rest by hand. The check only ever warns. It never blocks and never hides less. When the page has nothing left to load and the total is still higher, that is CodeRabbit counting a finding it never posted, so the notice sits behind the warning triangle in the drawer header and leaves the edge tab unmarked.

### Off switch

**Right click the toolbar icon for a checkbox that turns the extension off entirely.** This is not a preference on any one pull request. Unchecking it stops the engine outright, in every open tab, immediately, reveals every thread the page had hidden, and takes the panel off the page. Checking it again starts fresh from whatever is currently stored for the other five preferences.

It lives on its own key, written by the background service worker rather than by the panel, and defaults to on, both on a fresh install and whenever the read fails, so nobody meets a silently disabled extension they never chose.

## Roadmap

**v0.1 is the unresolved worklist**, which needs no network requests at all. Done: the fixture capture script and committed fixtures from public PRs, the thread scanner (walk `review-thread-collapsible`, attribute authors, parse the triple, detect Outdated and Pending), the hide engine and its safe rule with a MutationObserver so late loading items do not slip past, the drawer with severity, category, effort and activity badges, sort by severity and file, resolve, copy "Prompt for AI Agents", and Turbo navigation handling.

**v0.2 is the network half**, everything that needs the deferred thread endpoint or a stored preference. Done: resolved threads listed as findings rather than as a count, unresolve through GitHub's own button, the count check, sort by category and effort with grouped headers where a flat list would read as noise, and the aggressive hide toggle with the preferences holding it.

**v0.3 is the off switch.** Done: a background service worker, the checkbox on the toolbar icon's right click menu on its own `chrome.storage.local` key so the worker never merges onto the panel's record, live stop and restart in every open tab without a reload, and the `OFF` badge mirroring the checkbox.

Along the way:

* **The drawer was rebuilt as a designed panel**, in Primer light and dark: collapsible severity groups, Open and Resolved tabs, a sort popover with a per axis direction toggle, an overflow menu per row, a progress footer, settings as a sheet, and the edge tab. Nothing the earlier drawer could do was given up.
* **Category and effort became one pill**, an outline holding a coloured dot, the category in fewer words, a hair rule and the effort. They are two thirds of CodeRabbit's own first line and they arrive together, so a line each spent most of a row's height on six words. Seven categories have a hue and a short form. Anything else prints in full in grey, with the dropped words on the tooltip.
* **The panel learned to follow the system's light or dark setting**, and to be pinned to either one for a reader whose editor and system disagree. Every colour token is a light value and a dark one in the same declaration, so the choice is one CSS property rather than a second copy of the palette.
* **The panel learned to stay away.** A readable pull request with nothing of CodeRabbit's on it gets no host appended at all. That is invariant 4, asserted over every fixture in both hide modes.
* **The deferred fetch moved off the drawer and onto the page.** Every pass asks for the collapsed threads it has no answer for yet, so the drawer opens on rows that are already filled in. The trade is deliberate: the extension now asks GitHub about every pull request you open, not only the ones you triage. The first state is still published before the first request starts, so the count and the meter are never behind the network.

## Development

```
npm install
npm run dev      # vite build --watch
npm test         # vitest, happy-dom
```

Load the `dist/` folder as an unpacked extension at `chrome://extensions` with Developer mode enabled. Rebuilds need a manual extension reload. Chromium browsers only.

**Fixtures follow a strict rule:** committed fixtures come from public PRs only, and captures from private repositories stay local and gitignored. See `test/fixtures/README.md`.

## License

MIT, see `LICENSE.md`.
