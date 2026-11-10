# Guide for continuing this port

For an engineer or an LLM picking up the browser port of A2 Racer 4 - De politie slaat terug! (Davilex, 2000) without chat history. Paths are relative to the project root. On the owner's machine that is `/home/rick/Documents/Rebuilds/A2 Racer 4/`.

The architecture in short: `spel.dat`, the race, is recompiled from x86 to WebAssembly and runs as shipped. `source/host/` implements the Win32 and DirectX calls it makes. `source/render/` draws the captured Direct3D calls through Three.js. `source/menu/` is `menu.exe` rewritten by hand. `source/app.js` does what the launcher did. Both of the race's paths run: with a 3D card, and with `3D kaart` off the 8-bit software path. Reasoning: [`../PLAN.md`](../PLAN.md), [`recompiler.md`](recompiler.md).

## Read first

For a request to add or improve a custom map, also read [Making a new map](map-making.md).
It covers the Vianen workflow, native geometry limits, photo projection, visibility,
collision, props and focused local checks. It is the map-making handoff for future work.

| Order | Read | For |
|---|---|---|
| 1 | [`request.txt`](request.txt) | The brief. The limits in its fourth paragraph take precedence over broader language further down |
| 2 | [`../PLAN.md`](../PLAN.md) | Milestones, blockers, next actions |
| 3 | This file | Layout, routes, checks, rebuilds, pitfalls |
| 4 | [`original-behavior.md`](original-behavior.md), first its "Findings a continuing developer must know" and "Limits of the evidence" | What is established, and how far |
| 5 | [`feature-parity.md`](feature-parity.md), first its "Known incomplete" and "Not verified" | Status per feature, implemented and verified kept apart |
| 6 | [`validation.md`](validation.md), [`../evidence/reference-wine/results.md`](../evidence/reference-wine/results.md), [`../evidence/reference-86box/results.md`](../evidence/reference-86box/results.md) | Procedures, results, environments, known discrepancies. The runs of the original against the port |
| 7 | [`intentional-differences.md`](intentional-differences.md) | What differs on purpose. Check it before "fixing" a difference |
| 8 | [`behavior/`](behavior/) and [`parity/`](parity/), per area: audio, host, hud, input-platform, race-rules, render, sim-timing, startup-menu | Evidence per finding, and status rows |
| 9 | [`provenance.md`](provenance.md), [`reuse.md`](reuse.md), [`recompiler.md`](recompiler.md), [`../source/menu/README.md`](../source/menu/README.md) | Programs and versions, what came from the reference ports, the recompiler, how a menu form is written |
| 10 | [`research/`](research/) | Reverse-engineering notes per subsystem, Confirmed, Inferred, Unknown. A note with known errors says so at its top; the correction table is in `original-behavior.md`. For the 8-bit path `render-8bit.md` holds over the static `8bit-*.md` |
| 11 | [`../original-game-decompiled/LLM_GUIDE.md`](../original-game-decompiled/LLM_GUIDE.md) | Finding a function, address, string, asset or file in the original |

Live site: <https://games.nostalgiarealm.com/a2racer4/>, updated with `tools/deploy-website.sh`: [`hosting.md`](hosting.md). Releases: [`releasing.md`](releasing.md). The repository is `NostalgiaRealm/A2-Racer-4` on GitHub (`origin`) and `Nostalgia_Realm/A2-Racer-4` on GitLab (`gitlab`). `electron/` wraps `dist/` for the desktop builds, and `large-files/` holds `rcs.img` in pieces: `npm ci` restores it.

## Folder map

