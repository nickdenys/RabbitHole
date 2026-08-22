/**
 * Which palette the panel draws itself in.
 *
 * `auto` is what the panel has always done and is still the default: every
 * token is a light and dark pair, and the system's setting picks the half to
 * use. The other two pin it, for the reader whose editor is dark all day on a
 * system that is not, or who reads GitHub in light on a machine set to dark.
 *
 * A theme is about this panel and nothing else. It is not read from GitHub's
 * own `data-color-mode`, because that is a setting on the page rather than a
 * choice about the drawer, and a reader who wants the two to agree can say so
 * here in one click.
 */
export type Theme = 'auto' | 'light' | 'dark'

/**
 * What the settings sheet calls each one, in the order it offers them.
 *
 * Also the vocabulary `prefs.ts` validates against, so a theme that exists in
 * one place and not in the other cannot become a stored preference the panel
 * has no rule for.
 */
export const THEME_LABELS: Record<Theme, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
}

/**
 * The sentence under each option, which says what it does rather than repeating
 * its name.
 *
 * `auto` gets the longer one because it is the only choice whose result is not
 * in its label: it changes underneath the reader, while the page is open, and a
 * panel that went dark at sunset without warning is worth one clause.
 */
export const THEME_NOTES: Record<Theme, string> = {
  auto: "Follow the system's light or dark setting, and change with it while the page is open.",
  light: 'Always the light palette, whatever the system is set to.',
  dark: 'Always the dark palette, whatever the system is set to.',
}
