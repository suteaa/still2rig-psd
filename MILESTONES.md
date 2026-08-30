# Still2Rig VTuber Edition — Development Milestones

## 1. Development Policy

Implement VTuber Edition incrementally.

Each milestone should follow:

```text
Inspect
↓
Design
↓
Implement
↓
Test
↓
Inspect Result
↓
Report
```

Do not introduce unrelated later-stage functionality merely because it is already described in `SPEC.md`.

If the user explicitly asks for the complete implementation, proceed through milestones sequentially without requesting routine confirmation after every milestone.

Stop only when:

* user input is genuinely required
* an irreversible action requires approval
* external authentication/consent is required
* tests expose a blocking architectural issue

Preserve Standard Profile compatibility throughout development.

---

# Milestone 0 — Repository Analysis

## Goal

Understand the existing Still2Rig architecture before modifying it.

## Inspect

Read:

```text
AGENTS.md
SPEC.md
LAYER_SCHEMA.md
MILESTONES.md
README.md
README.ja.md
docs/
package.json
src/
test/
configs/
webui/
.agents/skills/still2rig-psd/
colab/
```

Trace the current workflow:

```text
prepare
↓
Colab preparation
↓
See-through
↓
import
↓
cleanup
↓
finalize
↓
PSD assembly
↓
QA
↓
preview
```

Identify:

* CLI entry point
* job representation
* job state/provenance
* See-through output mapping
* layer cleanup
* standard layer map
* PSD builder
* expression handling
* structural QA
* repair workflow
* WebUI loading
* Colab integration
* relevant test coverage

## Deliverable

Before broad changes, report:

```text
Current Architecture
Existing Data Flow
Proposed VTuber Extension Points
Files To Add
Files To Modify
Compatibility Risks
Implementation Order
```

## Exit Criteria

Milestone 0 is complete when the implementation locations for:

```text
profile
manifest
VTuber processing
PSD assembly
QA
WebUI
```

are identified without guessing.

---

# Milestone 1 — VTuber Profile and Schema Plumbing

## Goal

Add VTuber mode without changing Standard behavior.

## Implement

Target CLI support:

```bash
npm run still2rig-psd -- prepare ./character.png --name demo --profile vtuber
```

Store selected profile in job data.

Introduce:

* VTuber profile definition
* manifest type/model
* schema version
* canonical part identity support
* side enum
* source/provenance enum
* confidence representation
* geometry validation
* optional rig hints

Do not implement complex segmentation yet.

Generate a structurally valid initial:

```text
vtuber_manifest.json
```

for VTuber jobs.

## Tests

* standard prepare unchanged
* VTuber profile accepted
* unknown profile rejected
* profile persisted in job
* manifest serialization
* manifest deserialization
* invalid schema rejected
* duplicate canonical IDs rejected
* invalid confidence rejected
* invalid normalized coordinates rejected

## Exit Criteria

A VTuber job can be created and finalized through the existing architecture without changing Standard Profile output.

---

# Milestone 2 — Character Geometry and Left/Right

## Goal

Create a reliable character-relative coordinate frame.

## Implement

Estimate:

* character center
* face center
* body center
* orientation/axis
* confidence

Use the strongest available data.

Do not classify using canvas center alone.

Introduce common helpers for:

```text
character-relative side
normalized coordinate
bbox
centroid
```

## Tests

Synthetic/fixture cases:

* character centered
* character shifted left
* character shifted right
* asymmetrical pose
* different canvas aspect ratios

Verify that character Left/Right remains semantically correct.

## Exit Criteria

All later segmentation modules can request character-relative L/R from one common geometry service rather than reimplementing their own screen-side logic.

---

# Milestone 3 — Eye and Brow Split

## Goal

Implement the first high-confidence VTuber-specific subdivision.

## Target

When visible:

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

## Implement

Use:

* existing semantic layers
* connected components
* character axis
* face geometry
* component pairing

Record:

* canonical ID
* side
* bbox
* centroid
* confidence
* source tag
* provenance

## QA

Check:

* duplicate side assignment
* iris/eye-white spatial relation
* eyebrow/eye relation
* implausible geometry
* missing side

## Tests

Include:

* normal paired eyes
* one eye obscured
* asymmetrical eyes
* off-center character

