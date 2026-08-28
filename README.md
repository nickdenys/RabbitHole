<img src="https://raw.githubusercontent.com/nickdenys/RabbitHole/main/public/icons/icon128.png" alt="RabbitHole" width="96">

# RabbitHole

**Turn a CodeRabbit review into a checklist you work down to zero.**

CodeRabbit leaves 30 comments in your pull request timeline. Some are blockers, most are nitpicks, and you find out which by scrolling. You fix something, scroll back, lose your place. The review is a list of tasks presented as a wall of prose.

Everyone's coping strategy is the same: hide the bot. At least four tools do that, including CodeRabbit's own Houdini. They set `display: none` and you are done, along with the findings.

RabbitHole takes those comments out of the timeline and puts them in a side drawer instead. **The checklist is the point. The hiding is just how the findings get somewhere you can work them.**

**Status: v0.3 works on Chrome.** It builds, loads unpacked, and takes a real review to zero. The Firefox build is new: it builds and passes `web-ext lint` clean, but it has not yet been taken through a live review the way the Chrome one has.

## What you get

* **One list instead of 30 comments**, grouped by severity, sortable four ways in either direction, Open and Resolved on tabs.
* **A count of what is left.** Closed, the drawer is a tab on the page's edge carrying the number still to do and a severity meter, so three blockers never look like ten nitpicks.
* **Resolution that is real.** Rows resolve and reopen through GitHub's own button, and done state comes from GitHub rather than from local bookkeeping.
* **Context without losing the list.** Press a row's title to put that one finding back in the timeline and scroll to it. Press it again to take it out.
* **The rest of what a row needs:** copy CodeRabbit's agent prompt, open the finding on Files changed, read its category and effort off one pill.
* **Silence where there is nothing to say.** On a pull request CodeRabbit never reviewed there is no tab, no drawer, nothing.
* **An off switch that means off.** A checkbox on the toolbar icon stops the extension in every open tab, immediately.

It survives the way GitHub moves. Tabs within one pull request keep your progress, a different pull request is a reset rather than a merge, and leaving pull requests puts every comment back.

## The invariants

**The dangerous failure is not a broken panel. It is a page that quietly hides findings you never see.** Four rules prevent that, and they are tested.

1. Never hide a thread that could not be parsed.
2. Never hide a thread that cannot be positively proven to be CodeRabbit's.
3. Always distinguish "zero findings" from "could not read this page".
4. The panel is only ever absent from a page it has not touched.

Rule 3 exists because GitHub is rewriting the Conversation page in React. On a build the extension does not recognise it hides nothing and says so, rather than showing a reassuring empty list.

Rule 4 makes the edge tab safe to leave off. Every route to a hide proves the comment is CodeRabbit's first, so a page holding no such proof still has its whole timeline. The test is positive proof, never an empty list, which also keeps the tab monotonic: it can appear when CodeRabbit posts a review while you are reading, and it never disappears. An unreadable build keeps its handle, because rule 3 outranks rule 4.

## How it works

A Manifest V3 extension for Chrome and Firefox, panel in Preact, everything read off the rendered page. No API token, no backend, no OAuth, and two permissions: `storage`, plus `contextMenus` for the toolbar toggle.

* **Your worklist costs zero network requests.** Unresolved threads are already in the page.
* **Resolved threads are fetched as the page settles**, six at a time, through GitHub's own deferred endpoint on your session cookie, since GitHub renders them collapsed and authorless. Private repos need no token. Responses go through `DOMParser` and are never injected, so there is nothing to sanitize. A thread whose fetch fails is listed as unreadable and stays in the timeline.
* **Severity, category and effort** come from CodeRabbit's emoji triple, read by position off the first three `em` elements. That is a correctness fix rather than a style preference: a text search over the body also matches prose inside the finding.
* **Resolve and unresolve click GitHub's own buttons.** A row stays under Open until a pass confirms the change on the page. GitHub renders that button for write access, so a row on a repository you cannot write to says so.
* **The panel mounts only where there is something of CodeRabbit's.** Everywhere else costs one scan per page: no shadow host, no stylesheet, no handle.

### Hide policy

**Safe mode is the default: a thread is hidden only if every comment in it is CodeRabbit's.** One human reply, or one unsubmitted comment of your own, keeps it in the timeline and badges it in the panel. **Aggressive mode** hides every CodeRabbit rooted thread, as an explicit choice in settings, for teams that never discuss findings inline. Invariants 1 and 2 hold in both.

**A hide reverses one finding at a time, and only by you.** No pass may reverse either direction, so a page changing under you never swallows a thread you asked to see. The panel can put a thread back on the page but never take one off it.

**Five preferences live in `chrome.storage.local`**, per browser and never synced: hide mode, sort axis, sort direction, theme, drawer open. They are read before the first hide pass, so a page is hidden once, in the mode you chose. Nothing about a pull request is stored, and a failed read means safe mode.

### The count check

CodeRabbit posts "Actionable comments posted: N". RabbitHole hides that summary but reads it first and compares the total against the threads it found, because GitHub renders long conversations in pieces: a big pull request opens with a handful of threads and a reassuringly small number on the handle.

By default the panel closes the gap itself, clicking GitHub's own "Load more" until nothing is missing or nothing is left to click. A preference turns that off. The check only ever warns. It never blocks and never hides less. A total still high on a fully loaded page is CodeRabbit counting a finding it never posted, so that notice sits behind the drawer header's warning triangle.

### Off switch

**Right click the toolbar icon for a checkbox that turns the extension off entirely.** Unchecking it stops the engine in every open tab immediately, reveals every hidden thread and takes the panel off the page, and the icon carries an `OFF` badge. It lives on its own storage key, written by the background script, and defaults to on, so a failed read never leaves a silently disabled extension.

## Development

```
npm install
npm run build          # both browsers, into dist/chrome and dist/firefox
npm run dev            # vite build --watch, Chrome (dev:firefox for the other)
npm run start:firefox  # web-ext, a scratch profile with the add-on installed
npm test               # vitest, happy-dom
```

**Chrome:** load `dist/chrome` as an unpacked extension at `chrome://extensions` with Developer mode enabled. Rebuilds need a manual extension reload.

**Firefox:** `npm run start:firefox` opens a scratch profile and reloads on rebuild. To use your own profile instead, load `dist/firefox/manifest.json` at `about:debugging`, which lasts until the browser closes.

Both directories are written from one `src/manifest.ts`, and the JavaScript in them is byte for byte the same. Firefox needs a different manifest for exactly one reason (it runs the background script as an event page, since it does not implement `background.service_worker`), plus the add-on id and minimum version AMO requires. `npm run package` produces a zip per store.

**Fixtures follow a strict rule:** committed fixtures come from public PRs only, and captures from private repositories stay local and gitignored. See `test/fixtures/README.md`.

## License

MIT, see `LICENSE.md`.
