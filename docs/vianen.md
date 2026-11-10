# Vianen

The sections below record the track's successive iterations. The current appearance and the
latest checks are described in the final sections below.

## Vianen etappe (sketch)

A track the original never had, an earlier sketch: a loop through the old town of Vianen, an addition of the port and a first sketch. It is etappe 10, a slot the original reserves (`raser.ini [MAPS]` has rows 10 and 11) but never fills. It is offered in the multiplayer screens (`Vianen (schets)`), alone or with others, and directly with `?race=1&etappe=vianen`. The menu's own Tour and Quick Race do not list it.

## The route (second version)

About 1,360 m and 106 chunks, drawn along the streets (`LAP` in `build-track.py`, no longer routed by shortest path):

1. Up Voorstraat from the Grote Kerk past the market stalls and the Stadhuis.
2. Through the Lekpoort, and up a ramp onto the dike, 4 m above the town (`DIKE_UP`).
3. East along the moat's north side, then down.
4. South along the east moat, past a white drawbridge.
5. West along the south moat, back to the church.

Where the OSM water polygons lie beside the road, the side gets no houses. Instead it has a brick quay edge with white railings, a grass bank down to the water, the far bank and trees (`water_sides`). The market stalls are wooden counters with striped awnings against the houses (`market`). Ground heights per chunk (`Town.lift`) go into every point, the waypoints and the chunk positions.

## The first route

About 920 m and 72 chunks. From the Grote Kerk end of Voorstraat north past the Stadhuis and through the Lekpoort, west along the dike, south down the parallel streets, and back east to the church. The streets come from OpenStreetMap; bends are rounded so that none is tighter than 26 m, so the loop follows the real streets only roughly.

## How it is made

`python3 tools/vianen/build-track.py` reads `source/assets/vianen/` and writes `public/assets/vianen/` and `public/assets/loading/e10*.png`:

- **Track files** in the original layouts (`original-game-decompiled/docs/formats/game-data.md`). `.rmp`: per chunk two road quads, two pavements and a facade on each side; at the Lekpoort, pillars and the tower over the road. `.pmp`: chunk positions and triggers: chunk 0 marker, start and finish on chunk 11, finish valid on chunk 12, so the start chunk is 10. `.dmp`: one waypoint per chunk and lane, the right lane with the race and the left one against it, as on the original tracks. `.omp`: the start banner and five pickups. `.cmp` and `.pth` are empty: no rails, no traffic or police paths.
- **Textures**, through `raser.ini [MAPS]` row 10. `vn_weg.tga` is the herringbone klinkers, `vn_gras.tga` the pavement, and `vn_gevel.tga` a 1024×1024 atlas of facades: the Lekpoort, the Stadhuis, the Grote Kerk, and eight rows of houses. All are cut from openly licensed Wikimedia Commons photos, and the black and white ones are tinted. Names not in `rcs.img` are read as loose files, so the archive is unchanged.
- **The slot.** `source/host/vianen.js` adds, in memory and not saved: the track files, `etappe10.ini` and `e10_anim.ini` (copies of Amsterdam's; its start fly-by markers are switched off), `opponent.ini` values for etappe 10 (Amsterdam's), and the `[MAPS]` row. The race reads the archive lists of Amsterdam, whose objects it places (`RaceRunner.load`). Records are kept under track 10.

Sources and licences: `public/assets/vianen/ATTRIBUTION.md`, `source/assets/vianen/README.md`.

## Checks

- `node tools/vianen/check-vianen.mjs --seconds 90`: Node, no renderer. Boots etappe 10 and lets the bot drive. On 2026-11-08 it lapped the track and finished in about 70 s, and the race wrote `finished=1` to `game.ini`.
- `node tools/vianen/shots.mjs`: screenshots at the start, the Stadhuis, the Lekpoort, the dike and the Grote Kerk, in headless Chromium with the bot at 4× speed. `evidence/vianen/`.
- `node tools/check-multiplayer-browser.mjs --players 2 --seconds 10 --track vianen`: a network race on Vianen, all checks passed.

## Houses (third version)

The house fronts are drawn by `tools/vianen/facades.py`, not cut from photos: eight Dutch town-house types on the key colour, so the gable's outline stands against the sky. There are stepped, bell, neck and spout gables, and cornice fronts. They have white-framed sash windows, shutters (the Stadhuis's red and white, or green), doors and black shop fronts. The palette and details follow the owner's photos: red-brown and dark brick, white and cream plaster, charcoal glazed roofs. A gable front has its ridge running back from the street, a cornice front along it. The market stalls are tables of produce under striped awnings on two white poles. The dike is 8 m up, with a hump bridge on its straight that lifts a fast car off the road, and a lower hump on the south moat road (`HUMPS`).

The owner's photos stay for the Lekpoort, the Stadhuis, the Grote Kerk, the paving, the brick, and the canal's water and grass. They now sit in the building atlas `vn_bouw`, drawn with the walls.

## Bridges, side streets, the town behind

- **The arched bridge.** The hump on the dike is the brick bridge with three arches from the owner's canal photo (`arched_bridge`). Its photo faces run from the water up to the road on both sides. It has water on both sides, a narrower deck, brick parapets with a stone cap, and the lock's dark railings.
- **The drawbridge,** after the owner's photos of the one at the lock: black steel, not white (`drawbridge`). It stands across the road on a three-chunk crossing of the east moat. Two tall posts carry a boxed top beam with a white top, with white cross-bracing between them high above the cars. Balance arms run on top, lanterns stand at the corners, and dark railings line the deck.
- **Side streets** where a real OSM street leaves the route at about a right angle (`side_streets`, `side_street`): twelve on this lap. Each is an opening in the house row and a narrow street 26 m deep between house fronts, closed by a house. A car can drive in.
- **The town behind the rows** (`building_fronts`): the 260 OSM building walls nearest the route beyond the street rows, where they face the road, get drawn house fronts with gables. Vianen's own building plan rises behind the first row.