| Path | Kind | Content |
|---|---|---|
| `source/` | Source | Maintained code. Edit here |
| `source/index.html`, `style.css`, `main.js` | Source | The page, its style, the entry point |
| `source/app.js`, `race-runner.js`, `settings.js` | Source | Launcher flow, one race on the page, port settings |
| `source/host/` | Source | `machine.js` memory, thunks and COM objects; `win32.js` Win32, `Heap`, `VirtualClock`; `directx.js` DirectDraw, Direct3D, DirectInput, DirectSound; `race.js` one run of `spel.dat`; `hooks.js`; `hud-layout.js`; `vfs.js`; `persist.js`; `game-files.js`; `race-setup.js`, `pinRace` for a race without the menu |
| `source/render/` | Source | `d3d-renderer.js`, captured calls to Three.js |
| `source/audio/` | Source | `game-audio.js`, race sound on Web Audio |
| `source/input/` | Source | `keyboard.js`, `gamepad.js`, `touch.js` |
| `source/menu/` | Source | `framework.js`, `base-forms.js`, `plain-controls.js`, `data.js`, `flow.js`, `sound.js`, `forms/`. Has its own `README.md` |
| `source/ui/` | Source | `settings-panel.js`, `safe-area.js` |
| `source/dev/` | Source | `bot.js`, the test driver. Not part of the game, but it is in the bundle |
| `source/assets/touch/` | Source | The two wheel and pedal SVGs from RedCat SuperKarts, with `ATTRIBUTION.md` and the CC0 text |
| `tools/` | Source | Asset preparation, server, build, checks |
| `tools/recomp/` | Source | The recompiler. `tools/recomp/out/` is generated. `owner-fixes/` holds the owner's patch code the race runs, with what it takes and leaves out |
| `tools/reference-wine/` | Source | The reference runs: the original `spel.dat` under Wine, and the same key scripts on the port. Has its own `README.md` |
| `tools/reference-86box/` | Source | The reference runs of the 8-bit path, which Wine cannot run: the original `spel.dat` on a throwaway copy of the owner's 86Box Windows 98 machine, and the port's frame set against a screenshot of the guest. Has its own `README.md` |
| `docs/` | Documents | `research/` is analysis, `behavior/` evidence, `parity/` status |
| `public/` | Generated | What the browser loads. Never edit by hand, see Rebuild |
| `public/src/`, `public/index.html` | Generated | The bundle and the page |
| `public/game/` | Generated | `spel.wasm`, `spel.meta.json` |
| `public/assets/` | Generated | `game/`, 142 files: 140 race files, unchanged, and the lists `files.json`, `race-files.json`; `menu/`, `media/`, `loading/`, `touch/`; `asset-map.json` from output to source, 764 entries |
| `dist/` | Distribution | The static site from `npm run build` |
| `evidence/` | Evidence | Output of the checks: `flow/`, `race-ui/`, `performance/`, `driving/`, `traffic/`, `forms/`, `flow-phone/`, `smoke/`, `software/`, the 8-bit path; `reference-wine/`, the runs of the original with their report `results.md`; `reference-86box/`, frames of the original on the 8-bit path with theirs. Only what [`validation.md`](validation.md) cites counts |
| `original-game-decompiled/original/` | Extracted originals | Byte-exact copies of the install as it was before the updates, the disc and its image, and what the installer placed elsewhere. Read-only |
| `original-game-decompiled/original/updates/` | Extracted originals | Davilex's two official updates, installed after that snapshot: the two EXEs, `installed/` with every new or changed file, `delta.csv`, `README.md`. `tools/prepare-assets.py` lays `installed/` over `original/install/`, and the updates win. Read-only |
| `original-game-decompiled/extracted/` | Extracted originals | Installer and cabinet contents; `game-archives/` holds the unpacked game resources |
| `original-game-decompiled/decompiled/`, `analysis-projects/` | Recovered analysis | Ghidra output per module. Pseudocode, not source |
| `original-game-decompiled/annotations/`, `docs/`, `inventory/`, `dynamic/`, `logs/`, `scripts/` | Recovered analysis | Analyst names and documents, hashes and module tables, the observation runs, the scripts that build the package |
| `node_modules/` | Dependencies | `npm ci` |

## Entry points

| What | Where |
|---|---|
| Page | `source/index.html`, copied to `public/index.html`: canvases `#game` and `#menu`, `#overlay`, `#touch-controls`, `#dialog-keys`, `#loading`, `#settings-panel`, `#status` |
| App | `source/main.js` starts `App` in `source/app.js`: `start`, `route`, `startRace`, `exitGame`, `layout`, `applyFullscreen` |
| Menu | `MenuRuntime` in `source/menu/framework.js`, `startUp` and `afterRace` in `flow.js`, `GameData` in `data.js`, one class per form in `forms/` |
| Race runner | `RaceRunner` in `source/race-runner.js`: `run`, `load`, `frame`, `endWait`, `layout`, `chooseDevice`, `setFocus`, `traceTick` |
| Race | `Race` in `source/host/race.js`: `instantiate`, `boot`, `tick`, the pause state machine, `hook!updateClock`, `hook!hudDraw` |
| Host | `installWin32`, `installDirectX`, `installCoreHooks`; `Machine` in `source/host/machine.js` |
| Renderer | `D3DRenderer` in `source/render/d3d-renderer.js`: `attach`, `endFrame`, `present`, `blendPalette`, `setRenderSize`; on the 8-bit path `setIndexed`, `presentIndexed`, `FRAG_INDEXED` |
| Recompiler | `tools/recomp/build.py`, with `recompile.py`, `lift.py`, `wasmgen.py`, `replacements.py` |
| Asset tools | `tools/prepare-assets.py`, `tools/convert-dfm.py`, `tools/build-race-lists.mjs` |
| Server and build | `tools/serve.mjs`, `tools/bundle.mjs`, `tools/build.mjs` |
| Checks in a browser | `tools/check-flow.mjs`, `check-race-ui.mjs`, `check-phone-flow.mjs`, `check-software.mjs`, `benchmark.mjs`, `contact-sheet.mjs`, `shot.mjs` |
| Checks in Node | `tools/check-driving.mjs`, `check-traffic.mjs`, `run-bot.mjs`, `run-headless.mjs`: they read `public/assets/game` and pin the race with `pinRace`. `compare-traces.mjs` compares two benchmark files |
| Reference runs | `tools/reference-wine/`: `run.sh`, `refwine.py`, `campaign.sh` for the original, `port-launch.mjs` for the port, `analyze.py` for the tables. `tools/reference-86box/`: `prepare.sh`, `run.sh`, `drive.py` for the original, `port-rest.mjs` for the port, `compare.py` for the numbers |

