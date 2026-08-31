import fs from 'node:fs';
import path from 'node:path';
import { readPngRgba } from '../psd.mjs';
import { relativeProjectPath } from '../utils.mjs';
import { alphaMaskFromRgba, normalizePoint } from './geometry.mjs';
import { writePngRgba } from './raster.mjs';

export const DEFAULT_EYE_BROW_CONFIG = Object.freeze({
  alphaThreshold: 16,
  minimumComponentPixels: 8,
  minimumComponentAreaRatio: 0.00001,
  maximumComponentsPerLayer: 12,
  minimumPartConfidence: 0.55,
  singleComponentConfidenceCap: 0.78,
  irisMaximumEyeWhiteDistanceRatio: 0.55,
  eyelashMaximumEyeWhiteDistanceRatio: 1,
  browMaximumFaceHeightDistanceRatio: 0.45,
  browBelowEyeToleranceRatio: 0.5,
});

const SOURCE_SPECS = Object.freeze({
  eyewhite: Object.freeze({ file: 'eyewhite.png', kind: 'white', layer: 'EyeWhite' }),
  irides: Object.freeze({ file: 'irides.png', kind: 'iris', layer: 'Iris' }),
  eyelash: Object.freeze({ file: 'eyelash.png', kind: 'lash', layer: 'Eyelash' }),
  eyebrow: Object.freeze({ file: 'eyebrow.png', kind: 'brow', layer: 'Eyebrow' }),
});

const SIDES = Object.freeze(['left', 'right']);

function configWithDefaults(config = {}) {
  return { ...DEFAULT_EYE_BROW_CONFIG, ...config };
}

function roundConfidence(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
}

function roundNumber(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assertMask(mask, canvas, name) {
  if (!mask || mask.width !== canvas.width || mask.height !== canvas.height
    || !mask.data || mask.data.length !== canvas.width * canvas.height) {
    throw new Error(`${name} dimensions must match CharacterGeometryService canvas.`);
  }
}

export function extractEyeBrowComponents(mask, config = {}) {
  const resolved = configWithDefaults(config);
  const canvas = { width: mask?.width, height: mask?.height };
  assertMask(mask, canvas, 'mask');
  const minimumPixels = Math.max(
    resolved.minimumComponentPixels,
    Math.ceil(canvas.width * canvas.height * resolved.minimumComponentAreaRatio),
  );
  const visited = new Uint8Array(canvas.width * canvas.height);
  const queue = new Int32Array(canvas.width * canvas.height);
  const components = [];
  const noise = [];
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || mask.data[start] <= resolved.alphaThreshold) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const indices = [];
    let weight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head++];
      indices.push(index);
      const x = index % canvas.width;
      const y = Math.floor(index / canvas.width);
      const pixelWeight = mask.data[index] / 255;
      weight += pixelWeight;
      weightedX += (x + 0.5) * pixelWeight;
      weightedY += (y + 0.5) * pixelWeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (!ox && !oy) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue;
          const neighbor = ny * canvas.width + nx;
          if (!visited[neighbor] && mask.data[neighbor] > resolved.alphaThreshold) {
            visited[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }
      }
    }
    const pixelCentroid = [weightedX / weight, weightedY / weight];
    const component = {
      indices,
      pixels: indices.length,
      bbox: [minX, minY, maxX + 1, maxY + 1],
      centroid: normalizePoint(pixelCentroid, canvas),
      pixelCentroid,
    };
    if (component.pixels < minimumPixels) noise.push(component);
    else components.push(component);
  }
  components.sort((first, second) => second.pixels - first.pixels);
  const excess = components.splice(resolved.maximumComponentsPerLayer);
  return { components, noise, excess, minimumPixels };
}

function componentConfidence(component, minimumPixels) {
  const areaEvidence = Math.min(1, component.pixels / Math.max(1, minimumPixels * 4));
  return 0.55 + areaEvidence * 0.4;
}

