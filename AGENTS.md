# Still2Rig PSD — Agent Guide

This repository is developed and operated with AI coding agents such as Codex.

Treat the repository as potentially public even when working on a private fork. Keep private artwork, generated assets, credentials, local paths, and user-specific data out of tracked files.

The VTuber Edition extends the existing Still2Rig PSD workflow. It must remain compatible with the existing standard workflow unless the user explicitly requests a breaking change.

---

## 1. Core operating rules

Use the repository's official CLI and existing workflow for job creation, Colab preparation, import, processing, PSD assembly, repair, and QA.

The canonical CLI entry point is:

```bash
npm run still2rig-psd -- ...
```

Do not replace manifest-backed or job-backed workflow stages with ad-hoc scratch scripts merely because doing so appears faster.

Scratch scripts are acceptable for isolated investigation, debugging, benchmarks, or one-off data inspection, but they must not become an undocumented replacement for the actual pipeline.

Keep private and generated runtime data under the ignored:

```text
.still2rig-psd/
```

directory.

This includes, where applicable:

* source character images
* uploaded or downloaded Colab bundles
* generated PSD files
* generated masks
* contact sheets
* QA captures
* logs
* temporary files
* generated notebook cells
* connection tokens
* model downloads
* user-provided expression artwork

Never add the following to tracked files:

* API keys
* authentication tokens
* cookies
* Google account details
* personal images
* private PSDs
* chat transcripts
* local absolute paths
* private screenshots
* model weights
* credentials of any kind

Do not run or perform the following unless the user explicitly requests that separate action:

* `git init`
* git commit
* git push
* repository publication
* package publication
* release creation

Do not modify the user's global:

```text
~/.codex/config.toml
```

The repository-scoped Codex configuration is the intended configuration surface.

---

## 2. Required VTuber Edition documents

Before making changes related to VTuber Edition, read the following files:

1. `SPEC.md`
2. `LAYER_SCHEMA.md`
3. `MILESTONES.md`

Their responsibilities are intentionally separate.

### `SPEC.md`

Defines:

* product behavior
* architecture
* scope
* compatibility
* processing pipeline
* QA philosophy
* VTuber-specific behavior

### `LAYER_SCHEMA.md`

Defines the machine-readable contract:

* canonical part IDs
* PSD layer naming
* layer hierarchy
* character-relative left/right convention
* metadata fields
* parent relationships
* provenance
* rig hints
* schema versioning

Treat `LAYER_SCHEMA.md` as the source of truth for part identity.

### `MILESTONES.md`

Defines:

* implementation order
* test requirements
* completion gates
* milestone deliverables

Do not duplicate large sections of these documents into `AGENTS.md`.

---

## 3. Instruction priority

If project documents conflict, use this priority:

1. Security, privacy, consent, and repository operating rules in `AGENTS.md`
2. `LAYER_SCHEMA.md` for machine-readable data contracts
3. `SPEC.md` for VTuber Edition product behavior and architecture
4. `MILESTONES.md` for implementation order and completion gates
5. Existing implementation details where they do not conflict with the above

If a specification conflicts with the actual architecture in a way that would require a destructive rewrite, investigate first and prefer the smallest compatible design.

Document the conflict instead of silently choosing a different interpretation.

---

## 4. Google Colab

Use the repository's Still2Rig skill and established Colab workflow.

Do not replace the approved workflow with browser automation.

Do not automate:

* Chrome profile selection
* Google login
* Google account selection
* runtime allocation
* user consent
* connection approval

The user controls those actions.

Use the supported Colab MCP workflow for repository-controlled Colab execution.

Never disconnect, delete, or release the user's active runtime unless the user explicitly requests that action in the current turn.

Treat connection URLs and tokens as secrets.

Do not place them in:

* source files
* documentation
* screenshots
* logs intended for publication
* git history

---

## 5. Existing standard workflow compatibility

The current Still2Rig PSD standard workflow remains supported.

VTuber-specific behavior must be isolated behind an explicit profile such as:

```text
vtuber
```

or another clearly separated configuration selected by the user.

Do not silently change the standard layer contract.

Do not silently change:

* standard PSD ordering
* existing CLI semantics
* existing job layout
* current QA meanings
* expression-art requirements
* Colab consent boundaries
* preview behavior for standard PSDs

When shared code is modified, add or run regression coverage proving that the standard workflow still works.

Prefer additive changes over broad rewrites.

Reuse existing infrastructure where appropriate:

* jobs
* configuration
* provenance
* import validation
* PSD assembly
* QA
* WebUI
* repair workflow

Do not create a second implementation of an existing subsystem unless there is a documented technical reason.

---

## 6. VTuber Edition objective

VTuber Edition is not merely a more detailed PSD exporter.

