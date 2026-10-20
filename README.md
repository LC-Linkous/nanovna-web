# nanoVNA Web

A browser front end for the NanoVNA-F V2 and F V3. Plug the analyzer in over
USB, open the page in Chrome or Edge, click Connect: S11/S21 traces, SWR, Smith
chart, a live waterfall, markers with an R + jX readout, and CSV / Touchstone
export. Nothing to install.

**Use it:** https://lc-linkous.github.io/nanovna-web/

The page has a *Try without hardware* mode with a simulated F V3, so it can be
previewed anywhere.

<p align="center"><img src="media/screenshot.png" alt="nanoVNA Web in demo mode: docked sidebar with sweep controls on the left, |S11| trace with markers on the dark plot surface, device console below" width="900"></p>

This is the browser companion to the
[nanoVNA_python](https://github.com/LC-Linkous/nanoVNA_python) library: same
command set, same model envelopes, same quirks list, no Python needed.

## How it fits together

The NanoVNA exposes a text console over USB (`ch>` prompt, one command per
line). Both tools speak that console; they differ only in what is on the other
end of the cable.

```
                           NanoVNA-F V2 / V3
                     ┌──────────────────────────┐
                     │  console over USB CDC    │
                     │  ch> scan 50000 3e9 801  │
                     │  ch> cal open · data 0 … │
                     └────────────┬─────────────┘
                                  │  same bytes, same commands
                ┌─────────────────┴─────────────────┐
                │                                   │
        Chrome / Edge                           Python
   ┌────────────────────────┐          ┌────────────────────────┐
   │ nanoVNA Web            │          │ nanoVNA_python         │
   │                        │          │                        │
   │ Web Serial API         │          │ pyserial               │
   │   ▼                    │          │   ▼                    │
   │ js/device/             │  mirrors │ nvnapython/            │
   │   shell-link.js  ─ ─ ─ ┼ ─ ─ ─ ─ ─┼ ─  serial framing      │
   │   nanovna.js     ─ ─ ─ ┼ ─ ─ ─ ─ ─┼ ─  NanoVNA class       │
   │   models.js      ─ ─ ─ ┼ ─ ─ ─ ─ ─┼ ─  constants.py        │
   │   ▼                    │          │   ▼                    │
   │ js/plot/  js/ui/       │          │ your script, numpy,    │
   │ live plots, markers,   │          │ matplotlib, automation │
   │ calibration, recording │          │                        │
   └───────────┬────────────┘          └───────────┬────────────┘
               │                                   │
               │   .csv  .s1p / .s2p  .json        │
               └──────────────► ◄──────────────────┘
                     files move between the two
```

Reading it top to bottom:

- **The device doesn't know which one it's talking to.** `scan`, `cal`,
  `marker`, `cwfreq` and the rest are sent as the same strings with the same
  framing rules (echo stripped, doubled `ch> ` prompt tolerated, trailing
  space on scan lines, no error signalling). Anything learned about the
  protocol on one side goes into the other; `PROTOCOL.md` here and the
  library's notes are kept in step.
- **`js/device/` is a port of the library's device layer**, method for
  method: `vna.scan(start, stop, pts)` in JavaScript returns the same arrays
  as the Python call, and `models.js` carries the same frequency and point
  envelopes as `constants.py`. If you have read one, you have read the other.
- **Above that layer they diverge on purpose.** The page is for the bench:
  look at the trace, trim the antenna, sweep continuously, record. The library
  is for scripts: batch sweeps, fixtures, anything that needs numpy.
- **Files are the hand-off.** Export CSV / Touchstone / a recording from the
  page, open it in Python; or load a `.s1p` the library produced as an overlay
  under the live trace. The waterfall matrix CSV is the browser-side twin of
  the library's `plotting_waterfall_static.py` input.

Only one of the two can hold the serial port at a time; close the page's
connection (or the Python script) before starting the other.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ nanoVNA Web      [Connect] [Demo]  Model ▾   ● status         │
├────────────┬─────────────────────────────────────────────────┤
│ Sweep      │ Windows [1][2][4]                    Hold Clear │
│  start/stop│ ┌ |S11| SWR Smith … ─┐ ┌ |S11| SWR Smith … ─┐   │
│  points    │ │                    │ │                    │   │
│  [Single]  │ │       plot         │ │   plot / CW meter  │   │
│  [Contin.] │ └────────────────────┘ └────────────────────┘   │
│ ────────── │                                                 │
│ Calibration├─────────────────────────────────────────────────┤
│ ────────── │  Markers  [min SWR] [peak] [send to device]     │
│ Export     │  # freq |S11| SWR R X |S21| phase               │
│ ────────── ├─────────────────────────────────────────────────┤
│ Session &  │  Console ▲ (drag to resize)   Log ▾ [⤓][copy]   │
│  compare   │  > version                                      │
│ ────────── │  NanoVNA-F_V3 v1.0.6                            │
│ Diagnostics│  > scan 50000000 1500000000 801 7               │
│ ────────── │  … 801 lines (1273 ms)                          │
│ Device     │  ┌──────────────────────────────────┐ [Send]    │
│  tools     │  │ type a command                   │           │
│ ────────── │                                                 │
│ Settings   │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

Each window has its own view tabs; *Windows 1 / 2 / 4* sets how many. Two
windows sit side by side (stacked on a narrow screen), four in a grid: |S11|
next to the Smith chart, or SWR over the waterfall, from the same sweep. A
hover in one window highlights the same point in all of them, a click places
a marker from any of them, and the layout and views are remembered. The CW
meter is a view like the others and lives in whichever window selects it.

The sidebar is an accordion — click a header to open it, click again to
collapse; the choice is remembered. Drag its right edge to resize it
(double-click the edge to reset). The markers table sits between the plot and
the console so it has the full width. On narrow screens the sidebar stacks
above the plot.

## What it does (v0.6)

- **Sweep** — start/stop in MHz, points by model maximum / quick / custom,
  single or continuous.
- **Views, in 1 / 2 / 4 windows** — |S11| dB, |S21| dB, SWR, S11 phase, Smith
  chart, waterfall (rolling |S11| history), CW meter; each window shows its own
  view of the same sweep, so two or four can be compared side by side. *Hold*
  keeps a trace for comparison in every window.
- **Markers** — click to place up to six; each shows frequency, |S11|, SWR,
  R, X, |S21| and phase. *Mark minimum SWR* and *Mark |S11| peak* find them
  for you; *Send first 4 to device* sets the instrument's sweep to match and
  writes the markers to its own four (`sweep`, `marker N idx`); markers 5–6
  stay page-only. A rejection by the device is shown on the markers row.
- **Calibration** — step-through SOLT on the device (`cal open/short/load/
  thru/done`), on/off, reset, save/recall slots, and electrical delay
  (`edelay`). Calibration lives on the device; the page sends the commands.
  Run a page sweep first so the device is on the range you'll measure with.
  A badge in the top bar shows what the page last sent.
- **Device readback** — *Use device sweep* copies the instrument's own
  start/stop/points into the page (`sweep`); *Read device data* shows what's
  on its screen without starting a new scan (`frequencies`, `data 0/1`).
- **CW meter** — one frequency, big-number readout of |S11|, SWR, R + jX and
  |S21| updating continuously (`cwfreq` on the device, tiny `scan` for the
  numbers). For trimming an antenna while watching one value.
- **Beep** — the device buzzer (`beep on/off`) after each sweep and/or when
  minimum SWR drops below a threshold you set. Optional browser tone too.
- **Export** — CSV with derived columns, `.s1p`, `.s2p`, plot PNG, and a
  screenshot of the device's own screen.
- **Recording** — log every sweep and CW reading with timestamps while
  recording is on; save as a waterfall matrix CSV (the plot as data), a long
  sweep log CSV, a CW log CSV, or JSON. The browser-side equivalent of
  `plotting_waterfall_static.py`.
- **Replay** — scrub through the recording with a slider or play it at 0.5–8×;
  every window redraws for that sweep (the waterfall rebuilt from the recording
  up to that point). Sweeps that arrive while replaying are still recorded.
  *Live* returns to the instrument; *Load recording JSON* brings a saved one back.
- **Clip (WebM)** — save what the windows show as a video: a recording played
  back at the chosen speed, or the live windows until you stop, one frame per
  rendered sweep, with an optional caption bar (range, sweep, time, device).
  Encoded by the browser's own MediaRecorder: full colour, no library, a
  fraction of a GIF's size; plays in any browser, Slack and Discord.
- **Diagnostics** — one button runs a fixed set of commands, records raw
  replies and timings, and downloads a JSON to attach to an issue. This is
  how the page gets validated against hardware it hasn't seen yet.
- **Console** — the raw serial exchange with a resizable drawer, command
  history (↑ ↓), long replies collapsed, copy button, and a log download
  (commands only, or commands + replies, timestamped).
- **Session & compare** — save/load the whole page state as JSON; load a
  `.s1p`/`.s2p` as a dotted overlay under the live trace.
- **Device tools** — touch calibration, touch test, resolution readback.
- **Settings** — dark (default) or light theme; trace colours as the
  instrument convention (S11 yellow, S21 cyan) or blue/amber; waterfall
  palette (Viridis, Inferno, Turbo, Classic SDR, Grey) and colour floor;
  reference impedance Z₀ (default 50 Ω); beep rules; device screen
  brightness (`pwm`); mirror the page view onto device trace 0 (`trace 0 …`);
  overlay on/off; raw-byte echo for debugging framing. All remembered in the
  browser.

Not yet: group delay, TDR (planned as its own release).

## Supported hardware

Built for the NanoVNA-F V2 and F V3 (what the maintainer owns). The H4 and a
generic envelope are selectable from the Model dropdown but untested. Devices
that use a binary protocol (NanoVNA V2 / SAA-2 family) will not work.

Chrome or Edge is required for the USB link — they implement
[Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
Firefox and Safari can only use the demo.

## Code layout

No build step; native ES modules.

```
index.html                 markup only
css/
  theme.css                colour tokens: dark/light themes, trace colour schemes
  layout.css               top bar, docked sidebar, plot, console drawer
  components.css           buttons, inputs, tables
  panes.css                the 1 / 2 / 4 window grid (shared with tinysa-web, as are panes.js and clip.js)
js/
  main.js                  app state + wiring
  rf.js                    pure math: dB, SWR, Γ→Z, formatting
  device/                  ← the reusable "library" layer
    shell-link.js          NanoVNA console framing (ch> prompt, echo, binary)
    serial-link.js         Web Serial transport
    demo-link.js           simulated F V3, same byte stream
    models.js              per-model envelopes, detectModel()
    nanovna.js             NanoVNA class — method names mirror nvnapython
tests/
  device.test.mjs          the device layer over the demo device (node --test 'tests/**/*.test.mjs')
  plot/
    rect.js  smith.js  waterfall.js  palettes.js  common.js
  ui/
    sidebar.js  console.js  panes.js  clip.js  settings.js  diagnostics.js  export.js
    calibration.js  cw.js  session.js  devicetools.js  recorder.js  about.js
```

`js/device/` is the part another tool would reuse: `main.js` calls
`vna.scan(start, stop, pts)` and gets typed arrays back; it never sees `ch>`.

## Running locally

Module scripts don't load from `file://` in Chrome, so serve the folder:

```sh
python -m http.server 8000
# then open http://localhost:8000/
```

Web Serial works on `localhost`, so a real device can be used this way.

The device layer has tests that run without a browser or a device, against
the demo device's byte stream (Node 18 or later):

```sh
node --test 'tests/**/*.test.mjs'
```

## Validating against a real device

1. Connect, run a single sweep. If the plot looks wrong or the sweep fails,
   open *Diagnostics* → **Collect sample** and attach the JSON to an issue
   using the *Scan problem* template.
2. Compare the page's trace with the device's screen (*Export → Device
   screenshot* pulls that over USB too).
3. Export a `.s1p` and open it in anything that reads Touchstone.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the issue templates. Please read
the short [code of conduct](CODE_OF_CONDUCT.md).

## License

GPL-2.0 — see [LICENSE](LICENSE). Same as the nanoVNA_python library.

nanoVNA Web is not affiliated with or endorsed by any NanoVNA manufacturer.
Refer to the manufacturer's documentation for anything about the device itself.