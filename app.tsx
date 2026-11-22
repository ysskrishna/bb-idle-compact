// Idle Compact frontend: a pill in the thread composer that shows when the
// thread will be compacted, when its prompt cache expired, and what a
// compaction saved; plus the plugin's settings page.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CompactChip } from "./src/CompactChip";
import { SettingsPage } from "./src/SettingsPage";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "idle-compact",
    scopes: ["thread"],
    actions: [{ id: "compact", component: CompactChip }],
  });
  app.slots.settingsSection({ id: "settings", component: SettingsPage });
});
