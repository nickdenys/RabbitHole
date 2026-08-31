<img src="https://raw.githubusercontent.com/nickdenys/RabbitHole/main/public/icons/icon128.png" alt="RabbitHole" width="96">

# RabbitHole

**Turn a CodeRabbit review into a checklist you work down to zero.**

CodeRabbit leaves a lot of comments in your pull request timeline. Some are blockers, most are nitpicks. You fix something, scroll back, lose your place. A lot of context and time is lost going back and forth.

RabbitHole takes those comments out of the timeline and puts them in a side drawer as a task list instead.

![RabbitHole's drawer open on a pull request, listing the CodeRabbit findings by severity](https://raw.githubusercontent.com/nickdenys/RabbitHole/main/docs/screenshot.png)

## What's included

* **One list instead of 30 comments**, grouped by severity, sortable four ways in either direction, separate Open and Resolved tabs.
* **A quick glance of your issues.** After page load, a small tab appears on the page's edge with the number of CodeRabbit issues and a severity meter.
* **No external requests.** Rows resolve and reopen through GitHub's own button, and done state comes from GitHub rather than from external API's.
* **Context without losing the list.** Press a row's title to put that one finding back in the timeline and scroll to it. Press it again to take it out.
* **Shareable links still work.** Share a permalink to one CodeRabbit comment and that finding stays in the timeline, scrolled to, exactly as it would without the extension.
* **Quick actions:** copy CodeRabbit's agent prompt, open the finding on Files changed, read its category and effort off one pill.

## Safe to use

**The dangerous failure is not a broken panel. It is a page that quietly hides findings you never see.** We've set up four rules prevent that.

1. Never hide a thread that could not be parsed.
2. Never hide a thread that cannot be positively proven to be CodeRabbit's.
3. Always distinguish "zero findings" from "could not read this page".
4. The panel is only ever absent from a page it has not touched.

If GitHub decides to rewrite the Conversation page, the extension will not recognise it, hides nothing and says so, rather than showing a reassuring empty list. Nothing breaks.

## How it works

A Manifest V3 extension for Chrome and Firefox, panel in Preact, everything read off the rendered page. No API token, no backend, no OAuth, and two permissions: `storage`, plus `contextMenus` for the toolbar toggle.

* **Your worklist costs zero network requests.** Unresolved threads are already in the page.
* **Resolved threads are fetched as the page settles**, six at a time, through GitHub's own deferred endpoint on your session cookie, since GitHub renders them collapsed and authorless. Private repos need no token. Responses go through `DOMParser` and are never injected, so there is nothing to sanitize. A thread whose fetch fails is listed as unreadable and stays in the timeline.
* **Severity, category and effort** come from CodeRabbit's emoji triple, read by position off the first three `em` elements. That is a correctness fix rather than a style preference: a text search over the body also matches prose inside the finding.
* **Resolve and unresolve click GitHub's own buttons.** A row stays under Open until a pass confirms the change on the page. GitHub renders that button for write access, so a row on a repository you cannot write to says so.
* **The panel mounts only where there is something of CodeRabbit's.** Everywhere else costs one scan per page: no shadow host, no stylesheet, no handle.

## Privacy

Nothing is collected and nothing is transmitted. Six preferences and an on/off
switch live in `chrome.storage.local` on your own machine, and no comment,
thread, repository or username is ever written anywhere. The only request the
extension makes is to GitHub's own deferred thread endpoint, on your own
session, for the page you already have open. See [`PRIVACY.md`](PRIVACY.md).

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

## License

MIT, see `LICENSE.md`.

RabbitHole is an independent project. It is not affiliated with, endorsed by, or
sponsored by CodeRabbit.
