# CodeRabbit Triage

A browser extension that turns CodeRabbit review comments on GitHub pull requests into a triage worklist. CodeRabbit threads are hidden from the timeline and surfaced in a side drawer where you can see all findings at once, sort them by severity or file, resolve them through GitHub's own button, and know exactly what is left.

Status: early scaffold. The extension builds, loads unpacked, and detects supported pages. Parsing, hiding and the worklist drawer are in progress (see the roadmap below).

## Why

The pain is not visual noise. A CodeRabbit review cannot be worked as a task list. You cannot see all findings at once, sort them, check them off, and know what remains. Hiding the comments is the delivery mechanism, not the goal. Existing hiders (CodeRabbit's own Houdini, various userscripts) solve only the hiding half.

## The invariants

The dangerous failure mode is not a broken panel. It is a page that silently hides review findings you never see. Three invariants guard against that:

1. Never hide a thread that could not be parsed.
2. Never hide a thread that cannot be positively attributed to CodeRabbit.
3. The panel must always distinguish "zero findings" from "could not read this page".

Invariant 3 covers GitHub's ongoing React rewrite of the Conversation page. On an unrecognized build the extension hides nothing and the drawer handle shows an explicit unsupported state instead of an empty list.

## How it works

Everything runs against the rendered DOM of the Conversation tab. No API token, no backend, no permissions beyond `storage`.

* Unresolved threads are fully rendered in the page, so the actual worklist costs zero network requests.
* Resolved threads are collapsed and expose no author information, so they are fetched lazily (on panel open, concurrency capped) through GitHub's own deferred thread endpoint, using session cookies.
* Severity, category and effort come from CodeRabbit's emoji prefixed triple, rendered as the first three `em` elements of the comment body. Parsing is positional and requires the emoji prefix, so prose that emphasizes a severity word never matches.
* Resolve and unresolve click GitHub's own buttons (`form[action$="/resolve"] button`), so done state is GitHub's `data-resolved`, never local bookkeeping.

### Hide policy

Safe mode is the default: only threads where every comment is authored by CodeRabbit are hidden. A human reply, or a pending comment of your own, keeps the thread in the timeline and badges it in the panel. Aggressive mode (hide all CodeRabbit rooted threads) is an explicit toggle for teams that never discuss findings inline.

The walkthrough comment and the "Actionable comments posted: N" summaries are also hidden, but the summaries are parsed first: their sum is compared against the number of threads found, and a mismatch shows a warning (the Conversation tab is known to occasionally drop threads). The check only ever warns, it never gates.

## Roadmap

### v0.1, the unresolved worklist

* Fixture capture script and committed fixtures from public PRs
* Thread scanner: walk `review-thread-collapsible`, attribute authors, parse the triple, detect Outdated and Pending states
* Hide engine with the safe rule, plus a MutationObserver so lazily loaded timeline items do not escape it
* Drawer UI: unresolved findings with severity, category, effort, outdated, pending and human activity badges
* Sort by severity and by file
* Resolve action, copy "Prompt for AI Agents"
* Turbo navigation handling

### v0.2, the full design

* Deferred fetch of resolved threads (lazy on panel open, concurrency around 6)
* Unresolve action
* Count check warning based on CodeRabbit's own summary counts
* Sort by state, category and effort
* Aggressive hide toggle and preference persistence via `chrome.storage.local`
* Care point: fetched thread HTML is GitHub rendered, but it must still be injected carefully (sanitize or render into an inert container) since the panel lives in an extension context

### Later, maybe

* Firefox port (needs a signing pipeline, Firefox has no persistent unpacked mode)
* Support for GitHub's React build of the Conversation page once the rollout stabilizes
* Store listing

## Development

```
npm install
npm run dev      # vite build --watch
npm test         # vitest, happy-dom
```

Load the `dist/` folder as an unpacked extension at `chrome://extensions` (enable Developer mode). Rebuilds require a manual extension reload. Chromium browsers only.

Test fixtures follow a strict policy, see `test/fixtures/README.md`: committed fixtures come from public PRs only, captures from private repositories stay local and gitignored.

## License

MIT, see `LICENSE.md`.
