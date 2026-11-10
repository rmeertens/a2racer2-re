# A2 Racer 4 port: plan and status

Brief: [`docs/request.txt`](docs/request.txt). This file holds milestones, progress, blockers and next actions, so work can continue without chat history. For the folder map and how to continue, read [`docs/LLM_GUIDE.md`](docs/LLM_GUIDE.md).

## Architecture decision

`spel.dat`, the race executable, is recompiled statically from x86 to WebAssembly (`tools/recomp/`). Its logic, Ipion physics, AI, HUD logic and DaviScript run as shipped. A JavaScript host (`source/host/`) implements the Win32 and DirectX 5 calls it makes, and `source/render/` draws the captured Direct3D calls through Three.js. `menu.exe` (Delphi) is rewritten by hand from its decoded forms and decompiled handlers (`source/menu/`), because recompiling a VCL GUI would mean reimplementing USER32 and GDI. The launcher becomes `source/app.js`.

Why not hand-translate the race: 677 KB of game code plus Ipion cannot be tested piece by piece, and every translation slip would change handling or AI silently. The recompile reproduced the owner's screenshot of his patched game on its first run, by eye. Later it reproduced his Wine measurements of traffic behaviour to within 0.03, and the original's own speeds under Wine, by movement state, to within 2.05% at 1 s and 0.5% at 4 s and 8 s.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Subsystem research in `docs/research/` | done |
| 2 | x86-to-wasm recompiler, boots and runs the race headless | done |
| 3 | Win32, DirectDraw, Direct3D, DirectInput, DirectSound hosts | done for the 3D-card race path |
| 4 | Three.js renderer: batching, texture arrays, blend, z, fog | done, static track vertices added |
| 5 | HUD layout for any screen shape, safe areas | done |
| 6 | Audio on Web Audio, status on the virtual clock | done, checked by state only |
| 7 | Asset pipeline: menu art, video, race file loading | done |
| 8 | Menu port: 45 forms, data model, saves, INI writers | done |
| 9 | Launcher flow: intro, menu, race, results, back | done, walked in a browser on Amsterdam |
| 10 | Fixed tick, interpolation, focus handling | done |
| 11 | Touch wheel from Superkarts, gamepad, portrait layout | done |
| 12 | Settings: resolution, render scale, audio, controls | done |
| 13 | Benchmark at 800x360 DPR 2, 8x throttle: 30 FPS | done, met; final numbers in `docs/validation.md` |
| 14 | Reference run: the original `spel.dat` under Wine against the port | done: `tools/reference-wine/`, `evidence/reference-wine/results.md` |
| 15 | Required documents | done |
| 16 | The two installed updates: track 9 (Country etappe), car 7 (De Schaduw) | done: `original/updates/`, overlay in `tools/prepare-assets.py`, boot of all 10 etappes with all 8 cars, one launch through the menu. Not verified further, by the brief |
| 17 | The 8-bit path, `3D kaart` off, at the owner's request | done: indexed pipeline in `source/render/d3d-renderer.js`, palette and 8-bit surfaces in `source/host/directx.js`, the menu's own rules. Compared with the original on an emulated Windows 98 machine, `tools/reference-86box/`, on Amsterdam. Whole race on the bot, `tools/check-software.mjs` |
| 18 | Public release 1.0.0: repositories, desktop builds, decompile archive, checksums. [`docs/releasing.md`](docs/releasing.md) | done |
| 19 | Live at <https://games.nostalgiarealm.com/a2racer4/>. [`docs/hosting.md`](docs/hosting.md) | done |
| 20 | The owner's `A2-Racer-4-Fixes` 1.5.4 parts 11 to 13 in the race, release 1.1.0. [`tools/recomp/owner-fixes/README.md`](tools/recomp/owner-fixes/README.md) | done |

## Blockers

None.

## Next actions

Vianen realism pass, 10 November 2026: revised house proportions/materials, closed OSM backdrop
buildings, correctly scaled street furniture, projective landmark crops and redesigned readable
shop advertisements. Rebuilt assets, completed a bot lap and checked for map leaks; local browser
evidence and the remaining approximation limits are in [`docs/vianen.md`](docs/vianen.md).
Follow-up: added a silent, independent viewer at `http://127.0.0.1:4180/track-viewer.html`, with
106-station camera surveys, free cameras, saved views and additional Google Images references.
Second pass completed: connected ground/canal banks/water, seamless paving, sixteen varied
facades, detailed brick end walls, smaller street furniture and corrected landmark proportions.
Vianen-only race texture filtering and viewer handedness/transparent-edge fixes are in place.
Final track: 5,897 planes, zero dropped planes, zero boundary leaks, completed bot lap and
318-camera route survey. See `docs/vianen.md` and `evidence/vianen/realism-2/`.
Next: owner local playtest at `http://127.0.0.1:4180/?race=1&etappe=vianen`.
Follow-up: moved the Grote Kerk and its churchyard across the street onto the outside of the
returning corner for a clear approach sightline. Rebuilt to 5,915 planes; zero boundary leaks
and completed bot lap. New corner evidence: `evidence/vianen/church-move/`.
Photo mapping follow-up: recalibrated all nine active photo crops to their facade planes,
corrected landmark UV orientation and cropped UV mirroring, and aligned the Lekpoort opening
with its photographed arch. Four focused warp checks, local visual checks, zero leaks and a
completed bot lap. Evidence and limits: `docs/vianen.md`, `evidence/vianen/photo-warp/`.
Reverse-view follow-up: 365 flat props now render from both sides, using tagged UVs and reverse
GPU triangles without extra RMP/collision planes. Checked actual renderer handling, live rear
view/reverse gear and local viewer. Evidence: `evidence/vianen/reverse-culling/`.
Full-angle follow-up: 16-view survey presets plus station ranges (1,696 cameras); closed rear
house walls, side-street buildings, landmark backs, bridge undersides and raised embankments.
The Vianen 3D renderer now draws each verified static pool in full to eliminate partial-chunk
scenery omissions. Final assets: 6,178 planes, zero drops/leaks, completed bot lap, matched all
four live geometry pools. Current evidence: `evidence/vianen/angle-sweep/`.

Nothing is required. What a continuing developer could do, from `docs/feature-parity.md` Known incomplete and `docs/validation.md` Not verified:

1. Listen to the sound, race and menu. It was checked by state only.
2. Try real devices: phone, tablet, mobile GPU, safe-area insets, gamepad, joystick, wheel.
3. Try other browsers: Firefox, Safari, iOS, Android.
4. Drive other levels: chase and highway modes, Supercop, the Tour played through. The brief keeps verification on Amsterdam, so this needs the owner's word.
5. Measure steering, turbo, damage, collisions and race end on the original. `tools/reference-86box/` runs it on the 3D path too, on an emulated Voodoo3, with `--resolution 3`: not done yet.

No final critic or review pass: the brief forbids it. Verification stays on one level, etappe 0, Amsterdam.