function componentCandidates(sourceTag, mask, geometryService, config, diagnostics) {
  const extracted = extractEyeBrowComponents(mask, config);
  diagnostics.noise_components.push(...extracted.noise.map((component) => ({
    source_tag: sourceTag,
    bbox: component.bbox,
    pixels: component.pixels,
    reason: 'below_component_threshold',
  })));
  diagnostics.rejected_components.push(...extracted.excess.map((component) => ({
    source_tag: sourceTag,
    bbox: component.bbox,
    pixels: component.pixels,
    reason: 'component_limit_exceeded',
  })));
  const candidates = [];
  for (const component of extracted.components) {
    const classification = geometryService.classifySide(component.centroid);
    if (!SIDES.includes(classification.side)) {
      diagnostics.rejected_components.push({
        source_tag: sourceTag,
        bbox: component.bbox,
        pixels: component.pixels,
        reason: classification.side === 'center' ? 'component_on_character_axis' : 'insufficient_character_geometry',
      });
      continue;
    }
    const confidence = roundConfidence(Math.min(
      classification.confidence,
      componentConfidence(component, extracted.minimumPixels),
    ));
    if (confidence < config.minimumPartConfidence) {
      diagnostics.rejected_components.push({
        source_tag: sourceTag,
        side: classification.side,
        bbox: component.bbox,
        pixels: component.pixels,
        confidence,
        reason: 'confidence_below_threshold',
      });
      continue;
    }
    candidates.push({ component, side: classification.side, confidence, classification });
  }
  return candidates;
}

function pairQuality(left, right, geometryService) {
  const areaBalance = Math.min(left.component.pixels, right.component.pixels)
    / Math.max(left.component.pixels, right.component.pixels);
  const leftPoint = geometryService.denormalize(left.component.centroid);
  const rightPoint = geometryService.denormalize(right.component.centroid);
  const [axisX, axisY] = geometryService.character.axis.direction;
  const alongAxis = Math.abs((rightPoint[0] - leftPoint[0]) * axisX + (rightPoint[1] - leftPoint[1]) * axisY);
  const faceHeight = geometryService.character.face_bbox
    ? geometryService.character.face_bbox[3] - geometryService.character.face_bbox[1]
    : geometryService.canvas.height;
  const alignment = Math.max(0, 1 - alongAxis / Math.max(1, faceHeight * 0.3));
  const separation = Math.min(1, Math.abs(
    right.classification.signed_distance - left.classification.signed_distance,
  ) / 0.2);
  return areaBalance * 0.45 + alignment * 0.35 + separation * 0.2;
}

function selectSides(sourceTag, candidates, geometryService, config, diagnostics) {
  const selected = new Map();
  for (const side of SIDES) {
    const matches = candidates
      .filter((candidate) => candidate.side === side)
      .sort((first, second) => (
        second.confidence * second.component.pixels - first.confidence * first.component.pixels
      ));
    if (!matches.length) continue;
    selected.set(side, matches[0]);
    if (matches.length > 1) {
      diagnostics.issues.push({
        code: 'duplicate_side_assignment',
        source_tag: sourceTag,
        side,
        component_count: matches.length,
      });
      diagnostics.rejected_components.push(...matches.slice(1).map((candidate) => ({
        source_tag: sourceTag,
        side,
        bbox: candidate.component.bbox,
        pixels: candidate.component.pixels,
        confidence: candidate.confidence,
        reason: 'duplicate_side_assignment',
      })));
    }
  }
  if (selected.size === 2) {
    const quality = pairQuality(selected.get('left'), selected.get('right'), geometryService);
    for (const candidate of selected.values()) {
      candidate.confidence = roundConfidence(Math.min(candidate.confidence, 0.7 + quality * 0.3));
    }
  } else if (selected.size === 1) {
    const candidate = selected.values().next().value;
    candidate.confidence = Math.min(candidate.confidence, config.singleComponentConfidenceCap);
  }
  return selected;
}

function pointToBoxDistanceRatio(point, bbox) {
  const dx = Math.max(bbox[0] - point[0], 0, point[0] - bbox[2]);
  const dy = Math.max(bbox[1] - point[1], 0, point[1] - bbox[3]);
  return Math.hypot(dx, dy) / Math.max(1, Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]));
}

function validateEyeRelation(sourceTag, side, candidate, eyeWhite, maximumRatio, diagnostics) {
  if (!eyeWhite) {
    diagnostics.issues.push({ code: 'missing_eye_white_reference', source_tag: sourceTag, side });
    candidate.confidence = Math.min(candidate.confidence, 0.65);
    return true;
  }
  const ratio = pointToBoxDistanceRatio(candidate.component.pixelCentroid, eyeWhite.component.bbox);
  if (ratio > maximumRatio) {
    diagnostics.issues.push({
      code: `${sourceTag === 'irides' ? 'iris' : 'eyelash'}_eye_white_mismatch`,
      source_tag: sourceTag,
      side,
      distance_ratio: roundNumber(ratio),
    });
    diagnostics.rejected_components.push({
      source_tag: sourceTag,
      side,
      bbox: candidate.component.bbox,
      pixels: candidate.component.pixels,
      confidence: candidate.confidence,
      reason: 'spatial_mismatch',
    });
    return false;
  }
  candidate.confidence = roundConfidence(Math.min(candidate.confidence, 1 - ratio * 0.4));
  return true;
}

