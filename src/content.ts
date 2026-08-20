import { startEngine } from './engine'
import { updatePanel } from './panel/mount'

/**
 * The bootstrap, and nothing else.
 *
 * Everything that used to be here (detection, debouncing, Turbo, the caching of
 * the last verdict) moved into `engine.ts`, where it can be tested against a
 * document that is not the global one. What is left is the one line that says
 * which document the engine reads and where its state goes.
 */
startEngine(document, updatePanel)
