# Boxmeer sources and texture attribution

## Current artwork: original AI-generated textures

All active architectural and surface textures now come from the built-in image generation tool, generated from text only on 12 November 2026. No photographs or Street View pixels are used by the current builder, texture atlases, menu thumbnails or loading art. The five original images are `generated/facades.png`, `generated/landmarks.png`, `generated/materials.png`, `generated/foliage.png` and `generated/sky.png`; exact prompts are in `generated/prompts.json` and `generated/rework-prompts.json`. Measured panel boundaries, source hashes and packing metadata are in `generated/packing.json`, also distributed as `texture-sources.json`. Building details are inspired interpretations, not measured reconstructions. Functional street lettering, chevrons, gate lettering and parking/finish paint are code-authored. Menu and loading pictures are rendered views of the map. The native version uses original AI tree cutouts; the enhanced Boxmeer presentation replaces these with volumetric crowns. Lamps are solid geometry.

The photo files and attribution below are retained as historical research sources for the earlier map version. They are not inputs to the current build.


Map data © OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright. Snapshot retrieved 12 November 2026; the union of two API bounding boxes is stored in `osm.json`.

Route follows the user-supplied sketch, approximately georeferenced against Boxmeer station, the Steenstraat roundabout and Hoogendijk crossing. It is a racing interpretation, not navigation data.

## Photographs

Crops are rectified with a projective homography. `crops.json` records the exact control points. Texture derivatives retain their source licence.

