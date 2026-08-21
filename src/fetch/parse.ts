import { readAuthors } from '../parse/authors'
import { readFinding } from '../parse/finding'
import type { Finding, ThreadAuthors } from '../types'

/**
 * What a deferred fragment turned out to hold: who wrote the thread, and what
 * the thread says.
 *
 * `authors` is never null here. Attribution is the whole reason to fetch, so a
 * fragment that cannot be attributed is not a half read thread, it is an
 * unread one, and `parseThreadFragment` returns null rather than this.
 *
 * `finding` still can be. A thread whose comments are readable but whose root
 * carries no body is a thread you can attribute and cannot describe, which is
 * the same gap `readFinding` already reports on a rendered page.
 */
export interface FetchedThread {
  authors: ThreadAuthors
  finding: Finding | null
}

/**
 * Read one deferred fragment with the parsers that already read the page.
 *
 * **Parsed, never injected.** [[Decision log]], 21 August 2026: the fragment is
 * network HTML arriving in an extension context, and `DOMParser` gives an inert
 * document that runs no script and loads no resource. Nothing here returns
 * markup, so nothing downstream can put it back on a page: the panel draws text
 * it was handed, as it already does for a rendered thread.
 *
 * **The fragment carries no thread element**, verified 21 August 2026: it is
 * two root divs, the diff hunk and `.js-inline-comments-container`, with no
 * `review-thread-collapsible`, no `turbo-frame` and no `data-resolved` anywhere
 * in it. The parsers from A3 and A4 scope every read to a thread element, so
 * this supplies one: the parsed document's own `<body>`, which is the only
 * ancestor the fragment's roots have and which scopes exactly as tightly. That
 * is the shared helper [[Build plan|B3]] anticipated, and it is one line rather
 * than a second parser.
 *
 * **Identity and state are not in here and are not read out of it.** Which
 * thread this is, and whether it is resolved, are known already from the stub
 * in the page that gave up the URL, which is the only place they exist. The
 * engine merges this into that thread rather than building a thread from it.
 *
 * Null means the fragment could not be read: an empty body, markup that moved,
 * or a comment whose author is not exactly one readable link. The caller treats
 * it exactly as it treats a failed request, because to a worklist they are the
 * same fact, and it is a fact the reader is told rather than one that quietly
 * drops a row.
 */
export function parseThreadFragment(html: string): FetchedThread | null {
  const root = new DOMParser().parseFromString(html, 'text/html').body
  const authors = readAuthors(root)
  if (authors === null) return null

  return { authors, finding: readFinding(root) }
}