## Where each subsystem lives

| Subsystem | Original | Port | Evidence and status |
|---|---|---|---|
| Launcher flow | `A2Racer4.exe` | `source/app.js` | `behavior/startup-menu.md`, `parity/startup-menu.md` |
| Menu, 45 forms, navigation | `menu.exe` | `source/menu/` | same |
| Players, saves, unlocks, records, INI writers | `menu.exe` | `source/menu/data.js`, `source/host/vfs.js`, `persist.js` | same |
| Help, Hunny | `Menu.hlp`, `Hunny.acs` | `TBalloonForm`, `HelpWindow` in `source/menu/forms/group-dialogs.js`, `prepare_help`, `prepare_agent` | same |
| Race rules, AI, traffic, police, pickups, damage | `spel.dat`, `bonus.dso` | Recompiled, no hand-written copy: `public/game/spel.wasm` | `behavior/race-rules.md`, `parity/race-rules.md` |
| Physics (Ipion) | `spel.dat` | Recompiled | `behavior/sim-timing.md`, `parity/sim-timing.md` |
| Fixed tick, clocks, interpolation | `FUN_004a6700` and its callers | `RaceRunner.frame`, `hook!updateClock`, `VirtualClock`, `D3DRenderer.blendPalette` | same, `behavior/render.md`, and `evidence/reference-wine/results.md` for the measured clock |
| Win32 and DirectX surface, memory model | Imports and COM calls of `spel.dat` | `source/host/` | `behavior/host.md`, `parity/host.md` |
| Rendering | Direct3D 5 on the 3D-card path | `source/render/d3d-renderer.js` | `behavior/render.md`, `parity/render.md` |
| 8-bit path, `3D kaart` off | Ramp device, one PCX page, one palette, blit sky, in `spel.dat` | Recompiled logic. `PAL8`, `softBlit`, `IDirectDrawPalette` in `source/host/directx.js`; the indexed pipeline in `source/render/d3d-renderer.js`; `modeGrid` in `source/settings.js`; `isMode3d`, `chkVideo3dClick` in `source/menu/forms/group-options.js` | `research/render-8bit.md`, `behavior/render.md` section 26, `parity/render.md`, `evidence/reference-86box/results.md` |
| HUD | `CRaceOverlay` in `spel.dat`, recompiled | `source/host/hud-layout.js` moves groups at draw time | `behavior/hud.md`, `parity/hud.md` |
| Race sound | DirectSound | `source/audio/game-audio.js` | `behavior/audio.md`, `parity/audio.md` |
| Menu sound | DirectSound | `source/menu/sound.js` | same |
| Keyboard, pad, touch | DirectInput, `GetAsyncKeyState` | `source/input/` | `behavior/input-platform.md`, `parity/input-platform.md` |
| Port settings | None | `source/settings.js`, `source/ui/settings-panel.js`, `TfrmDisplaySettings` in `source/menu/forms/group-options.js` | same |
| Race files and download | Archives on disk | `source/host/game-files.js`, `race-files.json` | `behavior/host.md`, `behavior/race-rules.md` |
| Assets and mapping | Install with its updates, and disc | `tools/prepare-assets.py`, `public/assets/asset-map.json` | [`provenance.md`](provenance.md) |

## Original executables

