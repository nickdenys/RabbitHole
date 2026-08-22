import { run } from './bootstrap'

/**
 * The bootstrap, and nothing else.
 *
 * Everything that used to be here (detection, debouncing, Turbo, the caching of
 * the last verdict) moved into `engine.ts`, where it can be tested against a
 * document that is not the global one. Starting and stopping the engine as the
 * toolbar's toggle flips moved into `bootstrap.ts` for the same reason. What is
 * left is the one line that says which document the engine reads and where its
 * state goes.
 *
 * **One evaluation per hard load, and then it outlives every navigation.** The
 * manifest matches all of github.com, so this runs on whatever page the reader
 * arrives at; from there GitHub moves with Turbo and the module is never
 * evaluated again, including on the way to pull requests it has never seen and
 * to pages that are not pull requests at all. Nothing here watches for that:
 * the engine asks which page it is on at the top of every pass, and
 * `updatePanel` rebuilds its host whenever Turbo has taken the body the last
 * one was appended to.
 */
run(document)
