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

Move the download into `public/` and fill in a row below.

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
| `resolvable.html` | [nickdenys/optios-booking#1](https://github.com/nickdenys/optios-booking/pull/1) | 10 | 0 | 10, each with a resolve form | 0 | 1.7 MB |

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
shape. What is still owed is [[Build plan|B4]]'s recapture of `resolvable.html`
with a thread resolved on it, which is the only way to see the unresolve form.

### `resolvable.html` is the only one with a resolve form

`form[action$="/resolve"]` counts 0 in the other four, every one captured logged
in. GitHub renders that button only for a reader who can actually use it, which
on a stranger's repository is nobody. This one comes from a public repository of
Nick's own with CodeRabbit installed, so the buttons are there: 10 forms, each
with its thread id in the action, exactly the shape [[DOM reference]] records.

Because the repository is his, this fixture can be recaptured whenever GitHub
moves, which is what [[Build plan|C1]] asks for. The other four cannot.

**It still has nothing resolved.** All 10 threads are open, so the file carries
no unresolve form and no `data-deferred-content-url`. [[Build plan|B4]] needs the
first and [[Build plan|B3]] needs the second, and both arrive by resolving a
thread on that PR and recapturing over this file. That also answers B4's open
question of whether the unresolve form exists while the thread is collapsed.

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
