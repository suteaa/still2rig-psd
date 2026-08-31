import fs from 'node:fs';
import path from 'node:path';
import { readPngRgba } from '../psd.mjs';
import { relativeProjectPath, writeJson } from '../utils.mjs';
import { alphaMaskFromRgba, measureAlphaMask, normalizePoint } from './geometry.mjs';

export const HAIR_ANALYSIS_SCHEMA = 'still2rig-vtuber-hair-analysis';
export const HAIR_ANALYSIS_SCHEMA_VERSION = 1;

export const DEFAULT_HAIR_ANALYSIS_CONFIG = Object.freeze({
  alphaThreshold: 16,
  minimumComponentPixels: 32,
  minimumCanvasAreaRatio: 0.00002,
  minimumCharacterAreaRatio: 0.00005,
  maximumComponentsPerLayer: 64,
  maximumContourPoints: 128,
  minimumPrincipalAnisotropy: 0.05,
  rootCandidateDistanceSlackRatio: 0.015,
  rootMaximumDistanceRatio: 0.2,
  rootMaximumCandidateFraction: 0.6,
  minimumRootConfidence: 0.45,
  minimumTipConfidence: 0.45,
  tipMinimumSeparationRatio: 0.08,
});

export const HAIR_SEMANTIC_SOURCES = Object.freeze([
  Object.freeze({ source_tag: 'front hair', file: 'front hair.png' }),
  Object.freeze({ source_tag: 'side hair', file: 'side hair.png' }),
  Object.freeze({ source_tag: 'back hair', file: 'back hair.png' }),
]);

function configWithDefaults(config = {}) {
  return { ...DEFAULT_HAIR_ANALYSIS_CONFIG, ...config };
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function assertMask(mask, canvas, name) {
  if (!mask || mask.width !== canvas.width || mask.height !== canvas.height
    || !mask.data || mask.data.length !== canvas.width * canvas.height) {
    throw new Error(`${name} dimensions must match CharacterGeometryService canvas.`);
  }
}

function characterArea(geometryService) {
  const bbox = geometryService.character.character_bbox;
  if (!bbox) return null;
  return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
}

function effectiveMinimumPixels(canvas, geometryService, config) {
  const thresholds = [
    config.minimumComponentPixels,
    Math.ceil(canvas.width * canvas.height * config.minimumCanvasAreaRatio),
  ];
  const area = characterArea(geometryService);
  if (area) thresholds.push(Math.ceil(area * config.minimumCharacterAreaRatio));
  return Math.max(...thresholds);
}

function componentGeometry(indices, mask) {
  let weight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (const index of indices) {
    const x = index % mask.width;
    const y = Math.floor(index / mask.width);
    const pixelWeight = mask.data[index] / 255;
    weight += pixelWeight;
    weightedX += (x + 0.5) * pixelWeight;
    weightedY += (y + 0.5) * pixelWeight;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pixelCentroid = [weightedX / weight, weightedY / weight];
  return {
    indices,
    area_pixels: indices.length,
    bbox: [minX, minY, maxX + 1, maxY + 1],
    centroid: normalizePoint(pixelCentroid, mask),
    pixelCentroid,
  };
}

export function extractHairComponents(mask, { geometryService, config = {} }) {
  if (!geometryService?.canvas) throw new Error('Hair component extraction requires a CharacterGeometryService.');
  assertMask(mask, geometryService.canvas, 'hair mask');
  const resolved = configWithDefaults(config);
  const minimumPixels = effectiveMinimumPixels(mask, geometryService, resolved);
  const visited = new Uint8Array(mask.width * mask.height);
  const queue = new Int32Array(mask.width * mask.height);
  const accepted = [];
  const noise = [];
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || mask.data[start] <= resolved.alphaThreshold) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const indices = [];
    while (head < tail) {
      const index = queue[head++];
      indices.push(index);
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (!ox && !oy) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
          const neighbor = ny * mask.width + nx;
          if (!visited[neighbor] && mask.data[neighbor] > resolved.alphaThreshold) {
            visited[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }
      }
    }
    const component = componentGeometry(indices, mask);
    if (component.area_pixels < minimumPixels) noise.push(component);
    else accepted.push(component);
  }
  accepted.sort((first, second) => second.area_pixels - first.area_pixels);
  const excess = accepted.splice(resolved.maximumComponentsPerLayer);
  return { components: accepted, noise, excess, effective_minimum_pixels: minimumPixels };
}

