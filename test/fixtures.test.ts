import { describe, expect, it } from 'vitest'
import { detectPage } from '../src/detect'
import { fixtureNames, loadFixture } from './support/fixture'

// A capture is the timeline container, so any PR conversation URL will do.
const PR_URL = 'https://github.com/owner/repo/pull/1'

const CODERABBIT = 'a.author[href="/apps/coderabbitai"]'

// There is no React fixture, and there will not be one: a logged out session is
// served the classic Rails timeline, so the plan's "capture it logged out" does
// not reach that build. The invariant it was meant to cover, an unrecognised
// build hides nothing, is tested in the engine against any unrecognised
// document instead. See test/fixtures/README.md.
//
const EXPECTED = [
  'human-replies',
  'no-coderabbit',
  'pending-in-batch',
  'resolvable',
  'unresolved-and-resolved',
]

// Parsed once and shared, because these assertions only read. human-replies.html
// is 8.3 MB, and happy-dom holds a document of that size expensively enough that
// re-parsing it per case exhausts the test worker. Tests that MUTATE a document
// must still call loadFixture themselves, which is what it returns a fresh one for.
const docs: Record<string, Document> = Object.fromEntries(EXPECTED.map((name) => [name, loadFixture(name)]))

describe('fixtures', () => {
  it('has every fixture the parsers are written against', () => {
    expect(fixtureNames()).toEqual(expect.arrayContaining(EXPECTED))
  })

  it('is not silently empty', () => {
    // A glob that matches nothing would make every loop below vacuously pass,
    // which is the failure this project exists to prevent, one layer down.
    expect(fixtureNames().length).toBeGreaterThan(0)
  })

  it.each(EXPECTED)('%s parses into a timeline', (name) => {
    const doc = docs[name]
    expect(doc.querySelectorAll('.js-timeline-item').length).toBeGreaterThan(0)
    expect(doc.querySelectorAll('review-thread-collapsible').length).toBeGreaterThan(0)
  })

  it.each(EXPECTED)('%s reads as the classic build', (name) => {
    expect(detectPage(docs[name], PR_URL)).toBe('classic')
  })

  it('no-coderabbit.html has timeline items and no CodeRabbit anywhere', () => {
    const doc = docs['no-coderabbit']
    expect(doc.querySelectorAll('.js-timeline-item').length).toBeGreaterThan(0)
    expect(doc.querySelectorAll(CODERABBIT)).toHaveLength(0)
  })

  it.each(EXPECTED.filter((n) => n !== 'no-coderabbit'))('%s has CodeRabbit comments', (name) => {
    expect(docs[name].querySelectorAll(CODERABBIT).length).toBeGreaterThan(0)
  })

  // The resolve button is rendered only for a reader who can use it, so it is
  // absent from every capture taken on a stranger's repository. resolvable.html
  // exists to carry it, and this pins both halves of that fact.
  it('resolvable.html carries the resolve form, and only it does', () => {
    const forms = [...docs['resolvable'].querySelectorAll('form[action$="/resolve"]')]
    expect(forms.length).toBeGreaterThan(0)
    expect(forms.every((form) => form.querySelector('button') !== null)).toBe(true)
    expect(forms[0].getAttribute('action')).toMatch(/\/pull\/\d+\/threads\/\d+\/resolve$/)

    for (const name of EXPECTED.filter((n) => n !== 'resolvable')) {
      expect(docs[name].querySelectorAll('form[action$="/resolve"]')).toHaveLength(0)
    }
  })

  it('returns a fresh document per call', () => {
    const first = loadFixture('unresolved-and-resolved')
    const before = first.querySelectorAll('review-thread-collapsible').length
    first.querySelectorAll('review-thread-collapsible').forEach((el) => el.remove())

    expect(loadFixture('unresolved-and-resolved').querySelectorAll('review-thread-collapsible')).toHaveLength(before)
  })

  it('names the fixtures it does not have', () => {
    // A typo must fail loudly with the list, never resolve to an empty document.
    expect(() => loadFixture('resolvabel')).toThrow(/No fixture named "resolvabel".*human-replies/s)
  })
})

// These enforce test/fixtures/README.md on every fixture added later, not just
// the four captured today. A committed capture must carry no script and no live
// session token, and the capture script is what guarantees both.
describe('fixture hygiene', () => {
  it.each(EXPECTED)('%s has no scripts', (name) => {
    expect(docs[name].querySelectorAll('script')).toHaveLength(0)
  })

  it.each(EXPECTED)('%s leaks no CSRF token', (name) => {
    const live = [...docs[name].querySelectorAll('input[name="authenticity_token"]')].filter(
      (input) => input.getAttribute('value') !== 'REDACTED',
    )
    expect(live).toHaveLength(0)
  })

  it.each(EXPECTED)('%s records where it came from', (name) => {
    // The capture writes an HTML comment naming the URL and the date. It is the
    // only provenance that travels with the file itself.
    const head = docs[name].head.innerHTML
    expect(head).toMatch(/captured from https:\/\/github\.com\/\S+ on \d{4}-\d{2}-\d{2}/)
  })
})