Its purpose is to convert a static character image into structured VTuber assets that a future AutoRig system can interpret mechanically.

The principal output contract is:

```text
PSD
+
vtuber_manifest.json
```

The PSD is the human-editable visual representation.

The manifest is the machine-readable semantic representation.

Future tooling must not depend solely on guessing part identity from PSD layer names.

---

## 7. Left and right convention

All `L` and `R` labels mean the character's own left and right.

They never mean the viewer's left and right.

For a front-facing character, the character's left side will normally appear on the viewer's right.

Do not determine character side from raw canvas halves alone.

Use the strongest available evidence, such as:

* paired eyes
* face geometry
* face landmarks
* face-mask centroid
* neck position
* torso position
* pose estimation
* overall character mask

Store orientation confidence where required by the schema.

---

## 8. VTuber part detection rules

Do not treat uncertain segmentation as certain.

Every heuristic, model prediction, or subdivision should have:

* a confidence score where practical
* a defined fallback
* preserved upstream source data

Examples of acceptable fallback chains:

```text
multiple back-hair strands
→ left/right back hair
→ original back-hair semantic layer
```

```text
upper arm / forearm / hand
→ whole left/right arm
→ original usable body/arm source layer
```

```text
independent sideburn
→ corresponding side-hair part
→ original hair source
```

A failed subdivision must not destroy a usable upstream layer.

Do not generate empty raster layers merely to satisfy an expected name.

Do not fabricate a missing feature and report it as observed.

This applies particularly to:

* hidden eye
* ahoge
* sideburn
* ear
* teeth
* tongue
* mouth interior
* missing limb segment
* unseen joint area

Optional parts may be absent.

Absence is preferable to a false positive presented as truth.

---

## 9. Observed and generated artwork

Always distinguish source-visible artwork from generated or inferred hidden artwork.

Where hidden-area reconstruction, inpainting, or extension is used, preserve provenance sufficient to identify:

```text
observed
generated
mixed
```

Where supported, keep separate masks such as:

```text
visible_mask
generated_mask
final_mask
```

Do not report generated pixels as source-observed pixels.

Record generated-area ratios where defined by `LAYER_SCHEMA.md`.

Large generated regions should produce a QA warning.

Generated artwork must still be visually reviewed.

---

## 10. Live2D-oriented overlap

Simple cutouts are insufficient for later deformation.

Where appropriate, create additional hidden overlap around connections such as:

* face ↔ neck
* neck ↔ torso
* shoulder ↔ upper arm
* upper arm ↔ forearm
* forearm ↔ hand
* hair root ↔ head
* sideburn ↔ head

Do not use the same hard-coded pixel extension for every resolution.

Prefer calculations based on:

* canvas scale
* local part width
* estimated joint width
* configurable normalized ratios
* minimum and maximum limits

Generated overlap must retain provenance information.

---

## 11. Hair-specific rules

Hair subdivision is a primary VTuber Edition feature.

Target structures include:

* front hair: left / center / right
* side hair: left / right
* back hair: left / right
* multiple back-hair strands when confidence permits
* sideburns when independently detectable
* ahoge when actually present

Do not implement front-hair subdivision as a naive three-column crop.

Use available geometry and semantics such as:

* root position
* component connectivity
* centroid
* contour
* principal direction
* tip geometry
* face center
* depth
* skeleton structure

Avoid over-segmentation.

A smaller number of meaningful hair pieces is preferable to many unstable fragments.

---

## 12. Face and eye rules

Preserve individual left/right identity for:

* eye white
* iris
* eyelash
* eyebrow

Do not invent an obscured eye when the source does not provide enough information.

Face geometry should retain useful future rigging information where possible, including:

* face center
* face contour
* eye centers
* relevant bounding boxes
* useful deformation hints

These are hints, not ground truth.

---

## 13. Body and limb rules

Where supported, structure arms as:

```text
UpperArm
Forearm
Hand
```

for each side.

Pose or joint estimation should be implemented behind an adapter boundary rather than tightly coupling the entire VTuber pipeline to one pose-estimation library.

When joints cannot be estimated reliably, fall back to a coarser arm representation.

Do not invent joint coordinates merely to satisfy the schema.

Unknown values should remain unknown.

---

## 14. VTuber manifest

Every recognized VTuber part should have the machine-readable information required by `LAYER_SCHEMA.md`.

Where available, preserve:

* canonical ID
* PSD layer name
* parent
* character-relative side
* source semantic layer
* bounding box
* centroid
* confidence
* provenance
* generated-area ratio
* depth or z-order
* pivot hint
* anchor hint
* root hint
* tip hint
* joint hints
* rotation-axis hint

Do not fabricate metadata.

