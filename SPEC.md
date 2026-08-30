# Still2Rig VTuber Edition — Specification

## 1. Purpose

Still2Rig VTuber Edition extends `still2rig-psd` to convert a single static anime-style character image into a structured PSD designed for later Live2D Cubism modeling.

The immediate goal is not to produce a finished Live2D model.

The goal is to produce a high-quality intermediate representation that dramatically reduces manual part-separation work and provides enough machine-readable information for a future `AutoRig for Cubism` system.

Target pipeline:

```text
Static Character Image
        ↓
Still2Rig VTuber Edition
        ↓
Detailed VTuber PSD
+
vtuber_manifest.json
+
QA
        ↓
Human Review / Repair
        ↓
Future AutoRig for Cubism
        ↓
Cubism Editor
        ↓
Live2D Model
```

---

# 2. Product Goal

Convert one character illustration into:

```text
editable raster parts
+
semantic part identity
+
hierarchy
+
character-relative left/right
+
depth
+
provenance
+
confidence
+
future rigging hints
```

The output must be useful both to:

1. a human Live2D modeler;
2. a future automated rigging system.

The project must therefore optimize for semantic correctness and repairability, not merely for producing a large number of PSD layers.

---

# 3. Scope

VTuber Edition Phase 1 includes:

* single-character image processing
* See-through semantic decomposition reuse
* detailed VTuber-specific subdivision
* character center-axis estimation
* character-relative L/R assignment
* detailed hair subdivision
* face and eye subdivision
* neck and torso extraction
* arm subdivision
* hidden-area / overlap generation
* provenance tracking
* detailed PSD hierarchy
* VTuber manifest generation
* structural and semantic QA
* AutoRig readiness assessment
* manifest-aware WebUI inspection
* foundations for later manual correction

---

# 4. Non-Goals

Phase 1 does not include:

* finished Live2D rigging
* Cubism parameter creation
* Cubism ArtMesh authoring
* Cubism Deformer authoring
* Cubism physics authoring
* facial tracking
* webcam tracking
* direct `.cmo3` generation
* direct `.moc3` generation
* reverse engineering of proprietary Cubism file formats
* automatic Cubism GUI operation

These belong to the later `AutoRig for Cubism` project.

---

# 5. Compatibility Requirement

The existing Still2Rig standard workflow must continue to operate.

VTuber behavior must be selected explicitly.

Target CLI:

```bash
npm run still2rig-psd -- prepare ./character.png --name demo --profile vtuber
```

The existing workflow remains valid:

```bash
npm run still2rig-psd -- prepare ./character.png --name demo
```

A prepared job records its profile.

Later commands should normally read the profile from the job rather than requiring the user to repeat it.

Example:

```bash
npm run still2rig-psd -- import demo /path/to/result.zip
npm run still2rig-psd -- finalize demo
```

VTuber implementation must not silently alter Standard Profile output.

---

# 6. Inputs

Supported source types follow the existing project where practical:

```text
PNG
JPEG
WebP
```

V1 target conditions:

* one primary character
* anime / illustrated character
* neutral or mostly neutral pose
* front-facing or near-front-facing composition
* bust-up, half-body, or full-body
* adequate resolution
* character separable from background

Multiple-character scenes are out of scope for V1.

Highly occluded or extreme perspective characters may produce partial readiness instead of failure.

---

# 7. Primary Outputs

A VTuber job should produce:

```text
output/
├─ <name>.psd
└─ vtuber_manifest.json
```

Reports:

```text
reports/
├─ qa_report.json
├─ qa_report.html
└─ contact_sheet.png
```

Debug/intermediate artifacts may include:

```text
processed/
└─ vtuber/
   ├─ semantic/
   ├─ masks/
   ├─ parts/
   ├─ generated/
   ├─ geometry/
   └─ debug/
```

All runtime artifacts remain inside the ignored `.still2rig-psd/` work area.

---

# 8. PSD + Manifest Contract

The PSD and manifest are one logical result.

```text
<name>.psd
+
vtuber_manifest.json
```

The PSD is optimized for:

* visual inspection
* manual repair
* Photoshop-compatible editing
* later Cubism import

The manifest is optimized for:

* stable semantic part identity
* AutoRig
* QA
* repair tooling
* future schema evolution

The future AutoRig implementation must not depend only on PSD layer-name pattern matching.

