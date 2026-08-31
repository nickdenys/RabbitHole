# Store listing

**Everything the Chrome Web Store dashboard asks for, written out so the form is
a paste rather than a drafting session.** Written 31 August 2026 for version
0.3.0. The plan this came from is the Obsidian note `Chrome Web Store submission`.

Nothing here is read by the build. It is kept in the repository rather than in
the dashboard alone so that the copy has a history, and so the next version can
be diffed against this one.

## Product details

**Name**

```
RabbitHole
```

**Summary** (132 characters allowed, this is 80, and it is the manifest's
`description` verbatim so the two can never disagree)

```
Turns CodeRabbit review comments into a triage worklist on GitHub pull requests.
```

**Category** Developer Tools. **Language** English.

**Full description**

```
CodeRabbit leaves a lot of comments in your pull request timeline. Some are blockers, most are nitpicks. You fix something, scroll back, and lose your place.

RabbitHole takes those comments out of the timeline and puts them in a side drawer as a task list instead.

WHAT YOU GET

• One list instead of 30 comments, grouped by severity, sortable four ways in either direction, with separate Open and Resolved tabs.
• A count before you open anything. A small tab on the edge of the page shows how many CodeRabbit findings the pull request holds, broken down by severity.
• Context without losing the list. Press a row's title to put that one finding back in the timeline and scroll to it. Press it again to take it out.
• Shareable links still work. Open a permalink to one CodeRabbit comment and that finding stays in the timeline, scrolled to, exactly as it would without the extension.
• Quick actions. Copy CodeRabbit's agent prompt, open the finding on Files changed, read its category and effort off one pill.
• Resolve and unresolve from the list, through GitHub's own buttons. Done state comes from GitHub, not from anywhere else.

WHAT HAPPENS WHEN YOU INSTALL IT

On a GitHub pull request that has a CodeRabbit review, the drawer appears and CodeRabbit's own unresolved comments are taken out of the timeline into it. Nothing else on the page is touched: your colleagues' comments, the commits, the description and the checks all stay exactly where they were.

A CodeRabbit thread that a person has replied to is left in the timeline, because the conversation is the point of it. If you would rather have those in the list too, there is a setting for it.

On any page without a CodeRabbit review, the extension does nothing at all and shows nothing.

You can turn it off entirely from the checkbox on its toolbar icon's right-click menu. The icon shows OFF while it is turned off.

NO ACCOUNT, NO BACKEND, NO TRACKING

There is no login, no API token, and no server belonging to this project. Your worklist is read off the page you already have open. Resolved threads are fetched from GitHub's own endpoint on your own session, the same request your browser makes when you click a collapsed thread open. Nothing else is ever requested.

RabbitHole reads the review comments on the page you have open, in your browser, to build the list. That reading never leaves your machine and is never written down: no comment, no repository name, no username, and no record of what you have read. Only six display preferences and an on/off switch are stored. No analytics, no telemetry, no advertising.

The full source is at https://github.com/nickdenys/RabbitHole and the privacy policy is at https://github.com/nickdenys/RabbitHole/blob/main/PRIVACY.md

WHEN IT WILL NOT WORK

GitHub is rolling out a rewritten pull request page. RabbitHole does not recognise it, and on such a page it hides nothing and tells you so rather than showing you a reassuring empty list. It never hides a comment it could not read, and it never hides a comment it cannot prove is CodeRabbit's.

Requires Chrome 123 or newer.

RabbitHole is an independent open source project. It is not affiliated with, endorsed by, or sponsored by CodeRabbit.
```

## Graphics

| Asset | Size | Source |
| --- | --- | --- |
| Store icon | 128 × 128 PNG | `public/icons/icon128.png`, already in the repository |
| Screenshot 1 | 1280 × 800 | Drawer open, severity groups, on a public PR |
| Screenshot 2 | 1280 × 800 | Closed edge tab with the count and the severity meter |
| Screenshot 3 | 1280 × 800 | Resolved tab |
| Screenshot 4 | 1280 × 800 | Settings sheet |
| Screenshot 5 | 1280 × 800 | Toolbar right-click menu with the Enabled checkbox |
| Small promo tile | 440 × 280 | Rendered from `public/icons/mark.svg` |

