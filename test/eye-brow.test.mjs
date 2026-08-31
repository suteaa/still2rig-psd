import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeEyeBrowLayers } from '../src/vtuber/eye-brow.mjs';
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

function geometryService({
  width = 200,
  height = 240,
  centerX = 100,
  pair = [[65, 62, 81, 72], [119, 62, 135, 72]],
  pairedSource = 'synthetic-paired-features',
  includePair = true,
} = {}) {
  const face = mask(width, height, [[centerX - 52, 24, centerX + 52, 132]]);
  const torso = mask(width, height, [[centerX - 70, 132, centerX + 70, 235]]);
  const evidence = {
    faceMask: face,
    torsoMask: torso,
    overallMask: mergeAlphaMasks([face, torso], { width, height }),
  };
  if (includePair) evidence.pairedFeatureMasks = [{ mask: mask(width, height, pair), source: pairedSource }];
  return new CharacterGeometryService({ canvas: { width, height }, evidence });
}

function normalLayers(width = 200, height = 240, shiftX = 0) {
  return {
    eyewhite: mask(width, height, [
      [65 + shiftX, 62, 81 + shiftX, 72],
      [119 + shiftX, 62, 135 + shiftX, 72],
    ]),
    irides: mask(width, height, [
      [70 + shiftX, 63, 77 + shiftX, 71],
      [124 + shiftX, 63, 131 + shiftX, 71],
    ]),
    eyelash: mask(width, height, [
      [63 + shiftX, 58, 82 + shiftX, 62],
      [117 + shiftX, 58, 136 + shiftX, 62],
    ]),
    eyebrow: mask(width, height, [
      [63 + shiftX, 43, 82 + shiftX, 47],
      [117 + shiftX, 43, 136 + shiftX, 47],
    ]),
  };
}

function ids(result) {
  return result.parts.map((part) => part.id).sort();
}

test('normal paired eyes produce all schema-defined observed Eye/Brow parts', () => {
  const result = analyzeEyeBrowLayers({
    geometryService: geometryService(),
    layers: normalLayers(),
  });
  assert.deepEqual(ids(result), [
    'brow.left',
    'brow.right',
    'eye.left.iris',
    'eye.left.lash',
    'eye.left.white',
    'eye.right.iris',
    'eye.right.lash',
    'eye.right.white',
  ]);
  const leftWhite = result.parts.find((part) => part.id === 'eye.left.white');
  assert.equal(leftWhite.psd_layer, 'EyeWhite_L');
  assert.equal(leftWhite.parent, 'eye.left');
  assert.equal(leftWhite.side, 'left');
  assert.equal(leftWhite.source_tag, 'eyewhite');
  assert.equal(leftWhite.source_type, 'observed');
  assert.equal(leftWhite.generated_area_ratio, 0);
  assert.ok(leftWhite.confidence >= 0.6 && leftWhite.confidence <= 1);
  assert.equal(result.parts.find((part) => part.id === 'brow.right').parent, 'face');
  assert.equal(result.relationships[0].checks.iris_within_eye_white, true);
  assert.equal(result.relationships[0].checks.eyebrow_near_eye, true);
});

test('characters shifted left and right keep character-relative side identity', () => {
  for (const shiftX of [-40, 40]) {
    const centerX = 100 + shiftX;
    const pair = [[65 + shiftX, 62, 81 + shiftX, 72], [119 + shiftX, 62, 135 + shiftX, 72]];
    const service = geometryService({ centerX, pair });
    const result = analyzeEyeBrowLayers({ geometryService: service, layers: normalLayers(200, 240, shiftX) });
    const characterLeft = result.parts.find((part) => part.id === 'eye.left.white');
    const characterRight = result.parts.find((part) => part.id === 'eye.right.white');
    assert.ok(characterLeft.centroid[0] > characterRight.centroid[0]);
    if (shiftX < 0) assert.ok(characterLeft.centroid[0] < 0.5);
    if (shiftX > 0) assert.ok(characterRight.centroid[0] > 0.5);
  }
});