function validateBrowRelation(side, candidate, eyeWhite, geometryService, config, diagnostics) {
  if (!eyeWhite) {
    diagnostics.issues.push({ code: 'missing_eye_reference', source_tag: 'eyebrow', side });
    candidate.confidence = Math.min(candidate.confidence, 0.62);
    return true;
  }
  const brow = candidate.component.pixelCentroid;
  const eye = eyeWhite.component.pixelCentroid;
  const distance = Math.hypot(brow[0] - eye[0], brow[1] - eye[1]);
  const faceHeight = geometryService.character.face_bbox
    ? geometryService.character.face_bbox[3] - geometryService.character.face_bbox[1]
    : geometryService.canvas.height;
  const distanceRatio = distance / Math.max(1, faceHeight);
  const [axisX, axisY] = geometryService.character.axis.direction;
  const alongAxis = (brow[0] - eye[0]) * axisX + (brow[1] - eye[1]) * axisY;
  const eyeHeight = eyeWhite.component.bbox[3] - eyeWhite.component.bbox[1];
  if (distanceRatio > config.browMaximumFaceHeightDistanceRatio
    || alongAxis > eyeHeight * config.browBelowEyeToleranceRatio) {
    diagnostics.issues.push({
      code: 'brow_eye_mismatch',
      source_tag: 'eyebrow',
      side,
      distance_ratio: roundNumber(distanceRatio),
      below_eye: alongAxis > eyeHeight * config.browBelowEyeToleranceRatio,
    });
    diagnostics.rejected_components.push({
      source_tag: 'eyebrow',
      side,
      bbox: candidate.component.bbox,
      pixels: candidate.component.pixels,
      confidence: candidate.confidence,
      reason: 'spatial_mismatch',
    });
    return false;
  }
  const relationConfidence = 1 - distanceRatio / Math.max(config.browMaximumFaceHeightDistanceRatio, Number.EPSILON) * 0.35;
  candidate.confidence = roundConfidence(Math.min(candidate.confidence, relationConfidence));
  return true;
}

function partIdentity(sourceTag, side) {
  const spec = SOURCE_SPECS[sourceTag];
  if (spec.kind === 'brow') {
    return { id: `brow.${side}`, psd_layer: `Eyebrow_${side === 'left' ? 'L' : 'R'}`, parent: 'face' };
  }
  const displaySide = side === 'left' ? 'L' : 'R';
  return {
    id: `eye.${side}.${spec.kind}`,
    psd_layer: `${spec.layer}_${displaySide}`,
    parent: `eye.${side}`,
  };
}

function manifestPart(sourceTag, candidate) {
  return {
    ...partIdentity(sourceTag, candidate.side),
    side: candidate.side,
    source_tag: sourceTag,
    bbox: candidate.component.bbox,
    centroid: candidate.component.centroid,
    confidence: roundConfidence(candidate.confidence),
    source_type: 'observed',
    generated_area_ratio: 0,
  };
}

function relationshipCheck(issues, code, side, accepted) {
  if (issues.some((issue) => issue.code === code && issue.side === side)) return false;
  return accepted ? true : null;
}

