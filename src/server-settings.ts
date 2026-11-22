// Settings live in plugin storage and are edited on the plugin's own settings
// page. A stored value that no longer validates falls back to its default
// without discarding the others.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { settingsSchema } from "./contract.js";
import { DEFAULT_SETTINGS, type Settings } from "./policy.js";

const SETTINGS_KEY = "settings";

type Field = keyof Settings;
const shape = settingsSchema.shape as Record<Field, z.ZodType>;

export function parseStoredSettings(stored: unknown): Settings {
  const source = stored !== null && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const values = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Field[]) {
    const parsed = shape[key].safeParse(source[key]);
    if (parsed.success) Object.assign(values, { [key]: parsed.data });
  }
  return values;
}

export function createSettingsStore(bb: BbPluginApi) {
  return {
    async get(): Promise<Settings> {
      return parseStoredSettings(await bb.storage.kv.get(SETTINGS_KEY));
    },
    /** Validates the patch as a whole; an invalid value rejects the update. */
    async update(patch: Partial<Settings>): Promise<Settings> {
      const current = parseStoredSettings(await bb.storage.kv.get(SETTINGS_KEY));
      const next = settingsSchema.parse({ ...current, ...patch });
      await bb.storage.kv.set(SETTINGS_KEY, next);
      return next;
    },
  };
}
