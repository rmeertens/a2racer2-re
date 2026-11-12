# Boxmeer

Boxmeer is a separate native circuit in slot 11, following the supplied rough loop through the western residential area, Hoogendijk, the Maasheggen and the town centre. The current version is **4.092 km, 320 chunks and one default lap**, with a 13 m racing surface and a five-metre-high dike with smooth approaches. It includes Floralaan, De Meidoorn and four additional residential side streets, the basilica, castle, Carmelite monastery, De Weijer and Rochuskapel.

The [ten-round rework journal](boxmeer-rework.md) records all fifty improvements and their validation. It records the initial rework. The subsequent Floralaan street expansion adjusts the northern bend and supersedes its route dimensions and invented De Meidoorn connector.

## Play and inspect

Run `npm start`, then choose Boxmeer in Quick Race or multiplayer, or open `/?race=1&etappe=boxmeer`. The direct preview uses a Kat car with the existing garage upgrades; append `&stock=1` for the stock car, or specify `&car=0` etc. The default lap count is one; `&laps=2` overrides it. Existing menu-selected cars and upgrades retain their usual behavior.

The current local preview is [on port 4181](http://127.0.0.1:4181/?race=1&etappe=boxmeer), leaving the pre-existing port 4180 server alone. The silent inspector is `track-viewer.html?map=boxmeer`; add `&highlight=de-meidoorn` to look into the side street.

## Research and artwork

The route is an approximate racing interpretation of the supplied sketch, using an OpenStreetMap snapshot, not navigation data. The castle, basilica, monastery, De Vaart procession and woven Maasheggen landscape informed the design. Landmarks are adapted onto visible route-facing parcels. Ordinary houses are regional types rather than surveyed reconstructions. Floralaan’s northern bend now follows the OSM street more closely. De Azalea, De Tamarisk, De Acacia and De Jasmijn use their mapped bends and connections, with five direct entrances, housing and readable name plates. Junctions are adapted to the rounded racing road; exact adjustments and OSM way IDs are recorded in `boxmeer.json`. De Meidoorn keeps its branching shape, low houses, carports and solar roofs. Its invented connector has been removed for map fidelity. Race AI follows the main circuit.

All active architectural, material, foliage and sky imagery is original AI artwork generated from text. No Street View or photograph pixels are shipped in the active atlases or menu/loading images. Menu and loading art are actual rendered views of the map. Functional signs and paint are code-authored. Exact prompts, original sheets, hashes and packing are under `source/assets/boxmeer/generated/`. [Source attribution and research](../source/assets/boxmeer/README.md) also records inactive historical photographs, which are retained but never read by the active builder.

## Build and verify

Use the Vianen Python dependencies from `tools/vianen/requirements.txt`, including Shapely 2.1+:

```sh
python3 tools/boxmeer/build-track.py
npm run bundle
node tools/boxmeer/check-geometry.mjs
node tools/boxmeer/check-dike.mjs
node tools/boxmeer/check-boxmeer.mjs --seconds 420 --opponents 4 --car 3 --tuned
node tools/boxmeer/check-neighbourhood.mjs
node tools/boxmeer/check-cones.mjs
```

The default is the completed tenth pass. `BOXMEER_PASS=1` through `10` select the cumulative visual treatments; the current builder also includes the subsequent Floralaan layout revision. Native geometry and packing primitives are shared with Vianen; Boxmeer textures, namespace, route, models and binary files are separate. Required scenery must fit native budgets; optional buildings are added only when complete closed volumes fit. The generic loader preserves Vianen defaults, and complete-static-pool rendering recognizes slot 11. No new traffic or police routes are authored.

For browser checks, start the preview server and run `tools/boxmeer/check-browser.mjs` or `tools/boxmeer/survey.mjs`. Set `BOXMEER_URL` for another port and `BROWSER_EXECUTABLE` for an installed Chromium path. The final results and testing limits are in the rework journal, with reproducible evidence under `evidence/boxmeer/`.

## Floralaan expansion validation

Four additional named streets provide five Floralaan entrances. De Meidoorn has six houses with carports and solar roofs; the new streets add thirty low houses. Native checks drive all five new entrances and De Meidoorn's entrance and two arms, with maximum measured chassis rise of 8.2 cm. Packed geometry checks pass: 320 chunks, 12,758 planes, 573 closed authored volumes and 68,760 wall/roof rays. Full solo and four-opponent races finish with required assets present. The keyboard bot still used recovery attempts (three solo, six with opponents), so completion does not establish subjective handling quality. These are entrance probes rather than exhaustive street-network driving tests.

Current evidence and street views: `evidence/boxmeer/side-streets/validation.json`, `physics.json`, `visual.json`, `neighbourhood.png`, and the four named street screenshots. Earlier rework evidence records the previous layout.

## Raised dike

The dike crest is now 5 m above the town datum (about 5.1 m above the field mesh). Smooth climbs and descents have a maximum road gradient of about 2.63%. The road mesh, position file and both AI lanes share this elevation. Grass embankments reach the low fields; trees, hedges, street-name posts and recovery rails follow their local ground height. The residential side-street entrances remain at grade. Select **Hoogendijk** in the viewer, or add `&highlight=hoogendijk`, for a view across the raised road and banks. This height is an authored racing interpretation, not a surveyed dike measurement.

Repeat `node tools/boxmeer/check-dike.mjs` to check the packed road, lane heights, approach gradients, bank connection and flat residential entrances. The native race and focused physics results are under `evidence/boxmeer/dike/`.

## Boxmeer presentation redesign

The race and silent viewer share `source/render/boxmeer-world.js`: lit materials, sun and local shadows, 256 volumetric trees, rounded hedge tops, 1,859 planting locations, 3,022 building detail instances, animated water and a generated sky. Repeating road materials and edge paint replace stretched road UVs. Boxmeer uses the original native race interface, including the original HUD, countdown, pause and results screens. The custom race display and its layout overrides have been removed. Decorative scenery does not change the native road geometry or collision handling.

All enhancements are restricted to Boxmeer (native slot 11). Original tracks retain their renderer, colours and race display. Boxmeer temporarily selects high-colour rendering if an old indexed display mode is selected, then restores the previous preference on exit. Append `&classicboxmeer=1` for a presentation comparison. Viewer audio remains absent.

`node tools/boxmeer/check-presentation.mjs` verifies a full race, pause/resume, results, cleanup, viewer controls and Amsterdam/Vianen isolation. The evidence is in `evidence/boxmeer/redesign/`. Native race completion, dike and side-street probes also pass; the race bot still needed three recovery attempts, so this is not a claim of perfect handling. A short 1440×900 town run on the Apple M5 Pro Metal renderer measured about 120 average FPS; it is a local sample, not a guarantee for every device or camera.

## Exploring beyond showcase views

The survey retains 61 exploratory cameras without adding viewer controls. Add `&explore=49` to open one directly; the original camera controls and saved-camera import remain available. The set covers 24 shoulder/reverse views around the entire lap, side-street interiors in both directions, rear landmark quarters and elevated cross-dike views. Camera positions are stored in `source/assets/boxmeer/exploratory-views.json`; `tools/boxmeer/survey-new-views.mjs` reproduces the wider survey.

That survey exposed bare rear plots, plain gables, sparse field boundaries, stretched close-up hedge mapping and the castle's blank rear wings. The shared Boxmeer scene now adds 260 rear garden plots with patios, fences, planting and occasional sheds; 1,180 side/rear house windows sampled from the existing generated facade atlas; castle-wing windows; treatment at eight disconnected side-street endings; and 412 clumps forming field hedges. Grass uses generated surface detail in world space, and hedge bodies repeat leaf detail at a consistent scale. Road and building clearances constrain plot placement. These are visual additions; the native road/collision geometry is unchanged.

Before/after captures and camera manifests are in `evidence/boxmeer/new-views/` and `new-views-after/`. The checks still cover Boxmeer race completion, pause/resume, renderer cleanup, Amsterdam/Vianen isolation, silent viewer controls and exploratory-camera navigation.

A second set of 38 fresh, seeded camera positions is captured after the changes, separate from the 61 saved views used during authoring. Set `BOXMEER_HOLDOUT=20261112` and `BOXMEER_SURVEY_DIR=evidence/boxmeer/fresh-angle-check` when running the survey tool; change the seed to explore a different set. The final fresh-angle set was visually reviewed and reported no viewer errors.

## Movable street life

Boxmeer now has 56 additional native movable objects: 12 café chairs, six terrace tables, eight wheelie bins, eight pavement boards, eight delivery crates, eight flower planters and six cartons. They join the six existing traffic cones. Terrace groups face their tables; bins and planters also appear on residential streets, including Floralaan. Placements exclude junction clearance zones, building footprints and the racing surface. The checked minimum distance from the new meshes to the road edge is 1.41 m.

These are native lightweight physics bodies rather than duplicate static scenery. `source/host/boxmeer-impacts.js` restricts the contact setup to slot 11: furniture uses the native clatter handler and existing pole-impact sound; cartons retain the native paper emitter. Other tracks retain their existing setup. The silent viewer displays the authored standing poses. `bm_street.tga` reuses the existing AI-generated material and planting sheets, with functional shop lettering. `street-prop-sources.json` records the inputs.

Run `node tools/boxmeer/check-street-life.mjs` for real car-contact tests of all seven types, initial stability, road clearance, native object counts, paper-emitter behavior and animation capacity (449 of 525 frames used). Evidence is under `evidence/boxmeer/street-life/`. A four-opponent native race finished in 274.98 simulated seconds with two bot recovery attempts and no required missing assets; the live browser race, viewer and original-track isolation checks also pass.

## Playable-area limits

Boxmeer now monitors the local player's position against the circuit and the complete mapped side-street network. The main-road corridor extends 24 m from its centre line; side-street corridors extend 11 m. The union keeps junctions and street ends connected. There are no added interface messages or overlays. Remaining outside for 0.75 seconds, going another 3 m beyond the corridor, or falling more than 10 m beneath the nearby road returns the car to its most recent safe road position, upright and stopped. Recovery also restores the saved route, lap and driven-chunk progress, preserving elapsed race time. Side-street recovery follows the direction of travel; main-road recovery faces along the circuit.

The guard runs only for Boxmeer and only during active racing. Pause/countdown/results do not advance its timer. It acts on the local player; movable furniture retains its native physics. Normal driving, sidewalk objects and the mapped residential roads remain playable. The viewer remains unrestricted for inspection.

`node tools/boxmeer/check-bounds.mjs` verifies 387 authored road vertices and 24 native recovery probes: both sides of eleven circuit locations, grace timing and falling through terrain. The eight neighbourhood driving probes pass with zero automatic recoveries. A full four-opponent race finishes with zero bounds recoveries. `check-bounds-browser.mjs` verifies a real off-map recovery with the original interface and no custom HUD or boundary popup. Native furniture-contact tests and the Amsterdam/Vianen isolation checks also pass. Evidence is under `evidence/boxmeer/bounds/`.

## Natural boundaries before recovery

Boxmeer now has 351 additional closed hedge sections (313 in circuit gaps, 30 along residential streets and eight at disconnected street ends). The two dead ends in De Meidoorn are included, while all mapped entrances and connecting streets remain open. Existing low field hedges are raised to roughly two metres. Twenty-eight small tree groups reinforce the new hedge edges. The new hedge bodies use native RMP collision geometry, while their leafy surfaces and crowns reuse the existing AI-generated foliage. Tree groups are visual additions above the solid hedge boundaries.

`tools/boxmeer/natural_edges.py` avoids road/junction clearance areas and building footprints, reserves complete six-face volumes near their own chunks and records their faces in the building manifest. The packed map, including the corrected tree trunks, has 15,507 planes and 1,140 closed authored volumes; closure and winding checks pass. A geometric audit finds a solid boundary on 1,717 of 1,865 sampled outward rays away from side-street junctions (92.1%); the recovery limit remains available for open gaps.

`node tools/boxmeer/check-natural-edges.mjs` tests 24 real native car impacts with automatic recovery disabled, including all eight street ends. Each probe was stopped by geometry. The eight neighbourhood probes, existing movable-object collisions and recovery-limit tests still pass. A full four-opponent native race finishes with zero automatic bounds recoveries. The live browser race and original-track isolation checks pass with the original UI. Thirty-eight fresh seeded views and twelve focused boundary views were inspected. Evidence is under `evidence/boxmeer/natural-edges/`.

## Invisible tree-collision repair

The original crossed tree sprites were still native collision planes after the presentation began drawing volumetric trees. Their transparent rectangular wings could block empty space beside the new trunks. Six small planter-tree sprites were also collidable despite having no rendered 3D trunk. The repair removes all 666 legacy sprite planes after planning (preserving building placement), stores the 222 source tree sites in metadata and adds 216 complete tapered trunk collision shells. Each shell is inscribed inside the visible seven-sided cylinder, at the same position, height and taper. Foliage remains decorative. The 3D presentation reads the original tree metadata directly, retaining the tree appearance; debug classic mode shows the native trunk geometry.

`node tools/boxmeer/check-tree-clearance.mjs` replays 24 paths beside trees. Before repair, 17 were blocked; after repair, all 24 pass. `check-tree-colliders.mjs` checks all 5,184 proxy vertices against the visible cylinder envelope and tests four direct trunk impacts with auto-recovery disabled. Visible trunks remain solid. Geometry closure, natural boundaries, eight side-street probes, movable furniture, recovery limits, and browser/original-track isolation checks pass. A four-opponent native race finishes with zero bot recovery attempts and zero bounds recoveries. The original interface is unchanged. Evidence is in `evidence/boxmeer/invisible-obstacles/`.


## Floralaan signpost clearance

A focused follow-up found solid street-name posts encroaching on Floralaan and the De Meidoorn turn. The De Acacia post was only 2.23 m from the main-road centre. All five additional side-street signs now check their entire board footprint against the main road, every branch and nearby buildings before placement. Their boards have at least 11 m of main-road centre-line clearance, and their supports are thicker for visibility. The older entrance-name signs also avoid the complete road network and building footprints. Floralaan and De Meidoorn retain their name signs.

`node tools/boxmeer/check-floralaan-clearance.mjs` checks the 24 Floralaan chunks in both directions with automatic recovery disabled. All 434 carriageway probes pass, along with 49 additional verge probes; paths through visible scenery are excluded only from the verge checks. The eight neighbourhood driving probes and all 24 previously blocked tree-clearance paths pass. A four-opponent native race finishes with zero bot recovery attempts, zero bounds recoveries and no missing required assets. Geometry closure and winding checks pass. Evidence is under `evidence/boxmeer/invisible-obstacles/floralaan/`. The changes affect Boxmeer geometry only and preserve the original interface.