export function analyzeEyeBrowLayers({ geometryService, layers = {}, config = {} }) {
  if (!geometryService?.canvas || !geometryService?.character || typeof geometryService.classifySide !== 'function') {
    throw new Error('Eye/Brow analysis requires a CharacterGeometryService.');
  }
  const resolved = configWithDefaults(config);
  const diagnostics = { issues: [], rejected_components: [], noise_components: [] };
  const selectedBySource = new Map();
  for (const sourceTag of Object.keys(SOURCE_SPECS)) {
    const mask = layers[sourceTag];
    if (!mask) {
      selectedBySource.set(sourceTag, new Map());
      continue;
    }
    assertMask(mask, geometryService.canvas, `layers.${sourceTag}`);
    const candidates = componentCandidates(sourceTag, mask, geometryService, resolved, diagnostics);
    selectedBySource.set(sourceTag, selectSides(
      sourceTag,
      candidates,
      geometryService,
      resolved,
      diagnostics,
    ));
  }

  const accepted = new Map();
  const eyeWhites = selectedBySource.get('eyewhite');
  for (const side of SIDES) {
    const white = eyeWhites.get(side);
    if (white) accepted.set(`eyewhite:${side}`, white);
    const iris = selectedBySource.get('irides').get(side);
    if (iris && validateEyeRelation(
      'irides', side, iris, white, resolved.irisMaximumEyeWhiteDistanceRatio, diagnostics,
    )) accepted.set(`irides:${side}`, iris);
    const lash = selectedBySource.get('eyelash').get(side);
    if (lash && validateEyeRelation(
      'eyelash', side, lash, white, resolved.eyelashMaximumEyeWhiteDistanceRatio, diagnostics,
    )) accepted.set(`eyelash:${side}`, lash);
    const brow = selectedBySource.get('eyebrow').get(side);
    if (brow && validateBrowRelation(side, brow, white, geometryService, resolved, diagnostics)) {
      accepted.set(`eyebrow:${side}`, brow);
    }
  }

  const records = [];
  for (const sourceTag of Object.keys(SOURCE_SPECS)) {
    for (const side of SIDES) {
      const candidate = accepted.get(`${sourceTag}:${side}`);
      if (candidate) records.push({ part: manifestPart(sourceTag, candidate), component: candidate.component });
    }
  }
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.part.id)) throw new Error(`Duplicate canonical ID produced by Eye/Brow split: ${record.part.id}.`);
    ids.add(record.part.id);
  }

  const relationships = SIDES.map((side) => {
    const white = accepted.has(`eyewhite:${side}`);
    const iris = accepted.has(`irides:${side}`);
    const lash = accepted.has(`eyelash:${side}`);
    const brow = accepted.has(`eyebrow:${side}`);
    return {
      side,
      eye_white: white ? `eye.${side}.white` : null,
      iris: iris ? `eye.${side}.iris` : null,
      eyelash: lash ? `eye.${side}.lash` : null,
      eyebrow: brow ? `brow.${side}` : null,
      checks: {
        iris_within_eye_white: relationshipCheck(diagnostics.issues, 'iris_eye_white_mismatch', side, white && iris),
        eyebrow_near_eye: relationshipCheck(diagnostics.issues, 'brow_eye_mismatch', side, white && brow),
      },
    };
  });
  return {
    parts: records.map((record) => record.part),
    records,
    relationships,
    diagnostics,
  };
}

function componentRgba(image, component) {
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  for (const pixel of component.indices) {
    const offset = pixel * 4;
    data[offset] = image.data[offset];
    data[offset + 1] = image.data[offset + 1];
    data[offset + 2] = image.data[offset + 2];
    data[offset + 3] = image.data[offset + 3];
  }
  return { width: image.width, height: image.height, data };
}

export function splitEyeBrowFromLayerDirectory({ layerDir, outputDir, geometryService, config = {} }) {
  const images = {};
  const layers = {};
  const sourceLayers = [];
  for (const [sourceTag, spec] of Object.entries(SOURCE_SPECS)) {
    const file = path.join(layerDir, spec.file);
    if (!fs.existsSync(file)) continue;
    const image = readPngRgba(file);
    if (image.width !== geometryService.canvas.width || image.height !== geometryService.canvas.height) {
      throw new Error(`Eye/Brow layer dimensions differ: ${spec.file}`);
    }
    images[sourceTag] = image;
    layers[sourceTag] = alphaMaskFromRgba(image);
    sourceLayers.push(sourceTag);
  }
  const analysis = analyzeEyeBrowLayers({ geometryService, layers, config });
  const parts = [];
  for (const record of analysis.records) {
    const sourceTag = record.part.source_tag;
    const output = path.join(outputDir, `${record.part.psd_layer}.png`);
    writePngRgba(output, componentRgba(images[sourceTag], record.component));
    parts.push({ ...record.part, raster: relativeProjectPath(output) });
  }
  return {
    parts,
    processing: {
      source_layers: sourceLayers,
      source_layers_preserved: true,
      psd_hierarchy_pending: true,
      artifacts: parts.map((part) => ({ id: part.id, raster: part.raster })),
      relationships: analysis.relationships,
      diagnostics: analysis.diagnostics,
    },
  };
}