`LAYER_SCHEMA.md` is the source of truth for machine-readable IDs.

---

# 9. Target VTuber Parts

V1 should attempt to identify the following.

## Hair

```text
Front Hair
├─ Left
├─ Center
└─ Right

Side Hair
├─ Left
└─ Right

Back Hair
├─ Left
└─ Right
```

Back hair should additionally support multiple meaningful strands:

```text
BackHair_L_01
BackHair_L_02
...

BackHair_R_01
BackHair_R_02
...
```

Optional:

```text
Sideburn_L
Sideburn_R
Ahoge
```

## Head / Face

```text
FaceBase
Face contour metadata
Neck
```

Optional when reliably separable:

```text
Ear_L
Ear_R
Nose
```

## Eyes

```text
EyeWhite_L
EyeWhite_R

Iris_L
Iris_R

Eyelash_L
Eyelash_R

Eyebrow_L
Eyebrow_R
```

## Mouth

Required minimum:

```text
MouthBase
```

The architecture must allow future optional subdivision into:

```text
UpperLip
LowerLip
MouthInside
Teeth
Tongue
```

but Phase 1 must not invent unseen mouth anatomy.

## Body

```text
Torso
Neck
```

Arms:

```text
UpperArm_L
Forearm_L
Hand_L

UpperArm_R
Forearm_R
Hand_R
```

A coarser whole-arm fallback is allowed when reliable subdivision is not possible.

---

# 10. Optional Parts Policy

Not every character contains every part.

Examples:

* no ahoge
* no visible ears
* one eye hidden by hair
* hands outside the image
* arm hidden behind torso
* no visible mouth interior

Do not create empty or fictional parts merely to satisfy the target schema.

A missing optional part is valid.

A required-but-undetected part should be represented as a QA condition rather than fabricated artwork.

---

# 11. Character-Relative Left / Right

L/R always means the character's own side.

It never means screen side.

Do not use:

```text
x < canvasCenter → L
x > canvasCenter → R
```

as the sole classification method.

Estimate the character's center and orientation from the best evidence available.

Preferred evidence hierarchy:

```text
paired facial features
↓
face geometry / landmarks
↓
face mask
↓
neck / torso geometry
↓
pose estimation
↓
overall character mask
```

Store:

* face center
* body center
* orientation/axis estimate
* confidence

in normalized coordinates.

---

# 12. Face Geometry

In addition to the FaceBase raster, preserve useful face geometry for future rigging.

Where available:

```text
face center
face bounding box
face contour polyline
eye centers
mouth center
chin estimate
forehead/head overlap region
```

These values are hints, not authoritative anatomy.

Each estimated value should carry confidence where useful.

---

# 13. Eye Processing

See-through eye-related semantic results should be subdivided into character-relative left/right components.

Processing should consider:

* connected components
* face axis
* spatial pairing
* eye geometry
* source semantic layer

QA should detect obvious contradictions such as:

* left and right assigned to the same component
* iris far outside corresponding eye white
* eyebrow below corresponding eye region
* duplicated canonical identity

If a source eye is fully obscured, do not synthesize an eye and report it as observed.

---

# 14. Front Hair Processing

Front hair must not be split using three simple vertical rectangles.

Target:

```text
FrontHair_L
FrontHair_C
FrontHair_R
```

Possible features:

* root position
* overlap with forehead
* centroid
* connected components
* contour shape
* principal direction
* tip direction
* face center
* pseudo-depth
* skeleton geometry

Classification should represent the hair's semantic/root relationship, not simply the final position of its tip.

A center bang may lean strongly left or right while still being center-rooted.

---

# 15. Side Hair Processing

Target:

```text
SideHair_L
SideHair_R
```

Useful evidence:

* position adjacent to face
* ear/temple region
* root near side of head
* depth relationship to front/back hair
* vertical extent
* contour geometry

If side hair and sideburn cannot be separated reliably, prefer a combined side-hair result over false precision.

---

# 16. Back Hair Processing

Minimum acceptable result:

```text
BackHair_L
BackHair_R
```

Preferred result:

```text
BackHair_L_01
BackHair_L_02
...

BackHair_R_01
BackHair_R_02
...
```

Possible strand-analysis tools:

* connected components
* contour concavity
* distance transform
* skeletonization
* watershed
* local neck detection
* root clustering
* hair-tip analysis
* pseudo-depth

