// "Per provider": threshold overrides and the Codex cache lifetime.
import type { Stats } from "./contract";
import { formatDuration } from "./format";
import type { Settings } from "./policy";
import { SaveIndicator, type SaveStatus, SettingsSelect } from "./settings-ui";

const THRESHOLD_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const LIFETIME_STEPS = [5, 15, 30, 60, 120, 360, 720, 1440];

/** Fixed steps, plus the stored value when it is not one of them. */
function withCurrent(steps: readonly number[], current: number): number[] {
  return current === 0 || steps.includes(current) ? [...steps] : [...steps, current].sort((a, b) => a - b);
}

function learnedLabel(codexTtl: Stats["codexTtl"]): string {
  if (codexTtl.learnedMinutes === null) {
    return `Learned: 30 min default, ${codexTtl.longGapHits} of ${codexTtl.longGapHitsNeeded} long-gap hits seen`;
  }
  return `Learned: ${formatDuration(codexTtl.learnedMinutes)} from ${codexTtl.longGapHits} long-gap hits`;
}

export function ProviderSettings({
  draft,
  codexTtl,
  status,
  update,
}: {
  draft: Settings;
  codexTtl: Stats["codexTtl"] | null;
  status: SaveStatus | undefined;
  update: <Key extends keyof Settings>(key: Key, value: Settings[Key]) => void;
}) {
  const threshold = (key: "claudeThreshold" | "codexThreshold", label: string) => (
    <>
      <label htmlFor={`idle-compact-${key}`} className="text-foreground">
        {label}
      </label>
      <SettingsSelect
        id={`idle-compact-${key}`}
        value={draft[key]}
        onChange={(event) => update(key, Number(event.target.value))}
      >
        <option value={0}>Use global ({draft.threshold}%)</option>
        {withCurrent(THRESHOLD_STEPS, draft[key]).map((step) => (
          <option key={step} value={step}>
            {step}%
          </option>
        ))}
      </SettingsSelect>
    </>
  );
  return (
    <details open className="rounded-lg border border-border px-4 py-3">
      <summary className="cursor-pointer rounded text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Per provider
        <span className="float-right">
          <SaveIndicator status={status} />
        </span>
      </summary>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2.5 text-xs">
        {threshold("claudeThreshold", "Claude Code threshold")}
        {threshold("codexThreshold", "Codex threshold")}
        <label htmlFor="idle-compact-codex-ttl" className="text-foreground">
          Codex cache lifetime
          {codexTtl === null ? null : <span className="block text-muted-foreground">{learnedLabel(codexTtl)}</span>}
        </label>
        <SettingsSelect
          id="idle-compact-codex-ttl"
          value={draft.codexTtlMinutes}
          onChange={(event) => update("codexTtlMinutes", Number(event.target.value))}
        >
          <option value={0}>Learn automatically</option>
          {withCurrent(LIFETIME_STEPS, draft.codexTtlMinutes).map((minutes) => (
            <option key={minutes} value={minutes}>
              {formatDuration(minutes)}
            </option>
          ))}
        </SettingsSelect>
      </div>
    </details>
  );
}