function componentMembership(component, canvas) {
  const membership = new Uint8Array(canvas.width * canvas.height);
  for (const index of component.indices) membership[index] = 1;
  return membership;
}

function addBoundaryEdge(edges, x1, y1, x2, y2) {
  edges.push({ start: [x1, y1], end: [x2, y2] });
}

function orderedBoundary(component, canvas) {
  const membership = componentMembership(component, canvas);
  const edges = [];
  for (const index of component.indices) {
    const x = index % canvas.width;
    const y = Math.floor(index / canvas.width);
    if (y === 0 || !membership[index - canvas.width]) addBoundaryEdge(edges, x, y, x + 1, y);
    if (x + 1 === canvas.width || !membership[index + 1]) addBoundaryEdge(edges, x + 1, y, x + 1, y + 1);
    if (y + 1 === canvas.height || !membership[index + canvas.width]) addBoundaryEdge(edges, x + 1, y + 1, x, y + 1);
    if (x === 0 || !membership[index - 1]) addBoundaryEdge(edges, x, y + 1, x, y);
  }
  const byStart = new Map();
  const key = ([x, y]) => `${x},${y}`;
  edges.forEach((edge, index) => {
    const start = key(edge.start);
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(index);
  });
  const used = new Uint8Array(edges.length);
  const loops = [];
  for (let first = 0; first < edges.length; first += 1) {
    if (used[first]) continue;
    const points = [edges[first].start];
    const startKey = key(edges[first].start);
    let current = first;
    let closed = false;
    for (let count = 0; count <= edges.length; count += 1) {
      if (used[current]) break;
      used[current] = 1;
      const end = edges[current].end;
      if (key(end) === startKey) {
        closed = true;
        break;
      }
      points.push(end);
      const next = (byStart.get(key(end)) || []).find((index) => !used[index]);
      if (next === undefined) break;
      current = next;
    }
    loops.push({ points, closed });
  }
  loops.sort((first, second) => second.points.length - first.points.length);
  return loops[0] || { points: [], closed: false };
}

function sampleContour(contour, canvas, maximumPoints) {
  if (!contour.points.length) {
    return { coordinate_space: 'normalized_canvas', points: [], closed: false, representation: 'outer_boundary' };
  }
  const count = Math.min(maximumPoints, contour.points.length);
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const source = contour.points[Math.floor(index * contour.points.length / count)];
    points.push([round(source[0] / canvas.width), round(source[1] / canvas.height)]);
  }
  return {
    coordinate_space: 'normalized_canvas',
    points,
    closed: contour.closed,
    representation: 'outer_boundary',
  };
}

