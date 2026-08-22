import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import type { HideMode } from '../hide/policy'
import { THEME_LABELS, THEME_NOTES, type Theme } from './theme'

interface SettingsProps {
  mode: HideMode
  onMode: (mode: HideMode) => void
  theme: Theme
  onTheme: (theme: Theme) => void
  autoLoadMore: boolean
  onAutoLoadMore: (autoLoadMore: boolean) => void
}

/**
 * Which row is open. A single value rather than one flag per row, because
 * only one is ever open: opening a second is the same click as closing the
 * first, so there is never a state where two hold their options out at once.
 */
type SettingKey = 'hide' | 'load' | 'theme'

/**
 * The three settings worth a control: how much the extension may hide,
 * whether it loads hidden findings for the reader, and which palette it draws
 * itself in.
 *
 * Each is a row that opens on its own click rather than a fieldset spelled
 * out in full: three full radio cards with a paragraph apiece used to scroll
 * the sheet past 1500px, so the resting page is now three lines a reader can
 * scan for the current value, and the explanations open one row at a time
 * rather than all at once. See [[Design decisions]].
 *
 * The sort axis, its direction and the drawer's open state are remembered
 * too, but they are changed by using the drawer rather than by a settings
 * screen, so this holds those three alone rather than becoming a page of
 * everything stored. Which row is open is not among them either: it is not a
 * preference, just where the reader's click last landed, so it resets the
 * next time this sheet is opened.
 */
export function Settings({
  mode,
  onMode,
  theme,
  onTheme,
  autoLoadMore,
  onAutoLoadMore,
}: SettingsProps) {
  const [open, setOpen] = useState<SettingKey | null>(null)

  function toggle(key: SettingKey): void {
    setOpen((current) => (current === key ? null : key))
  }

  return (
    <div class="settings">
      <Row
        label="Hide mode"
        value={mode === 'safe' ? 'Safe' : 'Aggressive'}
        open={open === 'hide'}
        onToggle={() => toggle('hide')}
      >
        {/*
         * Both options are spelled out in full rather than left as "more or
         * less tidy", because aggressive mode hides threads a person has
         * replied to, and a reader deciding that deserves to know what it
         * costs before the click rather than after it.
         */}
        <Choice
          name="cr-hide-mode"
          value="safe"
          on={mode === 'safe'}
          onChoose={() => onMode('safe')}
          label="Safe"
          note="Hides a thread only when every comment in it is from CodeRabbit. A human reply keeps it visible."
        />

        <Choice
          name="cr-hide-mode"
          value="aggressive"
          on={mode === 'aggressive'}
          onChoose={() => onMode('aggressive')}
          label="Aggressive"
          note="Hides every thread CodeRabbit started, even ones with a human reply, so a person's comments can disappear too."
        />
      </Row>

      <Row
        label="Load hidden findings"
        value={autoLoadMore ? 'On' : 'Off'}
        open={open === 'load'}
        onToggle={() => toggle('load')}
      >
        <Choice
          name="cr-auto-load"
          value="on"
          on={autoLoadMore}
          onChoose={() => onAutoLoadMore(true)}
          label="On"
          note="Automatically clicks GitHub's “Load more…” until every CodeRabbit finding is on the page."
        />

        <Choice
          name="cr-auto-load"
          value="off"
          on={!autoLoadMore}
          onChoose={() => onAutoLoadMore(false)}
          label="Off"
          note="Leaves GitHub's pagination alone. You'll still see a warning if findings are missing."
        />
      </Row>

      <Row
        label="Theme"
        value={THEME_LABELS[theme]}
        open={open === 'theme'}
        onToggle={() => toggle('theme')}
      >
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
      </Row>
    </div>
  )
}

/**
 * One row of the collapsed list: a header naming the setting and its current
 * value, and the options underneath once a reader asks for them.
 *
 * The options exist in the DOM only while the row is open, rather than being
 * merely hidden by CSS, so a closed row costs nothing to render and holds
 * nothing a reader could tab into.
 */
function Row({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string
  value: string
  open: boolean
  onToggle: () => void
  children: ComponentChildren
}) {
  return (
    <div class="settings-row">
      <button
        type="button"
        class="settings-row-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span class="settings-row-label">{label}</span>
        <span class="settings-row-value">{value}</span>
        <span class="chevron" aria-hidden="true">
          {open ? '▼' : '▶'}
        </span>
      </button>

      {open && <div class="settings-row-body">{children}</div>}
    </div>
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
