import { readJson, writeJson } from '../utils.mjs';
import { PROFILE_VTUBER } from '../profile.mjs';
import { CHARACTER_ORIENTATIONS, emptyCharacterGeometry } from './geometry.mjs';

export const VTUBER_MANIFEST_SCHEMA = 'still2rig-vtuber';
export const VTUBER_MANIFEST_SCHEMA_VERSION = 1;
export const VTUBER_SIDES = Object.freeze(['left', 'right', 'center', 'none']);
export const VTUBER_SOURCE_TYPES = Object.freeze(['observed', 'generated', 'mixed']);

const CANONICAL_PART_PATTERNS = Object.freeze([
  /^hair\.front\.(left|center|right)$/,
  /^hair\.side\.(left|right)$/,
  /^hair\.back\.(left|right)(?:\.\d{2})?$/,
  /^hair\.sideburn\.(left|right)$/,
  /^hair\.ahoge$/,
  /^face\.base$/,
  /^ear\.(left|right)$/,
  /^eye\.(left|right)\.(white|iris|lash)$/,
  /^brow\.(left|right)$/,
  /^nose$/,
  /^mouth\.(base|upper_lip|lower_lip|inside|teeth|tongue)$/,
  /^body\.(neck|torso)$/,
  /^arm\.(left|right)\.(upper|forearm|hand)(?:\.(back|front))?$/,
]);

const CANONICAL_IDENTIFIER = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
const JOINT_HINT_NAMES = new Set(['shoulder', 'elbow', 'wrist', 'hand']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, name) {
  if (!isRecord(value)) throw new Error(`${name} must be an object.`);
}

function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
}

function assertUnitInterval(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return;
  assertFiniteNumber(value, name);
  if (value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1.`);
}

function assertNormalizedPoint(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${name} must be a normalized [x, y] point.`);
  }
  assertUnitInterval(value[0], `${name}[0]`);
  assertUnitInterval(value[1], `${name}[1]`);
}

function assertCanvas(canvas) {
  assertRecord(canvas, 'canvas');
  for (const name of ['width', 'height']) {
    if (!Number.isInteger(canvas[name]) || canvas[name] <= 0) {
      throw new Error(`canvas.${name} must be a positive integer.`);
    }
  }
}

function assertCoordinateSystem(value) {
  assertRecord(value, 'coordinate_system');
  if (value.normalized_coordinates !== 'canvas') {
    throw new Error('coordinate_system.normalized_coordinates must be canvas.');
  }
  if (value.angle_unit !== 'radian') throw new Error('coordinate_system.angle_unit must be radian.');
  if (value.z_index !== 'larger_is_front') {
    throw new Error('coordinate_system.z_index must be larger_is_front.');
  }
  if (value.side !== 'character_relative') {
    throw new Error('coordinate_system.side must be character_relative.');
  }
}

function assertCharacterAxis(value, name) {
  if (value === null || value === undefined) return;
  assertRecord(value, name);
  assertNormalizedPoint(value.origin, `${name}.origin`);
  if (!Array.isArray(value.direction) || value.direction.length !== 2) {
    throw new Error(`${name}.direction must be a finite unit [x, y] vector.`);
  }
  value.direction.forEach((coordinate, index) => assertFiniteNumber(coordinate, `${name}.direction[${index}]`));
  const length = Math.hypot(...value.direction);
  if (Math.abs(length - 1) > 0.000001) throw new Error(`${name}.direction must be a unit vector.`);
  assertOptionalString(value.source, `${name}.source`);
}

function assertCharacterOrientation(value, name) {
  if (value === null || value === undefined) return;
  assertRecord(value, name);
  if (!CHARACTER_ORIENTATIONS.includes(value.facing)) {
    throw new Error(`${name}.facing must be one of: ${CHARACTER_ORIENTATIONS.join(', ')}.`);
  }
  assertUnitInterval(value.confidence, `${name}.confidence`);
  assertOptionalString(value.source, `${name}.source`);
}

function assertNullableConfidenceRecord(value, name) {
  if (value === undefined) return;
  assertRecord(value, name);
  for (const field of ['character_center', 'face_center', 'body_center']) {
    if (value[field] !== undefined) assertUnitInterval(value[field], `${name}.${field}`, { nullable: true });
  }
}