function principalGeometry(component, mask, config) {
  const [cx, cy] = component.pixelCentroid;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let weight = 0;
  for (const index of component.indices) {
    const x = index % mask.width;
    const y = Math.floor(index / mask.width);
    const pixelWeight = mask.data[index] / 255;
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    xx += dx * dx * pixelWeight;
    xy += dx * dy * pixelWeight;
    yy += dy * dy * pixelWeight;
    weight += pixelWeight;
  }
  xx /= weight;
  xy /= weight;
  yy /= weight;
  const trace = xx + yy;
  const delta = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
  const majorVariance = Math.max(0, (trace + delta) / 2);
  const minorVariance = Math.max(0, (trace - delta) / 2);
  const anisotropy = trace ? delta / trace : 0;
  const bboxWidth = component.bbox[2] - component.bbox[0];
  const bboxHeight = component.bbox[3] - component.bbox[1];
  const aspectRatio = bboxWidth / Math.max(1, bboxHeight);
  const elongation = Math.sqrt((majorVariance + 1e-9) / (minorVariance + 1e-9));
  if (!trace || anisotropy < config.minimumPrincipalAnisotropy) {
    return {
      principal_direction: null,
      principal_angle_radians: null,
      direction_confidence: round(anisotropy),
      axis_is_undirected: true,
      elongation: round(elongation),
      aspect_ratio: round(aspectRatio),
      fill_ratio: round(component.area_pixels / Math.max(1, bboxWidth * bboxHeight)),
    };
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let direction = [Math.cos(angle), Math.sin(angle)];
  if (direction[1] < 0 || (Math.abs(direction[1]) < 1e-9 && direction[0] < 0)) {
    direction = direction.map((value) => -value);
  }
  return {
    principal_direction: direction.map((value) => round(value)),
    principal_angle_radians: round(Math.atan2(direction[1], direction[0])),
    direction_confidence: round(anisotropy),
    axis_is_undirected: true,
    elongation: round(elongation),
    aspect_ratio: round(aspectRatio),
    fill_ratio: round(component.area_pixels / Math.max(1, bboxWidth * bboxHeight)),
  };
}

function referenceDistanceField(referenceMask, config) {
  if (!referenceMask) return null;
  const { width, height } = referenceMask;
  const field = new Float64Array(width * height);
  field.fill(Number.POSITIVE_INFINITY);
  let referencePixels = 0;
  for (let index = 0; index < field.length; index += 1) {
    if (referenceMask.data[index] > config.alphaThreshold) {
      field[index] = 0;
      referencePixels += 1;
    }
  }
  if (!referencePixels) return null;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x) field[index] = Math.min(field[index], field[index - 1] + 1);
      if (y) field[index] = Math.min(field[index], field[index - width] + 1);
      if (x && y) field[index] = Math.min(field[index], field[index - width - 1] + diagonal);
      if (x + 1 < width && y) field[index] = Math.min(field[index], field[index - width + 1] + diagonal);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (x + 1 < width) field[index] = Math.min(field[index], field[index + 1] + 1);
      if (y + 1 < height) field[index] = Math.min(field[index], field[index + width] + 1);
      if (x + 1 < width && y + 1 < height) field[index] = Math.min(field[index], field[index + width + 1] + diagonal);
      if (x && y + 1 < height) field[index] = Math.min(field[index], field[index + width - 1] + diagonal);
    }
  }
  return field;
}

function contourPixelPoint(point, canvas) {
  return [
    Math.max(0, Math.min(canvas.width - 1, Math.floor(point[0]))),
    Math.max(0, Math.min(canvas.height - 1, Math.floor(point[1]))),
  ];
}

function referenceScale(referenceMeasurement, geometryService) {
  const bbox = referenceMeasurement?.bbox || geometryService.character.face_bbox || geometryService.character.character_bbox;
  if (!bbox) return null;
  return Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]);
}

function estimateRoot(contour, distanceField, referenceMeasurement, geometryService, config, evidence) {
  if (!distanceField || !contour.points.length) return null;
  const scale = referenceScale(referenceMeasurement, geometryService);
  if (!scale) return null;
  const distances = contour.points.map((point) => {
    const [x, y] = contourPixelPoint(point, geometryService.canvas);
    return distanceField[y * geometryService.canvas.width + x];
  });
  const minimumDistance = Math.min(...distances);
  if (!Number.isFinite(minimumDistance) || minimumDistance > scale * config.rootMaximumDistanceRatio) return null;
  const slack = Math.max(1, scale * config.rootCandidateDistanceSlackRatio);
  const candidates = contour.points.filter((point, index) => distances[index] <= minimumDistance + slack);
  const candidateFraction = candidates.length / contour.points.length;
  if (!candidates.length || candidateFraction > config.rootMaximumCandidateFraction) return null;
  const point = candidates.reduce((sum, candidate) => [sum[0] + candidate[0], sum[1] + candidate[1]], [0, 0])
    .map((value) => value / candidates.length);
  const proximity = clamp01(1 - minimumDistance / Math.max(1, scale * config.rootMaximumDistanceRatio));
  const localization = clamp01(1 - candidateFraction / config.rootMaximumCandidateFraction);
  const confidence = round(proximity * 0.65 + localization * 0.35);
  if (confidence < config.minimumRootConfidence) return null;
  return {
    point: normalizePoint(point, geometryService.canvas).map((value) => round(value)),
    pixel_point: point.map((value) => round(value)),
    confidence,
    evidence: [evidence, 'component_contour_localization'],
    reference_distance_ratio: round(minimumDistance / scale),
    candidate_fraction: round(candidateFraction),
  };
}