## Exit Criteria

Common front-facing characters reliably produce character-relative left/right eye parts.

A missing eye is reported rather than invented.

---

# Milestone 4 — Hair Foundation

## Goal

Build reusable hair-analysis primitives.

## Implement

Create a hair-analysis module capable of using:

* connected components
* contours
* centroids
* root estimates
* tip estimates
* principal direction
* skeleton information where useful
* depth where available
* face/head relationship

Add common hair configuration.

Do not yet optimize only for a single hairstyle.

## Tests

Use synthetic masks to test:

* separated components
* touching components
* narrow strands
* large connected mass
* small noise fragments

## Exit Criteria

Hair geometry can be inspected and classified without duplicating low-level mask logic across front/side/back hair modules.

---

# Milestone 5 — Front / Side Hair

## Goal

Produce semantic front and side hair subdivisions.

## Front Hair Target

```text
FrontHair_L
FrontHair_C
FrontHair_R
```

Do not perform naive vertical thirds.

Use root and geometric relationship to the face/head.

## Side Hair Target

```text
SideHair_L
SideHair_R
```

## Optional

Attempt:

```text
Sideburn_L
Sideburn_R
```

with conservative confidence.

Fallback:

```text
Sideburn
→ SideHair
```

## Tests

Include:

* center bang
* center bang leaning sideways
* asymmetric bangs
* long side locks
* no clear sideburn

## Exit Criteria

Front L/C/R is based on semantic/root relationship rather than only endpoint X coordinate.

Failed detailed classification preserves the upstream hair content.

---

# Milestone 6 — Back Hair and Strand Splitting

## Goal

Support Live2D-useful back-hair parts.

## Minimum Target

```text
BackHair_L
BackHair_R
```

## Preferred Target

```text
BackHair_L_01
BackHair_L_02
...

BackHair_R_01
BackHair_R_02
...
```

## Implement

Evaluate suitable combinations of:

* connected components
* contour concavity
* distance transform
* skeletonization
* watershed
* root clustering
* tip detection
* pseudo-depth

Provide configuration for:

```text
minimum component area
merge threshold
maximum strand count
minimum strand confidence
```

## Fallback

```text
multiple strands
→ L/R
→ original BackHair
```

## QA

Detect:

* tiny useless fragments
* excessive strand count
* overlapping duplicate masks
* impossible side assignment

## Exit Criteria

Back hair always preserves a usable coarse representation even when strand subdivision fails.

---

# Milestone 7 — Ahoge

## Goal

Detect ahoge conservatively.

## Implement

Candidate logic may consider:

* top-of-head location
* narrow geometry
* small relative area
* root near head/hair
* protrusion outside primary hair mass
* distinct tip

## Policy

Ahoge is optional.

Do not create one when confidence is insufficient.

## Tests

Include:

* clear ahoge
* no ahoge
* tall bangs mistaken for ahoge
* decorative head accessory near hair

## Exit Criteria

False positives are low enough that "not detected" is preferred to uncertain fabrication.

---

# Milestone 8 — Face, Neck, and Torso

## Goal

Establish the core head/body connection.

## Target

```text
FaceBase
Neck
Torso
```

Optional:

```text
Ear_L
Ear_R
Nose
```

## Metadata

Where practical, preserve:

* face contour
* chin hint
* neck center
* torso center
* relevant bounding boxes

## QA

Check plausible:

```text
Face ↔ Neck ↔ Torso
```

relationships.

## Exit Criteria

The core body chain is represented without changing Standard Profile ordering or semantics.

---

# Milestone 9 — Arm Identity

## Goal

Separate visible arms into character-relative sides before attempting joints.

## Target

```text
Arm_L
Arm_R
```

## Implement

Use:

* body semantics
* character axis
* pose evidence
* connected geometry
* torso relationship

Preserve possible front/back depth information.

## Tests

Include:

* arms at side
* one arm hidden
* arm crossing torso
* asymmetric pose

## Exit Criteria

Visible arms have stable semantic left/right identity or are explicitly marked uncertain.

---

# Milestone 10 — Limb Joint Adapter

## Goal

Create the abstraction required for detailed arm splitting.

## Implement

Define a pose/joint adapter interface able to provide, where available:

```text
shoulder
elbow
wrist
hand
confidence
```

