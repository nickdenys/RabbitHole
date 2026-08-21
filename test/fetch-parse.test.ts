import { describe, expect, it } from 'vitest'
import { parseThreadFragment } from '../src/fetch/parse'
import { fragmentNames, loadFragment } from './support/fixture'

/**
 * The deferred fragments, and what the parsers make of them.
 *
 * Every assertion below is against a real response body saved off GitHub's own
 * endpoint, for the same reason the page fixtures exist: a parser written
 * against guessed markup is a parser written twice. See test/fixtures/README.md
 * for where each one came from.
 */
const EXPECTED = ['deferred-thread', 'deferred-thread-reply']

describe('the deferred fragments', () => {
  it('has every fragment the parser is written against', () => {
    expect(fragmentNames()).toEqual(EXPECTED)
  })

  // The fact the whole module rests on, pinned so it fails loudly rather than
  // silently parsing to nothing on the day GitHub wraps the response. Verified
  // 21 August 2026 and recorded in [[DOM reference]].
  it.each(EXPECTED)('%s is a bare fragment with no thread element around it', (name) => {
    const doc = new DOMParser().parseFromString(loadFragment(name), 'text/html')

    expect(doc.querySelectorAll('review-thread-collapsible')).toHaveLength(0)
    expect(doc.querySelectorAll('turbo-frame')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-resolved]')).toHaveLength(0)
    expect(doc.querySelectorAll('form[action$="/resolve"], form[action$="/unresolve"]')).toHaveLength(0)

    // Two or three roots, and the count is the point: the diff hunk and the
    // comments, with a leading "Comment on lines +4 to +5" header on a thread
    // anchored to a range. `deferred-thread` has that header and
    // `deferred-thread-reply` does not, which is why nothing here reads a root
    // by index and why the parser scopes to the body instead.
    const roots = [...doc.body.children]
    expect(roots.length).toBeGreaterThanOrEqual(2)
    expect(roots.some((root) => root.matches('.blob-wrapper'))).toBe(true)
    expect(roots.at(-1)?.matches('.js-inline-comments-container')).toBe(true)
  })

  it.each(EXPECTED)('%s reads with the page parsers, unchanged', (name) => {
    const fetched = parseThreadFragment(loadFragment(name))

    expect(fetched).not.toBeNull()
    expect(fetched?.authors.comments).toBeGreaterThan(0)
  })

  // One CodeRabbit comment and nothing else, which is the case the hide policy
  // exists to act on: fetched, attributed, and now hidable like any other.
  it('reads a CodeRabbit rooted thread in full', () => {
    const fetched = parseThreadFragment(loadFragment('deferred-thread'))

    expect(fetched?.authors).toEqual({
      comments: 1,
      fromCodeRabbit: 1,
      fromHumans: 0,
      pending: 0,
      allFromCodeRabbit: true,
      rootIsCodeRabbit: true,
    })

    expect(fetched?.finding?.title).toBe('Make these tests independent and deterministic.')
    expect(fetched?.finding?.category).toBe('Maintainability & Code Quality')
    expect(fetched?.finding?.severity).toBe('minor')
    expect(fetched?.finding?.effort).toBe('Quick win')
    expect(fetched?.finding?.permalink).toBe('#discussion_r3819764962')
    expect(fetched?.finding?.aiPrompt).toContain('test_optios.py')
  })

  // The attribution half, on a fragment whose root comment is a person's. It is
  // invariant 2 over the network: fetching a thread never turns it into
  // CodeRabbit's, and this one comes back kept rather than hidable.
  it('attributes a human rooted thread to the human who rooted it', () => {
    const fetched = parseThreadFragment(loadFragment('deferred-thread-reply'))

    expect(fetched?.authors).toEqual({
      comments: 2,
      fromCodeRabbit: 1,
      fromHumans: 1,
      pending: 0,
      allFromCodeRabbit: false,
      rootIsCodeRabbit: false,
    })

    // Read off the root comment, which here is the human's, not CodeRabbit's.
    expect(fetched?.finding?.permalink).toBe('#discussion_r3664468357')
    expect(fetched?.finding?.severity).toBeNull()
  })
})

describe('a fragment that cannot be read', () => {
  it.each([
    ['an empty body', ''],
    ['markup with no comment in it', '<div class="js-inline-comments-container"></div>'],
    ['an error page', 'Not Found'],
  ])('is null for %s', (_name, html) => {
    expect(parseThreadFragment(html)).toBeNull()
  })

  // One unattributable comment poisons the thread rather than being skipped,
  // exactly as it does on a rendered page: "every comment is CodeRabbit's" is
  // not a claim you can make about a comment you could not read.
  it('is null when a comment has no author link', () => {
    const html = loadFragment('deferred-thread').replaceAll('class="author ', 'class="was-author ')

    expect(parseThreadFragment(html)).toBeNull()
  })
})

describe('parsed, never injected', () => {
  // [[Decision log]], 21 August 2026. The fragment is network HTML arriving in
  // an extension context, and this is the guarantee that made a sanitizer
  // unnecessary: DOMParser builds an inert document that runs no script.
  it('runs no script in the fragment', () => {
    const global = globalThis as unknown as { __fragmentRan?: boolean }
    delete global.__fragmentRan

    parseThreadFragment('<div><script>globalThis.__fragmentRan = true</script></div>')

    expect(global.__fragmentRan).toBeUndefined()
  })

  // Nothing that leaves here can be put back on a page as markup, because
  // nothing that leaves here is markup: it is strings and numbers, and the
  // round trip through JSON is the proof.
  it('returns data and never an element', () => {
    const fetched = parseThreadFragment(loadFragment('deferred-thread'))

    expect(Object.keys(fetched ?? {}).sort()).toEqual(['authors', 'finding'])
    expect(JSON.parse(JSON.stringify(fetched))).toEqual(fetched)
  })
})

// The same rules test/fixtures/README.md puts on a page capture. A committed
// fragment carries no script and no live session token either.
describe('fragment hygiene', () => {
  it.each(EXPECTED)('%s has no script and leaks no CSRF token', (name) => {
    const html = loadFragment(name)

    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).not.toMatch(/name="authenticity_token" value="(?!REDACTED)/)
  })

  it.each(EXPECTED)('%s records where it came from', (name) => {
    // The comment is prepended to the response body rather than put in a head,
    // because a fragment has no head. It parses away to a comment node and no
    // selector in this repo can see it.
    expect(loadFragment(name)).toMatch(/^<!-- captured from https:\/\/github\.com\/\S+ on \d{4}-\d{2}-\d{2}/)
  })
})