Avoid over-segmentation.

Tiny fragments should be merged or ignored according to configurable thresholds.

Maximum strands should be configurable rather than permanently hard-coded.

---

# 17. Ahoge Detection

Ahoge is optional.

Candidate properties may include:

* narrow hair component
* protrusion above main head mass
* connection or close proximity to hair mask
* small relative area
* root near top of head
* distinct tip

Use a relatively conservative confidence threshold.

False absence is preferable to repeatedly inventing ahoge.

---

# 18. Sideburn Detection

Sideburn candidates may use:

* face contour
* temple position
* ear region
* narrow hair geometry
* vertical direction
* side-hair relationship

If confidence is insufficient:

```text
Sideburn
→ SideHair
```

rather than generating an uncertain independent layer.

---

# 19. Body Processing

Attempt to identify:

```text
Neck
Torso
Arm_L
Arm_R
```

before detailed limb splitting.

Depth relationships must not be globally hard-coded because poses vary.

For example, an arm may be:

* behind the torso
* beside the torso
* partially in front of the torso
* crossing the body

Preserve depth information where available.

---

# 20. Limb Processing

Target:

```text
UpperArm
Forearm
Hand
```

per side.

Potential evidence:

* body semantic masks
* clothing/skin boundary
* skeleton
* pose estimation
* shoulder estimate
* elbow estimate
* wrist estimate
* hand geometry

Pose estimation must be abstracted behind an adapter.

The core VTuber pipeline must not require one specific pose library forever.

If joint confidence is too low, fall back:

```text
UpperArm / Forearm / Hand
→ whole Arm
```

without losing source artwork.

---

# 21. Rigging Hints

Phase 1 does not perform rigging.

However, where reliable, it should preserve hints such as:

```text
pivot_hint
anchor_hint
joint_hint
rotation_axis_hint
root_hint
tip_hint
```

Examples:

* shoulder pivot
* elbow pivot
* wrist pivot
* hair root
* hair tip
* neck center

These are estimates for future AutoRig use.

Unknown values must remain unknown.

---

# 22. Hidden Area Reconstruction

Simple visible cutouts are not sufficient for deformation.

Parts should contain enough hidden continuation to reduce holes when moved.

Important connections:

```text
Face ↔ Neck
Neck ↔ Torso
Shoulder ↔ UpperArm
UpperArm ↔ Forearm
Forearm ↔ Hand
Hair Root ↔ Head
Sideburn ↔ Head
```

Hidden-area processing may involve:

* mask extension
* source-layer recovery
* neighboring texture continuation
* inpainting
* geometric extrapolation

The implementation must distinguish reconstruction from observed artwork.

---

# 23. Adaptive Overlap

Do not use one fixed overlap size for all files.

Overlap should consider:

```text
canvas size
character scale
local part width
estimated joint width
part type
configured limits
```

Conceptually:

```text
overlap =
clamp(
    jointWidth * ratio,
    minimum,
    maximum
)
```

All major thresholds should be configurable.

---

# 24. Provenance

Each derived part should preserve its source history.

Conceptual chain:

```text
source semantic layer
↓
derived segmentation mask
↓
generated hidden mask
↓
final part
```

Part source types:

```text
observed
generated
mixed
```

Where practical, preserve:

```text
visible_mask
generated_mask
final_mask
```

and:

```text
generated_area_ratio
```

Do not confuse generated reconstruction with original image evidence.

---

# 25. Confidence

Automated semantic decisions should expose confidence when practical.

Suggested presentation tiers:

```text
HIGH
MEDIUM
LOW
```

Exact thresholds belong in configuration.

Confidence should be usable for:

* QA
* WebUI warning
* fallback selection
* AutoRig readiness
* manual-review prioritization

Confidence is not proof of visual quality.

---

# 26. Fallback Philosophy

Every detailed subdivision needs a safe coarser representation.

Examples:

```text
BackHair strands
→ BackHair L/R
→ original BackHair
```

```text
UpperArm / Forearm / Hand
→ Arm L/R
→ upstream usable body layer
```

```text
Sideburn
→ SideHair
```

```text
Detailed mouth
→ MouthBase
```

Never delete usable source content because a more detailed classifier failed.

---

# 27. Manifest

The VTuber result must include:

```text
vtuber_manifest.json
```