function assertCharacterEvidence(value, name) {
  if (value === undefined) return;
  assertRecord(value, name);
  for (const field of ['character_center', 'face_center', 'body_center', 'axis', 'orientation']) {
    if (value[field] !== undefined) assertOptionalString(value[field], `${name}.${field}`);
  }
}

function assertBoundingBox(value, canvas, name) {
  if (value === null || value === undefined) return;
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${name} must be a pixel [x1, y1, x2, y2] box.`);
  }
  value.forEach((coordinate, index) => {
    if (!Number.isInteger(coordinate)) throw new Error(`${name}[${index}] must be an integer pixel coordinate.`);
  });
  const [x1, y1, x2, y2] = value;
  if (x1 < 0 || y1 < 0 || x2 > canvas.width || y2 > canvas.height || x1 >= x2 || y1 >= y2) {
    throw new Error(`${name} must have positive area within the canvas.`);
  }
}

function assertOptionalString(value, name) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
}

function canonicalSide(id) {
  const segments = id.split('.');
  return VTUBER_SIDES.find((side) => side !== 'none' && segments.includes(side)) || 'none';
}

export function isCanonicalPartId(value) {
  return typeof value === 'string' && CANONICAL_PART_PATTERNS.some((pattern) => pattern.test(value));
}

export function assertCanonicalPartId(value, name = 'part.id') {
  if (!isCanonicalPartId(value)) {
    throw new Error(`${name} is not a canonical ID defined by LAYER_SCHEMA.md: ${String(value)}.`);
  }
}

function assertParent(value, id, name) {
  if (value === null) return;
  if (typeof value !== 'string' || !CANONICAL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must be null or a lowercase dot-separated identifier.`);
  }
  if (value === id) throw new Error(`${name} must not reference the part itself.`);
}

