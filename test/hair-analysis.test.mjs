import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractHairComponents,
  HairAnalysisService,
} from '../src/vtuber/hair-analysis.mjs';
import { CharacterGeometryService, mergeAlphaMasks } from '../src/vtuber/geometry.mjs';

function mask(width, height, rectangles = []) {
  const data = new Uint8Array(width * height);
  for (const [x1, y1, x2, y2] of rectangles) {
    for (let y = y1; y < y2; y += 1) {
      for (let x = x1; x < x2; x += 1) data[y * width + x] = 255;
    }
  }
  return { width, height, data };
}

function geometryContext({ width = 220, height = 220, centerX = width / 2 } = {}) {
  const faceWidth = Math.max(30, Math.round(width * 0.28));
  const faceHeight = Math.max(40, Math.round(height * 0.45));
  const faceTop = Math.round(height * 0.2);
  const faceLeft = Math.round(centerX - faceWidth / 2);
  const face = mask(width, height, [[faceLeft, faceTop, faceLeft + faceWidth, faceTop + faceHeight]]);
  const torsoWidth = Math.max(40, Math.round(width * 0.45));
  const torsoLeft = Math.round(centerX - torsoWidth / 2);
  const torso = mask(width, height, [[
    torsoLeft,
    faceTop + faceHeight,
    torsoLeft + torsoWidth,
    Math.min(height, Math.round(height * 0.96)),
  ]]);
  const eyeWidth = Math.max(3, Math.round(faceWidth * 0.14));
  const eyeHeight = Math.max(3, Math.round(faceHeight * 0.07));
  const eyeY = faceTop + Math.round(faceHeight * 0.35);
  const eyeOffset = Math.round(faceWidth * 0.22);
  const paired = mask(width, height, [
    [centerX - eyeOffset - eyeWidth, eyeY, centerX - eyeOffset, eyeY + eyeHeight],
    [centerX + eyeOffset, eyeY, centerX + eyeOffset + eyeWidth, eyeY + eyeHeight],
  ]);
  const geometryService = new CharacterGeometryService({
    canvas: { width, height },
    evidence: {
      pairedFeatureMasks: [{ mask: paired, source: 'synthetic-eyes' }],
      faceMask: face,
      torsoMask: torso,
      overallMask: mergeAlphaMasks([face, torso], { width, height }),
    },
  });
  return { geometryService, face, faceBounds: [faceLeft, faceTop, faceLeft + faceWidth, faceTop + faceHeight] };
}

function analyze(hairMask, context, options = {}) {
  const service = new HairAnalysisService({
    geometryService: context.geometryService,
    faceMask: options.faceMask === undefined ? context.face : options.faceMask,
    headMask: options.headMask || null,
    config: options.config || {},
  });
  return service.analyzeLayer({
    sourceTag: options.sourceTag || 'front hair',
    sourceFile: options.sourceFile || 'front hair.png',
    mask: hairMask,
    depthImage: options.depthImage || null,
    depthFile: options.depthImage ? 'front hair_depth.png' : null,
  });
}

test('one large connected hair mass produces one observed analysis component without a final Part', () => {
  const context = geometryContext();
  const result = analyze(mask(220, 220, [[35, 12, 185, 112], [65, 100, 155, 175]]), context);
  assert.equal(result.components.length, 1);
  const component = result.components[0];
  assert.equal(component.source_tag, 'front hair');
  assert.equal(component.provenance.source_type, 'observed');
  assert.equal(component.provenance.generated_area_ratio, 0);
  assert.ok(component.area_pixels > 15_000);
  assert.deepEqual(component.bbox, [35, 12, 185, 175]);
  assert.equal(component.contour.closed, true);
  assert.ok(component.contour.points.length > 4);
  assert.equal(Object.hasOwn(component, 'id'), false);
  assert.equal(Object.hasOwn(component, 'canonical_id'), false);
  assert.deepEqual(component.skeleton, { status: 'not_computed', method: null, points: null });
});

test('multiple disconnected components remain separate reusable observations', () => {
  const context = geometryContext();
  const result = analyze(mask(220, 220, [
    [24, 28, 58, 190],
    [158, 38, 188, 180],
    [88, 10, 132, 54],
  ]), context, { sourceTag: 'back hair', sourceFile: 'back hair.png' });
  assert.equal(result.components.length, 3);
  assert.equal(new Set(result.components.map((component) => component.analysis_id)).size, 3);
  assert.ok(result.components[0].area_pixels >= result.components[1].area_pixels);
  assert.ok(result.components.every((component) => component.source_tag === 'back hair'));
});

test('touching hair regions remain one connected observation', () => {
  const context = geometryContext();
  const result = analyze(mask(220, 220, [
    [35, 20, 90, 100],
    [90, 100, 145, 180],
  ]), context);
  assert.equal(result.components.length, 1);
  assert.equal(result.rejected_components.length, 0);
  assert.equal(result.components[0].area_pixels, 8800);
});

test('narrow strand exposes strong principal direction and elongation', () => {
  const context = geometryContext();
  const result = analyze(mask(220, 220, [[125, 94, 207, 104]]), context);
  const shape = result.components[0].shape;
  assert.ok(Math.abs(shape.principal_direction[0]) > 0.98);
  assert.ok(Math.abs(shape.principal_direction[1]) < 0.1);
  assert.ok(shape.elongation > 7);
  assert.ok(shape.direction_confidence > 0.9);
});