Top-level fields should include at least:

```text
schema
schema_version
profile
canvas
character
parts
processing
qa
```

Each recognized part follows `LAYER_SCHEMA.md`.

Useful information includes:

```text
canonical ID
PSD layer name
parent
side
source tags
bbox
centroid
confidence
source type
generated area ratio
z/depth
rigging hints
```

Manifest schema must be versioned.

---

# 28. PSD Hierarchy

PSD presentation should be human-readable.

Recommended high-level groups:

```text
Hair
Face
Mouth
Body
```

Detailed canonical identity is stored in the manifest.

Do not duplicate identical visible artwork into compatibility layers if that would create double compositing.

For VTuber Profile, update tooling to understand the manifest instead.

---

# 29. Existing Preview Compatibility

The current preview understands the Standard Profile's Anime2.5-style layer naming.

VTuber Edition should not break Standard Preview behavior.

For VTuber jobs, extend the existing preview to consume:

```text
PSD
+
vtuber_manifest.json
```

rather than forcing detailed VTuber PSDs to imitate the Standard layer contract.

Useful VTuber preview modes:

```text
Original
Composite
Selected Part
Mask
Generated Area
```

---

# 30. VTuber Debug UI

Developer/debug views should support:

* part list
* canonical ID
* confidence
* source type
* bounding box
* centroid
* character center axis
* generated mask
* pivot hints
* joint hints
* z/depth
* source semantic layer

Normal user screens should avoid unnecessary internal terminology.

---

# 31. Future Manual Correction

A complete raster editor is not required for V1.

Internal data structures must nevertheless allow future operations such as:

```text
Merge Parts
Split Part
Paint Mask
Erase Mask
Change Classification
Swap L/R
Change Z Order
Adjust Pivot
Adjust Joint
```

Do not design the manifest as immutable output-only data.

---

# 32. Job Structure

Reuse the existing job infrastructure.

Target extension:

```text
.still2rig-psd/jobs/<name>/
├─ input/
├─ colab/
├─ raw/
│  └─ imported/
├─ processed/
│  ├─ layers/
│  └─ vtuber/
│     ├─ masks/
│     ├─ parts/
│     ├─ generated/
│     ├─ geometry/
│     └─ debug/
├─ output/
│  ├─ <name>.psd
│  └─ vtuber_manifest.json
├─ reports/
│  ├─ qa_report.json
│  ├─ qa_report.html
│  └─ contact_sheet.png
└─ job.json
```

Do not create a second unrelated workspace system.

---

# 33. Configuration

VTuber-specific tuning must be centralized.

Examples:

```text
hair.maxStrands
hair.minComponentArea
hair.centerClassificationThreshold

confidence.high
confidence.medium

overlap.defaultRatio
overlap.minimumPixels
overlap.maximumRatio

generatedArea.warningRatio

pose.enabled
pose.adapter

qa.maximumCompositeDifference
```

Do not scatter tuning constants throughout unrelated modules.

---

# 34. GPU and Colab

Reuse the project's existing approved Colab architecture.

GPU-relevant work may include:

* See-through
* optional segmentation models
* pose estimation
* optional inpainting

Local processing should remain responsible for tasks that do not need GPU where practical:

* validation
* metadata
* deterministic mask operations
* PSD assembly
* manifest assembly
* structural QA

Adding new remote processing must preserve the existing user-consent boundary.

---

# 35. QA Categories

VTuber QA must be separate from existing Standard expression QA.

## Structural QA

Verify:

* PSD can be written/read
* canvas dimensions match
* canonical IDs are unique
* hierarchy is valid
* required metadata is valid
* raster layers contain expected alpha where applicable
* PSD ↔ manifest mappings exist

## Spatial QA

Examples:

* iris corresponds spatially to eye white
* eyebrow is plausibly positioned near its eye
* neck connects plausibly to face and torso
* hand connects plausibly to forearm
* forearm connects plausibly to upper arm
* L/R assignment does not strongly contradict character axis

## Coverage QA

Compare reconstructed composite to source.

Detect:

* large missing regions
* accidental holes
* abnormal duplicated coverage
* severe alpha mismatch

## Generated Region QA

Inspect:

* generated-area ratio
* overlap amount
* suspicious seams
* excessive reconstruction

## Semantic QA

Detect:

