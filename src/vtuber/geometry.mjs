import fs from 'node:fs';
import path from 'node:path';
import { readPngRgba } from '../psd.mjs';

export const CHARACTER_ORIENTATIONS = Object.freeze(['front', 'left_profile', 'right_profile', 'back']);
export const CHARACTER_RELATIVE_SIDES = Object.freeze(['left', 'right', 'center', 'unknown']);

export const DEFAULT_CHARACTER_GEOMETRY_CONFIG = Object.freeze({
  alphaThreshold: 16,
  minimumComponentPixels: 4,
  minimumAxisEvidenceConfidence: 0.45,
  minimumSideConfidence: 0.6,
  centerBandRatio: 0.025,
});

const EVIDENCE = Object.freeze({
  pairedFeatures: 'paired_facial_features',
  faceGeometry: 'face_geometry',
  faceMask: 'face_mask',
  neckTorso: 'neck_torso_geometry',
  pose: 'pose_evidence',
  overallMask: 'overall_character_mask',
});

const OVERALL_LAYER_FILES = Object.freeze([
  'back hair.png',
  'bottomwear.png',
  'handwear.png',
  'topwear.png',
  'neck.png',
  'ears.png',
  'face.png',
  'front hair.png',
  'headwear.png',
]);

function assertCanvas(canvas) {
  if (!canvas || !Number.isInteger(canvas.width) || canvas.width <= 0
    || !Number.isInteger(canvas.height) || canvas.height <= 0) {
    throw new Error('canvas must contain positive integer width and height.');
  }
}