## Photos

The facades, the Lekpoort, the Stadhuis, the Grote Kerk's tower and nave window, the herringbone road, the cobbled pavement and the brick come from the repository owner's own photos (`source/assets/vianen/own/`). `OWN` in `build-track.py` names a quad in a photo, and `own()` straightens it into its atlas cell with a perspective transform. The atlases are laid out at 1024×512 and 512×256 and saved stretched to squares, because the race samples non-square textures wrongly. Vianen therefore needs the middle texture memory setting, which `installVianen` sets for its race.

## 3D buildings

The track's planes now build the town in 3D. Houses have facades from the photos, gabled tile roofs, and end walls with gables. The Lekpoort is a tower over the road, with its passage and a slate spire with a white lantern. The Stadhuis is a stone block with battlements, and the Grote Kerk a nave with a steep slate roof and a tower with a spire behind a churchyard. Along the dike there is grass, a low stone edge and lime trees, and the straights have lamp posts. Trees and lamps are crossed quads on the key colour (255, 0, 127), which the game draws see-through. Textures: `vn_weg`, `vn_land`, `vn_gevel` and `vn_bouw` (`raser.ini [MAPS]` row 10). A chunk's lists are full at 16, 24, 12 and 12 planes, so a landmark's planes go to neighbouring chunks.

## A short lap and the view distance

Each tick the race runs object handlers within 2 × VISIBLECHUNKS chunks of the player (`0x0044cbb9`, `FUN_004a9870`). `FUN_004af5a0` wraps that window around the lap, wrongly when the window reaches past both ends at once. That happens only on a lap shorter than 4 × VISIBLECHUNKS chunks. The original's laps are about 360 chunks; Vianen's first lap had 72. With the shipped 25, chunks 22 to 49 left the player's own car outside the window. Its handler (`FUN_0044ea60`) did not run there, so the wheels went, steering stopped, the driven-chunk count and the reset chunk (`0x6fba7c`) froze, and the reset key sent the car back to chunk 21. `installVianen` caps VISIBLECHUNKS at a quarter of the lap's chunks (`vianenVisibleChunks`; 25 for the 106-chunk lap), and its restore() puts the player's value back, since `game.ini` is saved.

Checked on 2026-11-08 by counting the player handler's calls per second in a headless bot lap: 60 every second of the lap. The driven count rose all lap and the bot lapped without a reset. Against Amsterdam over the same kind of drive, the body's vertical speed averaged 0.084 m/s against 0.22.

## Walls

`python3 tools/vianen/check-walls.py` samples the building line on both sides of every chunk and reports where no upright plane stands. The houses run up to the Lekpoort's tower, and shallower houses fill tight inside bends. A low brick wall closes the churchyard, with a house before the church's tower. Run with a tolerance of 16 units for the tower's width, it reports no gaps. The dike's river side is a low stone edge on purpose.

## Known rough edges

The 96 red-and-white Voorstraat posts are independent native type-22 objects in the
OMP, using the closed octagonal `vn_paal.d3d` model. They have the original game's
10 kg movable-object physics, low rebound and a wooden impact sound: a car can knock them over and keep going.
Their former static RMP rectangles are removed, so a fallen post leaves no invisible
wall behind. They stay displaced for that race and return on a fresh race. The silent
track viewer previews these models at their authored upright poses. This applies to
the small roadside posts; quay railings and trees remain separate scenery.
`node tools/vianen/check-bollards.mjs` checks all 96 native handlers and physically
hits a post, verifies its rotation/displacement and drives through its former base.

All 38 lantern poles are also independent movable objects, using the closed 5.5 m
`vn_lamp.d3d` model: a cast-iron base and shaft, eight glass panes and a pitched cap.
Native type 3 supplies 50 kg, low-rebound physics and a metal impact sound. Their
former static sprites/colliders are removed. The four bridge lantern bases sit fully
inside the deck instead of hanging beyond its edge. They stay fallen until a new
race. The viewer uses the same mesh and authored OMP placements. Check street and
bridge impacts with `check-bollards.mjs --lanterns` and `check-bollards.mjs --bridge`.

The 63 parked bikes use the closed `vn_fiets.d3d` model, with tyres, rims, spokes,
frame tubes, forks, saddle, rear rack, pedals, kickstand and 56 cm-wide handlebars.
Their native type-22 bodies are light and movable. The former zero-width RMP cutouts
are removed; bikes topple and stay displaced after a hit. OMP yaw keeps each bike
parallel to its street, and the viewer loads the same model and placements.
`check-bollards.mjs --bikes` checks model width and closed surfaces, native orientation,
all 63 handlers, a real impact and driving through the former parked position.

Another 48 lightweight targets line the pavements: 12 cardboard cartons, 12 empty
slatted wooden crates, 18 traffic cones and six market chalkboards. Six small
shopfront groups decorate Voorstraat, with four more cone groups around the lap.
All use closed 3D meshes and a separate opaque procedural atlas, `vn_fun.tga`.
The native type-22 bodies supply 10 kg, low-rebound impacts; cones use
the bouncier native type-2 behaviour. They tumble or slide away on impact, remain
displaced for that race and return on a fresh race. Their meshes stay intact;
only cartons emit the original game's paper scraps. No static collider
is left behind, and these props consume no RMP scenery planes.

`check-smashables.mjs` checks all 48 transformed mesh footprints against every
road segment: the closest point remains 1.18 m beyond the road edge. Run
`check-bollards.mjs --prop box|crate|cone|sign` to check closed surfaces, all native
handlers, an actual hit/debris callback, persistent displacement and driving
through each former base. All four pass. The full bot lap finishes by 100 seconds
with no missing assets; reverse-view scenery, six sidewalk probes and the map's
boundary check also pass (zero leaks). Local viewer images and impact traces:
`evidence/vianen/smashables/`.