* impossible duplicate identity
* tiny meaningless hair fragments
* contradictory parents
* invalid side combinations
* impossible geometry

---

# 36. AutoRig Readiness

Do not reuse existing Standard quality fields as if they proved VTuber rig readiness.

Define a separate VTuber readiness status:

```text
AUTO_RIG_READY
AUTO_RIG_PARTIAL
MANUAL_REVIEW_REQUIRED
FAILED
```

Conceptually:

### AUTO_RIG_READY

Core semantic structure required by the future AutoRig is present with acceptable confidence.

### AUTO_RIG_PARTIAL

Usable structured data exists but some optional or lower-priority parts remain coarse.

### MANUAL_REVIEW_REQUIRED

PSD was generated, but important semantic ambiguity must be corrected before automatic rigging.

### FAILED

A blocking pipeline or structural failure occurred.

A readiness status does not claim artistic or Live2D production quality.

---

# 37. Repairability

A VTuber job must preserve enough intermediate information that a user can repair a result without rerunning expensive upstream processing when unnecessary.

Examples:

* keep imported semantic results
* keep masks
* preserve source mapping
* preserve generated-region masks
* preserve manifest history where practical

Future repair should be able to rebuild PSD and QA from corrected masks or metadata.

---

# 38. Testing

Required test categories:

## Unit

* profile parsing
* canonical IDs
* side enums
* schema validation
* geometry validation
* manifest serialization
* mask split
* mask merge
* provenance
* fallback selection

## Integration

```text
prepare
→ import
→ vtuber processing
→ finalize
→ PSD
→ manifest
→ QA
```

## Regression

Existing Standard Profile behavior must continue to pass.

## Visual Fixtures

Use synthetic or distributable fixtures where possible.

Do not commit private user artwork.

Representative cases should eventually include:

* bust-up
* half-body
* full-body
* long hair
* short hair
* ahoge
* no ahoge
* one eye covered
* asymmetric pose
* arms beside torso
* arm crossing torso
* complex clothing

---

# 39. V1 Acceptance Criteria

V1 is complete when all of the following are true.

## Compatibility

* Standard Profile still works.
* VTuber Profile can be selected explicitly.
* Existing job and consent boundaries remain intact.

## Outputs

* PSD generated.
* VTuber manifest generated.
* VTuber QA report generated.
* Contact sheet generated.

## Face

* FaceBase available.
* Face geometry metadata available where practical.
* Neck available or clearly reported missing.

## Eyes

* EyeWhite L/R
* Iris L/R
* Eyelash L/R
* Eyebrow L/R

when present in the source.

## Hair

* FrontHair L/C/R or explicit fallback/review state
* SideHair L/R or explicit fallback/review state
* BackHair at least L/R when segmentation supports it
* multiple back-hair strands supported
* Sideburn optional
* Ahoge optional

## Body

* Torso
* left/right arm identity where visible
* UpperArm / Forearm / Hand subdivision where reliable
* safe coarser fallback where not reliable

## Reconstruction

* hidden-overlap architecture implemented
* observed/generated distinction implemented
* generated-area ratio available

## Metadata

* canonical ID
* side
* parent
* bbox
* centroid
* confidence
* provenance
* z/depth where available
* future-rig hints where available

## QA

* structural
* spatial
* coverage
* generated region
* AutoRig readiness

## UI

* existing Standard preview still works
* VTuber result can be inspected
* mask/generated-area inspection available
* metadata/debug inspection available

---

# 40. Future AutoRig Contract

The later AutoRig project should consume:

```text
<name>.psd
vtuber_manifest.json
```

It should be able to identify a part from canonical ID without performing semantic image recognition again.

Examples:

```text
eye.left.iris
→ left iris rig target
```

```text
hair.front.center
→ center front-hair deformer / physics target
```

```text
arm.left.forearm
→ left forearm rig target
```

The exact canonical IDs are governed by `LAYER_SCHEMA.md`.

---

# 41. Final Design Principle

Still2Rig VTuber Edition succeeds when it transforms:

```text
pixels
```

into:

```text
structured, repairable, semantically meaningful VTuber source data
```

A PSD with many arbitrary layers is not sufficient.

The project must preserve:

```text
appearance
meaning
identity
hierarchy
side
depth
geometry
provenance
confidence
future rigging information
```

so that subsequent automation does not need to rediscover what Phase 1 already learned.
