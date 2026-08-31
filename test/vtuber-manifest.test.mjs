import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInitialVtuberManifest,
  deserializeVtuberManifest,
  isCanonicalPartId,
  serializeVtuberManifest,
  validateVtuberManifest,
  VTUBER_MANIFEST_SCHEMA_VERSION,
} from '../src/vtuber/manifest.mjs';

function manifestWithPart(overrides = {}) {
  const manifest = createInitialVtuberManifest({
    width: 2048,
    height: 2048,
    psd: '.still2rig-psd/jobs/demo/output/demo.psd',
  });
  manifest.parts.push({
    id: 'arm.left.forearm',
    psd_layer: 'Forearm_L',
    parent: 'arm.left',
    side: 'left',
    source_tag: 'handwear',
    bbox: [120, 240, 480, 960],
    centroid: [0.15, 0.3],
    confidence: 0.82,
    source_type: 'mixed',
    generated_area_ratio: 0.2,
    z_index: 12,
    pivot_hint: [0.16, 0.24],
    anchor_hint: [0.15, 0.3],
    rotation_axis_hint: 1.57,
    joint_hints: {
      shoulder: [0.2, 0.2],
      elbow: [0.15, 0.3],
      wrist: null,
    },
    ...overrides,
  });
  return manifest;
}

test('creates a schema-versioned initial VTuber manifest without fabricated parts', () => {
  const manifest = createInitialVtuberManifest({ width: 1280, height: 1280, psd: 'output/demo.psd' });
  assert.equal(manifest.schema_version, VTUBER_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.profile, 'vtuber');
  assert.deepEqual(manifest.parts, []);
  assert.deepEqual(manifest.character, {
    character_center: null,
    face_center: null,
    body_center: null,
    character_bbox: null,
    face_bbox: null,
    body_bbox: null,
    axis: null,
    axis_confidence: null,
    orientation: null,
    confidence: {
      character_center: null,
      face_center: null,
      body_center: null,
    },
    evidence: {
      character_center: null,
      face_center: null,
      body_center: null,
      axis: null,
      orientation: null,
    },
  });
  assert.equal(manifest.coordinate_system.side, 'character_relative');
  assert.equal(manifest.qa.status, 'not_evaluated');
});

test('serializes and deserializes canonical parts and optional rig hints', () => {
  const manifest = manifestWithPart();
  const serialized = serializeVtuberManifest(manifest);
  assert.ok(serialized.endsWith('\n'));
  assert.deepEqual(deserializeVtuberManifest(serialized), manifest);
});

test('accepts only canonical IDs defined by LAYER_SCHEMA.md', () => {
  for (const id of [
    'face.base',
    'eye.right.iris',
    'hair.front.center',
    'hair.back.left',
    'hair.back.right.01',
    'mouth.upper_lip',
    'arm.left.upper.front',
  ]) assert.equal(isCanonicalPartId(id), true, id);
  for (const id of ['Face.Base', 'eye.viewer_left.iris', 'hair.front', 'unknown.part']) {
    assert.equal(isCanonicalPartId(id), false, id);
  }
});

test('rejects unsupported schema versions and duplicate canonical IDs', () => {
  const invalidSchema = manifestWithPart();
  invalidSchema.schema_version = 2;
  assert.throws(() => validateVtuberManifest(invalidSchema), /Unsupported VTuber manifest schema version/);

  const duplicate = manifestWithPart();
  duplicate.parts.push(structuredClone(duplicate.parts[0]));
  assert.throws(() => validateVtuberManifest(duplicate), /Duplicate canonical ID/);
});

test('rejects invalid canonical IDs and side enums or identity mismatches', () => {
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ id: 'unknown.part' })),
    /not a canonical ID/,
  );
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ side: 'viewer-left' })),
    /side must be one of/,
  );
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ side: 'right' })),
    /side must be left/,
  );
});

test('rejects invalid confidence, provenance ratios, and normalized coordinates', () => {
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ confidence: 1.01 })),
    /confidence must be between 0 and 1/,
  );
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ source_type: 'observed', generated_area_ratio: 0.2 })),
    /must be 0 for observed artwork/,
  );
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ source_type: 'inferred' })),
    /source_type must be one of/,
  );
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ centroid: [-0.01, 0.3] })),
    /centroid\[0\] must be between 0 and 1/,
  );
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ pivot_hint: [0.5, Number.NaN] })),
    /pivot_hint\[1\] must be a finite number/,
  );
});

test('rejects invalid pixel geometry and accepts explicitly unknown optional geometry', () => {
  assert.throws(
    () => validateVtuberManifest(manifestWithPart({ bbox: [100, 100, 4096, 200] })),
    /bbox must have positive area within the canvas/,
  );
  const unknown = manifestWithPart({ bbox: null, centroid: null, pivot_hint: null });
  assert.equal(validateVtuberManifest(unknown), unknown);
});

test('validates character geometry, axis, orientation, and confidence', () => {
  const valid = createInitialVtuberManifest({ width: 200, height: 300, psd: 'output/demo.psd' });
  valid.character = {
    ...valid.character,
    character_center: [0.5, 0.52],
    face_center: [0.5, 0.2],
    body_center: [0.5, 0.65],
    character_bbox: [20, 10, 180, 300],
    face_bbox: [60, 20, 140, 100],
    body_bbox: [40, 110, 160, 290],
    axis: { origin: [0.5, 0.2], direction: [0, 1], source: 'paired_facial_features' },
    axis_confidence: 0.94,
    orientation: { facing: 'front', confidence: 0.94, source: 'paired_facial_features' },
    confidence: { character_center: 0.8, face_center: 0.9, body_center: 0.85 },
    evidence: {
      character_center: 'overall_character_mask',
      face_center: 'face_mask',
      body_center: 'neck_torso_geometry',
      axis: 'paired_facial_features',
      orientation: 'paired_facial_features',
    },
  };
  assert.equal(validateVtuberManifest(valid), valid);

  const badAxis = structuredClone(valid);
  badAxis.character.axis.direction = [0, 2];
  assert.throws(() => validateVtuberManifest(badAxis), /direction must be a unit vector/);

  const badOrientation = structuredClone(valid);
  badOrientation.character.orientation.facing = 'viewer-left';
  assert.throws(() => validateVtuberManifest(badOrientation), /orientation.facing must be one of/);
});
