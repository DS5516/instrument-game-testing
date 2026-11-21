const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const SheetExpression = require('../outputs/sheet-expression');

const source = readFileSync(join(__dirname, '..', 'outputs', 'script.js'), 'utf8');
const editorStart = source.indexOf('const sheetProjectsStorageKey=');
const editorEnd = source.indexOf('function recordCompositionEvent(');

class ElementStub {
  constructor(tag) {
    this.tag = tag;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.classes = new Set(String(value).split(' '));
    if (name === 'data-sheet-note-id') this.dataset.sheetNoteId = value;
  }

  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, listener) { this.listeners.set(type, [...this.listeners.get(type) || [], listener]); }
  setPointerCapture() {}
  focus() { this.focused = true; }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
    if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1);
    if (selector === '[data-sheet-note-id]') return Boolean(this.dataset.sheetNoteId);
    return selector === this.tag;
  }

  closest(selectors) {
    for (let current = this; current; current = current.parentElement) {
      if (selectors.split(',').some(selector => current.matches(selector))) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  dispatch(type, fields = {}) {
    let stopped = false;
    const event = {
      target: this, type, preventDefault() {}, stopPropagation() { stopped = true; }, ...fields,
    };
    for (let current = this; current && !stopped; current = current.parentElement) {
      event.currentTarget = current;
      for (const listener of current.listeners.get(type) || []) listener(event);
    }
  }
}

function createEditor(notes, initialClef = 'treble') {
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, new ElementStub(id));
    return controls.get(id);
  };
  const svg = control('#sheet-staff');
  const viewport = new ElementStub('viewport');
  viewport.clientWidth = 2150;
  viewport.append(svg);
  svg.createSVGPoint = () => ({ matrixTransform() { return this; } });
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  for (const [name, value] of Object.entries({
    clef: initialClef, instrument: 'piano', 'time-signature': '4/4', 'key-signature': 'C',
    duration: '1', dots: '0', voice: '1', tempo: '120', accidental: 'none',
  })) control(`#sheet-${name}`).value = value;
  control('#sheet-note-names').checked = true;
  const document = {
    querySelector: control,
    querySelectorAll: selector => selector === '#sheet-staff .sheet-note' ? svg.querySelectorAll('.sheet-note') : [],
    createElementNS: (_namespace, tag) => new ElementStub(tag),
    createElement: tag => new ElementStub(tag),
  };
  const sandbox = vm.createContext({ document, SheetExpression, localStorage: { getItem: () => null } });
  const run = js => vm.runInContext(js, sandbox);
  run(source.slice(editorStart, editorEnd));
  run(`sheetNotes=${JSON.stringify(notes)};setupSheetMusicEditor();`);
  return {
    run,
    svg,
    control,
    notes: () => JSON.parse(run('JSON.stringify(sheetNotes)')),
    group: id => svg.querySelectorAll('.sheet-note').find(item => item.dataset.sheetNoteId === id),
    point: (beat, step) => {
      const layout = run('sheetStaffGeometry()');
      return {
        clientX: run(`sheetBeatToX(${beat})`),
        clientY: run(`sheetStepToY(${step}) + sheetBeatSystem(${beat},sheetStaffGeometry()) * ${layout.height}`),
        detail: 1,
        pointerId: 1,
        button: 0,
        pointerType: 'mouse',
      };
    },
  };
}

const note = (id, beat, step, extra = {}) => ({ id, beat, step, durationBeats: 1, baseBeats: 1, ...extra });

test('a drag across beat columns does not let its synthetic click add another note', () => {
  const editor = createEditor([note('a', 0, 0)]);
  editor.group('a').querySelector('.sheet-notehead').dispatch('pointerdown', editor.point(0, 0));
  editor.svg.dispatch('pointermove', editor.point(2, 2));
  editor.svg.dispatch('pointerup', editor.point(2, 2));
  editor.svg.dispatch('click', editor.point(2, 2));
  assert.deepEqual(editor.notes().map(({ beat, step }) => [beat, step]), [[0, 2]]);

  editor.svg.dispatch('pointerdown', editor.point(2, 2));
  editor.svg.dispatch('pointerup', editor.point(2, 2));
  editor.svg.dispatch('click', editor.point(2, 2));
  assert.deepEqual(editor.notes().map(({ beat, step }) => [beat, step]), [[0, 2], [2, 2]]);
});

