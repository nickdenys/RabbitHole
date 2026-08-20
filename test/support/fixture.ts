/**
 * Access to the committed fixtures.
 *
 * Fixture text is read once at module load and cached. The parsed Document is
 * NOT cached: `loadFixture` returns a fresh one per call, because the hide
 * tests mutate the document they are given and a shared one would leak state
 * between tests in whatever order they happen to run.
 */
const files = import.meta.glob('../fixtures/public/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const textByName: Record<string, string> = {}
for (const [path, text] of Object.entries(files)) {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.html$/, '')
  textByName[base] = text
}

/** Every *.html in test/fixtures/public, without the extension, sorted. */
export function fixtureNames(): string[] {
  return Object.keys(textByName).sort()
}

/** A fresh Document per call. Accepts "name" or "name.html". */
export function loadFixture(name: string): Document {
  const key = name.replace(/\.html$/, '')
  const text = textByName[key]

  if (text === undefined) {
    const available = fixtureNames().join(', ') || 'none captured yet, see test/fixtures/README.md'
    throw new Error(`No fixture named "${name}". Available: ${available}`)
  }

  return new DOMParser().parseFromString(stripStylesheetLinks(text), 'text/html')
}

/**
 * A capture is a whole GitHub page, so it carries <link> tags pointing at
 * githubassets.com. happy-dom resolves those while parsing: left alone it
 * fetches them for real, and with CSS loading disabled it throws a DOMException
 * per tag instead, which buries the test output. Nothing here renders and no
 * parser reads a stylesheet, so the tags are dropped before parsing.
 *
 * Text level rather than DOM level because the throw happens during the parse.
 * A literal `<link` in a comment body would arrive escaped as `&lt;link`, so
 * this only ever matches a real element.
 */
function stripStylesheetLinks(html: string): string {
  return html.replace(/<link\b[^>]*>/gi, '')
}