Material effects are assigned per authored object after native race initialisation
by `source/host/vianen-impacts.js`: cartons crunch/rustle and emit paper; crates,
chalkboards and small posts clatter like wood; cones thump like rubber; bicycles
and lanterns clank like metal. Intact wood, rubber and metal objects emit no paper
or shattering fragments. Native sign/cone/paper handlers retain the original hit
state lifecycle; changing the non-cardboard handler leaves each body's mass,
friction, rebound and collision callback intact. No global handler is replaced.
The guard requires etappe 10 and Vianen's assets.

Four original mono PCM sounds are generated deterministically by
`tools/vianen/build-impact-sounds.py` (also called by the track builder). They use
the native positional mixer and the user's effect-volume controls. The sound
registry additions live in memory. Impact checks for all eight prop families
compare the PCM actually submitted to DirectSound with the intended material
sample and check the native paper-emitter counter around the target's handler:
one emitter for a carton, zero for the other seven families. Each observed hit plays
its material sample once. The test parks the car clear before checking the final
fallen pose, so a still-pushing car cannot re-tip the prop during that assertion.

Sidewalk collision edges use a 10 cm rise over a 60 cm bevel (`KERB_HEIGHT` and
`KERB_BEVEL`), meeting the road and pavement without a vertical wall. The former
sharp 20 cm curb could kick the wheel bodies upward when crossing or grazing it.
`node tools/vianen/check-sidewalks.mjs` checks all 212 packed curb profiles and runs
six repeatable curb-crossing / pavement-driving probes in the original game physics.
The flat-pavement probes allow the 10 cm curb plus 2 cm of suspension motion and isolate the ground mesh
by omitting movable posts from that test's OMP. Physical post impacts use the full,
unmodified OMP in `check-bollards.mjs`. Before/after traces are in
`evidence/vianen/sidewalk-collision/`; ordinary impacts with street furniture and the
authored road humps still use the game's collision response.

- The test bot is slow in bends; the AI racers lap at full pace.
- `tools/vianen/check-walls.py` now reports the side streets as openings, on purpose.
- Vianen is in the multiplayer screens and at `?race=1&etappe=vianen`, not in the menu's Quick Race list.

## Dike outbuildings and roof joins

The dike-house follow-up identified undersized background footprints rendered as
multi-storey houses: the tagged garage OSM 277708504 had 9.5 m walls, and a 2.3 ×
2.6 m footprint (794518665) also had 9.5 m walls. These read as detached wall
fragments even though their low-detail shells had faces and roofs. The builder
now respects recorded heights/levels and distinguishes garages/storage buildings
from residential houses. Small ancillary structures use 2.4–2.8 m walls, plain
brick, one garage or storage entrance and a closed bitumen roof. Classification
of untagged small footprints and their heights remains an approximation.

Cornice gable ends and backdrop roof fans now use exact triangle boundaries in
the four-vertex RMP record: a midpoint on one edge replaces the former offset
apex pair. This aligns cap/ridge joins without extra planes. Utility materials
occupy previously unused opaque cells in the existing land atlas. The freed
facade budget admits 60 complete backdrop buildings (39 low utility structures)
and the planned foreground roof details: 45 chimneys and 28 dormers. The resulting
track has 6,360 planes, no dropped planes, and unchanged route and movable-object placements.

For reproducible packed-geometry checks, build with
`VIANEN_BUILDINGS=evidence/vianen/dike-houses/buildings.json python3 tools/vianen/build-track.py`,
then run `node tools/vianen/check-buildings.mjs`. It checks all 60 authored backdrop
volumes with 7,112 interior-to-exterior rays, including roof/wall joins, verifies
outward winding, opaque materials and the two height regressions. Ground closes
the bases; these are not standalone bottom-capped object meshes. Focused local
views check the dike rows, roofs, rear walls and garage entrances. Runtime scenery
recognises all four updated pools; the full bot lap finishes, and the map boundary
check reports zero leaks. Evidence: `evidence/vianen/dike-houses/`.

## Houses beside the arched bridge

The left-hand houses immediately beside the arched bridge (chunks 41 and 46)
have finished exposed ends: ten sash windows preserve the drawn source frame's
proportions, with a brick plinth and roof-edge fascia over the retained solid end
wall. These are details on the approximate street-row houses, not a claim that the
actual Vianen buildings have those exact side-window positions. The four arched
bridge retaining wings are closed masonry volumes with stone foundations/caps,
at the 1.8 m railing height. Previously each was a thin 3 m panel with no top or
edge faces. The masonry is split at road grade so visible brick courses keep their
scale instead of stretching over the foundation's full height.

Regenerate references with
`VIANEN_BRIDGE_ENDS=evidence/vianen/bridge-houses/geometry.json VIANEN_BUILDINGS=evidence/vianen/dike-houses/buildings.json python3 tools/vianen/build-track.py`.
`node tools/vianen/check-bridge-houses.mjs` checks closed/wound wing geometry,
the cap height, road clearance and all ten end-window aspect ratios in the packed
RMP. The final track has 6,398 planes, no dropped planes, 60 backdrop buildings,
43 chimneys and 28 dormers. Existing route and movable-object files are unchanged.
Close local views of both bridge-facing ends: `evidence/vianen/bridge-houses/`.

## No way off the map

`tools/vianen/check-leaks.py` draws the track from above (ground: every upward plane; walls: every upright plane at least 12 units high), floods from the road between the walls, and reports each place reached with nothing underneath. It found two kinds of holes, now closed:
- Side streets: the corner houses had no side wall toward the street when the opposite house was taller, and shallow houses in bends left a gap before the street's own fronts. Both led behind the row, where there is no ground. A corner house now always has its side wall, extended to where the fronts begin.
- Bridge ends: the parapet stands at the deck edge (64), the quay and the houses at 82. A wall now closes that corner, so no one slips down to the water and off its far edge.

