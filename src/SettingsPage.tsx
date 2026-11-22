// The plugin's settings page. Every change saves on its own after a short
// pause, as BB's own settings do; a value that fails validation shows why and
// is not sent.
import { experimental_useExperiment, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, Stats } from "./contract";
import { formatTokens } from "./format";
import type { Settings } from "./policy";
import { InlineNumber, SaveIndicator, type SaveStatus, SettingRow, SettingsSection, SwitchRow } from "./settings-ui";
import { ProviderSettings } from "./ProviderSettings";

const SETTINGS_CHANGED = "settings-changed";
/** Long enough to finish typing a number, short enough to feel instant. */
const SAVE_DELAY_MS = 500;
const SAVED_VISIBLE_MS = 2_000;

type Section = "automatic" | "provider" | "advanced";
const SECTION_OF: Record<keyof Settings, Section> = {
  warmIdle: "automatic",
  coldReturn: "automatic",
  threshold: "automatic",
  claudeThreshold: "provider",
  codexThreshold: "provider",
  codexTtlMinutes: "provider",
  idleMarginMinutes: "advanced",
};

const isWhole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
const thresholdValid = (s: Settings) => isWhole(s.threshold, 1, 100);
const marginValid = (s: Settings) => isWhole(s.idleMarginMinutes, 1, 30);

function errorDetail(error: unknown): string | undefined {
  return (error instanceof Error && error.message.replace(/^HTTP \d+: /, "").trim()) || undefined;
}

export function SettingsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const builtinOn = experimental_useExperiment("compactExpiredCache");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ section: Section; status: SaveStatus } | null>(null);
  const draftRef = useRef<Settings | null>(null);
  draftRef.current = draft;
  /** Edited fields not yet saved, so a reload does not overwrite them. */
  const dirty = useRef(new Set<keyof Settings>());
  const lastSection = useRef<Section>("automatic");
  const [edits, setEdits] = useState(0);

  const load = useCallback(async () => {
    try {
      const [settings, nextStats] = await Promise.all([rpc.call("get_settings", {}), rpc.call("stats", {})]);
      const local = draftRef.current;
      const merged = { ...settings };
      if (local !== null) for (const key of dirty.current) Object.assign(merged, { [key]: local[key] });
      setDraft(merged);
      setStats(nextStats);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorDetail(error) ?? "Unknown error");
      toast.error("Could not load Idle Compact settings", { description: errorDetail(error) });
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(SETTINGS_CHANGED, () => {
    void load();
  });

  useEffect(() => {
    if (feedback?.status !== "saved") return;
    const timer = setTimeout(() => setFeedback((now) => (now === feedback ? null : now)), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Save the edited fields once typing pauses and every value is valid. `edits`
  // restarts the pause on each change.
  useEffect(() => {
    const current = draftRef.current;
    if (current === null || dirty.current.size === 0 || !thresholdValid(current) || !marginValid(current)) return;
    const timer = setTimeout(async () => {
      const sent = new Set(dirty.current);
      const patch = Object.fromEntries([...sent].map((key) => [key, current[key]])) as Partial<Settings>;
      const section = lastSection.current;
      setFeedback({ section, status: "saving" });
      try {
        const saved = await rpc.call("update_settings", patch);
        for (const key of sent) if (draftRef.current?.[key] === saved[key]) dirty.current.delete(key);
        setFeedback({ section, status: "saved" });
      } catch (error) {
        setFeedback({ section, status: "error" });
        toast.error("Could not save Idle Compact settings", { description: errorDetail(error) });
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [edits, rpc]);

  const update = <Key extends keyof Settings>(key: Key, value: Settings[Key]) => {
    dirty.current.add(key);
    lastSection.current = SECTION_OF[key];
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));
    setEdits((n) => n + 1);
  };
  const statusFor = (section: Section) => (feedback?.section === section ? feedback.status : undefined);

  if (draft === null) {
    return (
      <div className="max-w-3xl rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {loadError === null ? "Loading settings..." : `Could not load settings: ${loadError}`}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 pb-4">
      <div>
        <SettingsSection title="Automatic compaction" status={statusFor("automatic")}>
          <SwitchRow
            title="Compact idle threads before the cache expires"
            description="Runs a few minutes before the prompt cache runs out, while compaction still reads cached tokens."
            checked={draft.warmIdle}
            onChange={(on) => update("warmIdle", on)}
          />
          <SwitchRow
            title="Compact before sending to an expired cache"
            description="Holds your message while the thread compacts, then sends it."
            checked={draft.coldReturn}
            onChange={(on) => update("coldReturn", on)}
          />
          <SettingRow title="Threshold" description="Smaller threads are left alone.">
            <InlineNumber
              label="Context threshold, percent of the model's window"
              prefix="Compact when context is over"
              suffix={`% of the model's window, and at least ${formatTokens(100_000)} tokens`}
              value={draft.threshold}
              min={1}
              max={100}
              valid={thresholdValid(draft)}
              errorId="idle-compact-threshold-error"
              onChange={(value) => update("threshold", value)}
            />
          </SettingRow>
        </SettingsSection>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          Turn both off to only show the Compact button in the composer.
        </p>
      </div>

      {builtinOn ? (
        <p className="rounded-lg border border-[color:color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color:color-mix(in_oklab,var(--warning)_8%,transparent)] px-3 py-2.5 text-xs text-[color:var(--warning-text)]">
          BB's "Compact expired cache" experiment is on. It handles Claude Code threads when you return to them; this
          plugin still compacts Claude Code threads before expiry.
        </p>
      ) : null}

      <StatsCard stats={stats} />

      <ProviderSettings
        draft={draft}
        codexTtl={stats?.codexTtl ?? null}
        status={statusFor("provider")}
        update={update}
      />

      <details className="rounded-lg border border-border px-4 py-3">
        <summary className="cursor-pointer rounded text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Advanced settings
          <span className="float-right">
            <SaveIndicator status={statusFor("advanced")} />
          </span>
        </summary>
        <div className="mt-3">
          <InlineNumber
            label="Minutes before the cache expires"
            prefix="Compact"
            suffix="minutes before the cache expires"
            value={draft.idleMarginMinutes}
            min={1}
            max={30}
            valid={marginValid(draft)}
            errorId="idle-compact-margin-error"
            onChange={(value) => update("idleMarginMinutes", value)}
          />
        </div>
      </details>
    </div>
  );
}

function StatsCard({ stats }: { stats: Stats | null }) {
  const cells: [string, string][] = [
    ["Compactions", stats === null ? "-" : String(stats.compactions)],
    ["Tokens not re-read", stats === null ? "-" : formatTokens(stats.tokensNotReRead)],
    ["Before expiry / on return", stats === null ? "-" : `${stats.beforeExpiry} / ${stats.onReturn}`],
  ];
  return (
    <section aria-labelledby="idle-compact-stats-heading">
      <h2 id="idle-compact-stats-heading" className="mb-2 text-sm font-medium text-foreground">
        Last 30 days
      </h2>
      <dl className="grid grid-cols-3 rounded-lg border border-border bg-card">
        {cells.map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse border-border px-4 py-3 [&+&]:border-l">
            <dt className="text-2xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
