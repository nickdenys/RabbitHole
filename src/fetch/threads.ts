/**
 * Transport for GitHub's deferred thread endpoint, and nothing else.
 *
 * A resolved thread is collapsed to a stub: the page carries its file, its ids
 * and a `data-deferred-content-url`, and none of its comments. This module
 * turns a list of those URLs into their HTML. It does not parse, it does not
 * decide, and it never touches the page. B3 owns everything after the text.
 *
 * **Nothing here throws.** A dead thread yields null and the rest keep coming,
 * because one failed request must never empty a worklist.
 *
 * **Nothing leaves the page's origin.** The URLs arrive off a page attribute,
 * and the one module that turns page text into requests is where that text
 * stops being trusted. See `allowedUrl`.
 */

/**
 * The cap from [[Design decisions]]. Six in flight at once, and a caller asking
 * for more gets six.
 *
 * The number is a courtesy to GitHub rather than a measured optimum: a pull
 * request with 97 collapsed threads is one page load away from 97 requests, and
 * the browser would happily start them all.
 */
export const MAX_CONCURRENCY = 6

export interface FetchOptions {
  /** In flight at once. Defaults to `MAX_CONCURRENCY`, clamped to it, min 1. */
  concurrency?: number
  /** The engine's, tripped on navigation. Aborting ends the iteration. */
  signal?: AbortSignal
}

export interface ThreadHtml {
  /** The URL as it was given, so a caller can match a result to its thread. */
  url: string
  /** The fragment, or null for anything that did not come back as 2xx HTML. */
  html: string | null
}

/**
 * Fetch each URL and yield results **as they arrive, not in input order**, so
 * the panel fills progressively instead of blocking on the slowest thread.
 *
 * The request carries no headers at all. **Verified 21 August 2026** against
 * `leynos/cuprum#234` from a github.com page: five header variants (none,
 * `Accept: text/html`, `Accept: text/fragment+html`, a Turbo-Frame pair, and
 * `X-Requested-With`) all returned the same 200 and a byte identical 34,197
 * character body. Only the response's own content-type changed. See
 * [[DOM reference]].
 *
 * `credentials: 'same-origin'` is what makes a private repo work with no token.
 * It is not needed for a public one, which returns the same body with
 * credentials omitted, so this line exists for PR 590 and not for the fixtures.
 *
 * Aborting stops the queue: nothing further is started, in flight results are
 * dropped rather than yielded, and the iteration ends. It does not throw, so a
 * `for await` over it on a page being torn down simply stops.
 */
export async function* fetchThreadHtml(
  urls: string[],
  opts: FetchOptions = {},
): AsyncGenerator<ThreadHtml, void, undefined> {
  const { signal } = opts
  const limit = Math.max(1, Math.min(opts.concurrency ?? MAX_CONCURRENCY, MAX_CONCURRENCY))

  let next = 0
  const inFlight = new Set<Promise<Settled>>()

  const start = (url: string): void => {
    const settled: Promise<Settled> = fetchOne(url, signal).then((html) => ({
      url,
      html,
      promise: settled,
    }))
    inFlight.add(settled)
  }

  while (next < urls.length || inFlight.size > 0) {
    if (signal?.aborted) return

    while (inFlight.size < limit && next < urls.length) start(urls[next++])

    const done = await Promise.race(inFlight)
    inFlight.delete(done.promise)

    // Checked again after the await: a navigation during a request means the
    // page these belong to is gone, and yielding into it is worse than losing
    // the response.
    if (signal?.aborted) return

    yield { url: done.url, html: done.html }
  }
}

/**
 * Its own promise, so the winner of the race can be removed from the set.
 * `Promise.race` reports the value, not which promise produced it.
 */
interface Settled extends ThreadHtml {
  promise: Promise<Settled>
}

/**
 * One request, and every way it can fail flattened to null.
 *
 * The status is checked rather than the body: a wrong thread id answers 404
 * with a 9 character `Not Found`, verified 21 August 2026, which is a perfectly
 * parseable document and describes nothing.
 */
async function fetchOne(url: string, signal?: AbortSignal): Promise<string | null> {
  if (!allowedUrl(url)) return null

  try {
    const res = await fetch(url, { credentials: 'same-origin', signal })
    if (!res.ok) return null
    return await res.text()
  } catch {
    // Network error, an abort, or a body that could not be read. All three mean
    // the same thing to a worklist: this thread could not be read, say so.
    return null
  }
}

/**
 * Whether this URL may become a request at all: the page's own path, or an
 * absolute URL on the page's own origin.
 *
 * The URL comes off a `data-deferred-content-url` attribute, and everything
 * else read off the page is treated as untrusted text, so the one value that
 * turns into a request gets the same suspicion. On every page GitHub has
 * served it is a bare path (`/owner/repo/pull/590/threads/…`, see
 * [[DOM reference]]), so nothing real is ever refused; anything else would aim
 * this module's fetch wherever the attribute said. `same-origin` credentials
 * already keep the session cookie at home, so what the guard adds is that the
 * request itself stays there too, and a refused URL reads as a failed fetch,
 * which to a worklist it is.
 *
 * A scheme-relative `//host/path` fails the first test on purpose: it is an
 * absolute URL wearing a path's clothes. `data:` and `javascript:` parse with
 * an origin of `"null"`, which matches no page's.
 */
function allowedUrl(url: string): boolean {
  if (url.startsWith('/') && !url.startsWith('//')) return true

  try {
    return new URL(url).hostname.endsWith('github.com')
  } catch {
    // Neither a path nor a parseable absolute URL. GitHub writes no such
    // attribute, and guessing at what it resolves to is the guard not guarding.
    return false
  }
}