Use null, omitted optional fields, or explicit low-confidence states according to the schema.

Schema-breaking changes require schema version handling.

---

## 15. Quality claims

Keep different quality levels separate.

A structurally valid PSD does not prove:

* natural closed-eye art
* natural alternate mouth artwork
* correct deformation
* correct physics
* correct Live2D rigging
* visually seamless generated regions
* production-quality motion

Numeric tests do not replace visual review.

Do not describe an output as production-ready merely because structural QA passed.

Do not claim motion quality without actual renderer evidence.

For VTuber Edition, keep AutoRig readiness separate from visual quality.

Use explicit statuses defined by the specification rather than collapsing everything into a single success flag.

---

## 16. AutoRig boundary

This repository currently produces structured VTuber source assets.

Unless the user explicitly expands the scope, do not implement:

* direct `.cmo3` generation
* direct `.moc3` generation
* reverse engineering of proprietary Cubism formats
* Cubism GUI automation
* final Cubism ArtMesh authoring
* final Cubism Deformer authoring
* final parameter rigging
* final physics authoring
* face tracking

Preserve metadata that can support those future systems.

The future AutoRig system should consume:

```text
PSD
+
vtuber_manifest.json
```

rather than re-discovering all semantic information from the image.

---

## 17. Local PSD preview

Use the existing preview infrastructure whenever possible.

Standard preview command:

```bash
npm run preview
```

Do not copy user artwork, private PSD files, or generated screenshots into tracked WebUI source directories.

VTuber Edition should extend the existing preview instead of creating an unrelated second application unless the existing architecture genuinely prevents it.

For VTuber mode, the preview may expose development views such as:

* selected part
* mask
* generated area
* character center axis
* bounding box
* centroid
* confidence
* canonical ID
* pivot hints
* joint hints

Do not duplicate raster compatibility layers merely to satisfy the old preview if doing so would alter the composite.

Prefer making the preview manifest-aware.

---

## 18. User-facing language

Design UI text for a person using the tool for the first time.

Use natural, understandable Japanese.

Prefer labels describing what the user can do or what will change.

Avoid exposing internal implementation terminology when ordinary language is clearer.

Terms such as the following should normally remain in developer/debug views:

* manifest
* canonical ID
* WebGL
* runtime
* internal QA identifiers
* implementation parameter names

When technical terminology is necessary, explain it near the point of use.

When changing visible wording, review neighboring labels for consistency and inspect the rendered UI before reporting completion.

---

## 19. Milestone discipline

Follow `MILESTONES.md`.

Do not mix unrelated future milestones into the current implementation merely because their specifications are already known.

If the user's task explicitly asks for implementation across multiple milestones, proceed sequentially.

Do not require routine user confirmation between milestones unless:

* the specification is genuinely ambiguous
* an irreversible action is required
* user-controlled authentication or consent is required
* a major architecture change must be chosen

Before broad VTuber Edition implementation, complete Milestone 0 repository analysis.

The analysis should identify:

* current CLI flow
* job lifecycle
* See-through import/mapping
* cleanup pipeline
* PSD assembly
* QA
* configuration
* tests
* WebUI
* repository skill
* Colab workflow

Before broad architectural modification, report:

```text
Current Architecture
Proposed Changes
Files To Add
Files To Modify
Compatibility Risks
Implementation Order
```

---

## 20. Testing

Run focused tests while implementing and the relevant regression suite before declaring a milestone complete.

Do not ignore unexplained failing tests.

Important VTuber Edition coverage includes:

* profile selection
* canonical IDs
* schema validation
* character-relative L/R
* manifest serialization
* hierarchy
* mask splitting
* mask merging
* fallback behavior
* provenance
* confidence
* PSD/manifest correspondence
* generated-area accounting
* standard-workflow regression

Visual segmentation quality requires visual fixtures or inspection in addition to numeric tests.

When practical, use deterministic synthetic fixtures for structural tests and representative character fixtures for image-quality regression.

Do not commit private user artwork as a fixture.

---

## 21. Completion reports

At the end of a milestone, report:

```text
Implemented
Changed Files
Tests Run
Test Results
Known Limitations
Next Milestone
```

Keep these concepts separate:

* code implemented
* tests passing
* structural QA passing
* segmentation confidence
* visual quality
* AutoRig readiness

Do not use one of them as proof of the others.

---

## 22. Final development principle

Optimize for a pipeline that is inspectable, repairable, and machine-readable.

A useful VTuber result is not merely:

```text
a PSD with many layers
```

It is:

```text
artwork
+
semantic meaning
+
stable identity
+
hierarchy
+
side
+
depth
+
provenance
+
confidence
+
rigging hints
+
QA
```

Preserve information for future stages instead of discarding it after PSD assembly.