test('asymmetric eye positions follow the tilted character axis', () => {
  const pair = [[52, 54, 68, 64], [126, 76, 142, 86]];
  const service = geometryService({ pair });
  const layers = {
    eyewhite: mask(200, 240, pair),
    irides: mask(200, 240, [[57, 56, 64, 63], [131, 78, 138, 85]]),
  };
  const result = analyzeEyeBrowLayers({ geometryService: service, layers });
  assert.ok(Math.abs(service.character.axis.direction[0]) > 0.2);
  assert.deepEqual(ids(result), [
    'eye.left.iris', 'eye.left.white', 'eye.right.iris', 'eye.right.white',
  ]);
  assert.equal(result.relationships.every((relationship) => relationship.checks.iris_within_eye_white), true);
});

test('one obscured eye produces only the observed side and never invents its pair', () => {
  const service = geometryService();
  const result = analyzeEyeBrowLayers({
    geometryService: service,
    layers: {
      eyewhite: mask(200, 240, [[119, 62, 135, 72]]),
      irides: mask(200, 240, [[124, 63, 131, 71]]),
    },
  });
  assert.deepEqual(ids(result), ['eye.left.iris', 'eye.left.white']);
  assert.equal(result.parts.some((part) => part.side === 'right'), false);
});

test('a single valid component is not copied or split into two parts', () => {
  const result = analyzeEyeBrowLayers({
    geometryService: geometryService(),
    layers: { irides: mask(200, 240, [[124, 63, 131, 71]]) },
  });
  assert.deepEqual(ids(result), ['eye.left.iris']);
  assert.ok(result.parts[0].confidence <= 0.65);
  assert.equal(result.diagnostics.issues[0].code, 'missing_eye_white_reference');
});

test('extremely small noise is rejected without suppressing valid components', () => {
  const layers = normalLayers();
  layers.eyewhite.data[5 * 200 + 5] = 255;
  const result = analyzeEyeBrowLayers({ geometryService: geometryService(), layers });
  assert.equal(result.parts.filter((part) => part.source_tag === 'eyewhite').length, 2);
  assert.ok(result.diagnostics.noise_components.some((component) => (
    component.source_tag === 'eyewhite' && component.pixels === 1
  )));
});

test('iris far outside its corresponding eye white is detected and omitted', () => {
  const layers = normalLayers();
  layers.irides = mask(200, 240, [
    [70, 63, 77, 71],
    [174, 63, 181, 71],
  ]);
  const result = analyzeEyeBrowLayers({ geometryService: geometryService(), layers });
  assert.equal(result.parts.some((part) => part.id === 'eye.left.iris'), false);
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === 'iris_eye_white_mismatch'));
  assert.equal(result.relationships.find((item) => item.side === 'left').checks.iris_within_eye_white, false);
});

test('eyebrow unnaturally far from its corresponding eye is detected and omitted', () => {
  const layers = normalLayers();
  layers.eyebrow = mask(200, 240, [
    [63, 43, 82, 47],
    [117, 174, 136, 178],
  ]);
  const result = analyzeEyeBrowLayers({ geometryService: geometryService(), layers });
  assert.equal(result.parts.some((part) => part.id === 'brow.left'), false);
  assert.ok(result.diagnostics.issues.some((issue) => issue.code === 'brow_eye_mismatch'));
  assert.equal(result.relationships.find((item) => item.side === 'left').checks.eyebrow_near_eye, false);
});

test('duplicate assignments to one character side are diagnosed and never duplicate a canonical ID', () => {
  const layers = {
    eyewhite: mask(200, 240, [
      [65, 62, 81, 72],
      [119, 62, 135, 72],
      [148, 65, 164, 75],
    ]),
  };
  const result = analyzeEyeBrowLayers({ geometryService: geometryService(), layers });
  assert.equal(result.parts.filter((part) => part.id === 'eye.left.white').length, 1);
  assert.ok(result.diagnostics.issues.some((issue) => (
    issue.code === 'duplicate_side_assignment' && issue.side === 'left'
  )));
});

test('insufficient character geometry emits no side-specific parts', () => {
  const service = geometryService({ includePair: false });
  assert.equal(service.character.orientation, null);
  const result = analyzeEyeBrowLayers({ geometryService: service, layers: normalLayers() });
  assert.deepEqual(result.parts, []);
  assert.ok(result.diagnostics.rejected_components.every((component) => (
    component.reason === 'insufficient_character_geometry'
  )));
});