function estimateTip(contour, root, principal, geometryService, config) {
  if (!root || !principal.principal_direction || !contour.points.length) return null;
  const rootPoint = root.pixel_point;
  let direction = [...principal.principal_direction];
  const farthest = contour.points.reduce((best, point) => {
    const distance = Math.hypot(point[0] - rootPoint[0], point[1] - rootPoint[1]);
    return distance > best.distance ? { point, distance } : best;
  }, { point: contour.points[0], distance: -1 });
  const towardFarthest = (farthest.point[0] - rootPoint[0]) * direction[0]
    + (farthest.point[1] - rootPoint[1]) * direction[1];
  if (towardFarthest < 0) direction = direction.map((value) => -value);
  const bbox = geometryService.character.character_bbox;
  const scale = bbox
    ? Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1])
    : Math.hypot(geometryService.canvas.width, geometryService.canvas.height);
  let best = null;
  for (const point of contour.points) {
    const dx = point[0] - rootPoint[0];
    const dy = point[1] - rootPoint[1];
    const distance = Math.hypot(dx, dy);
    const projection = Math.max(0, dx * direction[0] + dy * direction[1]);
    const alignment = distance ? projection / distance : 0;
    const score = distance * (0.65 + alignment * 0.35);
    if (!best || score > best.score) best = { point, distance, alignment, score };
  }
  const separationRatio = best.distance / Math.max(1, scale);
  if (separationRatio < config.tipMinimumSeparationRatio) return null;
  const confidence = round(Math.min(
    root.confidence,
    0.35 + principal.direction_confidence * 0.4 + clamp01(separationRatio / 0.3) * 0.25,
  ));
  if (confidence < config.minimumTipConfidence) return null;
  return {
    point: normalizePoint(best.point, geometryService.canvas).map((value) => round(value)),
    confidence,
    evidence: ['root_to_contour_distance', 'principal_direction_alignment'],
    root_separation_ratio: round(separationRatio),
    principal_alignment: round(best.alignment),
  };
}

function overlapRatio(component, referenceMask, config) {
  if (!referenceMask) return null;
  let overlap = 0;
  for (const index of component.indices) if (referenceMask.data[index] > config.alphaThreshold) overlap += 1;
  return round(overlap / component.area_pixels);
}

function faceDistance(component, geometryService) {
  if (!geometryService.character.face_center || !geometryService.character.face_bbox) return null;
  const center = geometryService.denormalize(geometryService.character.face_center);
  const distance = Math.hypot(component.pixelCentroid[0] - center[0], component.pixelCentroid[1] - center[1]);
  const bbox = geometryService.character.face_bbox;
  const scale = Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  return round(distance / Math.max(1, scale));
}

function axisRelationship(component, geometryService) {
  const side = geometryService.classifySide(component.centroid);
  let alongAxis = null;
  if (geometryService.character.axis) {
    const point = component.pixelCentroid;
    const origin = geometryService.denormalize(geometryService.character.axis.origin);
    const direction = geometryService.character.axis.direction;
    const bbox = geometryService.character.character_bbox;
    const scale = bbox ? bbox[3] - bbox[1] : geometryService.canvas.height;
    alongAxis = round(((point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1]) / Math.max(1, scale));
  }
  return {
    character_side_hint: side.side,
    side_confidence: side.confidence,
    signed_axis_distance: side.signed_distance,
    along_axis_position: alongAxis,
    classifier: 'CharacterGeometryService',
  };
}

