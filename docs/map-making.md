# Making a new map

Use this workflow when adding a custom track to this port. It records the practical lessons
from Vianen: establish a drivable route, make the town recognisable from photographs, close
the geometry, and inspect it in both the viewer and the original race engine. Improve the
largest visible defects before adding small props.

Start with [the project guide](LLM_GUIDE.md), [Vianen's implementation notes](vianen.md),
and the [native file formats](../original-game-decompiled/docs/formats/game-data.md).
Vianen is a working example, not a generic map SDK: its slot, route, filenames, viewer,
checks and renderer integration contain Vianen-specific assumptions.

## Start with references and a recognisable route

- Collect an overhead map, street-level photographs in both travel directions, and close
  views of the landmarks, bridges and ordinary houses. Include roofs, exposed end walls,
  canal banks and the approaches to corners. One attractive front view is insufficient.
- Use image search to discover references, then record the original page, photographer,
  licence and intended use. A search thumbnail is not permission to redistribute an image.
  Keep source images and crop coordinates in `source/assets/<map>/`, with attribution.
  Prefer owner-supplied or appropriately licensed photos for shipped textures.
- Use OpenStreetMap for road connections, footprints, water and building classifications.
  Keep the input snapshot so regeneration does not depend on a changing network response.
  Honour its attribution and licence, as the Vianen source notes demonstrate.
- Choose the important street sequence explicitly. Vianen's active route is `LAP` in
  `tools/vianen/build-track.py`; the older shortest-path helpers in `route.py` do not define
  its current lap. Smooth bends enough for racing while preserving recognisable junctions.
- Place landmarks for recognition from a moving car. Check what can actually be seen on
  the approach and through a corner; trees and nearby house rows can hide a correct model.
  Record intentional gameplay changes to real geography, such as moving a landmark.

Block out the road, heights, bridges, building masses, start grid and finish first. Run a
lap before spending time on windows or advertisements. Use a car, doorway and storey height
as scale references. Vianen uses **10 world units per metre**, Y up, and a left-handed route
frame; do not confuse a half-width constant with the full road width.

Leave room for the start grid and check ordered waypoints, lane direction, lap wrap and
finish triggers. Short loops also need suitable native visibility ranges: inspect
`vianenVisibleChunks` in the loader rather than inheriting an original long track's setting.
Changing the route length affects these systems as well as the picture.

## Keep generation reproducible and integration explicit

Edit maintained builders and `source/`, then regenerate assets and bundles. Do not hand-patch
the RMP or generated `public/src/` files. Separate route data, photo rectification, facade
drawing, terrain and small models where practical; keep procedural randomness seeded.

The useful Vianen entry points are:

- `tools/vianen/build-track.py`: route, chunk budgets, native files, buildings and atlas setup.
- `tools/vianen/photo_warp.py`, `facades.py`, `surfaces.py`, `details.py`: photo projection,
  drawn fronts, connected terrain and small scenery models.
- `source/host/vianen.js`: asset list, native slot/animation registration and race setup.
- `source/host/vianen-impacts.js`: material sounds and object hit effects.
- `source/dev/track-model.js`, `track-viewer.js`: readers and the silent inspection viewer.
- `source/render/vianen-geometry.js`: Vianen's complete static-pool visibility handling.

A new map needs its own asset namespace, slot/launch integration, map selection, loading
art and attribution. Register each model, animation, texture and sound in the race loader
and the viewer. Make restoration of temporary race settings explicit. Check native slot
availability instead of overwriting an original track or silently replacing Vianen.

The native animation frame pool holds 525 frames. Registering a few more models can overflow
it even when the object count still fits. Vianen's loader keeps only the copied Amsterdam
track animations it actually uses (sky, reflections and the start zeppelin) before appending
its models. Leave shared vehicle, HUD and bonus animations intact. Check the live allocation
and a full race after adding models; do not enlarge the native pool blindly.

The native files have different jobs: RMP contains static planes; PMP contains chunk
positions and triggers; DMP contains driving waypoints; OMP places objects. CMP and PTH
cover additional native data that Vianen currently leaves empty. Adding visible roads does
not automatically create traffic or police paths. Inspect the formats and working loader
before extending those systems.

For an existing Vianen checkout, the basic rebuild is:

```bash
python3 -m venv /tmp/a2racer-map-venv
/tmp/a2racer-map-venv/bin/python -m pip install -r tools/vianen/requirements.txt
/tmp/a2racer-map-venv/bin/python tools/vianen/build-track.py
npm run bundle
npm start
```

Run commands from the repository root. The server is normally at `http://127.0.0.1:4180/`.
`npm start` bundles once; there is no watcher. After later source edits, bundle again and
reload. The builder also regenerates loading images: inspect those diffs and keep unrelated
outputs out of the change. A new map needs adapted paths and tooling, not this command block
with only its directory name changed.

## Spend the native geometry budget on complete buildings

RMP has four lists per chunk. The current native limits are **16 road, 24 land, 12 facade
and 12 detail/wall planes**. Vianen's builder names the last two `extra` and `rail`. Budget
required road, terrain, walls and roofs before optional furniture. Fail the build when a
required face cannot fit; silently dropping it creates missing houses and holes. Moving a
face into a nearby chunk's free slot also requires checking its visibility while driving.

- Build houses as closed volumes: front, back, exposed ends and complete roofs. Close
  bridge undersides, fascia, retaining walls and landmark rear blocks as well.
- Suppress a shared wall only when the neighbour covers its full depth and height profile.
  A tall gable beside a lower cornice roof still leaves an exposed end.
- Keep shared roof and gable vertices identical. Use `closed_tri` for boundaries that must
  meet exactly; the older `tri` helper offsets its apex and can leave small seams.
- Check winding and outward normals from outside the solid. Turning off all face culling
  conceals reversed faces and does not supply missing walls.
- Read OSM height, levels and building classification. An untagged garage or shed should
  not inherit a tall townhouse default. Model exposed ends with plinths, cornices and a few
  suitable windows rather than stretching one large facade over the whole side.
- Prefer connected terrain with shared edges around water and elevated roads. Fill visible
  embankment gaps, but avoid overlapping drivable surfaces that can confuse wheel contact.

## Rectify photographs before mapping them onto walls

A rectangular crop from an oblique photo retains the photographer's perspective. Projecting
it onto the game wall adds another perspective and skews the windows.

Pick four corners on **one planar surface**, ordered top-left, top-right, bottom-right,
bottom-left. Use wall/cornice/plinth intersections. Exclude roof silhouettes, side walls,
buttresses and other projecting parts; those need separate surfaces. Rectify the quad with
a projective homography using `photo_warp.rectify`, then pack the result into the atlas.
Keep the measured wall proportions and check window shapes at front and oblique angles.

Use `wall_uv` and the atlas helpers to keep texture orientation consistent on opposite
walls. Preserve aspect ratios when using a small window patch on an end wall. Leave atlas
sampling insets/gutters to prevent neighbouring cells bleeding through with filtering.
Inspect at racing distance as well as close up: tiny noisy detail often becomes a blur.

Use materials and silhouettes to support the photos: brick or plaster, roof pitch, chimneys,
dormers, sash windows and shopfront proportions. Vary plausible house types rather than
randomly changing every feature. Keep important photographic cells intact when improving
procedural parts of the atlas.

## Separate missing geometry from visibility failures

The viewer must read the same packed geometry, models and textures as the race. It should
reveal defects, not silently add replacement walls. Keep it silent: inspection does not
require booting the race or playing music.

Inspect forward, backward, sideways and diagonally at street height, then from above and
outside the house rows. Vianen's **16-angle geometry sweep** adds elevated, rear-wall and
roofline views to eight street directions. Use a focused station range after a local edit;
use a wider survey when establishing a new map. Save exact cameras, chunk/plane IDs and
before/after images for defects. A free camera inside a solid is not evidence of a missing
exterior face.

Thin trees and signs can disappear edge-on or from behind. Use deliberately two-sided
cutouts, closed models, or crossed canopy cards as appropriate. Vianen tags static cutouts
with an integer U offset and adds reverse triangles only for those tagged surfaces. Do not
apply that convention blindly to every mesh or make all solid buildings double-sided.

If a building is complete in the viewer but partly absent in the race, inspect the native
chunk index window. Vianen's renderer recognises its four static vertex pools from the
loaded track and supplies their complete indices on the 3D path. This is practical for this
small town, not proof that drawing an arbitrarily large map in full is affordable. Scope any
equivalent fix to the new map and preserve original tracks, HUD and software rendering.
Test actual rear-facing and reverse-driving views; a front-facing screenshot cannot cover
the invisible-tree or partial-building failures.

## Make collision and hit effects agree with the object

Use the existing native object behaviours deliberately; see
[track objects](research/gameplay-systems.md#17-track-objects) for the full dispatch table.
The following type numbers are decimal:

- **0:** decorative scenery with no physics body. Appropriate for canopy layers and flat
  drain/manhole decals. Vianen places covers only on flat ground, 3.5 mm above the surface.
- **2:** a light, bouncy 10 kg cone behaviour.
- **3:** a 50 kg movable sign behaviour, also used for lanterns and benches.
- **22:** a light 10 kg paper-box body. Vianen reuses its body for some lightweight props,
  but replaces the paper effect for wood and metal through the per-object impact setup.

Movable props need closed meshes with real width: a bicycle made from a zero-width plane
has an awkward collision shape. Remove any baked static collider when converting scenery
to a movable object, or the car will still hit its old location after knocking it aside.
Keep props clear of the racing line, bridge railings and each other.

Match sound and debris to material. Cardboard can rustle and emit paper; wood can clatter;
metal should clank; rubber should thump. Native hit lifecycle and positional volume handling
should remain intact. Verify an actual hit, displacement, resting pose and passage through
the old base. A registered handler alone does not establish that the interaction works.

Suspended props need a mounting lifecycle. Keep an unhit awning at its authored pose, then
release it once on native contact and let the original body simulate afterward. For a market
stall, use separate counter, roof and pole bodies; couple the roof release to its own counter
and supports. Wake a released body through the native API, or a roof that fell asleep while
mounted may remain floating when its support is struck. `source/host/vianen-market.js` is the
working example; do not apply mounting logic to original tracks.

For sidewalk jumps, inspect the wheel's contact geometry before changing vehicle physics.
Vianen's sharp curb was replaced by a 10 cm rise over a 60 cm bevel. Probe crossings at
several angles and locations, including bridges and slopes; keep a clear join between road,
bevel and pavement. Decorative covers must not become extra collision bodies.

Paint road markings into the road material. Vianen's white edge dashes were originally
separate RMP terrain planes raised 8 cm above the road, so the wheels encountered physical
steps. The fix uses a marked variant of the paving texture on the existing road faces and
removes the raised planes entirely. A small visual offset on an RMP plane is still collision
geometry; it is not a renderer-only decal. `check-sidewalks.mjs --road-markings` checks the
packed geometry and drives with the wheels over the paint in both directions.

## Use advertisements as part of the street

Use a few readable designs with a clear headline, coherent colours and the correct aspect
ratio. For a named performer, use a suitable licensed portrait rather than an unrelated face
or text-only placeholder. Check the actual loaded atlas crop: good source art can still be
stretched or cropped badly in the game.

Place posters inside shop windows or on plausible supports. A large billboard needs a frame,
posts, a finished rear side and clearance from the road; check its view on approach and from
behind. Avoid covering important landmarks or repeating the same poster on every house.
Keep development reports, diagnostic text and AI-report placeholders out of the scenery.

## Check the final assets and leave a useful handoff

Choose focused checks for the change. The existing Vianen tools are examples with authored
counts, station numbers and filenames; adapt their assertions for a new map instead of
running them unchanged or weakening them until they pass.

- `check-photo-warp.py`: rectification and facade UV orientation.
- `check-buildings.mjs`, `check-bridge-houses.mjs`: packed building closure, roof/wall rays
  and bridge house ends. Regenerate their face references when geometry changes using
  `VIANEN_BUILDINGS` and `VIANEN_BRIDGE_ENDS` during the build; stale references are misleading.
- `check-leaks.py`: reachable ground/boundary gaps. Its top-down approximation complements
  driving checks; it does not establish full three-dimensional collision correctness.
- `check-sidewalks.mjs`: actual native wheel responses at selected sidewalk crossings.
- `check-bollards.mjs --prop bench` (and other prop options): native impacts, material sound,
  paper emission, displacement and driving through the former base.
- `check-finish.mjs`: native decorative-body absence, bench bodies and packed bank colours.
- `check-scenery.mjs --runtime`: two-sided rendering and live forward/rear/reverse visibility.
- `check-vianen.mjs --seconds 130`: one bot race using the packed assets and native engine.

Open the local viewer and play the actual race. Check the reported problem angles, drive
backward, cross the sidewalk and hit any new movable object. Record asset-loading failures
separately from optional original-game samples; do not silently discard all missing files.
Keep validation within the requested map and affected systems. A bot finishing a lap is not
proof that every building looks good, and screenshots are not a physics or performance test.

Finish by recording the generator command, tested route/views, evidence paths, attribution,
intentional geography changes and remaining limitations. Commit maintained source and its
generated outputs together; exclude unrelated local files. If publishing is requested, check
the configured destination and identity, and distinguish a successful git push from a finished
hosting deployment. Leave a local play link and invite the requester to drive the map.
