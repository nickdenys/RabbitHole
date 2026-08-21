import type { HideMode } from '../hide/policy'

interface SettingsProps {
  mode: HideMode
  onChange: (mode: HideMode) => void
}

/**
 * The one setting worth a control, which is how much the extension may hide.
 *
 * The sort axis and the drawer's open state are remembered too, but they are
 * changed by using the drawer rather than by a settings screen, so this holds
 * the mode alone rather than becoming a page of everything stored.
 *
 * Both options are always spelled out, including the measurement, because the
 * choice is not "more or less tidy": aggressive mode hides threads a person has
 * replied to, and a reader deciding that deserves the number before the click
 * rather than after it. See [[Design decisions]].
 */
export function Settings({ mode, onChange }: SettingsProps) {
  return (
    <details class="settings">
      <summary class="settings-head">Hide mode: {mode === 'safe' ? 'Safe' : 'Aggressive'}</summary>

      <Choice
        value="safe"
        mode={mode}
        onChange={onChange}
        label="Safe"
        note="Hide a CodeRabbit thread only when every comment in it is CodeRabbit's. A reply from a person keeps it in the timeline."
      />

      <Choice
        value="aggressive"
        mode={mode}
        onChange={onChange}
        label="Aggressive"
        note="Hide every thread CodeRabbit started, replies and all. On one public pull request that was 29 of 36 threads, so the conversation goes with the review."
      />
    </details>
  )
}

/**
 * Radios rather than a checkbox, so both modes carry their own sentence. A
 * checkbox can only describe the state it is not in.
 */
function Choice({
  value,
  mode,
  onChange,
  label,
  note,
}: SettingsProps & { value: HideMode; label: string; note: string }) {
  return (
    <label class="setting">
      <input
        type="radio"
        name="cr-hide-mode"
        value={value}
        checked={mode === value}
        onChange={() => onChange(value)}
      />
      <span>
        <span class="setting-label">{label}</span>
        <span class="setting-note">{note}</span>
      </span>
    </label>
  )
}