test('canceling note capture keeps the previous selection and score', () => {
  const editor = createEditor([note('a', 0, 0), note('b', 1, 1)]);
  editor.run("selectSheetNote('a')");
  editor.group('b').querySelector('.sheet-notehead').dispatch('pointerdown', editor.point(1, 1));
  editor.svg.dispatch('pointercancel', editor.point(1, 1));
  assert.equal(editor.run('selectedSheetNoteId'), 'a');
  assert.equal(editor.notes().length, 2);
});

test('dragging from the edge of a note preserves its grab offset', () => {
  const editor = createEditor([note('a', 0, 4)]);
  const center = editor.point(0, 4);
  const pressed = { ...center, clientY: center.clientY + 4 };
  const released = { ...center, clientY: center.clientY + 16 };
  editor.group('a').querySelector('.sheet-notehead').dispatch('pointerdown', pressed);
  editor.svg.dispatch('pointermove', released);
  editor.svg.dispatch('pointerup', released);
  assert.equal(editor.notes()[0].step, 3);
});

test('keyboard selection retains its SVG note element and duration edits refresh its readout', () => {
  const editor = createEditor([note('a', 0, 0)]);
  const original = editor.group('a');
  original.dispatch('keydown', { key: 'Enter' });
  assert.equal(editor.group('a'), original);
  assert.ok(original.classes.has('selected'));
  editor.control('#sheet-duration').value = '0.5';
  editor.control('#sheet-accidental').value = 'sharp';
  editor.control('#sheet-apply-note').dispatch('click');
  assert.equal(editor.notes()[0].durationBeats, 0.5);
  assert.match(editor.control('#sheet-current-note').textContent, /E♯4.*Eighth/);
});

test('clipboard paste preserves the written pitch and inherited accidental across projects', () => {
  const editor = createEditor([
    note('sharp', 0, 6, { accidental: 'sharp' }),
    note('inherited', 1, 6, { accidental: 'none', articulation: 'staccato', dynamic: 'mf' }),
  ], 'bass');
  editor.run("selectSheetNote('inherited');sheetCopySelected();sheetNewProject();sheetPaste()");
  assert.equal(editor.run('sheetResolveNotes()[0].label'), 'F♯3');
  assert.equal(editor.notes()[0].articulation, 'staccato');
  assert.equal(editor.notes()[0].dynamic, 'mf');
});

test('paste skips a conflicting same-voice note and undo/redo restores the exact result', () => {
  const original = [note('a', 0, 0), note('b', 1, 0)];
  const editor = createEditor(original);
  editor.run("selectSheetNote('a');sheetCopySelected();sheetPaste()");
  const pasted = editor.notes();
  assert.deepEqual(pasted.map(({ beat }) => beat), [0, 1, 2]);
  editor.run('sheetUndo()');
  assert.deepEqual(editor.notes(), original);
  editor.run('sheetRedo()');
  assert.deepEqual(editor.notes(), pasted);
});

test('erasing the note that holds a repeat mark keeps the mark on the measure', () => {
  const original = [note('anchor', 0, 0, { repeatStart: true }), note('other', 1, 2)];
  const editor = createEditor(original);
  editor.control('#sheet-eraser').checked = true;
  editor.group('anchor').querySelector('.sheet-notehead').dispatch('click', editor.point(0, 0));
  assert.deepEqual(editor.notes().map(({ id, repeatStart }) => [id, repeatStart]), [['other', true]]);
  editor.run('sheetUndo()');
  assert.deepEqual(editor.notes(), original);
});
