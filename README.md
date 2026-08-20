# CodeRabbit Triage

Turns a CodeRabbit review on a GitHub pull request into a checklist you work down to zero.

CodeRabbit's comments come out of the timeline and go into a side drawer, where you can see every finding at once, sort by severity or file, resolve them through GitHub's own button, and tell what is left.

**The checklist is the point. Hiding the comments is just how the findings get somewhere you can work them.** Existing tools (CodeRabbit's own Houdini, various userscripts) only do the hiding.

**Status: it hides, it lists and it sorts.** It builds, loads unpacked, reads every CodeRabbit thread on a supported pull request page, takes the ones it can prove are CodeRabbit's out of the timeline, and puts them in a drawer as a row each: severity, title, file, badges, and the reason for anything it deliberately left on the page. The list sorts by severity or by file. The actions are next, so it is still read only. See the roadmap.

## The invariants

**The dangerous failure is not a broken panel. It is a page that quietly hides findings you never see.** Three rules prevent that, and they are tested.

1. Never hide a thread that could not be parsed.
2. Never hide a thread that cannot be positively proven to be CodeRabbit's.
3. Always distinguish "zero findings" from "could not read this page".

Number 3 exists because GitHub is rewriting the Conversation page in React. On a build the extension does not recognise it hides nothing, and the drawer handle says so rather than showing a reassuring empty list.

## How it works

Everything reads the rendered page. No API token, no backend, no permission beyond `storage`.

* **Unresolved threads are already in the page**, so your actual worklist costs zero network requests.
* **Resolved threads are collapsed** and show no author, so they are fetched lazily on panel open (concurrency capped) through GitHub's own deferred thread endpoint, using your session cookie. Private repos work without a token.
* **Severity, category and effort** come from CodeRabbit's emoji prefixed triple, the first three `em` elements of the comment body. Read by position and requires the emoji, so prose that happens to say "Major" never matches.
* **Resolve and unresolve click GitHub's own buttons.** Done state is GitHub's `data-resolved`, never local bookkeeping.

### Hide policy

**Safe mode is the default: a thread is hidden only if every comment in it is CodeRabbit's.** One human reply, or one unsubmitted comment of your own, keeps the thread in the timeline and badges it in the panel.

**Aggressive mode hides all CodeRabbit rooted threads.** It is an explicit toggle, for teams that never discuss findings inline.

The walkthrough comment and the "Actionable comments posted: N" summaries are hidden too, but read first: their total is compared against the threads found, and a mismatch warns you. The Conversation tab is known to occasionally drop a thread. The check only warns, it never blocks.

## Roadmap

**v0.1 is the unresolved worklist**, which needs no network requests at all.

* Fixture capture script, plus committed fixtures from public PRs
* Thread scanner: walk `review-thread-collapsible`, attribute authors, parse the triple, detect Outdated and Pending
* Hide engine with the safe rule, plus a MutationObserver so late loading items do not slip past
* Drawer showing unresolved findings with severity, category, effort, outdated, pending and human activity badges
* Sort by severity and by file
* Resolve, and copy "Prompt for AI Agents"
* Turbo navigation handling

Fetching resolved threads, the remaining sort axes and the aggressive hide toggle come after that.

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