Full table with types, versions, command lines and evidence: [`provenance.md`, section a](provenance.md#a-executables-and-modules).

| File | Role | Port |
|---|---|---|
| `A2Racer4.exe` | Launcher, alternates menu and race, reads `[General] ExitCode` | `source/app.js` |
| `A2Racer4.icd` | Same bytes as `A2Racer4.exe`. Purpose not established | Not used |
| `menu.exe` | Delphi 5 front end, 45 forms | Hand port, `source/menu/` |
| `spel.dat` | The race, a PE file with a `.dat` name | Recompiled, `tools/recomp/` |
| `bonus.dso` | DaviScript object for bonus objects, run by `spel.dat` | Runs as shipped |
| `rsc.dll` | Archive I/O for `MenuRcs`, used by `menu.exe` only | Not needed: `prepare-assets.py` converts the members |
| `setdebug.exe` | Toggles `debug.ini`; no module starts it | Not ported |
| `autorun.exe` | CD start | Not ported |
| `setup.EXE` | Wise installer of the game | Not ported |
| `service/Setup.exe` | Wise installer of Davilex Service | Not ported |
| `UnInst32.exe`, `UnWise.exe` | Uninstaller, same bytes | Not ported |
| `SERVICE.EXE`, `SERVICE.CPL` | Davi-Service support tool, started only from the exception dialog, and its Control Panel applet | Not ported |
| `a2racer4_update_car.exe`, `a2racer4_update_track.exe`, `Trkuinst.exe` | Davilex's two updates, and the track update's uninstaller | Not ported: their files come through `prepare-assets.py` |
| DirectX, DirectX Media, MS Agent, Acrobat Reader, NetManage, Microsoft redistributables | Third party on the disc | Not used: browser APIs instead |

## Debug routes and URL parameters

These are live in every build, also in `dist/`. `race`, `bot`, `bench` and `nostatic` count by being present, whatever their value: `?bot=0` turns the bot on.

| Parameter | Read in | Effect |
|---|---|---|
| `?race=1` | `App.route` | No menu: starts a race from the current `game.ini`, the shipped one in a fresh profile, with etappe, car, laps, `BRITISH`, money and tune-ups pinned by `pinRace` in `source/host/race-setup.js`. Afterwards the menu shows without the result flow |
| `&etappe=N`, `&car=N` | `App.route` | With `?race=1`: the etappe and car for `pinRace`. Default 0 |
| `&resolution=N`, `&chunks=N` | `App.route` | With `?race=1`, by `pinRace`: `RESOLUTION` in `raser.ini`, 1 and 0 being the 8-bit path, and `VISIBLECHUNKS` in `game.ini`. `chunks=15` is what a slow machine ends up at, for comparing pictures with one |
| `?bot=1` | `RaceRunner.run`, `chooseDevice` | `Bot` in `source/dev/bot.js` drives the player's car on the keyboard device along the AI's waypoints. The device stays 1 whatever touch or pad say |
| `?bench=1` | `RaceRunner.load`, `frame` | Fixed seeds: `host.fixedDate` 971434016000, `host.clockStart` 1. Turns on `traceTick`, which fills `window.__trace` once per 60 ticks |
| `?speed=N` | `RaceRunner.run`, `frame` | N ticks of game time per tick of real time. For flow checks with the bot |
| `?form=TfrmX` | `App.route`, `GameData.prepareFormTest` | Opens one form by class name, with a player and a race result, and `saveProgress` off. Dialogs open over `TfrmMainScreen` |
| `?mode=N` | `prepareFormTest` | With `?form`: race mode, 1 Quick Race, 2 Tour, default 2 |
| `?flags=N` | `prepareFormTest` | With `?form`: result flags, `RR` in `source/menu/data.js`: CHASE 1, QUALIFY 2, WINRACE 4, WINTRACK 8, BESTLAP 32. Default 0 |
| `?nostatic=1` | `RaceRunner.load` | Turns off static track vertices, for a before and after measurement |

Common combinations: `?race=1&bot=1&bench=1` is the benchmark's route, `?bot=1&bench=1&speed=8` is check-flow's, `?race=1&etappe=9&car=7` is track 9 with the truck, `?race=1&bench=1&speed=8&chunks=15&resolution=1` is `port-rest.mjs`'s. A plain `?race=1&bot=1` is not repeatable.

Globals for scripts: `window.__app` always; `window.__race` and `window.__renderer` once a race has loaded; `window.__bot` with `?bot`; `window.__trace` with `?bench`. `window.__bench` is created by `tools/benchmark.mjs`, and `RaceRunner.frame` records into it.

## Running the checks

Browser checks need a server and a fresh bundle, and start neither: run `npm start` in another terminal. Playwright's Chromium once: `npx playwright install chromium`. Node checks need neither a server nor a bundle. The reference runs need Wine, Xvfb and Python on the host, and neither a server nor a bundle; those of the 8-bit path need 86Box and the owner's machine on the host, and for the port's half a server.

These are the checks performed on the final build. Only these count as verification. All are on etappe 0, Amsterdam, unless the row says otherwise, in headless Chromium 145 on an AMD Radeon RX 6700 XT through ANGLE Vulkan, or in Node, under Wine or on an emulated machine where it says so. A check covers only what it says. Results: [`validation.md`](validation.md).

| Name | Command | Writes | Covers, and its limit |
|---|---|---|---|
| check-flow | `node tools/check-flow.mjs --speed 8 --timeout 400` | `evidence/flow/` | Real clicks from the intro through Quick Race on Amsterdam, a whole bot race, `TfrmResults`, back. Zero console errors or warnings |
| check-race-ui | `node tools/check-race-ui.mjs`, or `--only touch,keyboard,touchsetting,results,gameover,gamepad,failure,intro` | `evidence/race-ui/summary.json`, screenshots | 76 checks by name. Touch through CDP, pad through a stand-in for `navigator.getGamepads`, full screen in headless Chromium. Finish and game over are entered through `FUN_0044cda0` |
| check-phone-flow | `node tools/check-phone-flow.mjs` | `evidence/flow-phone/` | 7 checks by name, printed. Taps on an 844x390 touch profile, then 390x844: intro, new player, the menus, Quick Race on Amsterdam, a race on the wheel, Stop and Ja, back to the menu, the Tour's screens up to the Garage without a race. Zero console errors. Emulated touch in Chromium, not a real phone |
| check-software | `node tools/check-software.mjs` | `evidence/software/flow/` | The 8-bit path by real clicks at 1280x720: `3D kaart` off and on, `Weergave` without it, a whole race by the bot at `RESOLUTION` 1 to its results, a race at 0 left with Esc and J, back on with the 3D card in the same page, zero console errors. 15 by name in `summary.json`. It reads state, not pictures |
| repeat-trace | The three `benchmark.mjs` commands below, then `node tools/compare-traces.mjs evidence/performance/final-normal.json evidence/performance/final-8x.json` and the same with `final-normal-30fps.json` | `evidence/performance/final-*.json` | Bot on fixed seeds at three render profiles. Read `checksumsEqual`: every object with a physics body, 485 on Amsterdam. `maxPositionDifference` and `maxSpeedDifference` are the player's car only. Port against port |
| benchmark | `node tools/benchmark.mjs --gpu --throttle 8 --seconds 60 --warm 12 --out evidence/performance/final-8x.json`. Normal: `--gpu --throttle 1 --size 1280x720 --dpr 1 --seconds 60 --warm 12 --out evidence/performance/final-normal.json`. 30 FPS: add `--frameskip 2`, `--out evidence/performance/final-normal-30fps.json`. Before the static track change: `--url 'http://127.0.0.1:4180/?race=1&bot=1&bench=1&nostatic=1'` | `evidence/performance/` | 800x360, DPR 2, 8x CPU throttle, drawing buffer 1600x720, 60 s after 12 s warm-up, the bot on chunks 114 to 192. A desktop GPU, which CPU throttling does not slow: this says nothing about a phone's GPU |
| check-driving | `node tools/check-driving.mjs --json evidence/driving/amsterdam-no-opponents.json` | That file | Node, no renderer, no opponents, keyboard device. Speeds, one object hit, reset, cornering, braking, reverse, one wall hit. Its first launch lands in regime 22222: read `movementState` before comparing |
| check-traffic | `for a in "--hz 60 --whole-push" "--hz 30 --whole-push" "--hz 60" "--hz 30"; do node tools/check-traffic.mjs $a; done \| tee evidence/traffic/nose-rise.jsonl` | That file | Node. Peak forward y of traffic in the 3 s after a start, on the owner's method. Compare the highest values with his table; the means are not comparable |
| run-bot | `node tools/run-bot.mjs` | Prints only | Node. A whole race headless with opponents and traffic. Options `--etappe`, `--car`, `--seconds`, `--opponents` |
| form-check | No script in `tools/`. One form: `node tools/shot.mjs --url "http://127.0.0.1:4180/?form=TfrmGarage" --out evidence/forms/garage.png --size 1280x720 --wait 2500`, portrait with `--size 390x844`, a result branch with `&mode=` and `&flags=` in the URL | `evidence/forms/` | Done per form by the people who wrote the forms: screenshots, all Tour and Quick Race result branches with a faked `game.ini`, Garage buying, options persistence, help links, error dialog, tabs of Geavanceerd. `displaysettings`, `doublekeys`, `mainscreen`, `mainscreen-portrait` and `options` were taken after the last edit of their forms; most of the others date from before the last menu edits. `evidence/flow-phone/06-start-info.png` shows the current touch note |
| boot-all | `node tools/build-race-lists.mjs` | `public/assets/game/race-files.json` | Node, no renderer: all 10 etappes with all 8 cars for 2 s, to record which files each race reads, and all 10 etappes with car 0 at `RESOLUTION` 0 and 1. Not a gameplay check |
| reference-frame | By eye | None | The first race frame against the owner's screenshot of his patched game under Wine, `/home/rick/Documents/Rebuilds/A2 Racer 4 Patch/A2-Racer-4-Fixes/releases/test-v1.3.0/screenshots/4_4x3_1024x768.png`. `evidence/reference-wine/side-*.png` set the port next to the unpatched game, also by eye |
| reference-wine | Once: `systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 tools/reference-wine/prepare.sh`. All runs, about 20 minutes: `tools/reference-wine/campaign.sh`. One start of the original: `tools/reference-wine/run.sh --name launch-a --pace 60 --gas-at go+0.5 --gas-for 12 --after 0.5`. The same on the port: `node tools/reference-wine/port-launch.mjs --name port-launch-a --gas-at go+0.5 --gas-for 12 --after 0.5`. Tables: `python3 tools/reference-wine/analyze.py regimes evidence/reference-wine/raw/launch60-*.json.gz -- evidence/reference-wine/raw/port-launch60-*.json.gz`. From a distrobox, prefix the Wine commands with `distrobox-host-exec`. All commands: `tools/reference-wine/README.md` | `evidence/reference-wine/raw/` | The original `spel.dat` under Wine 11.20, Xvfb and llvmpipe, in a throwaway prefix, on Amsterdam with car 0: held to 60 ticks per second from outside, memory read per tick, 22 launches, same scripts on the port. `prepare.sh` copies `original/install`, without the updates, which for this case is the same data. Rate behaviour, first `dt`, countdown, acceleration and plateau by movement state, reverse, brake, gear index timing, car height, racers' path over 30 s. Not steering, turbo, damage, collisions, race end, traffic, Windows, period hardware, real vsync. Also three frames of the port at 640x480 against the original's screenshots, by eye and mean colour, `side-*.png`; no script in `tools/` makes them. Report: `evidence/reference-wine/results.md`, whose section "After the two port changes" is the current state of the port; `analysis-output.txt` holds earlier output, so run `analyze.py` for the current one |
| reference-86box | All commands: `tools/reference-86box/README.md`. The port's frame needs the server: `node tools/reference-86box/port-rest.mjs --resolution 1 --size 640x480 --chunks 15 --out port-640.png` | `evidence/reference-86box/` | The original `spel.dat` at `RESOLUTION` 0 and 1 on a throwaway copy of the owner's 86Box machine, disc 1.01 data, Amsterdam with car 0, screenshots of the guest and no memory read. The port's frame at rest against the guest's, pixel-exact in RGB by `compare.py`. An emulated machine, not a real one. Not the flash, `wait_lo` pictures as drawn by the game, end of race, the pause dialog, rates. Report: `evidence/reference-86box/results.md`. Findings: `research/render-8bit.md` |
| fix-checks | Not reproducible from `tools/`: one-off scripts run when a fix was made | Nothing kept in the project | Cite only for what `behavior/` says about each, and say it was a one-off script. Each ran on the build of its day, so its numbers can predate the last clock change. One ran on the final build, and is all that covers track 9 and car 7 past boot-all: through the real menu, a race on the keyboard device, 6 s of gas, 0 console errors, screenshots in `evidence/smoke/download-*.png` |

Tools that exist but are not among those checks: `tools/contact-sheet.mjs` (bot and screenshots), `tools/run-headless.mjs --ticks 300` (`npm run test:headless`; a quick boot check, and it writes `public/game/files-read.txt`). Passing them is not verification of parity. Neither is a successful build or a plausible screenshot.

## Rebuilding generated files

| Generated | Command | When | Reads |
|---|---|---|---|
| `public/src/`, `public/index.html` | `npm run bundle` | After any edit in `source/`, HTML and CSS included | `source/` |
| `public/game/spel.wasm`, `spel.meta.json`, `tools/recomp/out/report.json` | `npm run recompile`, about 10 s. Needs Python with `capstone`, at `~/.local/share/reverse-engineering/python-analysis/bin/python` | After any edit in `tools/recomp/` | `original-game-decompiled/original/install/spel.dat`, `decompiled/game__spel.dat/functions.csv` |
| `public/assets/` | `python3 tools/prepare-assets.py`, with `--skip-video` or `--only race,menu,error-icon,agent,help,loading,loading-bar,touch,media`. The 8-bit path's art, `eNN-8.png`, `eNN-lo.png` and `bar8-NN.png`, comes from `loading` and `loading-bar` | After an edit in that script or in `source/assets/touch/` | `original-game-decompiled/original/`, with `updates/installed/` laid over `install/`, `extracted/game-archives/` |
| `public/assets/menu/forms.json` | `python3 tools/convert-dfm.py` | After an edit in that script | `decompiled/game__menu.exe/delphi/forms/` |
| `public/assets/game/race-files.json` | `node tools/build-race-lists.mjs`, which in one run also writes `soft[0]` and `soft[1]`, the pictures and fonts per 8-bit mode, from boots of all 10 etappes at each | When what a race reads may have changed | `public/game/`, `public/assets/game/` |
| `dist/` | `npm run build` | For a release. It also leaves a minified bundle in `public/src/` | `public/` |
| `evidence/` | The commands above | After a change that a check covers | |
| `original-game-decompiled/` | `original-game-decompiled/scripts/reproduce_all.sh`. Long, and Ghidra must run under its memory ceiling, see that folder's `README.md` | Only if the package itself is wrong | The install and the ISO, read-only |

`prepare_media` skips a video whose MP4 exists and still lists it in the asset map: delete the MP4 to convert it again. Where `ffmpeg` is not on the path it runs `distrobox-host-exec ffmpeg`, because this work ran in a Debian distrobox on the Fedora host.

## How to continue

### What must not be done

- **Originals are read-only:** `/home/rick/.wine/drive_c/Program Files (x86)/Davilex/A2 Racer 4/`, `/home/rick/V1.01 A2 Racer 4 - De politie slaat terug!.iso`, `original-game-decompiled/original/`. Do extraction and development in this project, and use working copies for anything that could modify game files. `tools/reference-wine/` runs its own copy in a throwaway prefix. The owner's 86Box machine, `/mnt/4TB_NVME/86Box VMs/Windows 98/` and the Flatpak's machine folder, is read-only too: `tools/reference-86box/` copies it outside the project.
- **Reference projects are read-only:** `/home/rick/Documents/Rebuilds/RedCat Superkarts/`, `/home/rick/Documents/Rebuilds/RedCat Spookkasteel/RCSPOOK_NEW/`, and the owner's patch project `/home/rick/Documents/Rebuilds/A2 Racer 4 Patch/A2-Racer-4-Fixes`. The two RedCat ports are no evidence of how this game behaves. The patch project's notes are evidence about the original and about his patched game, not about the port.
- **No final critic.** The brief forbids a final critic, reviewer agent or separate final review pass.
- **Verification stays on one level:** etappe 0, Amsterdam. No campaign playthrough, no browser, device or frame-rate matrix. Implementing the full game is still required. Do not imply that other levels, modes, browsers or devices are verified: levels other than Amsterdam have boot-all at most, and track 9 with car 7 one launch on top.
- **Do not guess original behaviour.** Back it with code, data or a run. Keep Confirmed, Inferred and Unresolved apart, and never upgrade an inferred finding. A function's presence does not prove the game uses it. No physics constant is invented. The race's logic is the recompiled original: do not rewrite it by hand.
- **Keep implemented and verified apart.** Cite only checks that ran on the build you describe. After a change, rerun what it touches and update `validation.md`. Do not loosen a check to make it pass.
- **Do not edit `public/` or `dist/` by hand.** Rebuild them.
- **Do not "fix" what is original on purpose.** Timers run during dialogs, and a timed bonus can run out in a pause. There is no reverse gear. `original-behavior.md` lists more. Also leave the last-bit alternation of `dt` in `hook!updateClock`: it is deliberate, and gives the measured gas ramp. See `intentional-differences.md`, Clock ring.

### Pitfalls found in this work

**Bundling.** Browser checks test `public/src/main.js`, not `source/`, and nothing warns about a stale bundle. `npm start` and `npm run dev` bundle once, at start, with no watch. Run `npm run bundle` after every edit, and reload. Node checks import `source/` directly, read `public/game/spel.wasm`, and take game files from `public/assets/game`, so they neither need a bundle nor say anything about one. `npm run build` overwrites `public/src/main.js` with the minified bundle, which stays there until the next bundle. Minifying renames classes, so code must not read `constructor.name`: that is what `static className` on every form is for.

**`spel.wasm` rebuild.** An edit in `tools/recomp/` does nothing until `npm run recompile`, and it reaches `dist/` only through `npm run build`. Host and module must match: `Machine.bindRaw` throws `unknown thunk <name>` when a hook name is not in `spel.meta.json`, so a new `hook!` needs a recompile. `D3DRenderer.attach` wraps `hook!guard_0045dce0`, so keep `0x0045DCE0` in `GUARDED` in `tools/recomp/replacements.py`. A plain `build.py` without `--no-ret-store`, or with `--trace`, also writes to `public/game/`: rebuild with `npm run recompile` afterwards, because the evidence is on that build. After a rebuild the numbers in `evidence/` no longer describe the build, and a launch can land in another regime, see below.

**Playwright and full screen.** Full screen is on by default, at the first gesture. After that `page.setViewportSize` throws `To resize minimized/maximized/fullscreen window`. Call `window.__app.settings.set('fullscreen', false)` first, as `check-race-ui.mjs` and `check-phone-flow.mjs` do. The viewport stays at its emulated size in full screen, so measurements are not affected. Headless Chromium lets Esc reach the page, which a real browser may not.

**Comparing two runs: compare the movement state first.** The car's acceleration depends on Ipion's movement state of each core, the chassis and four wheels, which latch separately within 0.17 s of the gas and do not change after 1 s. That is shipped behaviour, measured in the original under Wine, and not a port fault. States seen in both: 11111, 22222, 21111, 12222, plus other mixed ones in the port. Speed at 4 s is about 20.7 m/s in 11111 and about 17.3 in 22222, in both. The moment of the gas does not decide it in the original: one key script six times gave 22222, 11111, 22222, 11111, 21111, 11111. The port repeats exactly on fixed seeds, but the tick number that gives a state is not a constant: it moves with everything that moves the counter in `FUN_004f7ec0`, and neighbouring ticks differ. So when two runs differ in speed, of the port or of the original, first compare the state: `movementState` in `check-driving.mjs`'s JSON, `moving` in its log, core+0x5C in general, the state strings of `tools/reference-wine/analyze.py regimes`. Do not read a regime change as a physics change, or a difference between input devices. Details: `evidence/reference-wine/results.md`, "The regimes", and `behavior/sim-timing.md`, "Movement state and the launch regimes".

**Fixed seeds through `?bench=1`.** Without it `time()` and `GetTickCount` seed from real time, so two `?bot=1` runs differ. With it `RaceRunner.load` fixes both. The Node tools set the same values themselves. `tools/contact-sheet.mjs`'s default URL has no `bench`.

**What the trace's checksum covers.** `RaceRunner.traceTick` hashes, once per 60 ticks, every object with a physics body: 485 on Amsterdam, each with its record in the table at `0x715e50` and its 3D object with world matrix. `bodies` in the trace counts them. `checksumsEqual` in `compare-traces.mjs` holds at all 71 samples between normal rendering, the mobile profile at 8x and 30 FPS in the `final-*.json` runs. `pos` and `speed` in the trace are the player's car only. The `repeat-*.json` files in that folder are older runs with an older checksum: do not cite them. All of this compares the port with itself.

**Free-running the original.** Under Xvfb with llvmpipe nothing limits it: 317 to 393 ticks per second, where the gas pedal hardly rises on a clean clock. Limit it with `--pace 60`. The time namespace gives the clean clock; `REFWINE_CLOCK_START=host` leaves the host's, whose rounding noise can lift the pedal by accident.

**Software rendering by default.** `tools/benchmark.mjs` without `--gpu`, `npm run bench`, and `tools/shot.mjs` always, use SwiftShader. Do not compare those numbers with the GPU runs.

**How the 8-bit path looks.** Do not derive it from the code or the `8bit-*.md` notes: the palette index of untextured draws and the stipple were read from frames, `research/render-8bit.md`. A slow guest loses view distance and smoke, and the port does not, so set a port frame against one with `?chunks=15`, as `port-rest.mjs` does. Wine refuses this path: `CreateDevice` fails on the 8-bit target.

**Autoplay.** All browser tools except `check-phone-flow.mjs` start Chromium with `--autoplay-policy=no-user-gesture-required`, so the path where the browser refuses sound and the intro plays muted has not run in them. `check-phone-flow.mjs` leaves the policy alone, taps past the intro either way and records nothing about sound.

**CDP touch.** `Input.dispatchTouchEvent`: `touchEnd` with points lifts only those points, `touchMove` with fewer points lifts nothing. A `touchEnd` without points ends all touches at once. `check-race-ui.mjs` relies on the per-finger form.

**State between runs.** Saves live in IndexedDB `a2racer4` and port settings in `localStorage` key `a2racer4.settings`. A fresh Playwright context starts empty, a normal browser profile does not. `?race=1` starts from whatever `game.ini` the last menu run left there, with the race keys pinned by `pinRace`. Clear the site's data to reproduce a first start.

**The snapshot is not the installation.** `original/install/` is the install from before Davilex's two updates, which the owner installed later, and the installation can move again. So re-run the input fingerprints before trusting the snapshot. In the installation folder, `sha256sum -c --quiet "/home/rick/Documents/Rebuilds/A2 Racer 4/original-game-decompiled/inventory/input_fingerprint_install_before.sha256"` should fail on the 10 changed files of `original/updates/delta.csv` and no others (the three `L*_anim.ini` as missing, because their names are lower-case now), and `find . -type f | wc -l` should give 164. The ISO's hash is in `input_fingerprint_iso_before.sha256`. Anything else is a change the port does not have. `tools/reference-wine/prepare.sh` still copies `original/install`: for etappe 0, car 0 that is the same data, for track 9 and car 7 it is not.

**The update's `game.ini`.** The car update overwrites it with a copy from the developers' machine: etappe 8, car 7, tune-ups on, one lap. The menu writes those keys before every race, so a player does not see it. Anything that starts a race without the menu must call `pinRace(vfs, { etappe, car, laps })` from `source/host/race-setup.js`, as `?race=1` and the Node tools do. It also sets `BRITISH` for etappe 9, money 0 and tune-ups 0.

**Citing in documents.** Name source files and functions, not line numbers: line numbers go stale. Addresses in the original stay exact. Scripts of the earlier passes lived in a session scratch folder, so `fix-checks` cannot be rerun from this project.

### Open items

- What is missing or not verified: `feature-parity.md`, "Known incomplete" and "Not verified". Track 9 and car 7 have boot-all and one launch, and the original has not been run with the updates.
- What the reference runs leave open, such as why a core latches in state 1 or 2 and the shares of the regimes: `evidence/reference-wine/results.md`, "Not established". On the 8-bit path, such as the flash on the guest: `research/render-8bit.md`, "Not settled". Its port choices: `intentional-differences.md`, Picture.
- `original-behavior.md`, "Corrections to the research notes", lists where the notes in `docs/research/` are wrong or out of date.