## Signs

Six shop windows carry a portrait poster for Jody Bernal (`jody_poster` in the bouw atlas).
The teal, orange and cream artwork uses Kees Spiero's CC0 portrait from 2001 as its
identity reference, with large lettering and a visible face. Source, finished artwork,
licence and generation prompt are in `source/assets/vianen/posters/`. Its 192×256 atlas
cell and 1.8×2.4 m maximum world dimensions share the same 3:4 aspect ratio. The poster
sits in the display window, below the fascia and clear of the door; `wall_uv` keeps
both street sides readable. The former AI Report boards and their texture cells are removed.

A massive freestanding 9×12 m portrait panel also stands on the open bank beyond
the arched bridge (station 46). Both faces carry readable artwork. The panel has steel
edges and two closed supports buried into the bank, with its nearest edge outside the
road and quay railing. This deliberately fictional advertisement reuses the poster atlas
cell at its correct 3:4 proportions. `VIANEN_VIEWS` exports front and rear inspection cameras.

## The Voorstraat

The Voorstraat, from past the Grote Kerk to before the Lekpoort (chunks 1 to 26), is wide as in the town: its house fronts stand at `VOOR` = 170 from the centre instead of `WALK` = 82, about 34 m front to front. Each chunk side has its own building line (`Town.at`). Where the line steps, the houses' side walls stand down to the ground. Between road and houses is a klinker square with:
- a row of lime trees: a trunk the car can hit, the crown above the cars;
- lamps between the trees;
- red and white posts along the kerb (owner's photo 1453);
- the market against the fronts.

The square's furniture faces oncoming cars, so it shows whole down the long street. It is on the land list, as the rail lists (bouw atlas) are nearly full; the water texture was halved to make room in the land atlas. Lamps and trees elsewhere are now one plane each, facing the road, instead of four. The square is added last, so whatever finds no room is furniture, never a wall.

The Lekpoort has the four corner turrets of the real gate. The Grote Kerk's tower has a low cap instead of a tall spire.

## The landmarks, after the owner's photos

- Stadhuis (photo 1449): the photo front in grey stone with battlements on the front and sides, a lower brick wing behind under a slate roof with its gable at the back, and a round stair turret with a slate cone (`Town.dome`).
- Grote Kerk (photos 1457-1459): a steep gable with a little roof over each tall window along the nave, and a west gable behind the tower. The tower has the photo on all four faces (so the scaffolding of November 2026 too), a flat top behind a gallery, and a small white lantern with a cap and a vane.
- `tools/vianen/shots.mjs --views views.json` shoots each landmark from a fixed camera (`VIANEN_VIEWS=path python3 tools/vianen/build-track.py` writes the file). The renderer takes the view matrix from `globalThis.__viewOverride` when it is set.

## In Quick Race

Vianen is the eleventh Quick Race track, after the original's ten. It is not in the Tour.
- `vianenTrack(index)` in `source/host/vianen.js` is its track record. `readStatic` in `source/menu/data.js` adds it to the tracks and to the Quick Race list.
- `trackFilesExist` passes for it, since its files are fetched when its race starts.
- `App.startRace` wraps a race on etappe 10 in `withVianen`, as the URL route and the network race do.
- The menu pictures come from `tools/vianen/menu-images.py`, in `public/assets/vianen/menu/`:
  - a round slideshow: frame 0 a map of the lap with its landmarks, frames 1–5 views of the track;
  - the `trname10` name banner.

  `App.start` adds them to the menu's image index.
- The network lobby keeps its own Vianen entry and leaves this record out.

## More of the town

- **Street name signs:** blue Dutch signs with the real names from OSM. One where the route enters a street, and one at each side street's corner with that street's name. The eight commonest names get atlas slots.
- **Bicycles:** parked against house fronts on the narrow streets, and by every third tree on the Voorstraat.
- **Road dashes:** white dashes along the road edges outside the Voorstraat, as by the Grote Kerk.
- **Plant tubs:** wooden tubs with shrubs between the Voorstraat's limes, where there is no lamp.
- **Shop awnings:** striped sun awnings over the shop fronts on the narrow streets. They are left off the Voorstraat, where the market stands.
- **Roof details:** closed dormers with a rectified double-window photo from the white corner
  house in photo 1439, and modest brick chimneys following photos 1439 and 1446. Whole
  five-face volumes use remaining plane budget after the foreground and background buildings.

Decoration (awnings, bicycles, dashes) is added after all buildings, so it never takes a roof's or a wall's place in a full list.

A Lek bridge on the horizon was tried and dropped. The route runs between house fronts the whole way, and the game draws only the chunks ahead of the car, so it was never in view while driving.

## The Stadhuis in view, no see-through backs

- The square stays empty in front of the Stadhuis (`Town.open_square`, two chunks before it to one after): no trees, lamps, tubs or bicycles, so it shows down the Voorstraat.
- The houses were one-sided planes, so across the gracht their backs were see-through. Backs are now drawn where they face water:
  - each street house near water on its own side of the road gets a back wall (`Town.near_water`);
  - each building behind the rows gets a back face when it turns toward a water stretch within 150 m (`Town.backs`).

  Both use house-front textures and are added after the buildings.
- The land beyond each far bank now reaches 160 m out, so the buildings across the water stand on grass.

## Realism pass (10 November 2026)

The reference is the owner's photographs in `source/assets/vianen/own/`, especially 1439, 1444
and 1446, checked against the municipality's [townscape guidance](https://zoek.officielebekendmakingen.nl/gmb-2021-163817.pdf)
and the [RCE entry for Voorstraat 1](https://monumentenregister.cultureelerfgoed.nl/node/737414).
The guidance describes individual, small-scale buildings of different periods forming a nearly
continuous street wall; the RCE entry describes a plaster cornice front and pitched roof beside
the Lekpoort. These support a quieter mix of brick, plaster, cornices and occasional gables,
rather than making every house an ornate gable with red-and-white shutters. No external photos
were added to the game.

- `facades.py`: finer, muted brickwork; recessed tall sash windows with sills and reflections;
  panelled doors; dark green and brown shop fronts; drainpipes and cornice shadows. The floor
  count now means upper floors. Houses have about 3 m per storey and varied plot widths, with
  fewer gables and mostly dark roofs. Shared side walls match plaster or brick fronts. A back
  uses the same gable silhouette as its front, closing gaps below the roof.
- `building_fronts`: 100 complete background buildings on simple convex OSM footprints replace
  the floating facade strips. Each has walls on every side and a roof. Complex courtyard plans
  are omitted. Whole buildings are admitted only when their local plane budget has room, after
  the foreground, water-facing backs and furniture have been placed.
- `own()`: a projective photo transform replaces the bilinear QUAD transform, which distorted
  oblique landmark facades and paving.
- Trees, lamps, posts, planters and stalls have smaller, more plausible dimensions. The previous
  Voorstraat crowns reached about 26 m above the street; the new trees reach about 12 m.
- The six Jody Bernal portrait posters replace the previous text-only banners. Their face and
  lettering keep the artwork's proportions, with the former technology ads removed. `wall_uv`
  corrects mirrored lettering on right-hand facades and street signs.

The route, race executable, physics and renderer are unchanged. This remains a game-scale
interpretation of Vianen: the repeating house designs, ad locations and background heights are
authored approximations, not a surveyed reconstruction.

Rebuild with Python, Pillow and NumPy:

```sh
VIANEN_VIEWS=/tmp/vianen-views.json python3 tools/vianen/build-track.py
npm start
node tools/vianen/shots.mjs --chunks 12,19,26,43,70,100 --out evidence/vianen/realism
node tools/vianen/shots.mjs --chunks '' --views /tmp/vianen-views.json --out evidence/vianen/realism
```

`shots.mjs --browser /path/to/chrome` can reuse an installed Chromium. Fixed-camera checks use
normal speed so the car's original camera does not cull a building before its close-up is taken.

Focused checks on macOS, Node 24 and headless Chromium:

- Build: 106 chunks, 4,536 planes, no dropped planes and no list above the engine's limits.
- `python3 tools/vianen/check-leaks.py`: 170,662 reachable cells, zero leaks.
- `node tools/vianen/check-vianen.mjs --seconds 115`: no missing files, a completed bot lap;
  `finished=1` by 100 seconds, race ended at 114.8 seconds.
- Local browser screenshots of the Voorstraat, gate, dike, canal and four ad variants in
  `evidence/vianen/realism/`; no page errors. These are focused visual checks, not a device or
  performance benchmark.

## Interactive track viewer

Open <http://127.0.0.1:4180/track-viewer.html> after `npm start`. `tools/bundle.mjs` builds a
separate entry point from `source/dev/track-viewer.js`; `track-model.js` reads the RMP/PMP and
uncompressed TGA files. It displays all actual planes (5,897 after the connected-terrain pass), without the race engine's camera
culling. No game instance, cars, pickups or audio are loaded. It is an inspection tool, not a
replacement race renderer.

- The track plan, route slider, previous/next buttons and landmark selector move the camera.
  The route can play automatically, or be scrolled on the slider in quarter-chunk increments.
- Orbit/pan/zoom and WASD/QE allow independent cameras, with route-relative height, offset, yaw
  and pitch controls. The URL hash holds the actual eye and target, so a problem view can be shared.
- Named cameras persist in local storage and can be exported/imported as JSON. Shift-click a
  saved-camera button to remove that camera. PNG capture saves the current unobstructed 3D view.
- A survey renders all 106 stations in the chosen direction into a scrollable contact sheet.
  Select ahead, left, right or behind. Clicking a thumbnail returns to that exact route camera.
- Surface selection identifies the source chunk, pass and plane. The four pass toggles,
  back-face display and wireframe help distinguish missing geometry from texture problems.
- Smooth distant textures uses mipmaps and anisotropic filtering; disable it to inspect
  sampling without those filters. Vianen now also uses these filters in the race renderer;
  the viewer still has different lighting and no race visibility culling.

Additional references inspected through Google Images on 10 November 2026, linked in the viewer:

- [Voorstraat panorama](https://commons.wikimedia.org/wiki/File:Voorstraat_Vianen.jpg): continuous,
  varied fronts, rooflines and awnings along the broad main street.
- [Lekpoort and its adjoining houses](https://www.bezoeklekenlinge.nl/nl/locaties/1496584115/lekpoort):
  the passage opening, tower silhouette and modest cornice fronts at its sides.
- [Stadhuis and its square](https://www.visitutrechtregion.com/nl/locaties/4279647297/stadhuis-vianen):
  the facade's scale relative to surrounding houses and the open space before it.

These are reference links, not new game textures. Canal-image results also included unrelated
stock photos and bridge design proposals; those were not used as evidence of existing buildings.

The initial viewer exposed repeated house designs, paving boundaries, blank side walls, and
missing or disconnected ground/water. The following pass addresses these in the track assets.

Focused viewer checks: build; parsing all 106 chunks and four texture atlases; route interpolation
and malformed input; browser landmark/direction controls, camera persistence across reload,
layer/filter controls, 106-image contact-sheet generation and thumbnail navigation. PNG export
also succeeded, and the browser reported no warnings or errors. Evidence: `evidence/vianen/viewer/`.
Existing gameplay files were not changed for this viewer.

## Connected terrain and second art pass, 10 November 2026

`tools/vianen/surfaces.py` triangulates continuous OSM/authored canal water, sloped banks and
surrounding ground. Parcel pads keep the foreground houses grounded; background buildings
stand at town elevation rather than at a nearby bridge's height. Footprints over water are
excluded. Terrain is divided between nearby chunks and excludes the playable road/pavement
corridor, so it does not add overlapping road collision surfaces.

Paving is now a seamless, periodic herringbone pattern with separate pavement, grass and water
atlas regions. Sixteen front designs replace eight: twelve drawn designs and four rectified
fronts from the owner's photographs. Fronts vary in width and roof profile, adjacent copies
are avoided, and brick end walls receive sash-window detail. Some plaster end walls remain
plain, as do many actual adjoining walls; the layout remains a game-scale interpretation.
Sparse, properly raised shop awnings, open branching autumn trees, smaller lamps, and lower
quay/bridge parapets reduce the oversized scenery. The drawbridge frame and Stadhuis are
shorter, and the Lekpoort now has a shaped arch and tunnel ceiling rather than a rectangular
opening. Six Jody Bernal portrait posters remain; the AI Report boards have been removed.

The Vianen race renderer uses mipmaps, modest anisotropy and smooth world-texture sampling
to reduce shimmer. This is selected only for etappe 10; original tracks and HUD sampling keep
their existing state. The viewer now reflects the D3D world into Three's camera coordinates,
including triangle winding and saved-camera conversion, so signs are readable on both sides
and left/right views match the game. Transparent key texels carry black RGB and are
unpremultiplied after filtering to prevent magenta tree fringes.

Rebuild dependencies include Shapely 2.1 or newer:

```sh
python3 -m pip install -r tools/vianen/requirements.txt
python3 tools/vianen/build-track.py
npm run bundle
```

Focused verification of the final geometry:

- 106 chunks, 5,897 planes, 77 background buildings; no dropped planes or over-capacity lists.
- Terrain: 602 ground, 532 bank and 230 water triangles.
- Boundary flood fill: 171,017 reachable cells, zero leaks. The checker now measures low sloped
  walls using distinct horizontal endpoints, avoiding false tall-wall classification.
- `node tools/vianen/check-vianen.mjs --seconds 130`: no missing files; bot reached `finished=1`
  by 115 seconds. This confirms a lap is possible, not that every collision/AI recovery is ideal.
- Generated ahead/left/right views at all 106 stations (318 captures), inspected route contact
  sheets, and checked a visible local race. No browser warnings or errors. Final viewer evidence:
  `evidence/vianen/realism-2/`. Earlier evidence folders describe earlier passes.

Local player evaluation is next: `http://127.0.0.1:4180/?race=1&etappe=vianen`. The silent viewer
is available alongside it at `http://127.0.0.1:4180/track-viewer.html`.
At this stage the race still used the original chunk visibility range, so landmarks could
appear in parts. The later 16-angle pass below replaces that static-scenery index window for
Vianen's 3D renderer; the full-geometry viewer alone could not verify this fix.

## Grote Kerk corner sightline

At the owner's request, the church, tower, churchyard and boundary wall now stand on the
opposite side of the street, outside the returning corner. This deliberately departs from
the OSM landmark side to expose the nave and tower in the driver's forward view at stations
101–103. The old side fills back in with street buildings; generated church reference cameras
use the same new side. Moving the reserved plots also regenerates house, sign and side-street
choices through the existing seeded generator.

Rebuilt track: 5,915 planes, zero dropped planes, 78 background buildings; boundary check
171,224 reachable cells and zero leaks. The bot completed its lap (`finished=1` by 90 seconds,
race ended at 108.1 seconds). Local viewer approach/corner checks had no warnings or errors;
evidence is in `evidence/vianen/church-move/`.

## Photo rectification and wall mapping

All nine active photo regions (four house fronts, Stadhuis, Lekpoort, church window bay,
church tower and bridge arches) now use control points on the photographed surface rather
than rectangular image bounds. The Stadhuis crop excludes its side wall and uses the stone
front below the separately modelled battlements. The church crop is one planar window bay,
excluding the projecting buttress and adjoining window. The cream-house crop stays within
the fully photographed bays instead of extending past the visible cornice.

`photo_warp.py` solves a normalised projective homography, validates the convex source quad
and its projective horizon, and supersamples before atlas downsampling. The race's existing
world-vertex shader already interpolates UVs with camera perspective; baking a second camera
view into the texture would skew the facade again. Atlas cell pixel proportions need not
equal wall proportions because the UVs address the complete rectified image.

Stadhuis and church photos now use the same facing-aware UV helper as the house fronts.
Mirroring a cropped region swaps its own UV bounds instead of resetting to the whole cell.
Both gate faces keep a continuous full-image mapping over the piers and arch pieces; the
far face reverses the whole image, preserving the joins. The gate opening is now 110 units
wide and approximately 94 high at the crown, matching the rectified photographed arch more
closely and removing the conspicuous smaller second opening.

Verification: `python3 tools/vianen/check-photo-warp.py` passes four focused checks, including
recovery of a synthetic perspective photograph of a colour grid, interior/edge projection,
invalid quads, all active source crops and UV orientation in both wall directions. Inspected
the rebuilt Stadhuis, house fronts, church and gate locally with no browser warnings/errors.
Track remains 5,915 planes with zero dropped planes. Boundary check: 171,225 reachable cells,
zero leaks. Bot lap completed (`finished=1` by 95 seconds, race ended at 112.7 seconds).
Evidence: `evidence/vianen/photo-warp/`, including a Stadhuis texture comparison.

These are manually calibrated photographs on game-scale building faces. Their silhouettes
and dimensions are still approximations, and occluding signs/scaffolding in the source photos
remain in the textures. A planar correction does not reconstruct projecting ornament or
recover hidden parts of a building.

## Flat scenery visible in reverse

Trees, lamps, bollards, planters and bicycles were authored as one-sided quads; the Voorstraat
props faced approaching traffic and disappeared from the rear. All flat props emitted by
`Town.sprite`, market poles and the church weather vane now carry an explicit two-sided tag:
their U coordinates are offset by 4. Integer texture wrapping retains the original atlas region.

For Vianen world draws only, `D3DRenderer.drawIndexed` adds the reverse winding of each tagged
triangle to the GPU index stream. This keeps the same 5,915 RMP planes and collision geometry,
avoids overflowing the original engine's chunk limits, and keeps normal culling for solid
surfaces and the HUD. The original etappes do not activate this path. The independent viewer
also renders the reverse triangles and maps raycast triangles back to the correct source plane.
Its ordinary “Show back faces” diagnostic is not needed to see these props from behind.

`node tools/vianen/check-scenery.mjs --runtime` checks all 365 tagged props through the actual
indexed-renderer method, verifies opposite windings, wrapped atlas coordinates, and unchanged
solid/HUD/original-track handling. Its live Vianen integration check confirms that the game
submits tagged triangles in forward view, with the camera actually facing rearward, and while
moving in reverse (speed -16.7). The rear-facing local viewer check reported no warnings or
errors; screenshot: `evidence/vianen/reverse-culling/behind.jpg`. The prior lap and boundary
checks still describe the unchanged collision mesh. Edge-on flat sprites remain thin; these
are two-sided cutouts rather than new three-dimensional tree/furniture models.

## Sixteen-angle coverage and closed scenery

The viewer now offers eight street directions (including all four diagonals), an eight-angle
street sweep, and a **16-angle geometry sweep**. The latter adds four elevated diagonal views
at 16 m and four rear-wall/roofline views from 38 m outside the route, on both sides. A complete
run produces 1,696 images across all 106 stations. From/to station controls support focused
checks. Clicking a thumbnail restores height, offset, yaw and pitch as well as route position;
the button count follows the chosen mode/range. Camera offset controls now reach ±60 m.

The wider views found actual missing geometry:

- Added 234 missing rear facades, closing the backs of all 321 main-row houses. Shared-end
  wall suppression now compares full depth and roof profiles, so a tall gabled neighbour
  cannot incorrectly hide a lower cornice roof end. Exposed end walls extend to the ground.
- Side-street facades now form closed cornice houses with roofs, rear walls and both ends.
- Closed the church nave's back and the Stadhuis's rear blocks. Drawbridge boxes have top
  and underside caps; bridge decks have undersides and fascia faces.
- Added 120 raised shoulder/embankment faces outside the pavement, filling the visible slits
  beneath elevated road/house parcels without adding a second drivable road surface.

Foreground closure takes priority over optional OSM backdrop buildings. The final map has
6,178 planes and 49 complete backdrop buildings, with no dropped planes and no over-capacity
chunk lists. Redundant flat-field tiling is reduced to 180 m cells. At dense corners, a closing
wall can use an opaque wall-colour sample in the facade pass when the detail pass is full.
The builder still fails if it cannot fit required geometry.

The race had a separate visibility problem: its native index window could omit only some
planes of a landmark or a large ground patch. `source/render/vianen-geometry.js` recognises
each of Vianen's four static vertex pools by count and sampled positions/UVs, then supplies
the complete authored index list to the existing 3D renderer. This reuses the uploaded static
vertices, textures, depth buffer and camera. Buildings keep normal face culling; tagged props
still receive their reverse triangles. Physics, AI and dynamic-object chunk handling keep the
original limits. The full-pool replacement is confined to Vianen's 3D path; the software path,
HUD and original etappes retain native visibility handling.

Verification of the final assets:

- Generated the full 1,696-view sweep, reviewed elevated/exterior overview sheets and detailed
  landmark/bridge views, and checked thumbnail restoration and a focused 16-view range.
- `node tools/vianen/check-scenery.mjs --runtime`: all four live pools match; 3,344 partial
  index windows exercised. Renderer checks verify complete indices despite partial native
  visibility, two-sided props and unchanged HUD/software/original-track paths.
- `python3 tools/vianen/check-leaks.py`: 171,203 reachable cells, zero leaks.
- `node tools/vianen/check-vianen.mjs --seconds 130`: no missing files; completed bot lap,
  `finished=1` by 95 seconds, race ended at 111.9 seconds.
- Visible local race: whole distant gate and scenery, no browser warnings/errors. These
  checks do not constitute a new performance benchmark or a test of every free-camera position.

Evidence: `evidence/vianen/angle-sweep/` contains selected 16-view sheets, before/after comparisons,
and viewer/race screenshots. Exterior surfaces are closed in the checked views; free cameras
can still be placed inside solids or below the authored terrain.


## Final five improvements

The final finishing pass adds five details without changing the route or existing static
collision geometry:

1. **Fuller Voorstraat limes.** Forty-eight extra two-sided canopy cards cross the original
   foliage at right angles. Side views retain branches and leaves instead of showing only a
   thin edge. These are crossed cutouts, not volumetric trees; canal-bank trees are unchanged.
2. **Shop-window displays.** The drawn shop fronts now contain recessed bakery shelves,
   flowerpots or books, with a glass reflection. The owner's four rectified photo fronts are
   pixel-identical to the previous revision. The display contents are fictional scenery.
3. **Darker canal banks.** Height-based per-vertex colour darkens 508 bank faces toward the
   waterline. It uses the same terrain vertices and texture coordinates.
4. **Flush street covers.** Sixteen grated drains sit beside the curb and eight circular
   manhole covers break up the road paving. They are placed only on flat chunks, 3.5 mm above
   their supporting surface. All 24 use native OMP type 0 with no physics body or hit handler.
5. **Benches that topple.** Four closed wooden/slatted benches stand along Voorstraat, facing
   the street. Native type 3 supplies a 50 kg movable body. They play the wood impact sample
   once when hit and emit no paper. They use the same material effects as the other props.

The new canopy layers also use non-colliding type 0. The map retains 6,398 RMP planes;
all static positions, UVs and triangle indices match the previous revision. OMP object count
rises from 252 to 328. The extra atlas is 256×256 pixels, with existing tree and wood materials
reused for the canopy layers and benches. `tools/vianen/details.py` builds these details;
the race and silent track viewer load the same models and textures.

Validation on the final generated assets:

- `node tools/vianen/check-finish.mjs`: all 72 decorative objects have null native body
  pointers, disabled physics and no collision handlers; all four benches have physics bodies
  and resolved wood samples. Models and textures load. Three optional original announcer
  variants are absent from the source game archive and are recorded separately in the result.
- `node tools/vianen/check-bollards.mjs --prop bench`: actual native impact topples a bench,
  displaces it 2.21 m and permits the car to pass its old base. One wood sound, zero paper.
- `node tools/vianen/check-sidewalks.mjs`: all six crossing probes pass, maximum rise 15.3 cm.
- `node tools/vianen/check-scenery.mjs --runtime`: all four pools match; forward, rear-facing
  and reverse-driving visibility checks pass.
- `node tools/vianen/check-vianen.mjs --seconds 130`: bot finishes by 95 seconds; all Vianen
  assets load. Boundary check has zero leaks. Building and bridge-house closure checks pass.
- Inspected six close local viewer views covering all five additions, with no browser warnings
  or errors. Screenshots and importable viewer cameras are in `evidence/vianen/final-five/`.

These checks cover the added details and the existing single Vianen race; they are not a new
performance benchmark or exhaustive camera sweep.

## Road paint collision fix

The white edge dashes were 146 separate RMP land planes, 0.8 world units (8 cm) above the
road. As native terrain they could contact the wheels rather than behaving as paint.
They now appear inside a marked-road texture variant, on the existing road faces at grade.
The variant reuses the previously unused pavement cell in `vn_weg.tga`; texture dimensions
and memory use are unchanged. The left half of a marked street mirrors the cell to keep
the stripe beside its outer edge. Wide Voorstraat sections and bridge decks remain unmarked.

The raised planes are removed from the packed map, leaving 6,252 static planes. All other
static vertices, colours and triangle indices are unchanged; only road UVs switch to the
painted material. Temporary planning reservations preserve the existing selection of 60
backdrop buildings and 43 chimneys/28 dormers, so this collision fix does not change town
density. No new objects or physics bodies are added.

`node tools/vianen/check-sidewalks.mjs --road-markings` verifies that the old raised planes
are absent, the texture contains paint, and every painted road vertex remains at grade.
Four native probes drive with the outer wheels on the edge line, on both sides and in both
directions. Before the fix, measured chassis rises ranged from 0.9 to 2.4 cm; after the fix
none rose above the settled starting height (about 3 mm of further settling). The largest
upward speed fell from 0.57 to 0.32 m/s. These probes demonstrate small marking-induced
motion; they did not reproduce a large launch.

The six existing sidewalk probes, runtime forward/rear/reverse visibility checks and building
closure checks pass. The bot race finishes by 95 seconds and ends at 111 seconds with all
Vianen assets loaded. The local viewer shows both edge lines flat on the paving with no
console warnings or errors. Evidence: `evidence/vianen/road-paint/`.


## Breakaway market stalls and shop awnings

All 15 market stalls and 20 red/white shop awnings now use movable native models. Each
market consists of a wooden counter, a separate cloth canopy with metal edge bars, and two
white support poles. Striking the counter or either support releases its canopy. The shop
awnings use four widths (3.6, 4.8, 5.6 and 6.4 m), fitted within their existing house fronts.
They stay mounted until actual contact, then detach and fall. They are above a normal car;
the implementation does not add an invisible ground-level trigger to make them hittable.

Counters use native type 3 (50 kg); poles, canopy roofs and shop awnings use type 22 (10 kg).
The per-object effect setup assigns wood to counters and metal to the frames/poles, with no
paper emission. These are separate rigid components, not a cloth simulation or wood fracture
system. `tools/vianen/market.py` creates closed meshes and a 512×512 atlas reusing the existing
produce, wood and striped-cloth art. Both the race and silent viewer load the same assets.

`VianenMounts` in `source/host/vianen-market.js` holds the 35 unhit hanging parts at their
original pose. It watches native hit state, permanently releases the part on contact, and
wakes its Ipion body through `0x4f32e0`, the native detach/wake operation. Each market roof
watches only its own counter and two poles. Released parts keep the original physics and hit
lifecycle and are never snapped back to their mounts. Original tracks have no mounted props.

The old 130 static market/awning planes are absent from the final RMP, including their
collision surfaces. Other static vertices, UVs, colours and indices are unchanged. Temporary
planning reservations preserve the existing buildings and roof details. The map now has
6,122 static planes and 408 authored OMP objects. The native 525-frame animation pool is
kept within budget by omitting unused Amsterdam scenery animations from Vianen's in-memory
track configuration; shared car, HUD, particle and bonus registries remain intact. The
focused impact run allocates 455 of those frames.

Validation of the generated assets:

- `check-bollards.mjs --prop stall`: counter hit plays one wood sample and zero paper;
  its separate canopy releases and falls 2.67 m. The counter moves and the car passes its
  former location.
- `check-bollards.mjs --prop awning`: all 35 hanging parts remain mounted through countdown;
  an actual airborne car contact releases the shop canopy. It plays one metal sample with
  zero paper, falls 2.63 m and stays detached. The house behind it remains solid.
- `check-bollards.mjs --prop marketpole`: closed support-pole geometry, native metal impact,
  toppling, displacement and passage through the former base.
- Six sidewalk probes, building/bridge closure, non-colliding cover checks and live
  forward/rear/reverse visibility checks pass. All four static pools still match.
- The bot finishes by 95 seconds; race ends at 111 seconds with all Vianen assets loaded.
  Local intact stall/awning views have no browser warnings or errors.

Evidence, native impact traces and importable viewer cameras are in
`evidence/vianen/breakaway-market/`. These are focused Vianen checks, not a new performance
benchmark or a test of every possible crash.
