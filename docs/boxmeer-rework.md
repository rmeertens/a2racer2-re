# Boxmeer: ten rounds, fifty changes

Historical record of the initial ten-round rework. The later Floralaan expansion adds four mapped streets, adjusts the northern bend, and removes the invented De Meidoorn shortcut. Current dimensions and behavior are in [Boxmeer](boxmeer.md).

The ten cumulative rounds below rebuild the native track, rather than applying a cosmetic filter. Each round has five changes. The individual build and native-race results are retained under `evidence/boxmeer/rework/pass-01/` through `pass-10/`.

## Try this version

- [Drive Boxmeer](http://127.0.0.1:4181/?race=1&etappe=boxmeer): one lap, Kat, existing garage upgrades enabled.
- [Stock car](http://127.0.0.1:4181/?race=1&etappe=boxmeer&stock=1): the same map without the preview upgrades.
- [Inspect De Meidoorn](http://127.0.0.1:4181/track-viewer.html?map=boxmeer&highlight=de-meidoorn).

The revised circuit is 3.963 km, with a 13 m road, approximately 45 m minimum bend radius and a gentle 2.2 m dike. De Meidoorn has an optional connection back to Floralaan; race AI follows the main circuit. Menu-selected cars and original tracks retain their existing upgrade choices.

## Round 1: Driving space and route flow

1. Widened the racing surface from 10 to 13 metres.
2. Completed corner smoothing to a minimum radius of about 45 metres.
3. Moved the driving waypoints out to suit the wider road.
4. Increased clearance between the racing line and street buildings.
5. Changed Boxmeer's default race from two laps to one.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-01/`. Packed geometry checks also passed at each round.

## Round 2: Road edges and surface continuity

6. Lowered curbs to 5 cm and lengthened their bevels.
7. Widened and cut open the De Meidoorn entrance apron.
8. Aligned ground texture coordinates across terrain triangles.
9. Inset road texture sampling to reduce atlas-edge bleed.
10. Moved rural hedges back to provide a grass recovery margin.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-02/`. Packed geometry checks also passed at each round.

## Round 3: Streets and housing

11. Separated shopping streets from residential facade types.
12. Varied terrace frontage widths and introduced deliberate gaps.
13. Added detached-house setbacks, gardens and drives.
14. Added lower-pitched hipped roofs and terracotta roof variations.
15. Added window bays to exposed residential end walls.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-03/`. Packed geometry checks also passed at each round.

## Round 4: Maasheggen landscape

16. Replaced the old tree cutouts with original AI-generated summer foliage.
17. Rebuilt roadside hedges as continuous curved volumes.
18. Added more distant tree clumps to give the landscape depth.
19. Introduced coherent field-sized colour variation.
20. Replaced rural paved shoulders with grassy verges.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-04/`. Packed geometry checks also passed at each round.

## Round 5: Recognizable landmarks

21. Added belfry clocks, stringcourses and buttresses to the basilica.
22. Reworked the castle roofs, seated its roof cupola correctly, and added entrance pillars and a forecourt.
23. Gave De Weijer a park setting with a pond and trees.
24. Rebuilt Rochuskapel as a six-sided chapel with a cross.
25. Added a sheltered monastery entrance and paved forecourt.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-05/`. Packed geometry checks also passed at each round.

## Round 6: Floralaan and De Meidoorn

26. Refined the low-house wall, roof and solar-panel proportions.
27. Replaced heavy carport beams and brick posts with slender steel structures.
28. Painted parking bays into the driveway material.
29. Mounted readable street-name plates with separate front and rear faces.
30. Connected a De Meidoorn arm back to Floralaan as an optional drive-through route.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-06/`. Packed geometry checks also passed at each round.

## Round 7: Street life and interaction

31. Replaced flat lantern sprites with solid street lamps.
32. Added complete benches at public-space locations.
33. Added planted tubs around public forecourts.
34. Built a sheltered bus stop on Floralaan.
35. Added six movable cones using the native collision system.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-07/`. Packed geometry checks also passed at each round.

## Round 8: Rendering and materials

36. Subdivided road panels to remove the large blank near-camera texture patches.
37. Added transparent gutters around foliage cells to prevent edge streaks.
38. Adjusted brick and roof material repetition to a more believable scale.
39. Added cornice and gutter trim to selected building fronts.
40. Replaced the yellow dawn sky with an original AI-generated daylight sky.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-08/`. Packed geometry checks also passed at each round.

## Round 9: Racing feedback and choices

41. Placed warning chevrons ahead of the sharper bends.
42. Added Floralaan, Maasheggen and Centrum sector gates.
43. Varied turbo, repair and points pickups across the two driving lines.
44. Added a visible start/finish gate and non-colliding chequered paint.
45. Added low recovery rails outside selected bends.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-09/`. Packed geometry checks also passed at each round.

## Round 10: Presentation and final driving feel

46. Replaced atlas-crop menu pictures with actual rendered views of the map.
47. Replaced the loading image with an actual rendered Boxmeer view.
48. Added the side-street connection, clearer labels and sector shortcuts to the viewer map.
49. Made the direct preview a responsive, fully upgraded Kat car; stock preview remains available.
50. Added a gentle elevated dike with connected grass embankments.

Validation: native race finished; required missing files: 0. Build and race evidence: `evidence/boxmeer/rework/pass-10/`. Packed geometry checks also passed at each round.

## Final checks and limits

- Native preview race with four opponents finished at 271.37 simulated seconds, with no recovery resets or required missing files. Stock Kat also completed its race with no recovery resets. These bot runs check completion; they do not establish subjective fun or a controlled speed improvement.
- De Meidoorn entrance and both arms passed wheel probes. A separate native connector drive rejoined Floralaan, with a maximum chassis rise of 5.7 cm. This is not an AI-driven complete alternative lap.
- All six cones register with the native collision system. A test hit displaced one cone by 25.5 m and the car passed its former base. The native object frame pool used 442 of 525 entries.
- 310 chunks, 12,301 planes, 586 closed authored volumes (including scenery supports and hedges). 70,320 wall/roof rays found no missing or reversed faces; this is not an exhaustive collision proof.
- Final browser smoke check matched all four live geometry pools and reported no page errors or failed requests. A 140-view final route survey and images are in `evidence/boxmeer/`.
- Vianen completed its native race. The original Amsterdam check passed 300 ticks.
- Software-rendered browser captures validate appearance, not real-device frame rate. A two-human multiplayer session has not been tested.

## Artwork and evidence

Five original text-generated image sheets are saved in `source/assets/boxmeer/generated/`: facades, landmarks, materials, foliage and sky. Exact prompts are in `prompts.json` and `rework-prompts.json`; `packing.json` records source hashes and atlas packing. No photographs or Street View pixels are inputs to the active textures or menu/loading pictures. Functional lettering and paint are drawn for readability. Menu and loading pictures are renders of the rebuilt track.

Street View and local-history research remain documented in `source/assets/boxmeer/README.md`. Buildings are simplified regional interpretations and landmarks are moved beside the racing route.

Useful final evidence: `browser.json`, `geometry.json`, `race.png`, `survey.json`, `survey-final/`, `rework/pass-10/{tuned,cones,shortcut}.json`, and `rework/{vianen-regression,original-regression}.log`.