Do not tightly couple the VTuber pipeline to a single third-party model.

Provide a disabled/no-op implementation or fallback path when pose processing is unavailable.

## Exit Criteria

Detailed limb processing consumes a generic joint interface.

---

# Milestone 11 — Upper Arm / Forearm / Hand

## Goal

Split arms into Live2D-useful pieces.

## Target

```text
UpperArm_L
Forearm_L
Hand_L

UpperArm_R
Forearm_R
Hand_R
```

## Metadata

Where reliable:

```text
pivot_hint
joint_hints
rotation_axis_hint
```

## Fallback

```text
UpperArm / Forearm / Hand
→ whole Arm
```

## QA

Check:

* shoulder connection
* elbow connection
* wrist connection
* segment ordering
* implausibly small fragments

## Exit Criteria

Joint subdivision is useful where confidence is adequate and harmless where it is not.

---

# Milestone 12 — Hidden Overlap Architecture

## Goal

Prevent immediate gaps when parts are later deformed.

## Targets

```text
Face ↔ Neck
Neck ↔ Torso
Shoulder ↔ UpperArm
UpperArm ↔ Forearm
Forearm ↔ Hand
Hair Root ↔ Head
Sideburn ↔ Head
```

## Implement

Create adaptive overlap calculation based on:

* image scale
* local part width
* joint width
* part type
* configurable min/max

Generate:

```text
visible_mask
generated_mask
final_mask
```

where practical.

## Exit Criteria

The system can extend part masks beyond their visible cut boundary without losing provenance.

---

# Milestone 13 — Hidden Area Reconstruction

## Goal

Fill required hidden overlap with usable artwork.

## Implement

Use the least destructive source of information first.

Possible priority:

```text
recover from existing inferred semantic layer
↓
neighboring texture continuation
↓
controlled reconstruction
↓
inpainting when necessary
```

Track:

```text
source_type
generated_area_ratio
```

## QA

Warn on:

* excessive generated area
* obvious alpha discontinuity
* invalid fill
* empty generated overlap

## Exit Criteria

Generated hidden artwork can never be confused with original observed artwork in manifest or QA.

---

# Milestone 14 — VTuber PSD Assembly

## Goal

Create the detailed PSD defined by `LAYER_SCHEMA.md`.

## Implement

Generate human-readable hierarchy while retaining stable canonical IDs in manifest.

Ensure:

* PSD ↔ manifest mapping
* no duplicate semantic identity
* no unnecessary empty layers
* correct canvas
* preserved alpha
* valid depth order

Do not create duplicate raster compatibility layers that alter the composite.

## Tests

* PSD round trip
* hierarchy
* mapping
* duplicate detection
* alpha integrity
* standard regression

## Exit Criteria

A VTuber PSD opens correctly in PSD-compatible software and every semantic part can be resolved through the manifest.

---

# Milestone 15 — VTuber QA

## Goal

Create VTuber-specific quality gates.

## Implement

### Structural QA

* PSD readable
* canvas valid
* manifest valid
* canonical IDs unique
* layer mapping valid

### Spatial QA

* eye relationships
* face/neck/torso relationships
* arm segment relationships
* L/R consistency

### Coverage QA

* source/composite difference
* missing area
* accidental hole
* duplicate overlap

### Generated Region QA

* generated ratio
* overlap amount
* seam indicators

### Semantic QA

* invalid hierarchy
* meaningless tiny fragments
* contradictory identity

## Exit Criteria

A VTuber result can fail semantic readiness without falsely failing the entire PSD generation pipeline.

---

# Milestone 16 — AutoRig Readiness

## Goal

Produce a clear downstream status.

## Statuses

```text
AUTO_RIG_READY
AUTO_RIG_PARTIAL
MANUAL_REVIEW_REQUIRED
FAILED
```

## Implement

Define explicit criteria in configuration or QA logic.

Do not use the existing Standard Profile's expression `productionReady` field as proof of VTuber AutoRig readiness.

## Exit Criteria

The user can distinguish:

```text
PSD generated successfully
```

from:

```text
safe to send directly to AutoRig
```

---

# Milestone 17 — Manifest-Aware WebUI

## Goal

Extend the current preview without breaking Standard Profile.

## Add

