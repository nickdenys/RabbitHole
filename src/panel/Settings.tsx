import type { HideMode } from '../hide/policy'
import { THEME_LABELS, THEME_NOTES, type Theme } from './theme'

interface SettingsProps {
  mode: HideMode
  onMode: (mode: HideMode) => void
  theme: Theme
  onTheme: (theme: Theme) => void
}

/**
 * The two settings worth a control: how much the extension may hide, and which
 * palette it draws itself in.
 *
 * The sort axis, its direction and the drawer's open state are remembered too,
 * but they are changed by using the drawer rather than by a settings screen, so
 * this holds those two alone rather than becoming a page of everything stored.
 *
 * The hide mode comes first because it is the one that changes the page. The
 * theme changes nothing but this panel, and a reader who never opens this sheet
 * never needs it: auto is what the panel did before the setting existed.
 */
export function Settings({ mode, onMode, theme, onTheme }: SettingsProps) {
  return (
    <>
      <fieldset class="settings">
        <legend class="settings-head">
          Hide mode: <span class="settings-value">{mode === 'safe' ? 'Safe' : 'Aggressive'}</span>
        </legend>

        {/*
         * Both options are always spelled out, including the measurement,
         * because the choice is not "more or less tidy": aggressive mode hides
         * threads a person has replied to, and a reader deciding that deserves
         * the number before the click rather than after it. See
         * [[Design decisions]].
         */}
        <Choice
          name="cr-hide-mode"
          value="safe"
          on={mode === 'safe'}
          onChoose={() => onMode('safe')}
          label="Safe"
          note="Hide a CodeRabbit thread only when every comment in it is CodeRabbit's. A reply from a person keeps it in the timeline."
        />

        <Choice
          name="cr-hide-mode"
          value="aggressive"
          on={mode === 'aggressive'}
          onChoose={() => onMode('aggressive')}
          label="Aggressive"
          note="Hide every thread CodeRabbit started, replies and all. On one public pull request that was 29 of 36 threads, so the conversation goes with the review."
        />
      </fieldset>

      <fieldset class="settings">
        <legend class="settings-head">
          Theme: <span class="settings-value">{THEME_LABELS[theme]}</span>
        </legend>

        {(Object.keys(THEME_LABELS) as Theme[]).map((option) => (
          <Choice
            key={option}
            name="cr-theme"
            value={option}
            on={theme === option}
            onChoose={() => onTheme(option)}
            label={THEME_LABELS[option]}
            note={THEME_NOTES[option]}
          />
        ))}
      </fieldset>
    </>
  )
}

/**
 * Radios rather than a checkbox, so every option carries its own sentence. A
 * checkbox can only describe the state it is not in.
 *
 * The whole card is the label, so the sentence is part of the target rather
 * than text beside a 14 pixel circle.
 *
 * `name` is passed in rather than derived, because two groups of these now
 * share one sheet and radios sharing a name would be one group: picking a theme
 * would clear the hide mode.
 */
function Choice({
  name,
  value,
  on,
  onChoose,
  label,
  note,
}: {
  name: string
  value: string
  on: boolean
  onChoose: () => void
  label: string
  note: string
}) {
  return (
    <label class={on ? 'setting on' : 'setting'}>
      <input type="radio" name={name} value={value} checked={on} onChange={onChoose} />
      <span class="setting-mark" aria-hidden="true" />
      <span class="setting-text">
        <span class="setting-label">{label}</span>
        <span class="setting-note">{note}</span>
      </span>
    </label>
  )
}