function assertPoint(point, name) {
  if (!Array.isArray(point) || point.length !== 2
    || point.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${name} must be a finite [x, y] point.`);
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function roundConfidence(value) {
  return Math.round(clamp01(value) * 1_000_000) / 1_000_000;
}

function configWithDefaults(config = {}) {
  return { ...DEFAULT_CHARACTER_GEOMETRY_CONFIG, ...config };
}

export function normalizePoint(point, canvas) {
  assertCanvas(canvas);
  assertPoint(point, 'point');
  const normalized = [point[0] / canvas.width, point[1] / canvas.height];
  if (normalized.some((value) => value < 0 || value > 1)) {
    throw new Error('point must be within the canvas.');
  }
  return normalized;
}

export function denormalizePoint(point, canvas) {
  assertCanvas(canvas);
  assertPoint(point, 'point');
  if (point.some((value) => value < 0 || value > 1)) {
    throw new Error('normalized point must be between 0 and 1.');
  }
  return [point[0] * canvas.width, point[1] * canvas.height];
}

export function alphaMaskFromRgba(image) {
  assertCanvas(image);
  if (!image.data || image.data.length !== image.width * image.height * 4) {
    throw new Error('RGBA image data length does not match its canvas.');
  }
  const data = new Uint8Array(image.width * image.height);
  for (let source = 3, target = 0; source < image.data.length; source += 4, target += 1) {
    data[target] = image.data[source];
  }
  return { width: image.width, height: image.height, data };
}

function assertMask(mask, canvas, name = 'mask') {
  if (!mask || mask.width !== canvas.width || mask.height !== canvas.height
    || !mask.data || mask.data.length !== canvas.width * canvas.height) {
    throw new Error(`${name} dimensions must match the canvas.`);
  }
}

export function mergeAlphaMasks(masks, canvas) {
  assertCanvas(canvas);
  const data = new Uint8Array(canvas.width * canvas.height);
  for (const [index, mask] of masks.filter(Boolean).entries()) {
    assertMask(mask, canvas, `masks[${index}]`);
    for (let pixel = 0; pixel < data.length; pixel += 1) {
      if (mask.data[pixel] > data[pixel]) data[pixel] = mask.data[pixel];
    }
  }
  return { width: canvas.width, height: canvas.height, data };
}

export function measureAlphaMask(mask, { alphaThreshold = DEFAULT_CHARACTER_GEOMETRY_CONFIG.alphaThreshold } = {}) {
  const canvas = { width: mask?.width, height: mask?.height };
  assertCanvas(canvas);
  assertMask(mask, canvas);
  let weight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = mask.data[y * canvas.width + x];
      if (alpha <= alphaThreshold) continue;
      const pixelWeight = alpha / 255;
      weight += pixelWeight;
      weightedX += (x + 0.5) * pixelWeight;
      weightedY += (y + 0.5) * pixelWeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;
    }
  }
  if (!pixels || weight === 0) return null;
  const pixelCentroid = [weightedX / weight, weightedY / weight];
  return {
    bbox: [minX, minY, maxX + 1, maxY + 1],
    centroid: normalizePoint(pixelCentroid, canvas),
    pixelCentroid,
    pixels,
    weight,
  };
}

function connectedComponents(mask, config) {
  const { width, height } = mask;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || mask.data[start] <= config.alphaThreshold) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let pixels = 0;
    let weight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      const pixelWeight = mask.data[index] / 255;
      pixels += 1;
      weight += pixelWeight;
      weightedX += (x + 0.5) * pixelWeight;
      weightedY += (y + 0.5) * pixelWeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);
      for (const neighbor of neighbors) {
        if (!visited[neighbor] && mask.data[neighbor] > config.alphaThreshold) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
    if (pixels >= config.minimumComponentPixels) {
      components.push({
        pixels,
        weight,
        pixelCentroid: [weightedX / weight, weightedY / weight],
        bbox: [minX, minY, maxX + 1, maxY + 1],
      });
    }
  }
  return components;
}

function pairedFeatureAxis(mask, config, sourceTag) {
  const components = connectedComponents(mask, config)
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, 8);
  let best = null;
  for (let first = 0; first < components.length; first += 1) {
    for (let second = first + 1; second < components.length; second += 1) {
      let left = components[first];
      let right = components[second];
      if (left.pixelCentroid[0] > right.pixelCentroid[0]) [left, right] = [right, left];
      const dx = right.pixelCentroid[0] - left.pixelCentroid[0];
      const dy = right.pixelCentroid[1] - left.pixelCentroid[1];
      const distance = Math.hypot(dx, dy);
      const meanWidth = ((left.bbox[2] - left.bbox[0]) + (right.bbox[2] - right.bbox[0])) / 2;
      if (!distance || dx <= meanWidth * 0.5 || Math.abs(dy) > Math.abs(dx)) continue;
      const areaBalance = Math.min(left.pixels, right.pixels) / Math.max(left.pixels, right.pixels);
      const horizontalAlignment = 1 - Math.abs(dy) / distance;
      const usefulSeparation = Math.min(1, dx / Math.max(1, meanWidth * 1.5));
      const score = areaBalance * 0.45 + horizontalAlignment * 0.35 + usefulSeparation * 0.2;
      if (!best || score > best.score) best = { left, right, dx, dy, distance, score };
    }
  }
  if (!best) return null;
  let direction = [-best.dy / best.distance, best.dx / best.distance];
  if (direction[1] < 0) direction = direction.map((value) => -value);
  const origin = [
    (best.left.pixelCentroid[0] + best.right.pixelCentroid[0]) / 2,
    (best.left.pixelCentroid[1] + best.right.pixelCentroid[1]) / 2,
  ];
  const confidence = roundConfidence(0.6 + best.score * 0.4);
  return {
    origin,
    direction,
    confidence,
    source: sourceTag ? `${EVIDENCE.pairedFeatures}:${sourceTag}` : EVIDENCE.pairedFeatures,
    orientation: { facing: 'front', confidence, source: EVIDENCE.pairedFeatures },
  };
}

function principalAxis(mask, measurement, config, source) {
  if (!measurement || measurement.pixels < config.minimumComponentPixels) return null;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let weight = 0;
  const [cx, cy] = measurement.pixelCentroid;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const alpha = mask.data[y * mask.width + x];
      if (alpha <= config.alphaThreshold) continue;
      const pixelWeight = alpha / 255;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      xx += dx * dx * pixelWeight;
      xy += dx * dy * pixelWeight;
      yy += dy * dy * pixelWeight;
      weight += pixelWeight;
    }
  }
  if (!weight) return null;
  xx /= weight;
  xy /= weight;
  yy /= weight;
  const trace = xx + yy;
  const delta = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
  if (!trace || !Number.isFinite(delta)) return null;
  const majorAngle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const major = [Math.cos(majorAngle), Math.sin(majorAngle)];
  const minor = [-major[1], major[0]];
  let direction = Math.abs(major[1]) >= Math.abs(minor[1]) ? major : minor;
  if (direction[1] < 0) direction = direction.map((value) => -value);
  const anisotropy = delta / trace;
  return {
    origin: measurement.pixelCentroid,
    direction,
    confidence: roundConfidence(0.25 + 0.45 * anisotropy),
    source,
  };
}

function axisFromCenters(face, neck, body) {
  const origin = face?.pixelCentroid || neck?.pixelCentroid;
  const target = body?.pixelCentroid || neck?.pixelCentroid;
  if (!origin || !target || origin === target) return null;
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const length = Math.hypot(dx, dy);
  if (!length || dy <= 0) return null;
  const verticalAgreement = dy / length;
  return {
    origin,
    direction: [dx / length, dy / length],
    confidence: roundConfidence(0.58 + 0.22 * verticalAgreement),
    source: EVIDENCE.neckTorso,
  };
}

function externalAxis(record, canvas, source) {
  if (!record?.axis) return null;
  const { origin, direction } = record.axis;
  assertPoint(origin, `${source}.axis.origin`);
  assertPoint(direction, `${source}.axis.direction`);
  const length = Math.hypot(...direction);
  if (!length) throw new Error(`${source}.axis.direction must not be zero.`);
  const confidence = record.axis.confidence ?? record.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`${source}.axis.confidence must be between 0 and 1.`);
  }
  return {
    origin: denormalizePoint(origin, canvas),
    direction: [direction[0] / length, direction[1] / length],
    confidence,
    source,
    orientation: record.orientation || null,
  };
}

function measureEvidence(mask, canvas, config, name) {
  if (!mask) return null;
  assertMask(mask, canvas, name);
  return measureAlphaMask(mask, config);
}

export function emptyCharacterGeometry() {
  return {
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
  };
}

export function analyzeCharacterGeometry({ canvas, evidence = {}, config = {} }) {
  assertCanvas(canvas);
  const resolvedConfig = configWithDefaults(config);
  const overall = measureEvidence(evidence.overallMask, canvas, resolvedConfig, 'evidence.overallMask');
  const face = measureEvidence(evidence.faceMask, canvas, resolvedConfig, 'evidence.faceMask');
  const neck = measureEvidence(evidence.neckMask, canvas, resolvedConfig, 'evidence.neckMask');
  const body = measureEvidence(evidence.torsoMask, canvas, resolvedConfig, 'evidence.torsoMask');
  const character = emptyCharacterGeometry();

  if (overall) {
    character.character_center = overall.centroid;
    character.character_bbox = overall.bbox;
    character.confidence.character_center = 0.8;
    character.evidence.character_center = EVIDENCE.overallMask;
  }
  if (face) {
    character.face_center = face.centroid;
    character.face_bbox = face.bbox;
    character.confidence.face_center = 0.9;
    character.evidence.face_center = EVIDENCE.faceMask;
  }
  if (body) {
    character.body_center = body.centroid;
    character.body_bbox = body.bbox;
    character.confidence.body_center = 0.85;
    character.evidence.body_center = evidence.torsoSource
      ? `${EVIDENCE.neckTorso}:${evidence.torsoSource}`
      : EVIDENCE.neckTorso;
  }

  const candidates = [];
  for (const entry of evidence.pairedFeatureMasks || []) {
    const mask = entry?.mask || entry;
    if (!mask) continue;
    assertMask(mask, canvas, 'evidence.pairedFeatureMasks');
    const candidate = pairedFeatureAxis(mask, resolvedConfig, entry?.source || null);
    if (candidate) {
      candidates.push(candidate);
      break;
    }
  }
  const faceGeometryAxis = externalAxis(evidence.faceGeometry, canvas, EVIDENCE.faceGeometry);
  if (faceGeometryAxis) candidates.push(faceGeometryAxis);
  const faceMaskAxis = principalAxis(evidence.faceMask, face, resolvedConfig, EVIDENCE.faceMask);
  if (faceMaskAxis) candidates.push(faceMaskAxis);
  const neckTorsoAxis = axisFromCenters(face, neck, body);
  if (neckTorsoAxis) candidates.push(neckTorsoAxis);
  const poseAxis = externalAxis(evidence.pose, canvas, EVIDENCE.pose);
  if (poseAxis) candidates.push(poseAxis);
  const overallAxis = principalAxis(evidence.overallMask, overall, resolvedConfig, EVIDENCE.overallMask);
  if (overallAxis) candidates.push(overallAxis);

  const chosen = candidates.find((candidate) => candidate.confidence >= resolvedConfig.minimumAxisEvidenceConfidence);
  if (chosen) {
    character.axis = {
      origin: normalizePoint(chosen.origin, canvas),
      direction: chosen.direction,
      source: chosen.source,
    };
    character.axis_confidence = chosen.confidence;
    character.evidence.axis = chosen.source;
  }

  const orientationCandidates = [
    candidates.find((candidate) => candidate.source.startsWith(EVIDENCE.pairedFeatures))?.orientation,
    faceGeometryAxis?.orientation,
    poseAxis?.orientation,
  ].filter(Boolean);
  const orientation = orientationCandidates.find((candidate) => (
    CHARACTER_ORIENTATIONS.includes(candidate.facing)
    && typeof candidate.confidence === 'number'
    && candidate.confidence >= resolvedConfig.minimumSideConfidence
  ));
  if (orientation) {
    character.orientation = {
      facing: orientation.facing,
      confidence: roundConfidence(orientation.confidence),
      source: orientation.source || chosen?.source || EVIDENCE.pairedFeatures,
    };
    character.evidence.orientation = character.orientation.source;
  }

  return character;
}

export function classifyCharacterRelativeSide(point, { canvas, character }, config = {}) {
  assertCanvas(canvas);
  assertPoint(point, 'point');
  const resolvedConfig = configWithDefaults(config);
  if (!character?.axis || character.axis_confidence === null
    || character.axis_confidence < resolvedConfig.minimumSideConfidence
    || character.orientation?.facing !== 'front'
    || character.orientation.confidence < resolvedConfig.minimumSideConfidence) {
    return { side: 'unknown', confidence: 0, signed_distance: null };
  }
  const pixelPoint = denormalizePoint(point, canvas);
  const origin = denormalizePoint(character.axis.origin, canvas);
  const [dx, dy] = character.axis.direction;
  const length = Math.hypot(dx, dy);
  if (!length) return { side: 'unknown', confidence: 0, signed_distance: null };
  const offsetX = pixelPoint[0] - origin[0];
  const offsetY = pixelPoint[1] - origin[1];
  const signedPixels = (dx * offsetY - dy * offsetX) / length;
  const referenceWidth = character.character_bbox
    ? character.character_bbox[2] - character.character_bbox[0]
    : canvas.width;
  const signedDistance = signedPixels / Math.max(1, referenceWidth);
  const centerBand = resolvedConfig.centerBandRatio;
  const baseConfidence = Math.min(character.axis_confidence, character.orientation.confidence);
  if (Math.abs(signedDistance) <= centerBand) {
    return {
      side: 'center',
      confidence: roundConfidence(baseConfidence * (1 - Math.abs(signedDistance) / Math.max(centerBand, Number.EPSILON))),
      signed_distance: signedDistance,
    };
  }
  const distanceConfidence = Math.min(1, (Math.abs(signedDistance) - centerBand) / Math.max(centerBand * 4, 0.1));
  return {
    side: signedDistance < 0 ? 'left' : 'right',
    confidence: roundConfidence(baseConfidence * (0.6 + 0.4 * distanceConfidence)),
    signed_distance: signedDistance,
  };
}

export class CharacterGeometryService {
  constructor({ canvas, evidence = {}, config = {} }) {
    this.canvas = { ...canvas };
    this.config = configWithDefaults(config);
    this.character = analyzeCharacterGeometry({ canvas: this.canvas, evidence, config: this.config });
  }

  normalize(point) {
    return normalizePoint(point, this.canvas);
  }

  denormalize(point) {
    return denormalizePoint(point, this.canvas);
  }

  classifySide(point) {
    return classifyCharacterRelativeSide(point, this, this.config);
  }
}

function readOptionalMask(layerDir, file, canvas) {
  const source = path.join(layerDir, file);
  if (!fs.existsSync(source)) return null;
  const image = readPngRgba(source);
  if (image.width !== canvas.width || image.height !== canvas.height) {
    throw new Error(`Character geometry layer dimensions differ: ${file}`);
  }
  return alphaMaskFromRgba(image);
}

export function analyzeCharacterGeometryFromLayerDirectory({ layerDir, width, height, config = {} }) {
  const canvas = { width, height };
  assertCanvas(canvas);
  const masks = new Map();
  const read = (file) => {
    if (!masks.has(file)) masks.set(file, readOptionalMask(layerDir, file, canvas));
    return masks.get(file);
  };
  const topwear = read('topwear.png');
  const bottomwear = read('bottomwear.png');
  const torsoMask = topwear || bottomwear;
  const overallMasks = OVERALL_LAYER_FILES.map(read).filter(Boolean);
  return analyzeCharacterGeometry({
    canvas,
    config,
    evidence: {
      pairedFeatureMasks: [
        { mask: read('eyewhite.png'), source: 'eyewhite' },
        { mask: read('irides.png'), source: 'irides' },
      ],
      faceMask: read('face.png'),
      neckMask: read('neck.png'),
      torsoMask,
      torsoSource: topwear ? 'topwear' : (bottomwear ? 'bottomwear' : null),
      overallMask: overallMasks.length ? mergeAlphaMasks(overallMasks, canvas) : null,
    },
  });
}