test('wide component records aspect, fill, and horizontal principal geometry', () => {
  const context = geometryContext();
  const result = analyze(mask(220, 220, [[35, 25, 185, 82]]), context);
  const shape = result.components[0].shape;
  assert.ok(shape.aspect_ratio > 2.5);
  assert.equal(shape.fill_ratio, 1);
  assert.ok(Math.abs(shape.principal_direction[0]) > 0.95);
});

test('tiny noise uses canvas and character-relative configured thresholds', () => {
  const smallContext = geometryContext({ width: 100, height: 100, centerX: 50 });
  const largeContext = geometryContext({ width: 1000, height: 1000, centerX: 500 });
  const config = {
    minimumComponentPixels: 1,
    minimumCanvasAreaRatio: 0.001,
    minimumCharacterAreaRatio: 0,
  };
  const smallMask = mask(100, 100, [[10, 10, 12, 12], [30, 20, 60, 60]]);
  const largeMask = mask(1000, 1000, [[10, 10, 30, 30], [300, 200, 600, 600]]);
  const small = extractHairComponents(smallMask, { geometryService: smallContext.geometryService, config });
  const large = extractHairComponents(largeMask, { geometryService: largeContext.geometryService, config });
  assert.equal(small.effective_minimum_pixels, 10);
  assert.equal(large.effective_minimum_pixels, 1000);
  assert.equal(small.components.length, 1);
  assert.equal(large.components.length, 1);
  assert.equal(small.noise.length, 1);
  assert.equal(large.noise.length, 1);
});

test('asymmetric hair records distinct component geometry and CharacterGeometry side hints', () => {
  const context = geometryContext();
  const result = analyze(mask(220, 220, [
    [28, 30, 62, 205],
    [158, 48, 183, 142],
  ]), context, { sourceTag: 'back hair', sourceFile: 'back hair.png' });
  assert.equal(result.components.length, 2);
  assert.notEqual(result.components[0].area_pixels, result.components[1].area_pixels);
  const hints = new Set(result.components.map((component) => (
    component.relationships.character_axis.character_side_hint
  )));
  assert.deepEqual(hints, new Set(['left', 'right']));
  assert.ok(result.components.every((component) => (
    component.relationships.character_axis.classifier === 'CharacterGeometryService'
  )));
});

test('off-center character side hint follows character axis rather than canvas half', () => {
  const context = geometryContext({ width: 220, height: 220, centerX: 65 });
  const result = analyze(mask(220, 220, [[86, 18, 104, 82]]), context);
  const relation = result.components[0].relationships.character_axis;
  assert.ok(result.components[0].centroid[0] < 0.5);
  assert.equal(relation.character_side_hint, 'left');
  assert.equal(relation.classifier, 'CharacterGeometryService');
});

test('normalized analysis remains valid across canvas resolutions and aspect ratios', () => {
  for (const [width, height] of [[400, 100], [100, 400], [800, 800]]) {
    const context = geometryContext({ width, height, centerX: width / 2 });
    const hair = mask(width, height, [[
      Math.round(width * 0.42),
      Math.round(height * 0.03),
      Math.round(width * 0.58),
      Math.round(height * 0.42),
    ]]);
    const result = analyze(hair, context);
    assert.equal(result.components.length, 1, `${width}x${height}`);
    const centroid = result.components[0].centroid;
    assert.ok(Math.abs(centroid[0] - 0.5) < 0.02, `${width}x${height}`);
    assert.ok(centroid.every((value) => value >= 0 && value <= 1));
    assert.ok(result.components[0].contour.points.every((point) => point.every((value) => value >= 0 && value <= 1)));
  }
});

test('root and tip use face connection plus component direction instead of image top/bottom', () => {
  const context = geometryContext();
  const [faceLeft, faceTop, faceRight, faceBottom] = context.faceBounds;
  const strand = mask(220, 220, [[faceRight - 5, Math.round((faceTop + faceBottom) / 2) - 5, 210, Math.round((faceTop + faceBottom) / 2) + 5]]);
  const result = analyze(strand, context);
  const component = result.components[0];
  assert.ok(component.root_candidate);
  assert.ok(component.tip_candidate);
  assert.ok(component.root_candidate.point[0] < component.tip_candidate.point[0] - 0.25);
  assert.ok(Math.abs(component.root_candidate.point[1] - component.tip_candidate.point[1]) < 0.08);
  assert.ok(component.root_candidate.confidence >= 0.45);
  assert.ok(component.tip_candidate.confidence >= 0.45);
});

test('optional depth is referenced without asserting global depth meaning', () => {
  const context = geometryContext();
  const hair = mask(220, 220, [[125, 94, 207, 104]]);
  const depthData = new Uint8ClampedArray(220 * 220 * 4);
  for (let index = 0; index < 220 * 220; index += 1) {
    depthData[index * 4] = 128;
    depthData[index * 4 + 1] = 128;
    depthData[index * 4 + 2] = 128;
    depthData[index * 4 + 3] = 255;
  }
  const result = analyze(hair, context, { depthImage: { width: 220, height: 220, data: depthData } });
  const depth = result.components[0].depth;
  assert.equal(depth.source_file, 'front hair_depth.png');
  assert.equal(depth.coverage_ratio, 1);
  assert.ok(Math.abs(depth.normalized_mean - 128 / 255) < 0.00001);
  assert.equal(depth.interpretation, 'source_relative_unscaled');
});

test('insufficient head and face references leave root and tip unknown without fabrication', () => {
  const context = geometryContext();
  const result = analyze(mask(220, 220, [[125, 94, 207, 104]]), context, { faceMask: null });
  const component = result.components[0];
  assert.equal(component.root_candidate, null);
  assert.equal(component.tip_candidate, null);
  assert.ok(component.shape.principal_direction);
});
