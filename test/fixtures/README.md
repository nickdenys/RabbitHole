# Fixture policy

Committed fixtures must be captured from public pull requests only. Anything captured from a private repository (such as the PR 590 set used during design) goes in `private/`, which is gitignored and never leaves your machine.

Capture must happen while logged in. Logged out sessions receive GitHub's React build of the Conversation page, which is not the markup this extension parses.

To capture the "Pending in batch" state, start a review on a public PR without submitting it, save the page, then discard the review.

A capture script is planned as part of v0.1. Until it exists, fixtures are saved manually via the browser's "Save page" or by copying `outerHTML` of the timeline from devtools.

## Layout

```
test/fixtures/
  public/    committed, from public PRs
  private/   gitignored, local only
```
