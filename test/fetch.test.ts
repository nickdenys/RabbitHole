import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_CONCURRENCY, fetchThreadHtml } from '../src/fetch/threads'

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Call {
  url: string
  init: RequestInit | undefined
  resolve: (html: string) => void
  reject: (err: unknown) => void
  fail: (status: number) => void
}

/**
 * A `fetch` nothing settles on its own, so a test decides when each request
 * finishes and in which order. Concurrency is the only thing this module has to
 * get right, and it is invisible unless requests can be held open.
 */
function stubFetch(): { calls: Call[]; peak: () => number; live: () => number } {
  const calls: Call[] = []
  let live = 0
  let peak = 0

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    live++
    peak = Math.max(peak, live)

    return new Promise<Response>((resolve, reject) => {
      const settle = (fn: () => void) => {
        live--
        fn()
      }

      calls.push({
        url,
        init,
        resolve: (html) => settle(() => resolve(response(200, html))),
        fail: (status) => settle(() => resolve(response(status, 'Not Found'))),
        reject: (err) => settle(() => reject(err)),
      })
    })
  })

  return { calls, peak: () => peak, live: () => live }
}

function response(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response
}

const urls = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `/owner/repo/pull/1/threads/${i}?rendering_on_files_tab=false`)

/** Let the generator's microtasks run so its requests actually start. */
const settle = () => new Promise((r) => setTimeout(r, 0))

/**
 * Drain an iterable into an array in arrival order, while a driver settles the
 * stubbed requests. Both halves have to run at once, which is the point of the
 * module.
 */
async function collect(
  it: AsyncIterable<{ url: string; html: string | null }>,
  drive: (helpers: ReturnType<typeof stubFetch>) => Promise<void>,
  helpers: ReturnType<typeof stubFetch>,
): Promise<{ url: string; html: string | null }[]> {
  const seen: { url: string; html: string | null }[] = []
  const drained = (async () => {
    for await (const result of it) seen.push(result)
  })()

  await drive(helpers)
  await drained
  return seen
}

