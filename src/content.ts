import { startEngine } from './engine'
import { updatePanel } from './panel/mount'

/**
 * The bootstrap, and nothing else.
 *
 * Everything that used to be here (detection, debouncing, Turbo, the caching of
 * the last verdict) moved into `engine.ts`, where it can be tested against a
 * document that is not the global one. What is left is the one line that says
 * which document the engine reads and where its state goes.
 *
 * **One evaluation per hard load, and then it outlives every navigation.** The
 * manifest matches all of github.com, so this runs on whatever page the reader
 * arrives at; from there GitHub moves with Turbo and the module is never
 * evaluated again, including on the way to pull requests it has never seen and
 * to pages that are not pull requests at all. Nothing here watches for that:
 * the engine asks which page it is on at the top of every pass, and
 * `updatePanel` rebuilds its host whenever Turbo has taken the body the last
 * one was appended to.
 *
 * Nothing calls the engine's teardown, which is the point. There is no moment
 * in a browsing session where the extension should stop watching, so the
 * teardown exists for the tests and for the day one is needed, and leaving a
 * pull request is an ordinary pass that publishes `not-pr` rather than a stop.
 */
startEngine(document, updatePanel)
