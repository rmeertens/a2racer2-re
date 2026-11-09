# Vianen

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

- The test bot is slow in bends; the AI racers lap at full pace.
- `tools/vianen/check-walls.py` now reports the side streets as openings, on purpose.
- Vianen is in the multiplayer screens and at `?race=1&etappe=vianen`, not in the menu's Quick Race list.

## No way off the map

`tools/vianen/check-leaks.py` draws the track from above (ground: every upward plane; walls: every upright plane at least 12 units high), floods from the road between the walls, and reports each place reached with nothing underneath. It found two kinds of holes, now closed:
- Side streets: the corner houses had no side wall toward the street when the opposite house was taller, and shallow houses in bends left a gap before the street's own fronts. Both led behind the row, where there is no ground. A corner house now always has its side wall, extended to where the fronts begin.
- Bridge ends: the parapet stands at the deck edge (64), the quay and the houses at 82. A wall now closes that corner, so no one slips down to the water and off its far edge.

## Signs

Six houses carry a shop sign for Vianen's singer Jody Bernal (`sign_blue`, `sign_red` in the bouw atlas). The signs are text only, drawn by `sign_texture` in the build script.

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
- **AI Report ads:** six text-only boards for aireport.nl, apart from the Jody Bernal signs.

Decoration (awnings, bicycles, dashes) is added after all buildings, so it never takes a roof's or a wall's place in a full list.

A Lek bridge on the horizon was tried and dropped. The route runs between house fronts the whole way, and the game draws only the chunks ahead of the car, so it was never in view while driving.

## The Stadhuis in view, no see-through backs

- The square stays empty in front of the Stadhuis (`Town.open_square`, two chunks before it to one after): no trees, lamps, tubs or bicycles, so it shows down the Voorstraat.
- The houses were one-sided planes, so across the gracht their backs were see-through. Backs are now drawn where they face water:
  - each street house near water on its own side of the road gets a back wall (`Town.near_water`);
  - each building behind the rows gets a back face when it turns toward a water stretch within 150 m (`Town.backs`).

  Both use house-front textures and are added after the buildings.
- The land beyond each far bank now reaches 160 m out, so the buildings across the water stand on grass.
