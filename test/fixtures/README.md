# Fixtures

Every parser in this repo asserts against these files. A parser written against
hand built markup is a parser written twice, so nothing here is invented.

## The rules

**Committed fixtures come from public pull requests only.** Anything captured
from a private repository (such as the PR 590 set used during design) goes in
`private/`, which is gitignored and never leaves your machine.

**Capture while logged in.** Not for the reason originally written down: as of
19 August 2026 a logged out session gets the same Rails timeline, so the build is
not the issue. What an anonymous capture loses is everything GitHub renders for a
signed in reader, the resolve form above all. Capture logged in or the fixture is
quietly incomplete.

**Record provenance below in the same sitting.** A fixture with no source URL
cannot be recaptured when GitHub changes, and a suite that only ever saw August
markup proves nothing in October.

## Layout

```
test/fixtures/
  public/             committed, from public PRs
  public/fragments/   committed, single deferred thread responses
  private/            gitignored, local only
```

## Capturing

`scripts/capture-fixture.js` is a console paste, not a Node script: the markup
only exists behind your session. Open the PR's Conversation tab, paste the whole
file into the devtools console, then run

```js
captureFixture('unresolved-and-resolved')
```

It clones the parent of the first `.js-timeline-item`, removes every `<script>`,
blanks any CSRF token input, wraps the result in a bare document and downloads
it. It also logs the counts (threads, resolved, CodeRabbit authored, Outdated
labels) that later steps assert against, which is easier to check now, with the
real page still in front of you, than later from the saved file.

It refuses to build the file if a token survives, because a fixture is
committed and a leak cannot be taken back.

Move the download into `public/` and fill in a row below.

### Tokens hide inside `<template>`

**Found 21 August 2026, while recapturing `resolvable.html`.** The redaction pass
used `clone.querySelectorAll(...)`, which does not descend into a `<template>`:
its children live in a separate `content` fragment rather than in the document
tree, so a selector walks straight past them. GitHub renders its inline comment
form inside a template, one per thread, each with a live `authenticity_token`.

That capture came out with 95 tokens redacted and 9 untouched, all 9 inside
templates. `scrub` now walks template content recursively and the script throws
rather than downloading if anything is left, so a future hiding place fails the
capture instead of shipping.

**The fixture committed on 20 August carried 10 live tokens for the same
reason**, and they are in git history. A CSRF token is scoped to one session and
dies with it, so the exposure ends when that session does, but the four other
committed fixtures were checked and are clean: their repositories gave the
reader no write access, so GitHub rendered no forms and their templates hold no
tokens.

To capture the "Pending in batch" state, start a review on a public PR without
submitting it, capture, then discard the review.

Find candidate PRs by searching GitHub pull requests for CodeRabbit's app
account as a commenter.

## What is captured

## What is captured

Captured 19 August 2026, logged in. Counts are what the parsers see in the
committed file, taken by walking the fixture rather than by reading the page.

