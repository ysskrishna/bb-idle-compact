# Screenshot and recording provenance

These assets are browser captures of Idle Compact running inside a real,
disposable BB 0.50.1 instance on macOS (the isolated scratch server in
[docs/development.md](../development.md)). The plugin is pre-release code with
manifest version `0.1.0`. The data is one disposable Codex thread (GPT-6.1 Terra)
in a scratch "Payments service" project that printed a synthetic, randomly
generated ledger to fill its context. No real conversations are published.

To make the states appear in minutes, the capture used a short Codex cache
lifetime (12 and then 2 minutes) and a 1-minute margin, set through the settings
RPC. The defaults are "Learn automatically" (30 minutes to start) and 5 minutes.

- `idle-compact-demo.gif`: two continuous recordings of the same thread, joined
  with one cut, resampled to ten frames per second from timestamped page
  screenshots and scaled to 900 px wide. Dark theme, motion on. The first part
  shows "Auto-compacts in 8m" and its tooltip. The second part, recorded about
  twelve minutes later after the context was filled again, shows the expired pill
  with its pulsing dot and tooltip, a click, "Compacting 122K...", and
  "Compacted 122K → 19K". It is not an AI-generated animation or a
  reconstructed interface.
- `composer-*-light.png`, `composer-scheduled-dark.png`,
  `composer-expired-tooltip-dark.png`: screenshots at 2x pixel density cropped
  to the thread composer. `composer-held-message-light.png` shows a message
  sent after the cache expired, held by Idle Compact while the thread compacts.
- `composer-compacting-dark.png` and `composer-compacted-dark.png`: frames from
  the GIF's recording at 1x, cropped to the composer. There is no light-theme
  capture of the "Compacted" pill.
- `settings-light.png`, `settings-dark.png`: the plugin's settings page at 2x
  with both disclosures open and BB's `compactExpiredCache` experiment on. The
  stats are the three real compactions from the demo thread (one before expiry,
  one on return, one by the Compact button), whose log was copied into a fresh
  scratch server for this capture.
- `marketplace-overview.png`: a clearly separate composite joining two real
  composer screenshots side by side (the scheduled tooltip in light, the
  expired tooltip in dark), scaled to 2,000 px wide. It does not depict one
  application window.

BB's context meter sits in the composer footer; BB places plugin composer
actions next to the microphone and send buttons. The live desktop can look
different because of its width, theme, model, and thread states.