function assertSourceMapping(part, name) {
  assertOptionalString(part.source_tag, `${name}.source_tag`);
  if (part.source_tags !== undefined) {
    if (!Array.isArray(part.source_tags) || part.source_tags.length === 0) {
      throw new Error(`${name}.source_tags must be a non-empty array.`);
    }
    const values = new Set();
    for (const [index, value] of part.source_tags.entries()) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name}.source_tags[${index}] must be a non-empty string.`);
      }
      values.add(value);
    }
    if (values.size !== part.source_tags.length) throw new Error(`${name}.source_tags must be unique.`);
  }
  if (part.source_tag !== undefined && part.source_tags !== undefined) {
    throw new Error(`${name} must use source_tag or source_tags, not both.`);
  }
}

function assertJointHints(value, name) {
  if (value === undefined || value === null) return;
  assertRecord(value, name);
  for (const [joint, point] of Object.entries(value)) {
    if (!JOINT_HINT_NAMES.has(joint)) throw new Error(`${name}.${joint} is not a supported joint hint.`);
    assertNormalizedPoint(point, `${name}.${joint}`, { nullable: true });
  }
}

function assertPart(part, canvas, index) {
  const name = `parts[${index}]`;
  assertRecord(part, name);
  assertCanonicalPartId(part.id, `${name}.id`);
  if (typeof part.psd_layer !== 'string' || !part.psd_layer.trim()) {
    throw new Error(`${name}.psd_layer must be a non-empty string.`);
  }
  assertParent(part.parent, part.id, `${name}.parent`);
  if (!VTUBER_SIDES.includes(part.side)) throw new Error(`${name}.side must be one of: ${VTUBER_SIDES.join(', ')}.`);
  const expectedSide = canonicalSide(part.id);
  if (part.side !== expectedSide) {
    throw new Error(`${name}.side must be ${expectedSide} for canonical ID ${part.id}.`);
  }
  if (!VTUBER_SOURCE_TYPES.includes(part.source_type)) {
    throw new Error(`${name}.source_type must be one of: ${VTUBER_SOURCE_TYPES.join(', ')}.`);
  }
  assertUnitInterval(part.confidence, `${name}.confidence`);
  assertUnitInterval(part.generated_area_ratio, `${name}.generated_area_ratio`);
  if (part.source_type === 'observed' && part.generated_area_ratio !== 0) {
    throw new Error(`${name}.generated_area_ratio must be 0 for observed artwork.`);
  }
  if (part.source_type === 'generated' && part.generated_area_ratio !== 1) {
    throw new Error(`${name}.generated_area_ratio must be 1 for generated artwork.`);
  }
  if (part.source_type === 'mixed' && (part.generated_area_ratio <= 0 || part.generated_area_ratio >= 1)) {
    throw new Error(`${name}.generated_area_ratio must be greater than 0 and less than 1 for mixed artwork.`);
  }
  assertBoundingBox(part.bbox, canvas, `${name}.bbox`);
  if (part.centroid !== undefined) assertNormalizedPoint(part.centroid, `${name}.centroid`, { nullable: true });
  for (const hint of ['pivot_hint', 'anchor_hint', 'root_hint', 'tip_hint']) {
    if (part[hint] !== undefined) assertNormalizedPoint(part[hint], `${name}.${hint}`, { nullable: true });
  }
  if (part.rotation_axis_hint !== undefined && part.rotation_axis_hint !== null) {
    assertFiniteNumber(part.rotation_axis_hint, `${name}.rotation_axis_hint`);
  }
  if (part.z_index !== undefined && !Number.isInteger(part.z_index)) {
    throw new Error(`${name}.z_index must be an integer.`);
  }
  assertJointHints(part.joint_hints, `${name}.joint_hints`);
  assertSourceMapping(part, name);
}

export function validateVtuberManifest(value) {
  assertRecord(value, 'manifest');
  if (value.schema !== VTUBER_MANIFEST_SCHEMA) {
    throw new Error(`manifest.schema must be ${VTUBER_MANIFEST_SCHEMA}.`);
  }
  if (value.schema_version !== VTUBER_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported VTuber manifest schema version: ${String(value.schema_version)}.`);
  }
  if (value.profile !== PROFILE_VTUBER) throw new Error('manifest.profile must be vtuber.');
  assertCoordinateSystem(value.coordinate_system);
  assertCanvas(value.canvas);
  assertRecord(value.character, 'character');
  for (const name of ['character_center', 'face_center', 'body_center']) {
    if (value.character[name] !== undefined) {
      assertNormalizedPoint(value.character[name], `character.${name}`, { nullable: true });
    }
  }
  for (const name of ['character_bbox', 'face_bbox', 'body_bbox']) {
    if (value.character[name] !== undefined) {
      assertBoundingBox(value.character[name], value.canvas, `character.${name}`);
    }
  }
  assertCharacterAxis(value.character.axis, 'character.axis');
  if (value.character.axis_confidence !== undefined) {
    assertUnitInterval(value.character.axis_confidence, 'character.axis_confidence', { nullable: true });
  }
  assertCharacterOrientation(value.character.orientation, 'character.orientation');
  assertNullableConfidenceRecord(value.character.confidence, 'character.confidence');
  assertCharacterEvidence(value.character.evidence, 'character.evidence');
  if (!Array.isArray(value.parts)) throw new Error('parts must be an array.');
  const ids = new Set();
  value.parts.forEach((part, index) => {
    assertPart(part, value.canvas, index);
    if (ids.has(part.id)) throw new Error(`Duplicate canonical ID: ${part.id}.`);
    ids.add(part.id);
  });
  assertRecord(value.processing, 'processing');
  assertRecord(value.qa, 'qa');
  return value;
}

export function createInitialVtuberManifest({ width, height, psd, character = null }) {
  if (typeof psd !== 'string' || !psd.trim()) throw new Error('Initial VTuber manifest requires a PSD path.');
  const manifest = {
    schema: VTUBER_MANIFEST_SCHEMA,
    schema_version: VTUBER_MANIFEST_SCHEMA_VERSION,
    profile: PROFILE_VTUBER,
    coordinate_system: {
      normalized_coordinates: 'canvas',
      angle_unit: 'radian',
      z_index: 'larger_is_front',
      side: 'character_relative',
    },
    canvas: { width, height },
    character: character || emptyCharacterGeometry(),
    parts: [],
    processing: {
      stage: 'character_geometry',
      detailed_segmentation: false,
      psd,
    },
    qa: {
      status: 'not_evaluated',
    },
  };
  return validateVtuberManifest(manifest);
}

export function serializeVtuberManifest(value) {
  validateVtuberManifest(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function deserializeVtuberManifest(text) {
  if (typeof text !== 'string') throw new Error('VTuber manifest input must be JSON text.');
  return validateVtuberManifest(JSON.parse(text));
}

export function writeVtuberManifest(file, value) {
  validateVtuberManifest(value);
  writeJson(file, value);
}

export function readVtuberManifest(file) {
  return validateVtuberManifest(readJson(file));
}
