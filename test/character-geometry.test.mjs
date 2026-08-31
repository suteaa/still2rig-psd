import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeCharacterGeometry,
  CharacterGeometryService,
  classifyCharacterRelativeSide,
  measureAlphaMask,
  mergeAlphaMasks,
  normalizePoint,
} from '../src/vtuber/geometry.mjs';

function mask(width, height, rectangles = []) {
  const data = new Uint8Array(width * height);
  for (const [x1, y1, x2, y2] of rectangles) {
    for (let y = y1; y < y2; y += 1) {
      for (let x = x1; x < x2; x += 1) data[y * width + x] = 255;
    }
  }
  return { width, height, data };
}

function frontFacingEvidence(width, height, centerX) {
  const faceWidth = Math.max(20, Math.round(width * 0.24));
  const faceHeight = Math.max(20, Math.round(height * 0.28));
  const faceTop = Math.round(height * 0.12);
  const faceLeft = Math.round(centerX - faceWidth / 2);
  const face = mask(width, height, [[faceLeft, faceTop, faceLeft + faceWidth, faceTop + faceHeight]]);
  const torsoWidth = Math.max(28, Math.round(width * 0.36));
  const torsoLeft = Math.round(centerX - torsoWidth / 2);
  const torso = mask(width, height, [[
    torsoLeft,
    faceTop + faceHeight,
    torsoLeft + torsoWidth,
    Math.min(height, Math.round(height * 0.94)),
  ]]);
  const eyeWidth = Math.max(3, Math.round(faceWidth * 0.15));
  const eyeHeight = Math.max(3, Math.round(faceHeight * 0.1));
  const eyeY = faceTop + Math.round(faceHeight * 0.36);
  const eyeOffset = Math.round(faceWidth * 0.23);
  const paired = mask(width, height, [
    [centerX - eyeOffset - eyeWidth, eyeY, centerX - eyeOffset, eyeY + eyeHeight],
    [centerX + eyeOffset, eyeY, centerX + eyeOffset + eyeWidth, eyeY + eyeHeight],
  ]);
  return {
    pairedFeatureMasks: [{ mask: paired, source: 'synthetic-eyes' }],
    faceMask: face,
    torsoMask: torso,
    torsoSource: 'synthetic-torso',
    overallMask: mergeAlphaMasks([face, torso], { width, height }),
  };
}

function serviceFor(width, height, centerX) {
  return new CharacterGeometryService({
    canvas: { width, height },
    evidence: frontFacingEvidence(width, height, centerX),
  });
}

test('measures pixel bbox and normalized centroid without using canvas center', () => {
  const geometry = measureAlphaMask(mask(200, 100, [[20, 10, 60, 30]]));
  assert.deepEqual(geometry.bbox, [20, 10, 60, 30]);
  assert.deepEqual(geometry.centroid, [0.2, 0.2]);
});

test('centered front-facing character maps viewer right to character left', () => {
  const service = serviceFor(200, 240, 100);
  assert.ok(Math.abs(service.character.character_center[0] - 0.5) < 0.01);
  assert.ok(Math.abs(service.character.face_center[0] - 0.5) < 0.01);
  assert.ok(Math.abs(service.character.body_center[0] - 0.5) < 0.01);
  assert.match(service.character.axis.source, /^paired_facial_features:/);
  assert.equal(service.character.orientation.facing, 'front');
  assert.equal(service.classifySide(normalizePoint([150, 120], service.canvas)).side, 'left');
  assert.equal(service.classifySide(normalizePoint([50, 120], service.canvas)).side, 'right');
  assert.equal(service.classifySide(normalizePoint([100, 120], service.canvas)).side, 'center');
});

test('character shifted left is classified relative to its own axis', () => {
  const service = serviceFor(200, 240, 60);
  const viewerRightButCanvasLeft = normalizePoint([88, 120], service.canvas);
  assert.ok(viewerRightButCanvasLeft[0] < 0.5);
  assert.ok(service.character.character_center[0] < 0.5);
  assert.equal(service.classifySide(viewerRightButCanvasLeft).side, 'left');
});

test('character shifted right is classified relative to its own axis', () => {
  const service = serviceFor(200, 240, 140);
  const viewerLeftButCanvasRight = normalizePoint([112, 120], service.canvas);
  assert.ok(viewerLeftButCanvasRight[0] > 0.5);
  assert.ok(service.character.character_center[0] > 0.5);
  assert.equal(service.classifySide(viewerLeftButCanvasRight).side, 'right');
});

test('paired facial geometry outranks asymmetric body geometry and supports a tilted axis', () => {
  const width = 200;
  const height = 240;
  const paired = mask(width, height, [
    [54, 46, 66, 54],
    [116, 66, 128, 74],
  ]);
  const face = mask(width, height, [[45, 25, 140, 105]]);
  const asymmetricTorso = mask(width, height, [[15, 105, 115, 235]]);
  const service = new CharacterGeometryService({
    canvas: { width, height },
    evidence: {
      pairedFeatureMasks: [{ mask: paired, source: 'synthetic-eyes' }],
      faceMask: face,
      torsoMask: asymmetricTorso,
      overallMask: mergeAlphaMasks([face, asymmetricTorso], { width, height }),
    },
  });
  assert.match(service.character.axis.source, /^paired_facial_features:/);
  assert.ok(Math.abs(service.character.axis.direction[0]) > 0.2);
  const origin = service.denormalize(service.character.axis.origin);
  const [dx, dy] = service.character.axis.direction;
  const viewerRight = normalizePoint([origin[0] + dy * 35, origin[1] - dx * 35], service.canvas);
  assert.equal(service.classifySide(viewerRight).side, 'left');
});

test('normalized geometry remains stable across wide and tall canvases', () => {
  for (const [width, height] of [[400, 100], [100, 400]]) {
    const service = serviceFor(width, height, width * 0.5);
    assert.ok(Math.abs(service.character.face_center[0] - 0.5) < 0.02, `${width}x${height}`);
    assert.equal(service.classifySide(normalizePoint([width * 0.7, height * 0.5], service.canvas)).side, 'left');
    assert.equal(service.classifySide(normalizePoint([width * 0.3, height * 0.5], service.canvas)).side, 'right');
  }
});

test('insufficient geometry remains null and side remains unknown', () => {
  const canvas = { width: 200, height: 200 };
  const empty = mask(canvas.width, canvas.height);
  const character = analyzeCharacterGeometry({
    canvas,
    evidence: { faceMask: empty, torsoMask: empty, overallMask: empty },
  });
  assert.equal(character.character_center, null);
  assert.equal(character.face_center, null);
  assert.equal(character.body_center, null);
  assert.equal(character.axis, null);
  assert.equal(character.orientation, null);
  assert.deepEqual(
    classifyCharacterRelativeSide([0.75, 0.5], { canvas, character }),
    { side: 'unknown', confidence: 0, signed_distance: null },
  );
});

test('face and torso can provide an axis fallback but do not fabricate facing orientation', () => {
  const canvas = { width: 200, height: 240 };
  const face = mask(canvas.width, canvas.height, [[70, 30, 130, 90]]);
  const torso = mask(canvas.width, canvas.height, [[50, 115, 150, 225]]);
  const character = analyzeCharacterGeometry({
    canvas,
    evidence: {
      faceMask: face,
      torsoMask: torso,
      overallMask: mergeAlphaMasks([face, torso], canvas),
    },
  });
  assert.equal(character.axis.source, 'neck_torso_geometry');
  assert.equal(character.orientation, null);
  assert.equal(classifyCharacterRelativeSide([0.75, 0.5], { canvas, character }).side, 'unknown');
});