VTuber views:

```text
Parts
QA
Masks
Generated Areas
Metadata
```

Viewer modes:

```text
Original
Composite
Selected Part
Mask
Generated Area
```

Developer overlay:

* canonical ID
* bounding box
* centroid
* character axis
* confidence
* provenance
* pivot hint
* joint hint

## Policy

Standard PSD behavior must remain unchanged.

Do not expose excessive implementation terminology in the normal user view.

## Exit Criteria

A problematic automatically generated part can be found visually within seconds.

---

# Milestone 18 — Manual Correction Foundation

## Goal

Prepare for correction without building a complete graphics editor.

## Internal Support

Ensure data can later support:

```text
Merge
Split
Mask Paint
Mask Erase
Classification Change
L/R Swap
Z Order Change
Pivot Adjustment
Joint Adjustment
```

An actual polished editor is not required in this milestone.

## Exit Criteria

Current data structures do not prevent later correction tooling.

---

# Milestone 19 — End-to-End Integration

## Goal

Run the complete VTuber pipeline.

## Pipeline

```text
Input
↓
prepare --profile vtuber
↓
approved See-through processing
↓
import
↓
character analysis
↓
detailed splitting
↓
hidden reconstruction
↓
PSD assembly
↓
manifest
↓
VTuber QA
↓
WebUI review
```

## Verify

* job provenance
* profile persistence
* repair compatibility
* artifact locations
* Standard Profile regression

## Exit Criteria

The complete pipeline succeeds without manual file-moving or undocumented scripts.

---

# Milestone 20 — Representative Validation

## Goal

Evaluate real-world failure modes.

## Fixture Matrix

Test, using legally usable/private local assets without committing them:

```text
Bust-up
Half-body
Full-body
Short hair
Long hair
Asymmetric hair
Ahoge
No ahoge
Eye covered by hair
Simple clothing
Complex clothing
Arms at sides
Arm crossing torso
Hands visible
Hands cropped
Asymmetric pose
```

Record known limitations by category.

Do not tune only for one character.

## Exit Criteria

Major failure classes are understood and either handled or explicitly documented.

---

# Milestone 21 — V1 Hardening

## Goal

Complete the first usable VTuber Edition.

## Required Gate

### Compatibility

* Standard Profile regression passes.
* VTuber Profile is explicit.
* Existing consent/security boundaries remain intact.

### Core Output

* PSD
* manifest
* QA report
* contact sheet

### Face

* FaceBase
* Neck or explicit failure
* useful face geometry where available

### Eyes

When visible:

* white L/R
* iris L/R
* lash L/R
* brow L/R

### Hair

* front L/C/R or review/fallback
* side L/R or review/fallback
* back L/R minimum
* multi-strand support
* optional sideburn
* optional ahoge

### Body

* torso
* arm L/R when visible
* detailed limb segmentation where reliable
* safe fallback where not

### Reconstruction

* adaptive overlap
* observed/generated provenance
* generated-area accounting

### QA

* structural
* spatial
* coverage
* generated-region
* semantic
* AutoRig readiness

### UI

* Standard Preview preserved
* VTuber part inspection
* mask inspection
* generated-area inspection
* metadata/debug inspection

## Exit Criteria

The user can take a static illustration, run the documented VTuber workflow, inspect the result, identify uncertain parts, and obtain a structured PSD/manifest pair suitable as the input contract for the next AutoRig project.

---

# Milestone Completion Report

After every milestone, report:

```text
Implemented:
- ...

Changed Files:
- ...

Tests Run:
- ...

Test Results:
- ...

Known Limitations:
- ...

Next Milestone:
- ...
```

Do not call a milestone complete when tests required by that milestone are failing without explanation.

Do not confuse:

```text
implementation complete
tests passing
structural QA passing
segmentation quality
visual quality
AutoRig readiness
```

with one another.

---

# Final Phase 1 State

The final Phase 1 pipeline should be:

```text
Static Character Illustration
        ↓
Still2Rig VTuber Edition
        ↓
Detailed PSD
+
Versioned VTuber Manifest
+
QA
        ↓
Review / Repair
        ↓
Future AutoRig for Cubism
```

The key completion requirement is that the future AutoRig system should not need to rediscover the semantic identity of every part from the original image.