**Public pull requests only**, the same rule the fixtures follow. The private
PR 590 set is the better demo and it never appears. Capture against
[nickdenys/optios-booking#1](https://github.com/nickdenys/optios-booking/pull/1),
which is a repository of Nick's own, so the screenshots can be retaken when
GitHub moves.

The small promo tile is optional and skipping it means the listing can never be
featured.

## Privacy tab

Every answer is "no". Each one still has to be typed.

**Single purpose**

```
RabbitHole collects CodeRabbit's review comments on a GitHub pull request into a sortable worklist in a side drawer, and hides those same comments from the page timeline so that the list is the one place they are worked.
```

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `storage` | Stores six display preferences (hide mode, sort axis, sort direction, theme, drawer open state, auto load more) and an on/off switch, in local storage on the user's own machine. Nothing about any pull request is stored. |
| `contextMenus` | Adds one checkbox to this extension's own toolbar icon's right-click menu, which turns the extension off. It adds nothing to the page's context menu. |
| Host permission `https://github.com/*` | Reads the pull request page the user already has open, to find CodeRabbit's review comments in it. A pull request URL contains an arbitrary owner and repository name, so `https://github.com/*` is the narrowest match that reaches them all. On a page with no CodeRabbit review the extension does nothing. |

**Remote code:** No, I am not using remote code.

Ready if asked: the extension executes only the JavaScript in the uploaded
package. It does fetch HTML from `github.com`, the same origin as the page, and
that HTML is parsed into an inert document with `DOMParser` and never injected
or evaluated. The transport refuses any URL that does not resolve to the page's
own origin (`allowedUrl` in `src/fetch/threads.ts`).

**Data usage: check "Website content". Leave the other eight unchecked.**

This was answered the other way round on 31 August and it was wrong. Chrome does
not exempt local-only handling: "Extensions are required to disclose how they
handle user data, even when data is processed or stored locally on a user's
device and is not transmitted to external servers or third parties", where
*handle* is defined as "collecting, transmitting, using, or sharing". Reading a
page counts. See the [user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

* **Website content — checked.** The extension reads CodeRabbit's review
  comments off the pull request page, and reads the HTML that GitHub's deferred
  thread endpoint returns for collapsed threads. Comment text, severity markers,
  file paths and author links are all website content under Chrome's definition.
  All of it is processed in the browser and none of it is transmitted or stored.
* **Personally identifiable information — unchecked.** The extension reads the
  author link on a comment only to prove the comment is CodeRabbit's. It is not
  collected, kept, or used to identify anybody.
* **Authentication information — unchecked, and this is the closest call.**
  Chrome defines the category as "logins, password, and authentication
  cookies", so the session cookie is squarely in scope as a *thing*. The
  extension still does not handle it. It declares only `storage` and
  `contextMenus`, has no `cookies` permission, and therefore cannot read the
  cookie's value at any point. `credentials: 'same-origin'` in
  `src/fetch/threads.ts` is the browser's own default for `fetch`, so the
  cookie is attached by the browser to a same-origin request exactly as it is
  for every request the GitHub page makes itself. It is never read, stored,
  copied, or sent anywhere but back to the origin that issued it. The
  extension causes a credentialed request; it does not collect, use or share a
  credential.
* **Web history — unchecked.** No list of pages visited is read or kept. The
  extension knows only the pull request in the tab it is running in.
* **Personal communications, health, financial, location, user activity —
  unchecked.** None are touched. Code review comments on a repository are page
  content, not a messaging channel.

The three certifications stay true and all three are ticked:

* Not being sold to third parties, outside of approved use cases.
* Not being used or transferred for purposes unrelated to the item's single purpose.
* Not being used or transferred to determine creditworthiness or for lending purposes.

**Privacy policy URL**

```
https://github.com/nickdenys/RabbitHole/blob/main/PRIVACY.md
```

## Reviewer instructions

Paste into the "Instructions for reviewers" field. This one is not optional: on
a pull request with no CodeRabbit review the extension deliberately does
nothing, so a reviewer testing on a random pull request sees an extension that
looks broken.

```
Thank you for reviewing. Two things will save you time.

1. THE EXTENSION IS DELIBERATELY SILENT ON MOST PAGES

RabbitHole only acts on a GitHub pull request that carries review comments from the CodeRabbit bot. On every other page, including GitHub pull requests without such a review, it shows nothing and changes nothing. This is intentional: it must never hide a comment it cannot positively prove is CodeRabbit's.

So please test on a pull request that has one. This is a good one, on a public repository owned by the developer:

https://github.com/nickdenys/optios-booking/pull/1

What you should see there, without logging in to anything:

• A small tab on the right edge of the page showing the number of CodeRabbit findings and a coloured severity meter.
• Clicking it opens a drawer listing the findings, grouped by severity, with Open and Resolved tabs.
• CodeRabbit's unresolved comments are no longer in the page timeline; every other comment is untouched.
• Clicking a row's title puts that one comment back in the timeline and scrolls to it.
• Right-clicking the extension's toolbar icon shows an "Enabled" checkbox. Unchecking it restores the page immediately, in every open tab, and puts an OFF badge on the icon.

For a page where it correctly does nothing at all: https://github.com/laravel/framework/pull/54450

2. THE CONTENT SCRIPT MAKES REQUESTS TO GITHUB.COM

You will see this in the code, so here is what it is up front.

GitHub renders a resolved review thread collapsed, without its comments in the page. To list those in the Resolved tab, the extension requests them from the deferred-content endpoint that GitHub itself puts on the page, in a data-deferred-content-url attribute, with credentials: 'same-origin'. It is the same request the page makes when you click a collapsed thread open.

It is same-origin with the page, so no host permission beyond the content script's own match is involved. The transport refuses any URL that does not resolve to the page's origin, so a URL read off the page cannot become a request anywhere else. Responses are parsed with DOMParser into an inert document and are never injected into the page or evaluated.

No other network request is made. There is no server belonging to this project, no analytics, and no telemetry.

3. SOURCE

The extension is open source, MIT licensed, and the uploaded build is minified but not obfuscated and ships its source map.

Code: https://github.com/nickdenys/RabbitHole
Privacy policy: https://github.com/nickdenys/RabbitHole/blob/main/PRIVACY.md
Build: npm install && npm run build, which writes dist/chrome. The manifest is generated from src/manifest.ts.

RabbitHole is not affiliated with CodeRabbit. It reads their comments; it is not their product.
```

## Distribution

Free. All regions. No in-app purchases and no ads.

**Publish unlisted first, then flip to public.** It proves the store's own
artefact installs clean on a machine that never had the unpacked build.
Visibility is reversible; the version number is not.
