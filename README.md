# A2 Racer 4 – De politie slaat terug! in the browser

**Play it: <https://games.nostalgiarealm.com/a2racer4/>**

Version 1.1.7. [Changelog](CHANGELOG.md), [release notes](docs/releases/1.1.7.md). Downloads: [GitHub](https://github.com/NostalgiaRealm/A2-Racer-4/releases/latest), [GitLab](https://gitlab.com/Nostalgia_Realm/A2-Racer-4/-/releases). Repositories: [GitHub](https://github.com/NostalgiaRealm/A2-Racer-4), [GitLab](https://gitlab.com/Nostalgia_Realm/A2-Racer-4).

A port of the Dutch racing game from 2000 to WebGL and Three.js, built from the original game files. The race itself is the original code: `spel.dat` is recompiled from x86 to WebAssembly, so its physics, AI, rules and HUD logic run as shipped. The menu is rewritten by hand from the original forms and code. All artwork, music, speech and text are the originals, in Dutch.

Status, measurements and what was checked: [`docs/feature-parity.md`](docs/feature-parity.md), [`docs/validation.md`](docs/validation.md). Changes on purpose: [`docs/intentional-differences.md`](docs/intentional-differences.md). Continuing the work: [`docs/LLM_GUIDE.md`](docs/LLM_GUIDE.md), [`PLAN.md`](PLAN.md). All documents: [below](#documents).

The game's content is in the port, with Davilex's two official updates, track 9 (the Country etappe) and car 7 (the truck De Schaduw), and with the gaps listed under Known incomplete in [`docs/feature-parity.md`](docs/feature-parity.md). The race runs the fixes of the owner's Windows patch `A2-Racer-4-Fixes` that matter at its 60 ticks per second, parts 11 to 13, from his own code: [`tools/recomp/owner-fixes/`](tools/recomp/owner-fixes/README.md). `3D kaart` off works: `Normaal` and `Laag` then run the race's 8-bit software path, 640x480 and 320x200. Verification covers one level, etappe 0 (Amsterdam), in headless Chromium on a desktop GPU. Other levels have a boot check at most, and the Country etappe with the truck one launch on top. No real phone, tablet or gamepad and no other browser engine was tried. On that level the original `spel.dat` also ran under Wine, and the port's speeds, reverse, brake, countdown, first time steps and three frames of its picture were set against it. The 8-bit path, which Wine cannot run, ran on an emulated Windows 98 machine, and the port's frames at rest were set against it pixel by pixel: 88.1% of the picture identical at 640x480 and 85.5% at 320x200. Steering, turbo, damage, collisions, the end of a race and traffic were not measured on the original, and no real hardware of the period was used. The original has not been run with the updates; for Amsterdam with car 0 the data is the same.

## Multiplayer

Up to eight players, each in their own browser: main menu, `Internet`. One player names and hosts a server, and the others join it. `npm start` also runs the lobby the browsers meet through; `npm start -- --lan` opens it to the local network. On a static site such as <https://a2racer.meertens.dev/> (GitHub Pages, `.github/workflows/pages.yml`) the browsers meet through the public PeerJS broker and connect over WebRTC; there the list shows the servers on the same network, and a server elsewhere is joined by typing its name. How it works, how to host the lobby next to a static site, and what was checked: [`docs/multiplayer.md`](docs/multiplayer.md).

## Vianen

A new track of its own through the old town of Vianen, with the Lekpoort, the Stadhuis and the Grote Kerk, generated from OpenStreetMap and openly licensed photos. Choose it in the multiplayer screens, alone or with others, or open `?race=1&etappe=vianen`. How it is made: [`docs/vianen.md`](docs/vianen.md). For future custom tracks, read [Making a new map](docs/map-making.md).

## Downloads

Desktop builds for Linux, Windows and macOS, a static web build, the source and the decompile: [`docs/releases/`](docs/releases/) lists the files of each release and what was checked on each. The Windows package has run under Wine but not on Windows, and the macOS packages have not been started so far.

The decompile of the original game is in [`original-game-decompiled/`](original-game-decompiled/README.md): generated C and assembly of every game module, unpacked resources, Ghidra projects, format documents and the game's own files. What is left out, such as the disc image and third-party installers: [`docs/releasing.md`](docs/releasing.md#what-is-published).

## Run it

You need Node.js 24. The prepared files in `public/` are already in this folder. `npm ci` also rebuilds `rcs.img` from its pieces in `large-files/`, because it is too big for one file in git.

```bash
npm ci
```

```bash
npm start
```

Open <http://127.0.0.1:4180/>. Click once: that allows sound and enters full screen. Another port: `PORT=8080 npm start`.

## Development

`npm run dev` does the same as `npm start`: it bundles `source/` into `public/src/` once and serves `public/`. There is no watch mode. After editing `source/`, bundle again and reload the page:

```bash
npm run bundle
```

## Desktop

The same game in Electron, with its files inside the package. `npm run desktop` starts it from this folder. `npm run desktop:linux` and `npm run desktop:win` build the packages into `release/`. macOS comes from `.github/workflows/macos-release.yml`. The quit path in the menu returns to the first screen, as in the browser: close the window to leave. Releases: [`docs/releasing.md`](docs/releasing.md).

## Vianen track viewer

With `npm start` running, open <http://127.0.0.1:4180/track-viewer.html> to inspect Vianen without
driving. Scrub the route slider, click the track plan, jump to a landmark, or build a scrollable
survey at each of the 106 track sections. Eight street directions and a 16-angle sweep cover
diagonal, elevated, rear-wall and roof views (1,696 images). Limit the station range for a
focused check; clicking a thumbnail restores that exact camera. Drag to orbit, right-drag to
pan, scroll to zoom; WASD moves and Q/E changes height.
Save named cameras in the browser, export/import them as JSON, or save the current view as a PNG.
The address also preserves the current camera for sharing an exact problem spot.

Shift-click a surface to identify its source chunk and plane. Layer, back-face, wireframe and
texture-filter controls help diagnose defects. This reads the actual RMP/PMP geometry and TGA
atlases directly; the race engine, vehicles and audio are not started. More details and reference
photo links: [`docs/vianen.md`](docs/vianen.md).

To regenerate the track assets, install the Python dependencies with
`python3 -m pip install -r tools/vianen/requirements.txt`, then run
`python3 tools/vianen/build-track.py` and `npm run bundle`. Prepared assets are already included.

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Steer | Left, Right | Left stick or D-pad left, right | Wheel, left and right |
| Gas | Up | RT or A | Wheel, upper half |
| Brake, then reverse | Down | LT, B, D-pad down or stick down | Wheel, lower half |
| Turbo | Ctrl | X | Turbo |
| Handbrake | Alt | RB | Handrem |
| Horn | Space | Y | Claxon |
| Cameras | 1, 2, 4, also 6 to 0 | LB, next of 1, 2, 4 | Camera, next of 1, 2, 4 |
| Look back, while held | 3 | R3 | Terugkijken |
| Reset | Enter | L3 | Reset |
| Roepen | T | D-pad up | Roepen, under Meer in landscape |
| Dashboard | 5 | | Dashboard, under Meer in landscape |
| Overlay detail | D | | Detail, under Meer in landscape |
| Pause | P, then any key or a mouse button on the race | Start, then A, B or Start | Pauze, then Verder or a tap on the race |
| Quit | Esc, then J or Y. Esc or N stays | Back, then A or B | Stop, then Ja or Nee |
| Leave finish table or game over | Esc, Enter or Space | A | Verder |
| Full screen | On at the first gesture. Leaving it turns the setting off and, in a race, opens the quit prompt. With a mouse in full screen: Stop beside the gear | | |
| Settings | In a race F9, also closes; Esc closes. In the menu `Opties`, `Geavanceerd`, tab `Browser` | | In a race the gear button. In the menu the same dialog |
| Menu | Mouse and keyboard, as in the original | D-pad or stick moves, A is Enter, B is Esc, RB is Tab | Tap |

The keys in the first six rows are the `Standaard` values and can be changed in `Opties`. The others cannot, as in the original.

The game has no reverse gear or gear keys. Holding brake at a standstill is how it reverses, as in the original.

On macOS, Ctrl+Left and Ctrl+Right switch desktops, so bind turbo elsewhere in `Opties`.

Both settings places hold 3D-resolutie, Renderschaal, Volume, Beeldjes per seconde tonen, Volledig scherm, Aanraakbediening and Deadzone gamepad. They are saved per browser. No pad button opens them.

Touch controls show on a touch screen, or with Aanraakbediening on. A pad connected at race start drives that race; one found later works from the next race. The race pauses if the pad in use goes away.

## Prepare from the original game

Only needed for a fresh copy without `public/assets` and `public/game`. Inputs stay unchanged. They come from `original-game-decompiled/`, the decompile package made from the installed game and its disc; see its own `README.md` to rebuild that. The owner installed Davilex's two updates after that package was made: `prepare-assets.py` lays `original/updates/installed/` over `original/install/`, and the updates win. Re-run the input fingerprints before trusting that snapshot of the install: [`docs/LLM_GUIDE.md`](docs/LLM_GUIDE.md), "The snapshot is not the installation".

```bash
python3 tools/prepare-assets.py
```

```bash
python3 tools/convert-dfm.py
```

```bash
~/.local/share/reverse-engineering/python-analysis/bin/python -I tools/recomp/build.py --no-ret-store
```

```bash
node tools/build-race-lists.mjs
```

| Step | Result |
|---|---|
| `prepare-assets.py` | `public/assets`: race files, menu art as PNG, Hunny's frames, help text, error icon, H.264 video, wait pictures, progress bar frames, for the 8-bit path too, touch art from `source/assets/touch`, and `asset-map.json` from output to source, 764 entries. Video needs `ffmpeg` with libx264 |
| `convert-dfm.py` | `public/assets/menu/forms.json`: the decoded Delphi forms |
| `recomp/build.py` | `public/game/spel.wasm`, `spel.meta.json`. Needs Python with `capstone`; `npm run recompile` runs this same command. See [`docs/recompiler.md`](docs/recompiler.md) |
| `build-race-lists.mjs` | `public/assets/game/race-files.json`: what each race reads from the archives, with `soft[0]` and `soft[1]` for the 8-bit modes. Needs `spel.wasm` |

Options of `prepare-assets.py`:

```bash
python3 tools/prepare-assets.py --skip-video
```

```bash
python3 tools/prepare-assets.py --only help,loading-bar,touch,error-icon
```

`--only` runs the named steps and keeps the other entries of the asset map. The steps are `race`, `menu`, `error-icon`, `agent`, `help`, `loading`, `loading-bar`, `touch` and `media`. `--skip-video` leaves the videos out of `media`. A video whose MP4 already exists is not converted again, with or without it: delete the MP4 to redo it.

## Build a static site

```bash
npm run build
```

```bash
npm run preview
```

`dist/` is plain static files. The server should support HTTP range requests for `rcs.img` and `rc.img`; nginx, Apache and GitHub Pages do. Without them each read fetches the whole archive. Only `tools/serve.mjs` was run.

## Checks

The browser tools need Chromium for Playwright, once:

```bash
npx playwright install chromium
```

They do not start a server or bundle anything. Have `npm start` running in another terminal, on a fresh bundle.

| Command | What it does | Needs a server |
|---|---|---|
| `node tools/check-flow.mjs --speed 8 --timeout 400` | Real clicks from the intro through a whole bot race on Amsterdam to the results and back. Writes `evidence/flow/` | Yes |
| `node tools/check-race-ui.mjs` | 76 named input, focus, settings and layout checks. Writes `evidence/race-ui/summary.json`. `--only touch,keyboard,touchsetting,results,gameover,gamepad,failure,intro` runs those sections | Yes |
| `node tools/check-software.mjs` | The 8-bit path with real clicks: `3D kaart` off and on, a whole bot race at `RESOLUTION` 1, a short one at 0, back on with the 3D card. 17 named checks. Writes `evidence/software/flow/` | Yes |
| `node tools/benchmark.mjs --gpu --throttle 8 --seconds 60 --warm 12 --out evidence/performance/final-8x.json` | The mobile performance measurement: 800x360, DPR 2, 8x CPU throttle. Without `--gpu` it uses software rendering | Yes |
| `node tools/benchmark.mjs --gpu --throttle 8 --seconds 60 --warm 12 --url 'http://127.0.0.1:4180/?race=1&bot=1&bench=1&nostatic=1' --out evidence/performance/final-before-static-8x.json` | The same, without the static track vertices | Yes |
| `node tools/benchmark.mjs --gpu --throttle 1 --size 1280x720 --dpr 1 --seconds 60 --warm 12 --out evidence/performance/final-normal.json` | Normal rendering, for the comparison | Yes |
| `node tools/benchmark.mjs --gpu --throttle 1 --size 1280x720 --dpr 1 --seconds 60 --warm 12 --frameskip 2 --out evidence/performance/final-normal-30fps.json` | Every second display frame, 30 FPS | Yes |
| `node tools/compare-traces.mjs evidence/performance/final-normal.json evidence/performance/final-8x.json` | Compares two of those runs per game second: the checksum over every object with a physics body, and position and speed of the player's car | No |
| `node tools/check-driving.mjs --json evidence/driving/amsterdam-no-opponents.json` | Scripted driving, no opponents, prints speeds. Repeatable | No |
| `node tools/check-owner-fixes.mjs --out evidence/owner-fixes/races-with-fixes.json` | Whole bot races on all 10 etappes, reading the state of the owner's added code: 25 Hz tick, camera, `hung_check`. `--game` points at another build | No |
| `node tools/check-shadow.mjs --hz 144 --out evidence/shadow/summary-144hz.json` | The player's shadow in its car's frame per presented frame, with the bot on Amsterdam. `--hz` stands in for a display rate | Yes |
| `node tools/check-wheels.mjs --hz 144 --out evidence/wheels/summary-144hz.json` | The wheels' matrices as drawn between ticks, with the bot on Amsterdam: 1 is a wheel at its own size | Yes |
| `node tools/check-hud-spray.mjs 900` | The HUD in every frame with 900 extra world-matrix rows taken per tick, as a dense spray does | Yes |
| `node tools/check-pairing.mjs --etappe 7` | Every draw's pairing with the tick before against the nearest free draw of its mesh, per mesh | Yes |
| `node tools/check-lights.mjs --etappe 7` | How the renderer pairs the car lights between ticks: lights paired with another light | Yes |
| `node tools/check-tail-glow.mjs 165 7 20` | The player's tail-light glow against its car per presented frame, at a 165 Hz stand-in | Yes |
| `node tools/check-traffic.mjs --hz 60` | Traffic nose rise on the owner's method. Also `--hz 30` and `--whole-push`, one JSON line each; `evidence/traffic/nose-rise.jsonl` holds the four | No |
| `node tools/run-bot.mjs` | A whole race in Node with opponents and traffic. Prints progress and what it writes to `game.ini` | No |
| `node tools/build-race-lists.mjs` | Boots all 10 etappes with all 8 cars for 2 s, and all 10 at `RESOLUTION` 0 and 1, to list the files each race reads. Not a gameplay check | No |
| `node tools/run-headless.mjs --ticks 300` | Runs the race in Node without a browser. `npm run test:headless` | No |
| `node tools/check-phone-flow.mjs` | The flow with taps on an emulated phone: menus at 844x390 and 390x844, a race on the wheel, Stop and Ja, the Tour's screens up to the Garage. No whole race. 7 checks. Writes `evidence/flow-phone/` | Yes |
| `node tools/contact-sheet.mjs` | The bot drives; a screenshot every few seconds. Writes `evidence/smoke/` | Yes |
| `node tools/shot.mjs --url "http://127.0.0.1:4180/?form=TfrmGarage" --out evidence/forms/garage.png --size 1280x720 --wait 2500` | One form or page in a screenshot, on software rendering. `--mobile` for touch and DPR 2 | Yes |

A race without the menu: <http://127.0.0.1:4180/?race=1&etappe=9&car=7>, default etappe 0, car 0. `&resolution=1` or `0` starts the 8-bit path, and `&chunks=15` sets the view distance for comparing with a slow machine. `pinRace` in `source/host/race-setup.js` sets those keys in `game.ini` and `raser.ini`, because the car update's copy comes from the developers' machine. The Node tools do the same, and read their files from `public/assets/game`.

**Comparing two runs: compare the movement state first.** The player's car accelerates by the movement state of its five physics cores, which latch in the first 0.2 s of a launch. At 4 s that is about 20.7 m/s with all cores in state 1 and about 17.3 with all in state 2, and there are mixes. It is the game's own spread, in the original as in the port, and the moment of the gas does not decide it in the original. So a speed difference between two runs says nothing until their states match: `movementState` in the JSON of `check-driving.mjs`, the state strings of `analyze.py regimes` below. Results: [`docs/validation.md`](docs/validation.md).

### Reference runs of the original

These run the original `spel.dat` under Wine on Amsterdam and read its memory per tick, with the same key scripts on the port. They need Wine, Xvfb and Python on the host, no server and no bundle. They use a private Xvfb and a throwaway Wine prefix, and never touch `~/.wine` or the original files. Their copy of the install has no updates, which for Amsterdam with car 0 is the same data. All commands: [`tools/reference-wine/README.md`](tools/reference-wine/README.md). Report: [`evidence/reference-wine/results.md`](evidence/reference-wine/results.md).

Once, to create the prefix:

```bash
systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 tools/reference-wine/prepare.sh
```

One start of the original, held to 60 ticks per second from outside:

```bash
tools/reference-wine/run.sh --name launch-a --pace 60 --gas-at go+0.5 --gas-for 12 --after 0.5
```

The same on the port:

```bash
node tools/reference-wine/port-launch.mjs --name port-launch-a --gas-at go+0.5 --gas-for 12 --after 0.5
```

The tables:

```bash
python3 tools/reference-wine/analyze.py regimes evidence/reference-wine/raw/launch60-*.json.gz -- evidence/reference-wine/raw/port-launch60-*.json.gz
```

Everything the report is based on, about 20 minutes:

```bash
tools/reference-wine/campaign.sh
```

The 8-bit path cannot run under Wine. `tools/reference-86box/` runs it on a throwaway copy of the owner's 86Box Windows 98 machine and takes screenshots of the guest, and sets the port's frame against them. All commands: [`tools/reference-86box/README.md`](tools/reference-86box/README.md). Report: [`evidence/reference-86box/results.md`](evidence/reference-86box/results.md). Findings: [`docs/research/render-8bit.md`](docs/research/render-8bit.md).

## Folders

| Folder | Content |
|---|---|
| `source/` | Maintained code: `host/` Windows and DirectX in JavaScript, `render/`, `audio/`, `input/`, `menu/`, `ui/`, `dev/` the test bot, `assets/touch/` the touch art |
| `tools/` | Asset preparation, recompiler, server, build, checks; `reference-wine/`, the runs of the original under Wine; `reference-86box/`, its runs on the 8-bit path on an emulated Windows 98 machine |
| `public/` | What the browser loads. Generated: rebuild with the commands above |
| `dist/` | The static site from `npm run build` |
| `original-game-decompiled/` | The decompile package: original files, recovered code, its documentation; `original/updates/`, Davilex's two updates: the EXEs, the installed files, `delta.csv` |
| `docs/` | Documents, see below |
| `evidence/` | Measurements and screenshots; `software/`, the 8-bit path; `reference-wine/`, the runs of the original under Wine; `reference-86box/`, its frames on the 8-bit path |

## Documents

| Document | Content |
|---|---|
| [`CHANGELOG.md`](CHANGELOG.md), [`docs/releases/`](docs/releases/) | Versions, release notes |
| [`docs/releasing.md`](docs/releasing.md) | What a release contains, what stays out, how to make one |
| [`docs/hosting.md`](docs/hosting.md) | The live site: server, Nginx, how to update it |
| [`docs/request.txt`](docs/request.txt) | The brief |
| [`PLAN.md`](PLAN.md) | Milestones, progress, blockers, next actions |
| [`docs/LLM_GUIDE.md`](docs/LLM_GUIDE.md) | Folder map, boundaries, entry points, debug routes, how to continue |
| [`docs/original-behavior.md`](docs/original-behavior.md) | What is established about the original, and how |
| [`docs/behavior/`](docs/behavior/) | The same per area, with evidence: [audio](docs/behavior/audio.md), [host](docs/behavior/host.md), [hud](docs/behavior/hud.md), [input and platform](docs/behavior/input-platform.md), [race rules](docs/behavior/race-rules.md), [render](docs/behavior/render.md), [simulation and timing](docs/behavior/sim-timing.md), [start-up and menu](docs/behavior/startup-menu.md) |
| [`docs/feature-parity.md`](docs/feature-parity.md) | Content and features, implementation and verification status |
| [`docs/parity/`](docs/parity/) | The same per area: [audio](docs/parity/audio.md), [host](docs/parity/host.md), [hud](docs/parity/hud.md), [input and platform](docs/parity/input-platform.md), [race rules](docs/parity/race-rules.md), [render](docs/parity/render.md), [simulation and timing](docs/parity/sim-timing.md), [start-up and menu](docs/parity/startup-menu.md) |
| [`docs/validation.md`](docs/validation.md) | Test procedures, results, environments, known discrepancies |
| [`evidence/reference-wine/results.md`](evidence/reference-wine/results.md) | The original under Wine against the port: setup, tables, what is not established |
| [`evidence/reference-86box/results.md`](evidence/reference-86box/results.md) | The original's 8-bit path on an emulated Windows 98 machine against the port: frames and numbers |
| [`docs/intentional-differences.md`](docs/intentional-differences.md) | Requested adaptations and their effect on original behaviour |
| [`docs/provenance.md`](docs/provenance.md) | Every executable, installation against disc, which files are the authority, configuration, saves, reference environment |
| [`docs/reuse.md`](docs/reuse.md) | What was taken from the RedCat ports, and what differs |
| [`docs/recompiler.md`](docs/recompiler.md) | How `spel.dat` becomes WebAssembly |
| [`docs/research/`](docs/research/) | Reverse-engineering notes per subsystem, with corrections at the top of each note that has known errors. `render-8bit.md` is the 8-bit path as measured |
| [`source/menu/README.md`](source/menu/README.md) | How a menu form is written |
| [`original-game-decompiled/README.md`](original-game-decompiled/README.md) | The decompile package, with its own `LLM_GUIDE.md` |

## Rights

The game, its code, media and fonts retain their owners' rights. This project is not affiliated with Davilex. Extraction does not imply ownership or a redistribution licence. The code in `original-game-decompiled/decompiled/` is generated pseudocode, not the developers' source. This project's own code carries no licence grant.
