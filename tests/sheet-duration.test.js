const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'outputs', 'script.js'), 'utf8');
const start = source.indexOf('const sheetProjectsStorageKey');
const end = source.indexOf('function recordCompositionEvent', start);
assert.ok(start >= 0 && end > start, 'sheet editor source block exists');
const context = vm.createContext({});
const editor = vm.runInContext(source.slice(start, end) + `
  ({sheetNoteValue, sheetReadNoteValue, sheetNoteValueLabel, sheetFlagCount,
    sheetSnapPoint, sheetStaffGeometry, sheetBeatToX,
    setNotes(notes) { sheetNotes = notes; }})
`, context);

test('all written lengths preserve base value and exact dotted timing', () => {
  for (const base of [4, 2, 1, .5, .25, .125]) {
    for (const [dots, factor] of [1, 1.5, 1.75].entries()) {
      const notation = editor.sheetNoteValue(base, dots);
      assert.deepEqual({...notation}, {baseBeats: base, dots, durationBeats: base * factor});
      assert.deepEqual({...editor.sheetReadNoteValue(JSON.parse(JSON.stringify(notation)))}, {...notation});
      assert.deepEqual({...editor.sheetReadNoteValue({durationBeats: base * factor})}, {...notation});
    }
  }
  assert.equal(editor.sheetNoteValueLabel({durationBeats: 1.5}), 'Dotted quarter');
  assert.equal(editor.sheetNoteValueLabel({durationBeats: 1.75}), 'Double-dotted quarter');
});

test('flags follow the written value independently of the dots', () => {
  for (const [count, base] of [1, .5, .25, .125].entries()) {
    assert.equal(editor.sheetFlagCount(editor.sheetNoteValue(base, 2).baseBeats), count);
  }
});

test('placement snaps to thirty-second positions and off-grid dotted ends', () => {
  const svg = {
    createSVGPoint: () => ({matrixTransform() { return this; }}),
    getScreenCTM: () => ({inverse: () => ({})}),
  };
  context.document = {querySelector: id => id === '#sheet-staff' ? svg : {value: '4/4'}};
  editor.setNotes([{beat: 1, durationBeats: .4375}]);
  const layout = editor.sheetStaffGeometry();
  for (const beat of [0, .125, .25, 1.4375, 3.875, 4, 4.125]) {
    const snapped = editor.sheetSnapPoint({clientX: editor.sheetBeatToX(beat, layout), clientY: layout.bottom}, layout);
    assert.equal(snapped.beat, beat);
  }
});