describe('fetchThreadHtml', () => {
  it('never has more than six requests in flight, whatever the caller asks for', async () => {
    const helpers = stubFetch()
    const it = fetchThreadHtml(urls(20), { concurrency: 50 })

    const results = await collect(
      it,
      async ({ calls }) => {
        // Answer requests one at a time, checking the cap between each, so the
        // assertion covers the refill and not just the first burst.
        for (let i = 0; i < 20; i++) {
          await settle()
          expect(helpers.live()).toBeLessThanOrEqual(MAX_CONCURRENCY)
          calls[i].resolve(`<div>${i}</div>`)
        }
        await settle()
      },
      helpers,
    )

    expect(helpers.peak()).toBe(MAX_CONCURRENCY)
    expect(results).toHaveLength(20)
  })

  it('defaults to six, and one is a floor rather than an error', async () => {
    const six = stubFetch()
    void fetchThreadHtml(urls(10)).next()
    await settle()
    expect(six.peak()).toBe(MAX_CONCURRENCY)

    vi.unstubAllGlobals()

    const one = stubFetch()
    void fetchThreadHtml(urls(10), { concurrency: 0 }).next()
    await settle()
    expect(one.peak()).toBe(1)
  })

  it('streams in arrival order, not in input order', async () => {
    const helpers = stubFetch()
    const it = fetchThreadHtml(urls(3), { concurrency: 3 })

    const results = await collect(
      it,
      async ({ calls }) => {
        await settle()
        calls[2].resolve('third')
        await settle()
        calls[0].resolve('first')
        await settle()
        calls[1].resolve('second')
        await settle()
      },
      helpers,
    )

    expect(results.map((r) => r.html)).toEqual(['third', 'first', 'second'])
    // The URL comes back beside the html, which is the only way a caller can
    // match an out of order result to the thread that asked for it.
    expect(results.map((r) => r.url)).toEqual([urls(3)[2], urls(3)[0], urls(3)[1]])
  })

  it('yields null for a rejected request and keeps the queue moving', async () => {
    const helpers = stubFetch()
    const it = fetchThreadHtml(urls(3), { concurrency: 3 })

    const results = await collect(
      it,
      async ({ calls }) => {
        await settle()
        calls[0].reject(new TypeError('Failed to fetch'))
        calls[1].resolve('<div>ok</div>')
        calls[2].resolve('<div>ok</div>')
        await settle()
      },
      helpers,
    )

    expect(results).toHaveLength(3)
    expect(results.filter((r) => r.html === null)).toHaveLength(1)
    expect(results.filter((r) => r.html !== null)).toHaveLength(2)
  })

  it('yields null on a 404 rather than the body it came with', async () => {
    const helpers = stubFetch()
    const it = fetchThreadHtml(urls(1))

    const results = await collect(
      it,
      async ({ calls }) => {
        await settle()
        calls[0].fail(404)
        await settle()
      },
      helpers,
    )

    expect(results).toEqual([{ url: urls(1)[0], html: null }])
  })

  it('sends the session cookie and no headers', async () => {
    const helpers = stubFetch()
    void fetchThreadHtml(urls(1)).next()
    await settle()

    expect(helpers.calls[0].init?.credentials).toBe('same-origin')
    expect(helpers.calls[0].init?.headers).toBeUndefined()
  })

  it('stops the queue on abort, and does not throw', async () => {
    const helpers = stubFetch()
    const controller = new AbortController()
    const it = fetchThreadHtml(urls(20), { signal: controller.signal })

    const seen: unknown[] = []
    const drained = (async () => {
      for await (const result of it) seen.push(result)
    })()

    await settle()
    expect(helpers.calls).toHaveLength(MAX_CONCURRENCY)

    controller.abort()
    // Whatever was in flight when the page went away is dropped, not yielded.
    helpers.calls[0].resolve('<div>too late</div>')
    await drained

    expect(seen).toEqual([])
    expect(helpers.calls).toHaveLength(MAX_CONCURRENCY)
  })

  it('starts nothing when the signal is already aborted', async () => {
    const helpers = stubFetch()
    const controller = new AbortController()
    controller.abort()

    const seen: unknown[] = []
    for await (const result of fetchThreadHtml(urls(5), { signal: controller.signal })) {
      seen.push(result)
    }

    expect(helpers.calls).toHaveLength(0)
    expect(seen).toEqual([])
  })

  it('passes the signal to every request, so an abort reaches the network', async () => {
    const helpers = stubFetch()
    const controller = new AbortController()
    void fetchThreadHtml(urls(1), { signal: controller.signal }).next()
    await settle()

    expect(helpers.calls[0].init?.signal).toBe(controller.signal)
  })

  it('yields nothing for an empty list', async () => {
    const helpers = stubFetch()
    const seen: unknown[] = []
    for await (const result of fetchThreadHtml([])) seen.push(result)

    expect(seen).toEqual([])
    expect(helpers.calls).toHaveLength(0)
  })
})

/**
 * The URLs come off a page attribute, so the transport is where they stop
 * being trusted: a path is the page's own, anything else has to prove it is on
 * the page's origin, and a refusal is a null body with no request made. See
 * `allowedUrl` in `src/fetch/threads.ts`.
 */
describe('the origin guard', () => {
  async function one(url: string): Promise<{ url: string; html: string | null }[]> {
    const seen: { url: string; html: string | null }[] = []
    for await (const result of fetchThreadHtml([url])) seen.push(result)
    return seen
  }

  it('refuses an absolute URL on another origin, without touching the network', async () => {
    const helpers = stubFetch()
    const url = 'https://evil.example/owner/repo/pull/1/threads/9'

    expect(await one(url)).toEqual([{ url, html: null }])
    expect(helpers.calls).toHaveLength(0)
  })

  it('refuses a scheme-relative URL, which is an absolute one in a path\'s clothes', async () => {
    const helpers = stubFetch()
    const url = '//evil.example/owner/repo/pull/1/threads/9'

    expect(await one(url)).toEqual([{ url, html: null }])
    expect(helpers.calls).toHaveLength(0)
  })

  it('refuses what is neither a path nor a parseable URL', async () => {
    const helpers = stubFetch()

    for (const url of ['javascript:alert(1)', 'threads/9', '']) {
      expect(await one(url)).toEqual([{ url, html: null }])
    }
    expect(helpers.calls).toHaveLength(0)
  })

  it('fetches an absolute URL on the page\'s own origin', async () => {
    const helpers = stubFetch()
    vi.stubGlobal('location', { origin: 'https://github.com', href: 'https://github.com/o/r/pull/1' })
    const url = 'https://github.com/o/r/pull/1/threads/9'

    const drained = one(url)
    await settle()
    expect(helpers.calls).toHaveLength(1)
    helpers.calls[0].resolve('<div>ok</div>')

    expect(await drained).toEqual([{ url, html: '<div>ok</div>' }])
  })
})
