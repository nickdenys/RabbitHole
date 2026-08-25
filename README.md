# CodeRabbit Triage

Turns a CodeRabbit review on a GitHub pull request into a checklist you work down to zero.

CodeRabbit's comments come out of the timeline and go into a side drawer, where you can see every finding at once, sort them four ways, resolve them through GitHub's own button, and tell what is left.

**The checklist is the point. Hiding the comments is just how the findings get somewhere you can work them.** Existing tools (CodeRabbit's own Houdini, various userscripts) only do the hiding.

**Status: v0.3 works.** It builds, loads unpacked, reads every CodeRabbit thread on a supported pull request page, takes the ones it can prove are CodeRabbit's out of the timeline, and puts them in a drawer as a row each: a tick box, the title, the file, a pill carrying the category and the effort, badges, and the reason for anything it deliberately left on the page. The list groups by severity and sorts four ways in either direction, Open and Resolved are tabs, and the footer counts how far down the review you are. Every row can resolve or reopen through GitHub's own button, copy CodeRabbit's agent prompt, and open itself on Files changed. Pressing a row's title puts that one finding back in the timeline and scrolls to it, and pressing it again takes it out, so you can read a comment in context without giving up the hiding for the rest of the review. A checkbox on the toolbar icon turns the whole extension off, in every open tab, immediately.

**The closed drawer is a tab on the page's edge** carrying the Triage mark, the number still to do, and a meter of that number by severity, so three blockers and ten nitpicks do not look alike from across the screen. Hovering it widens the tab into the sentence behind those three.

It survives the way GitHub actually moves. Clicking between the tabs of one pull request keeps your progress, arriving at a different pull request is a reset rather than a merge, and leaving pull requests puts every comment back and takes the panel away. Resolved threads are read back off GitHub's own deferred thread endpoint when you open the drawer, so they list as findings like any other, and one that could not be fetched is listed as unreadable rather than dropped. See the roadmap.

## The invariants

**The dangerous failure is not a broken panel. It is a page that quietly hides findings you never see.** Three rules prevent that, and they are tested.

1. Never hide a thread that could not be parsed.
2. Never hide a thread that cannot be positively proven to be CodeRabbit's.
3. Always distinguish "zero findings" from "could not read this page".

Number 3 exists because GitHub is rewriting the Conversation page in React. On a build the extension does not recognise it hides nothing, and the drawer handle says so rather than showing a reassuring empty list.

## How it works

Everything reads the rendered page. No API token, no backend, and the only permissions are `storage` and `contextMenus`, the latter for the toolbar toggle below.

* **Unresolved threads are already in the page**, so your actual worklist costs zero network requests.
* **Resolved threads are collapsed** and show no author, so they are fetched lazily on panel open (six at a time) through GitHub's own deferred thread endpoint, using your session cookie. Private repos work without a token. The response is parsed with `DOMParser` and never injected: the panel renders text, so no sanitizer is needed. A thread whose fetch fails is listed as unreadable and stays in the timeline, because a finding nobody could read is exactly what must never disappear quietly.
* **Severity, category and effort** come from CodeRabbit's emoji prefixed triple, the first three `em` elements of the comment body. Read by position and requires the emoji, so prose that happens to say "Major" never matches.
* **Resolve and unresolve click GitHub's own buttons.** Done state is GitHub's `data-resolved`, never local bookkeeping. A click only means the click happened: the row's tick box stays empty and the row stays under Open until a pass confirms it on the page, and the row says so rather than striking a finding through on hope. GitHub renders the button for write access, not for a session, so a row on a repository you cannot write to says that instead.

### Hide policy

**Safe mode is the default: a thread is hidden only if every comment in it is CodeRabbit's.** One human reply, or one unsubmitted comment of your own, keeps the thread in the timeline and badges it in the panel.

**Aggressive mode hides all CodeRabbit rooted threads.** It is an explicit choice on the drawer's settings sheet, behind the gear in the footer, for teams that never discuss findings inline. Both invariants hold in both modes: neither one hides a thread it could not read or could not prove is CodeRabbit's.

**A hide can be reversed one finding at a time, and only by you.** A row's title is the switch: it puts that thread back in the timeline and scrolls to it, and a second press returns it to whatever the policy decided. No pass may reverse either direction, so a page that keeps changing under you never swallows a thread you asked to see. The title of a finding the policy left in the timeline has only one state to be in, so it only scrolls: the panel can put a thread back on the page but never take one off it.

**The mode, the sort axis, its direction, the panel's theme and whether the drawer is open are remembered** in `chrome.storage.local`, per browser and never synced. They are read before the first hide pass, so a page is hidden once, in the mode you chose. Nothing about a pull request is stored, and a storage read that fails is safe mode.

The walkthrough comment and the "Actionable comments posted: N" summaries are hidden too, but read first: their total is compared against the threads found, and the panel warns when the page holds fewer than CodeRabbit says it posted. GitHub renders a long conversation in pieces, so a big pull request opens with a handful of its threads in the page and a reassuringly small number on the handle. The check only warns, it never blocks and never hides less. When the page has nothing left to load, the same warning says so instead of pointing at a button: a total that stays higher than the page on a fully rendered conversation is CodeRabbit counting a finding it never posted as a thread.

**By default, the panel closes that gap itself.** Whenever the count check comes up short, it clicks GitHub's own "Load more" for every batch still on the page, the same button you would click yourself, until nothing is missing or nothing is left to click. A preference on the settings sheet turns this off for a reader who would rather load the rest by hand.

### Off switch

**Right click the toolbar icon for a checkbox that turns the extension off entirely.** Unlike it, this is not a preference on any pull request: unchecking it stops the engine outright, in every open tab, immediately, reveals every thread the page had hidden, and takes the panel off the page. The icon carries an `OFF` badge whenever it is unchecked, so the state is visible without opening the menu. Checking it again starts fresh, reading whatever is currently stored for the other five preferences.

It is stored on its own, separately from the mode, sort, theme and load preferences above: it is written by the toolbar's background service worker rather than by the panel, and defaults to on, on a fresh install and whenever the read fails, so nobody meets a silently disabled extension they never chose.

## Roadmap

**v0.1 is the unresolved worklist**, which needs no network requests at all. It is done.

* Fixture capture script, plus committed fixtures from public PRs
* Thread scanner: walk `review-thread-collapsible`, attribute authors, parse the triple, detect Outdated and Pending
* Hide engine with the safe rule, plus a MutationObserver so late loading items do not slip past
* Drawer showing unresolved findings with severity, category, effort, outdated, pending and human activity badges
* Sort by severity and by file
* Resolve, and copy "Prompt for AI Agents"
* Turbo navigation handling

**v0.2 adds the network half**, which is everything that needs GitHub's deferred thread endpoint or a stored preference. It is done.

* Fetch resolved threads on panel open, so they list as findings rather than as a count (done)
* Unresolve, through GitHub's own button (done)
* The count check: compare CodeRabbit's own "Actionable comments posted: N" against the threads found, and warn when the page holds fewer (done)
* Sort by category and effort, with grouped headers where a flat list would read as noise (done)
* The aggressive hide toggle, and the preferences that hold it (done)

**The drawer was then rebuilt on a designed panel**, in Primer light and dark: collapsible severity groups, Open and Resolved tabs, a sort popover with a per axis direction toggle, an overflow menu per row, a progress footer, settings as a sheet, and the edge tab described above. Nothing the earlier drawer could do was given up, and neither of the two places invariant 3 shows itself changed.

**Category and effort read as one pill under each row**, an outline holding a coloured dot, the category in fewer words, a hair rule and the effort. They are two thirds of CodeRabbit's own first line and they arrive together, so a line each spent most of a row's height on six words. Seven categories have a hue and a short form; anything else prints in full in grey, and the words the pill dropped are on its tooltip.

**The panel follows the system's light or dark setting**, and the settings sheet pins it to either one for a reader whose editor and system disagree. Every colour token is a light value and a dark one in the same declaration, so the choice is one CSS property rather than a second copy of the palette.

**v0.3 adds the off switch**, a background service worker and the toolbar menu described above. It is done.

* A checkbox on the toolbar icon's right click menu, backed by its own `chrome.storage.local` key so the background worker never has to merge onto the panel's preferences record (done)
* Flipping it stops or restarts the content script's engine outright in every open tab, live, rather than waiting for a reload (done)
* An `OFF` badge on the icon mirrors the checkbox so the state reads without opening the menu (done)

## Development

```
npm install
npm run dev      # vite build --watch
npm test         # vitest, happy-dom
```

Load the `dist/` folder as an unpacked extension at `chrome://extensions` with Developer mode enabled. Rebuilds need a manual extension reload. Chromium browsers only.

**Fixtures follow a strict rule:** committed fixtures come from public PRs only, captures from private repositories stay local and gitignored. See `test/fixtures/README.md`.

## License

MIT, see `LICENSE.md`.