- `11527006.jpg` — [Boxmeer frontaal.JPG](https://commons.wikimedia.org/wiki/File:Boxmeer_frontaal.JPG), Kasteelbeer. CC BY-SA 3.0 nl: https://creativecommons.org/licenses/by-sa/3.0/nl/deed.en. Used as texture/reference or menu/loading artwork; no ownership is claimed.

- `11644117.jpg` — [Boxmeer Rijksmonument 10031 Carmelietenklooster Steenstraat 39.JPG](https://commons.wikimedia.org/wiki/File:Boxmeer_Rijksmonument_10031_Carmelietenklooster_Steenstraat_39.JPG), Havang(nl). CC0: http://creativecommons.org/publicdomain/zero/1.0/deed.en. Used as texture/reference or menu/loading artwork; no ownership is claimed.

- `11644176.jpg` — [Boxmeer Rijksmonument 10032 kerk, Steenstraat 41.JPG](https://commons.wikimedia.org/wiki/File:Boxmeer_Rijksmonument_10032_kerk,_Steenstraat_41.JPG), Havang(nl). CC0: http://creativecommons.org/publicdomain/zero/1.0/deed.en. Used as texture/reference or menu/loading artwork; no ownership is claimed.

- `133455365.jpg` — [De Sint-Petrusbasiliek te Boxmeer.jpg](https://commons.wikimedia.org/wiki/File:De_Sint-Petrusbasiliek_te_Boxmeer.jpg), Johan Bakker. CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0. Used as texture/reference or menu/loading artwork; no ownership is claimed.

- `23308966.jpg` — [Exterieur overzicht, voorzijde - Boxmeer - 20001065 - RCE.jpg](https://commons.wikimedia.org/wiki/File:Exterieur_overzicht,_voorzijde_-_Boxmeer_-_20001065_-_RCE.jpg), Loek Tangel. CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0. Used as texture/reference or menu/loading artwork; no ownership is claimed.

- `23433830.jpg` — [Veerstraat 46, aanzicht - Boxmeer - 20039201 - RCE.jpg](https://commons.wikimedia.org/wiki/File:Veerstraat_46,_aanzicht_-_Boxmeer_-_20039201_-_RCE.jpg), Gerard Dukker. CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0. Used as texture/reference or menu/loading artwork; no ownership is claimed.

- `57318368.jpg` — [Restaurant Riche in the center of Boxmeer - panoramio.jpg](https://commons.wikimedia.org/wiki/File:Restaurant_Riche_in_the_center_of_Boxmeer_-_panoramio.jpg), Henk Monster. CC BY 3.0: https://creativecommons.org/licenses/by/3.0. Used as texture/reference or menu/loading artwork; no ownership is claimed.

- `85067405.jpg` — [Boxmeer GM Spoorstraat 60.jpg](https://commons.wikimedia.org/wiki/File:Boxmeer_GM_Spoorstraat_60.jpg), HenkvD. CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0. Used as texture/reference or menu/loading artwork; no ownership is claimed.

## Reference research (not redistributed textures)

Google Street View, inspected 12 November 2026:
- Koorstraat 72 (March 2025): grey herringbone paving, low shop blocks and pollarded trees. https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.6465,5.9495
- Rollandsestraat (March 2025): asphalt, white edge dashes, floodplain verge and hedgerows. https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.6542,5.9550
- Burgemeester Verkuijlstraat 1 / Steenstraat (May 2025): cream rendered upper floors, large shop glazing and small street trees. https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.6469,5.9521

Local-history references:
- https://www.centrumboxmeer.nl/bezienswaardigheden/
- https://www.centrumboxmeer.nl/bezienswaardigheden/wandelroute-boxmeer/
- https://www.maasheggenunesco.com/ontdek/bezienswaardigheden/
- https://www.nepomukboxmeer.nl/over-boxmeer/bekende-gebouwen-in-boxmeer/

The native geometry, drawn surfaces, shop labels and low-poly hedges are original procedural scenery. Geometry/packing, paving and tree routines reuse the maintained Vianen tooling in this repository; no Vianen town photos are used. Ordinary drawn shop names are fictional. Street View imagery is a visual reference only and is not shipped.

Landmark positions and dimensions are adapted to the drawn racing loop for visibility: De Weijer, the basilica, monastery, Riche and castle are moved onto nearby route-facing parcels. The castle does not reproduce every wing, and ordinary buildings are regional types rather than individually surveyed reconstructions.

## Floralaan and De Meidoorn finishing pass

Google Street View inspected 12 November 2026 (May 2025 imagery):
- Floralaan 36, looking east into De Meidoorn: https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.655429,5.9402065&heading=80
- De Meidoorn 1: https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.65516,5.94085&heading=20

These observations inform original drawn low brick facades, white window frames, broad roof slopes, roof-mounted solar panels, carports and garden hedges. Street View pixels are not redistributed. OSM ways 6854523, 6854525 and 6854723 define the branching side-street layout. The side street is fitted to the rounded racing version of Floralaan; its branching shape is preserved. Exact translation and road polylines are recorded in `boxmeer.json`. De Meidoorn now keeps its mapped branching layout, without the earlier invented connector. Race AI stays on the main circuit.

## Additional Floralaan streets

De Azalea (way 6854683), De Tamarisk (6854466, 6854477, 6854633), De Acacia (6891413), and De Jasmijn (6854718, 1449535273, 167492056, 1449535274) are built from the OSM snapshot. Shared nodes with Floralaan determine the real junctions; a disconnected southern Acacia segment is excluded. The northern racing bend uses Floralaan way 6891687, retaining a rounded interpretation suitable for the game. Junction displacement is interpolated through each street, preserving connections and approximate street directions. The packed metadata records source IDs, roads, five entrances and displacement in metres. This remains a racing interpretation rather than exact navigation data.

The new street plates are deterministic lettering in the unused old lamp-sprite atlas cell. Housing and surfaces reuse the original AI-generated sheets. Sign supports, lamps, trees, bus stops and recovery barriers are excluded from junction clearance areas. Tests cover the five new entrances and the existing De Meidoorn entrance and arms. Reference map: https://www.openstreetmap.org/#map=17/51.6553/5.9396

## Enhanced Boxmeer presentation

The additional text-only generated sheet `generated/garden-plants.png` supplies meadow flowers, reeds, garden flowers and hornbeam foliage. Its exact prompt is in `generated/presentation-prompts.json`; SHA-256 and derived atlas names are in `generated/presentation-packing.json`, distributed as `presentation-sources.json`. `tools/boxmeer/presentation_art.py` packs the transparent planting atlas and a leaf detail crop, and detects window-frame bounds from the existing generated facade sheet. No new photographs are used. Road materials are repeating crops of the original generated material atlas; additional white edge paint is geometry.

The Boxmeer-only presentation adds sun and local shadows, volumetric trees and hedge tops, facade trim, gutters, roof details, garden planting, animated water and a sky. It shares native map geometry and route elevations with the game; these decorative additions do not create new driving collisions.

## Scenery beyond the racing line

The exploratory-camera survey adds rear plots, fences, patios, sheds, side and rear windows, street-end planting and field hedges. New window surfaces are crops of the original generated facade atlas; grass and hedge bodies use repeating details from the original generated material/leaf sheets. No additional photographs are used. All scenery additions are restricted to the Boxmeer presentation. The survey cameras and viewer navigation are packaged as `exploratory-views.json`.

## Movable street furniture

The 56 additional knock-over objects use original procedural native models: café tables/chairs, wheelie bins, pavement boards, slatted crates, flower planters and cartons. `bm_street.tga` crops and colours the existing generated land/material atlases and garden-plant sheet; its shop lettering is code-authored functional text. There are no new photograph inputs. `tools/boxmeer/movable.py` builds the models, atlas and clearance-checked placements; `street-prop-sources.json` records the atlas sources. Native lightweight bodies provide collision and movement. The existing game impact sound is reused.

## Natural boundary geometry

The additional solid hedge sections and tree groups reuse the original AI-generated leaf and grass materials. No new photographs or texture sources are introduced. Their native collision shells, clearances and source plane references are generated by `tools/boxmeer/natural_edges.py` and recorded in `boxmeer.json` and `buildings.json`. The original user interface is retained.

## Tree collision repair

Legacy tree-card planes are retained only during planning, then removed from the packed native collision map. Tree positions/heights are preserved in `nativeTrees`; complete tapered trunk shells fit inside the rendered wood. The 3D foliage still uses the same original AI-generated leaf artwork. `tools/boxmeer/tree_collisions.py` records the conversion in `treeCollisionAudit`. No textures or UI assets change.
