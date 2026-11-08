# Changelog

## Unreleased

Network races for up to eight players. [docs/multiplayer.md](docs/multiplayer.md).

### Added

- The main menu's `Internet` button opens the multiplayer screens. One player names and hosts a server, the others join it from a list. The host picks etappe, laps and difficulty, everyone picks a car, and all start together.
- Each browser runs its own race. The other humans drive the AI racer slots, with their AI switched off, and an eighth player gets an extra car. Standings and name tags are drawn over the race.
- `tools/lobby.mjs`, the lobby and relay, served on `/lobby` by `npm start` (`--lan` for other machines), and on its own by `tools/lobby-server.mjs`. Without a lobby, as on a static site, the browsers meet through the public PeerJS broker and connect over WebRTC (dependency `peerjs` 1.5.4).
- `.github/workflows/pages.yml`: the site on GitHub Pages at a2racer.meertens.dev.
- `tools/check-multiplayer.mjs` (Node, up to eight races in one process) and `tools/check-multiplayer-browser.mjs` (headless Chromium).

## 1.1.7 — 2026-11-06

The shadows under the other cars no longer jump. [Release notes](docs/releases/1.1.7.md).

### Fixed

- The blob shadows of the other cars are one shape rewritten for each car. Between ticks the renderer matched each with the shadow of the tick before by draw order, which shifts when a car comes within range, so a shadow was matched with another car's and drawn a tick ahead of its car: the same fault as the tail lights in 1.1.6. They now pair with the nearest shadow.

### Added

- `tools/check-pairing.mjs`: every draw's pairing between ticks against the nearest free one, per mesh.

## 1.1.6 — 2026-11-06

The tail lights no longer flicker. [Release notes](docs/releases/1.1.6.md).

### Fixed

- Car lights, and cars of one model, share a mesh. Between ticks the renderer paired each draw with the same draw of the tick before by order, which shifts when a car or light comes into view. A tail light was then blended from another light, or drawn a tick ahead of its car. A shared mesh whose draws move now pairs each draw with the nearest one of the tick before.

### Added

- `tools/check-lights.mjs` and `tools/check-tail-glow.mjs`: the pairing of the lights, and the glow against its car per presented frame.

## 1.1.5 — 2026-11-04

The HUD no longer vanishes in a dense mud or water spray. [Release notes](docs/releases/1.1.5.md).

### Fixed

- Each spray particle takes a world-matrix row in the renderer, and there were 1,024 per tick. A dense spray used them up before the HUD, whose draws then all took the last row and landed off screen. Now 4,096, more than the game's spray can take.

### Added

- `tools/check-hud-spray.mjs`: the HUD in every frame with rows taken as a dense spray would.

## 1.1.4 — 2026-11-04

No more black road and sky in Chromium on native Wayland. [Release notes](docs/releases/1.1.4.md).

### Fixed

- The game's canvas is now opaque. three.js gave it an alpha channel and the game's draws leave alpha below 1, which a native Wayland compositor shows as see-through: black road, ground and sky, and shifted colours. Windows, XWayland and headless browsers ignored it.

## 1.1.3 — 2026-11-03

The wheels no longer pulse. [Release notes](docs/releases/1.1.3.md).

### Fixed

- Each car's wheels have their own matrix and turn about 60 degrees per tick at speed. Blending that matrix element by element between ticks shrank and skewed the wheels halfway, by up to a third. A matrix turning more than 20 degrees in a tick now keeps the latest tick's rotation and blends its position only.

### Added

- `tools/check-wheels.mjs`: the size of the wheels as drawn between ticks.

## 1.1.2 — 2026-11-03

The player's shadow no longer jitters under the car. [Release notes](docs/releases/1.1.2.md).

### Fixed

- The game cuts the player's shadow into new polygons every tick, which the port could not pair between ticks, so it drew the shadow at the latest tick under a car drawn between two ticks: the shadow slid back and forth by up to a tick of motion. It now moves with the car, as the original draws both from the same tick.

### Added

- `tools/check-shadow.mjs`: the shadow's place in the car's frame per presented frame.

## 1.1.1 — 2026-11-03

The original game icon, from `A2Racer4.exe`, as the browser tab's icon. [Release notes](docs/releases/1.1.1.md).

### Added

- `favicon.ico`: the icon resource of `A2Racer4.exe` (32x32, 256 colours) put together as an icon file without conversion, by `tools/prepare-desktop-icons.mjs`. The web build and every desktop build carry it. The desktop packages already used the same icon for the app.

## 1.1.0 — 2026-11-03

The race now runs the owner's fixes from `A2-Racer-4-Fixes` 1.5.4 that matter at its 60 ticks per second: his own added code, lifted to WebAssembly with the rest of `spel.dat`. Details and checks: [release notes](docs/releases/1.1.0.md).

### Changed

- **Hung cars** (his part 11): a car that stands still for 3 s with an axle off the ground or tipped over goes back on the road.
- **Cars that lift up or float** (part 12): body contacts end when they leave their triangle, so a car no longer climbs an invisible plane nose first.
- **The reset** (part 12): no more `Illegal chunk` at the last section, no landing under the road on etappes 5 and 6 or on a tunnel on 7, lanes freed, and Enter waits only after Enter.
- **Frame rate** (part 13): police brake, Supercop, chase camera, car lighting, skid marks, smoke, mud and water, pickups, animated objects, debris, the speed camera flash and the turbo tank behave as at 25 FPS. The camera lags more and skid marks last longer than in 1.0.0.

### Recompiler

- `tools/recomp/owner-fixes/`: his source, bytes and hook table. `pushad`, `popad`, `pause`, x87 arguments for added functions, tail jumps into inlined helpers, spliced hooks.
- `tools/check-owner-fixes.mjs`: whole bot races on every etappe, reading the state his code keeps.

## 1.0.0 — 2026-11-01

First public release: the browser and desktop port, and the decompile of the original game. Details and what was and was not checked: [release notes](docs/releases/1.0.0.md).

### Port

- The race is the original `spel.dat` (version 1.01), recompiled from x86 to WebAssembly, on a JavaScript host for its Win32 and DirectX 5 calls. Three.js draws its captured Direct3D calls.
- The menu is `menu.exe` rewritten by hand from its forms and code. All artwork, music, speech and text are the originals, in Dutch.
- Davilex's two official updates are in: track 9, the Country etappe, and car 7, the truck De Schaduw.
- Both of the race's paths run: with a 3D card, and with `3D kaart` off the 8-bit software path at 640x480 and 320x200.
- Adaptations, all listed in [intentional differences](docs/intentional-differences.md): any screen shape, render scale, touch controls, gamepad, the traffic fix from `A2-Racer-4-Fixes`.

### Decompile

- `original-game-decompiled/`: all game modules in generated C and assembly (`spel.dat`, `menu.exe`, `setdebug.exe`, `rsc.dll`, `A2Racer4.exe`), `bonus.dso` decoded, unpacked game resources, Ghidra projects, format documents, the game's own files and the two updates. What is left out and why: [releasing](docs/releasing.md#what-is-published).

### Builds

- Desktop packages for Linux x64, Windows x64, macOS Intel and macOS Apple Silicon, in Electron. Static web build. Source archive, decompile archive with manifest, checksums.
