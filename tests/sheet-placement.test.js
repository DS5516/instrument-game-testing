const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'outputs', 'script.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Could not find ${name} in outputs/script.js`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Could not parse ${name} in outputs/script.js`);
}

const editorFunctions = [
  'sheetClef', 'sheetStaffGeometry', 'sheetDisplayLayout', 'sheetStepToY', 'sheetYToStep',
  'sheetLedgerSteps', 'sheetBeatToX', 'sheetBeatSystem', 'sheetStaffPoint', 'sheetSnapPoint', 'sheetSnapLocal',
  'sheetHandlePointerUp', 'sheetDragTarget', 'sheetDragMoved', 'sheetBeatMeasure',
].map(extractFunction).join('\n');

const clefInput = { value: 'treble' };
let svg;
const sandbox = {
  document: {
    querySelector(selector) {
      if (selector === '#sheet-clef') return clefInput;
      if (selector === '#sheet-staff') return svg;
      if (selector === '#sheet-current-note') return { textContent: '' };
      return null;
    },
  },
  sheetNotes: [],
  sheetRenderedLayout: null,
  selectedSheetNoteId: null,
  sheetDragState: null,
  sheetReleaseClick: null,
  sheetPreviewClientPoint: null,
  sheetStaffStepHeight: 10,
  sheetStaffLineSpacing: 20,
  sheetMeasureBeats: () => 4,
  sheetResolveNotes: () => [{ id: 'dragged', label: 'C5' }],
  sheetPushUndo() {},
  renderSheetStaff() {},
  updateSheetPreview() {},
  selectSheetNote() {},
  sheetLetterOrder: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  sheetSemitones: { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 },
};
vm.createContext(sandbox);
vm.runInContext(editorFunctions, sandbox, { filename: 'outputs/script.js (sheet geometry)' });
const api = vm.runInContext(`({
  sheetStaffGeometry, sheetStepToY, sheetYToStep, sheetLedgerSteps,
  sheetBeatToX, sheetBeatSystem, sheetSnapPoint, sheetHandlePointerUp,
  pitchAtStep: ${source.slice(source.indexOf('function sheetPitchAtStep('), source.indexOf('\nfunction sheetStaffStepForPitch'))}
})`, sandbox);

function transformedSvg(scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0) {
  return {
    getScreenCTM() {
      return {
        inverse() {
          return {
            a: 1 / scaleX, b: 0, c: 0, d: 1 / scaleY,
            e: -offsetX / scaleX, f: -offsetY / scaleY,
          };
        },
      };
    },
    createSVGPoint() {
      return {
        matrixTransform(matrix) {
          return {
            x: matrix.a * this.x + matrix.c * this.y + matrix.e,
            y: matrix.b * this.x + matrix.d * this.y + matrix.f,
          };
        },
      };
    },
  };
}

const expectedStaffPitches = {
  treble: ['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'],
  bass: ['G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3'],
};

for (const [clef, expected] of Object.entries(expectedStaffPitches)) {
  test(`${clef} clef: each staff line and space snaps to its expected pitch`, () => {
    clefInput.value = clef;
    const layout = api.sheetStaffGeometry([]);
    for (let step = 0; step <= 8; step += 1) {
      const pitch = api.pitchAtStep(step, clef);
      assert.equal(`${pitch.letter}${pitch.octave}`, expected[step], `step ${step}`);
      for (const [sx, sy, ox, oy] of [[1, 1, 0, 0], [1.25, 1.25, -170, -95], [1.5, 1.5, 180, 92], [0.8, 1.2, -240, 640]]) {
        svg = transformedSvg(sx, sy, ox, oy);
        const localX = layout.left + 24;
        const localY = api.sheetStepToY(step, layout);
        const snapped = api.sheetSnapPoint({ clientX: ox + localX * sx, clientY: oy + localY * sy }, layout);
        assert.equal(snapped?.step, step, `step ${step} at scale ${sx}/${sy} and offset ${ox}/${oy}`);
        assert.equal(api.sheetYToStep(localY, layout), step);
        assert.equal(api.sheetStepToY(snapped.step, layout), localY, 'preview and rendered note share the same SVG y coordinate');
        assert.equal(snapped.x, api.sheetBeatToX(snapped.beat, layout), 'preview and rendered note share the same SVG x coordinate');
      }
    }
  });
}

test('ledger-line pitches and ledger positions are consistent above and below each clef', () => {
  const examples = [
    ['treble', 10, 'A5', [10]],
    ['treble', -2, 'C4', [-2]],
    ['treble', -3, 'B3', [-2]],
    ['bass', 10, 'C4', [10]],
    ['bass', -2, 'E2', [-2]],
    ['bass', -3, 'D2', [-2]],
  ];
  for (const [clef, step, expected, ledgerSteps] of examples) {
    clefInput.value = clef;
    const pitch = api.pitchAtStep(step, clef);
    assert.equal(`${pitch.letter}${pitch.octave}`, expected);
    assert.deepEqual(Array.from(api.sheetLedgerSteps(step)), ledgerSteps);
    assert.equal(api.sheetYToStep(api.sheetStepToY(step), api.sheetStaffGeometry([])), step);
  }
  assert.deepEqual(Array.from(api.sheetLedgerSteps(9)), []);
  assert.deepEqual(Array.from(api.sheetLedgerSteps(-1)), []);
});

test('pointer-up commits the final drag pitch in SVG coordinates', () => {
  clefInput.value = 'treble';
  sandbox.sheetNotes = [{ id: 'dragged', beat: 0, step: 4, durationBeats: 1 }];
  const layout = api.sheetStaffGeometry(sandbox.sheetNotes);
  const startY = api.sheetStepToY(4, layout);
  const targetY = api.sheetStepToY(2, layout);
  const scale = 1.4, offsetX = 110, offsetY = 75;
  svg = transformedSvg(scale, scale, offsetX, offsetY);
  sandbox.sheetDragState = { id: 'dragged', startY, nextStep: 4, moved: false };
  api.sheetHandlePointerUp({ clientX: offsetX + (layout.left + 25) * scale, clientY: offsetY + targetY * scale });
  assert.equal(sandbox.sheetNotes[0].step, 2);
});

test('a resized and zoomed second system snaps the same pitch to the correct measure', () => {
  clefInput.value = 'bass';
  sandbox.sheetNotes = [];
  svg = {...transformedSvg(.75, .75, -325, -88),parentElement:{clientWidth:680}};
  const layout = api.sheetStaffGeometry();
  assert.equal(layout.measuresPerSystem, 1);
  const beat = 4.5;
  const y = api.sheetStepToY(6,layout)+layout.height*api.sheetBeatSystem(beat,layout);
  const snapped = api.sheetSnapPoint({clientX:api.sheetBeatToX(beat,layout)*.75-325,clientY:y*.75-88},layout);
  assert.equal(snapped.beat,beat);
  assert.equal(snapped.step,6);
  const pitch=api.pitchAtStep(snapped.step);
  assert.equal(pitch.letter+pitch.octave,'F3');
});
