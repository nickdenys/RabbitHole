# Privacy policy

**RabbitHole sends nothing to anyone. It reads the pull request you are looking
at, on your own machine, and that reading never leaves your browser.**

It does read review content, so this policy says so plainly rather than opening
on the word "nothing". Chrome's own rules count reading and processing as
handling user data even when nothing is transmitted, and they are right to. What
matters to you is where it goes, and the answer is nowhere.

Last updated 31 August 2026. It applies to the RabbitHole browser extension for
Chrome and Firefox, published by Nick Denys, and to every version of it.

## What is stored

Seven values, all in `chrome.storage.local`, all on your own machine. Nothing is
written to `chrome.storage.sync`, so nothing is carried to another device by
your browser profile.

Six of them are one record of preferences, written when you change a setting:

| Value | What it is |
| --- | --- |
| `hideMode` | Whether threads a human has replied to are hidden too |
| `sortAxis` | Which column the worklist is ordered by |
| `sortLeading` | Which way round that order runs |
| `drawerOpen` | Whether the drawer was open when you last closed a page |
| `theme` | Auto, light, or dark |
| `autoLoadMore` | Whether the extension presses GitHub's own "Load more" for you |

The seventh is `enabled`, the on/off state behind the checkbox on the toolbar
icon's right-click menu.

That is the complete list. You can read it in `src/prefs.ts` and
`src/enabled.ts`.

## What is read, and where it goes

The extension reads the content of the pull request page you have open: the
review comments CodeRabbit posted, their text, their severity markers, the file
each one points at, and the author link on each comment that proves who wrote
it. In Chrome's store vocabulary that is **website content**, and the author
link is also **personally identifiable information**, since it carries a GitHub
username. Both are declared on the listing.

The author link is compared for exact equality against CodeRabbit's own account
path and then dropped. What is kept from it is a count and a yes or no, so the
extension can tell you whether CodeRabbit wrote a comment and cannot tell you
who else did.

All of it is read and used in the page you are already on, in your own browser,
to build the worklist and decide what to hide. **None of it is transmitted
anywhere, to the developer or to anyone else, and none of it is written to
storage.** It lives in memory for as long as the tab is open and goes when the
tab does.

There is no server belonging to this project to send it to, and no code in this
extension that sends it anywhere. See "What is sent, and where" below for the
only request it makes.

## What is not stored

Nothing about any pull request, ever. No review comment, no thread id, no file
path, no repository name, no URL, no username, and no record of what you have
read or resolved. Which findings are done is a fact about the review and stays
with GitHub, where you resolved them.

There is no account, no login, no API token, and no OAuth.

## What is sent, and where

The extension makes requests to exactly one place: `github.com`, the same origin
as the page you already have open.

GitHub renders a resolved review thread collapsed, without its comments. To list
those threads in the Resolved tab, the extension asks GitHub for them through
the same deferred endpoint the page itself uses, on your own existing session,
for the pull request you are already looking at. It is the same request your
browser would make if you clicked the thread open yourself.

Requests are refused unless they resolve to the origin of the page you are on,
so a URL read off the page can never become a request somewhere else. The guard
is `allowedUrl` in `src/fetch/threads.ts`.

Responses are parsed into an inert document with `DOMParser`, read for the
thread's comments, and never injected into the page. That parsing happens in
your browser and its results go into the drawer on your screen and nowhere
else.

No request goes anywhere else. There is no server belonging to this project.

## Analytics and tracking

None. No analytics, no telemetry, no crash reporting, no error reporting, no
cookies set by the extension, no advertising, and no fingerprinting.

## Selling and sharing

Nothing read on your machine leaves it, so there is nothing to sell, share, or
transfer, and nothing has ever been. No data is used for any purpose unrelated
to the extension's single purpose, and none is used to determine
creditworthiness or for lending.

## Permissions, and why each one exists

* **`storage`** holds the seven values above.
* **`contextMenus`** puts one checkbox on this extension's own toolbar icon,
  which turns the extension off.
* **`https://github.com/*`** reads the pull request page you are already on. A
  pull request lives under any owner and any repository name, so no narrower
  match exists. The extension does nothing on a GitHub page that carries no
  CodeRabbit review.

## Remote code

None. The extension executes no code that is not in the package you install.
Fetched HTML is parsed, never evaluated and never injected.

## Deleting what is stored

Remove the extension. Your browser deletes its local storage with it. Review
content is never persisted at all, so closing the tab is already the whole of
its deletion. There is nothing held anywhere else to request the deletion of.

## Changes

A change to this policy is a commit in the public repository, and its history is
the record of every version. The date at the top is the last one.

## Contact

Open an issue at <https://github.com/nickdenys/RabbitHole/issues>.

## Not affiliated with CodeRabbit

RabbitHole is an independent open source project. It is not affiliated with,
endorsed by, or sponsored by CodeRabbit. "CodeRabbit" is the trademark of its
owner and is used here only to describe what this extension reads.