function depthReference(component, depthImage, sourceFile, config) {
  if (!depthImage) return null;
  let count = 0;
  let total = 0;
  let minimum = 1;
  let maximum = 0;
  for (const index of component.indices) {
    const offset = index * 4;
    if (depthImage.data[offset + 3] <= config.alphaThreshold) continue;
    const value = (depthImage.data[offset] + depthImage.data[offset + 1] + depthImage.data[offset + 2]) / (3 * 255);
    count += 1;
    total += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (!count) return null;
  return {
    source_file: sourceFile,
    coverage_ratio: round(count / component.area_pixels),
    normalized_mean: round(total / count),
    normalized_min: round(minimum),
    normalized_max: round(maximum),
    interpretation: 'source_relative_unscaled',
  };
}

function publicNoise(component, sourceTag, reason) {
  return {
    source_tag: sourceTag,
    area_pixels: component.area_pixels,
    bbox: component.bbox,
    centroid: component.centroid,
    reason,
  };
}

export class HairAnalysisService {
  constructor({ geometryService, faceMask = null, headMask = null, config = {} }) {
    if (!geometryService?.canvas || typeof geometryService.classifySide !== 'function') {
      throw new Error('Hair analysis requires a CharacterGeometryService.');
    }
    this.geometryService = geometryService;
    this.config = configWithDefaults(config);
    this.faceMask = faceMask;
    this.headMask = headMask;
    if (faceMask) assertMask(faceMask, geometryService.canvas, 'faceMask');
    if (headMask) assertMask(headMask, geometryService.canvas, 'headMask');
    this.referenceMask = faceMask || headMask;
    this.referenceEvidence = faceMask ? 'face_mask_proximity' : 'head_mask_proximity';
    this.referenceMeasurement = this.referenceMask
      ? measureAlphaMask(this.referenceMask, this.config)
      : null;
    this.distanceField = referenceDistanceField(this.referenceMask, this.config);
  }

  analyzeLayer({ sourceTag, mask, sourceFile = null, depthImage = null, depthFile = null }) {
    if (typeof sourceTag !== 'string' || !sourceTag.trim()) throw new Error('Hair sourceTag is required.');
    assertMask(mask, this.geometryService.canvas, 'hair mask');
    if (depthImage) {
      if (depthImage.width !== mask.width || depthImage.height !== mask.height
        || !depthImage.data || depthImage.data.length !== mask.width * mask.height * 4) {
        throw new Error('Hair depth image dimensions must match the hair mask.');
      }
    }
    const extracted = extractHairComponents(mask, {
      geometryService: this.geometryService,
      config: this.config,
    });
    const canvasArea = mask.width * mask.height;
    const observedCharacterArea = characterArea(this.geometryService);
    const components = extracted.components.map((component, index) => {
      const rawContour = orderedBoundary(component, mask);
      const contour = sampleContour(rawContour, mask, this.config.maximumContourPoints);
      const principal = principalGeometry(component, mask, this.config);
      const root = estimateRoot(
        rawContour,
        this.distanceField,
        this.referenceMeasurement,
        this.geometryService,
        this.config,
        this.referenceEvidence,
      );
      const tip = estimateTip(rawContour, root, principal, this.geometryService, this.config);
      return {
        analysis_id: `${sourceTag.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}:${String(index + 1).padStart(3, '0')}`,
        source_tag: sourceTag,
        provenance: {
          source_type: 'observed',
          source_file: sourceFile,
          generated_area_ratio: 0,
        },
        area_pixels: component.area_pixels,
        area_ratio_canvas: round(component.area_pixels / canvasArea),
        area_ratio_character: observedCharacterArea
          ? round(component.area_pixels / observedCharacterArea)
          : null,
        bbox: component.bbox,
        centroid: component.centroid.map((value) => round(value)),
        contour,
        root_candidate: root ? {
          point: root.point,
          confidence: root.confidence,
          evidence: root.evidence,
          reference_distance_ratio: root.reference_distance_ratio,
          candidate_fraction: root.candidate_fraction,
        } : null,
        tip_candidate: tip,
        shape: principal,
        relationships: {
          face_overlap_ratio: overlapRatio(component, this.faceMask, this.config),
          head_overlap_ratio: overlapRatio(component, this.headMask, this.config),
          face_center_distance_ratio: faceDistance(component, this.geometryService),
          character_axis: axisRelationship(component, this.geometryService),
        },
        depth: depthReference(component, depthImage, depthFile, this.config),
        skeleton: {
          status: 'not_computed',
          method: null,
          points: null,
        },
      };
    });
    return {
      source: {
        source_tag: sourceTag,
        source_file: sourceFile,
        source_type: 'observed',
        original_preserved: true,
        depth_file: depthFile,
      },
      effective_minimum_pixels: extracted.effective_minimum_pixels,
      components,
      rejected_components: [
        ...extracted.noise.map((component) => publicNoise(component, sourceTag, 'below_relative_area_threshold')),
        ...extracted.excess.map((component) => publicNoise(component, sourceTag, 'component_limit_exceeded')),
      ],
    };
  }
}

function readOptionalMask(layerDir, file, geometryService) {
  const source = path.join(layerDir, file);
  if (!fs.existsSync(source)) return null;
  const image = readPngRgba(source);
  if (image.width !== geometryService.canvas.width || image.height !== geometryService.canvas.height) {
    throw new Error(`Hair analysis layer dimensions differ: ${file}`);
  }
  return alphaMaskFromRgba(image);
}

function readOptionalDepth(layerDir, file, geometryService) {
  const source = path.join(layerDir, file);
  if (!fs.existsSync(source)) return null;
  const image = readPngRgba(source);
  if (image.width !== geometryService.canvas.width || image.height !== geometryService.canvas.height) {
    throw new Error(`Hair depth layer dimensions differ: ${file}`);
  }
  return image;
}

export function analyzeHairFromLayerDirectory({ layerDir, outputFile, geometryService, config = {} }) {
  const faceMask = readOptionalMask(layerDir, 'face.png', geometryService);
  const headMask = readOptionalMask(layerDir, 'src_head.png', geometryService)
    || readOptionalMask(layerDir, 'head.png', geometryService);
  const service = new HairAnalysisService({ geometryService, faceMask, headMask, config });
  const layers = [];
  for (const source of HAIR_SEMANTIC_SOURCES) {
    const mask = readOptionalMask(layerDir, source.file, geometryService);
    if (!mask) continue;
    const depthFile = source.file.replace(/\.png$/i, '_depth.png');
    const depthImage = readOptionalDepth(layerDir, depthFile, geometryService);
    layers.push(service.analyzeLayer({
      sourceTag: source.source_tag,
      mask,
      sourceFile: source.file,
      depthImage,
      depthFile: depthImage ? depthFile : null,
    }));
  }
  const analysis = {
    schema: HAIR_ANALYSIS_SCHEMA,
    schema_version: HAIR_ANALYSIS_SCHEMA_VERSION,
    coordinate_system: {
      centroid: 'normalized_canvas',
      contour: 'normalized_canvas',
      bbox: 'pixel_exclusive',
      side: 'character_relative_hint_only',
      angle_unit: 'radian',
    },
    canvas: { ...geometryService.canvas },
    source_layers_preserved: true,
    final_parts_created: false,
    classifiers_pending: ['front', 'side', 'back', 'sideburn', 'ahoge'],
    context: {
      face_geometry_available: Boolean(geometryService.character.face_center),
      face_mask_available: Boolean(faceMask),
      head_mask_available: Boolean(headMask),
      character_axis_available: Boolean(geometryService.character.axis),
    },
    layers,
  };
  writeJson(outputFile, analysis);
  return {
    analysis,
    processing: {
      analysis_file: relativeProjectPath(outputFile),
      source_layers: layers.map((layer) => layer.source.source_tag),
      source_layers_preserved: true,
      final_parts_created: false,
      component_count: layers.reduce((sum, layer) => sum + layer.components.length, 0),
      rejected_component_count: layers.reduce((sum, layer) => sum + layer.rejected_components.length, 0),
      classifiers_pending: analysis.classifiers_pending,
    },
  };
}
