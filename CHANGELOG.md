# Changelog

## Unreleased

- Security: the plot legend is now built from DOM text nodes instead of
  `innerHTML`. The overlay name it shows comes from a loaded file (the `.s1p`
  filename, or `overlay.name` in a session JSON), so a crafted file could run
  script in the page.
- Settings loaded from a session file or from localStorage are validated
  against an allowlist (known keys, known enum values, clamped numbers). A
  session with an unexpected `theme` value used to throw while building the
  Settings panel on the next load, which left the plot blank until site data
  was cleared.
- Loading a session now refreshes the Settings form, so the controls show the
  values the session applied instead of the ones from before the load.

## v0.4.2

- About page: *About* at the foot of the sidebar (or `#about` in the URL) swaps the plot
  and markers for a short page on what the tool does, the flow, supported
  hardware (drawn from `models.js`), known limits and what is next. *Back to
  plots* returns. Same card layout as fox-bench.

## v0.4.1

- Settings: checkbox rows laid out properly (box at left, text beside it,
  SWR threshold input compact); group headings spaced.

## v0.4.0 — recording

- Recording section: one Start/Stop toggle logs every sweep (single or
  continuous) and every CW-meter reading with timestamps, in any view. A
  pulsing REC badge with the count sits in the top bar; the page warns before
  closing with an unsaved recording.
- Exports: waterfall matrix CSV (timestamps down, frequencies across, |S11|
  dB — the plot as data; also |S21|), sweep log CSV (long format, one row per
  point with dB/phase/SWR/R/X), CW log CSV (one row per reading), and the
  whole recording as JSON.

## v0.3.4 — save hang

- `save N` over USB was seen to freeze an F V3 (fw 0.5.8) until power-cycled.
  The Save button now confirms first (recommending the device's own CAL →
  SAVE menu on the V3), probes the console with `version` afterwards, and if
  the device is silent says so and disables the controls instead of letting
  every later command time out.
- Diagnostics: the download button is disabled while collecting and a failed
  collection produces its own JSON, so an old sample can't be downloaded by
  mistake.

## v0.3.3 — don't freeze the device

- The page no longer sends `pause` at connect. The first hardware session
  showed `scan` works while the device sweeps, and a paused device cannot
  measure calibration standards (the probable cause of a bad SOLT and a
  shifted resonance). *Freeze device screen* is now a toggle in the top bar.
- Calibration: each step first resumes the device if frozen, the section
  shows which device sweep the calibration is being captured on, and the
  guidance says to run a page sweep first so ranges match. Badge wording is
  "sent by page" — the page cannot read the device's cal state.
- The device sweep is restored on disconnect only if the page changed it.

## v0.3.2 — first hardware session (NanoVNA-F V3, fw 0.5.8)

- `cwfreq` unit is read from the device's `help` text (Hz on the F V3; the
  page previously sent kHz). Fallback by model.
- The device's own sweep is recorded at connect and restored at disconnect,
  because `scan` replaces it. Shown in the Sweep section.
- Scan timeout scales with point count (801 pts measured at 4.8 s).
- Status line uses the model name from `info` (`version` alone is `0.5.8`).
- Demo device now mimics the real replies: bare version, `info` layout,
  `help` listing, trailing space on scan lines, ~5.5 ms/point timing, and
  `scan` rewriting the device sweep.
- PROTOCOL.md: verified-on-hardware section added from the diagnostic sample.

## v0.3.1

- Sidebar is resizable: drag the edge (double-click to reset); width remembered.
- edelay input placeholder no longer cut off.
- Marker sync: sets the device sweep to match the page first (device marker
  indices refer to the device's sweep), sends only as many markers as the
  model has (4), labels the rest "(page)" in the table, and reports a device
  rejection on a status line instead of continuing.
- The NanoVNA API now detects error replies (usage lines, "invalid", "out of
  range", …) for marker, trace, cal, recall, edelay, cwfreq and pwm, since the
  console protocol never signals errors itself. The demo device rejects bad
  marker ids/indices and unknown trace formats so this path is tested.

## v0.3.0 — front panel

- Fixes: accordion headers collapse on second click; demo mode is obvious
  (highlighted button, "Demo mode (click to leave)"); Single / Continuous show
  a running state (Continuous becomes an amber "Stop" with a pulse); markers
  table moved under the plot at full width; console log download with
  commands-only or commands+replies modes.
- Calibration section: SOLT step-through, done/reset/on/off, save/recall
  slots, edelay; cal badge in the top bar.
- Sweep: "Use device sweep" and "Read device data" readback.
- CW meter view with big-number |S11| / SWR / R + jX / |S21|.
- Markers: peak finder, phase column, "Send to device".
- Beep rules (after sweep, below SWR threshold) with optional browser tone.
- Settings: device screen brightness, mirror view to device trace 0, overlay
  toggle.
- Session save/load (JSON) and Touchstone overlay (.s1p/.s2p, RI/MA/DB).
- Device tools: touch calibration, touch test, resolution.
- Continuous and CW readings log a one-line summary instead of the full dump.

## v0.2.0 — workability

- Split the single file into ES modules: `js/device/` (reusable NanoVNA
  API mirroring nvnapython), `js/plot/`, `js/ui/`, `css/`.
- New layout: docked accordion sidebar, plot on a dark "screen" surface,
  full-width resizable console drawer with command history and collapsed
  long replies.
- Own theme: dark bench-instrument default, light option.
- Settings section: theme, trace colour scheme (instrument yellow/cyan or
  blue/amber), waterfall palette (Viridis default, Inferno, Turbo, Classic
  SDR, Grey), waterfall colour floor, Z₀, raw-byte echo. Persisted.
- Markers raised to six; the table moved into the sidebar.
- Diagnostics summary reformatted for the sidebar width.
- Local development now needs an http server (module scripts); documented.

## v0.1.0 — first release

- Web Serial driver for the NanoVNA console: `ch>` framing with doubled-prompt
  handling, echo stripping, no-prompt and binary paths. Rules ported from
  nanoVNA_python.
- Model envelopes for F V2, F V3, H4, generic; detection from `version`/`info`
  with manual override.
- Single and continuous `scan` with validate-and-retry.
- Views: |S11|, |S21|, SWR, phase, Smith chart, waterfall. Hold trace.
- Up to four markers with |S11|, SWR, R, X, |S21|; minimum-SWR finder.
- Z₀ input.
- Exports: CSV (derived columns), .s1p, .s2p, plot PNG, device screenshot.
- Diagnostics sample → JSON.
- Demo device (simulated F V3) that produces the real byte framing.

Built against the demo device only. See *Not yet verified on hardware* in
PROTOCOL.md.