| Name | Source | Threads | Resolved | Unresolved CodeRabbit | Outdated | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `unresolved-and-resolved.html` | [AnchalGhai/cohort-9-mern-7434-anchalbai#2](https://github.com/AnchalGhai/cohort-9-mern-7434-anchalbai/pull/2) | 13 | 10 | 2 | 3 | 682 KB |
| `human-replies.html` | [leynos/cuprum#234](https://github.com/leynos/cuprum/pull/234) | 103 | 76 | 27, of which 10 have a human reply | 57 | 8.3 MB |
| `pending-in-batch.html` | [InseeFrLab/onyxia#1072](https://github.com/InseeFrLab/onyxia/pull/1072) | 19 | 10 | 8, plus 2 pending comments | 11 | 1.8 MB |
| `no-coderabbit.html` | [laravel/framework#54450](https://github.com/laravel/framework/pull/54450) | 3 | 1 | none, zero CodeRabbit anywhere | 2 | 800 KB |
| `resolvable.html` | [nickdenys/optios-booking#1](https://github.com/nickdenys/optios-booking/pull/1) | 10 | 2 | 8, each with a resolve form | 0 | 1.6 MB |
| `partial-timeline.html` | [leynos/cuprum#234](https://github.com/leynos/cuprum/pull/234) | 1 | 1, collapsed | none rendered yet | 0 | 553 KB |

### `partial-timeline.html` is the page as a reader meets it

**Captured 31 August 2026, and it breaks two of the rules above on purpose.** It
is the same pull request as `human-replies.html` and it is not a duplicate of
it: that one was captured with the whole 316 item timeline expanded by hand, and
this one is what GitHub actually serves on the first paint.

It exists because every other fixture was captured expanded, which meant the
suite had never seen a partial timeline, which is the state a long pull request
is in for every reader every time. **That gap hid a real bug.** On this page the
walkthrough is in the first chunk and every `Actionable comments posted: N` is
not, so `claimed` is null, the count check has nothing to compare and stays
quiet by design, and the drawer fell through to "CodeRabbit reviewed this pull
request in full and posted nothing to work down" on a review of roughly 102
findings. The page says `506 hidden items` on the button while the drawer said
there was nothing to find. See the 31 August [[Decision log]] entry.

What it holds: 57 of 563 timeline items, one collapsed thread, CodeRabbit's
walkthrough, one `.ajax-pagination-form`, and no actionable count anywhere.

**Deviation 1, captured logged out.** The rule above exists because an anonymous
capture loses everything GitHub renders for a signed in reader, the resolve form
above all. Nothing is lost here: cuprum is a stranger's repository, so GitHub
renders no resolve form for this reader either way, and `resolvable.html`
remains the only fixture that has any. What this file is for is the chunk
boundary, which is the same for everyone.

**Deviation 2, captured by fetching the URL** rather than by pasting
`scripts/capture-fixture.js` into the console, for the same reason the deferred
fragments were: the console script cannot capture a page without first loading
it in a browser, and loading it in a browser is what makes the timeline start
expanding. The same transformation was applied, parent of the first
`.js-timeline-item`, every `<script>` removed, every `authenticity_token`
blanked, templates walked recursively, and 60 tokens were redacted with none
left.

**Recapture with care.** GitHub's chunk size is not a promise, so the numbers
above will move. What has to stay true for this fixture to be worth keeping is
the shape: a `.ajax-pagination-form` in the page, and no `Actionable comments
posted:` anywhere in it.

### There is no React fixture, on purpose

Logged out now serves the classic Rails timeline, so the plan's "capture the same
page logged out" does not reach the React build, and `react-build.html` was
dropped rather than faked.

Nothing is lost that matters. What protects a reader on an unrecognised build is
the engine rule that nothing is hidden unless `kind === 'classic'`, and that is
testable with any document the detector does not recognise. The React label
itself stays covered by the hand built case in `test/detect.test.ts`, whose
selector was verified against a real React page on 11 August 2026.

## The deferred fragments

`public/fragments/` holds responses from GitHub's deferred thread endpoint, the
one a collapsed thread names in `data-deferred-content-url`. They are what
`src/fetch/parse.ts` reads, and they are not pages: two or three root divs, the
diff hunk and `.js-inline-comments-container`, with no `<html>`, no timeline
item and no `review-thread-collapsible` around them.

They live in their own directory for that reason. `fixtureNames()` is walked by
the engine and invariant suites, which assert a timeline, a classic build and a
thread count on everything they find, and a fragment answers none of those.
Fragments come back from `fragmentNames()` and `loadFragment()` instead, as text
rather than as a Document, because text is what `fetchThreadHtml` yields.

Captured 21 August 2026 by fetching the URL directly. **Logged out**, which the
endpoint allows for a public repository: five header variants returned a byte
identical body on 21 August, and a session changes nothing the parsers read.
Provenance is an HTML comment on the first line, since a fragment has no head.

| Name | Source thread | Comments | Root author | Size |
| --- | --- | --- | --- | --- |
| `deferred-thread.html` | [nickdenys/optios-booking#1](https://github.com/nickdenys/optios-booking/pull/1), thread 2596022521 | 1 | CodeRabbit, with a 🟡 Minor triple and an agent prompt | 16 KB |
| `deferred-thread-reply.html` | [leynos/cuprum#234](https://github.com/leynos/cuprum/pull/234), thread 2481955968 | 2 | a person, replied to by CodeRabbit | 34 KB |

`deferred-thread.html` comes from a repository of Nick's own, so it can be
recaptured when GitHub moves, and it carries the leading
`Comment on lines +4 to +5` header div that a range anchored thread gets and
`deferred-thread-reply.html` does not. That difference is why the parser scopes
to the parsed body rather than reading a root by index.

**Its thread was open when it was captured**, which is a deviation from the
build plan's "resolve one first". The endpoint renders the same partial either
way: the cuprum thread beside it was resolved, and the two bodies have the same
shape. B4 has since recaptured `resolvable.html` with two threads resolved, so
nothing is owed here any more.

### `resolvable.html` is the only one with a resolve form

`form[action$="/resolve"]` counts 0 in the other four, every one captured logged
in. GitHub renders that button only for a reader who can actually use it, which
on a stranger's repository is nobody. This one comes from a public repository of
Nick's own with CodeRabbit installed, so the buttons are there: 8 forms, each
with its thread id in the action, exactly the shape [[DOM reference]] records.
It is also the only fixture with a `/unresolve` form, for the same reason.

Because the repository is his, this fixture can be recaptured whenever GitHub
moves, which is what [[Build plan|C1]] asks for. The other four cannot.

**Recaptured 21 August 2026 for [[Build plan|B4]]**, with two threads resolved
and one of those two expanded by hand before capturing. That is what makes this
the only fixture that can answer B4 at all, because it holds all three states of
a thread on a repository the reader can write to:

| State | Count | Carries |
| --- | --- | --- |
| Open | 8 | a `/resolve` form |
| Resolved, expanded | 1 | a `/unresolve` form, its comments, no deferred URL |
| Resolved, collapsed | 1 | a `data-deferred-content-url` and **no form at all** |

The last row is the answer to B4's question. On a stranger's pull request a
collapsed thread has no form either, but there the reason is permission, so the
absence proves nothing. Here the same reader has a resolve form on eight other
threads, which leaves collapsing as the only explanation. See [[DOM reference]].

The expanded one was expanded by clicking GitHub's own chevron and waiting for
the deferred fetch, then capturing. Expanding **removes**
`data-deferred-content-url`, so one thread cannot show both states, which is why
two are resolved rather than one.

The recapture moved every pinned count that mentions this fixture: nine threads
readable rather than ten, nine hidden rather than ten, eight resolve forms
rather than ten. All of them are in the count tables in `test/`.

**`human-replies.html` is 8.3 MB**, because reaching its human replies meant
clicking "N hidden items" until the whole 316 item timeline was loaded. It is the
only fixture with more than one human reply in an unresolved thread, so it earns
its place, but it costs about 700 ms to parse and it is why `test/fixtures.test.ts`
shares one parsed document across the assertions that only read.

## Reading them in tests

```ts
import { loadFixture, fixtureNames, loadFragment, fragmentNames } from './support/fixture'
```

`loadFixture` returns a **fresh** Document per call, because the hide tests
mutate it. The file text is cached, the parsed document never is.
