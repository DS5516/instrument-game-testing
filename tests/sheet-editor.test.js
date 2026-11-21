const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const SheetExpression = require('../outputs/sheet-expression');
const SheetMusicXML = require('../outputs/sheet-musicxml');

const outputs = join(__dirname, '..', 'outputs');
const script = readFileSync(join(outputs, 'script.js'), 'utf8');
const html = readFileSync(join(outputs, 'index.html'), 'utf8');
const scaleX = 1.37;
const scaleY = 1.25;
const offsetX = 133;
const offsetY = -240;

// Provide just the DOM methods the editor uses for input, rendering, and storage.
class TestElement {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.handlers = new Map();
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.dataset = {};
    this.options = [];
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
  }

  append(...elements) {
    this.children.push(...elements);
    for (const element of elements) element.parentElement = this;
  }

  replaceChildren() { this.children = []; }
  addEventListener(type, callback) { this.handlers.set(type, callback); }
  getAttribute(name) { return this.attrs[name]; }
  add(option) { this.options.push(option); }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === 'data-sheet-note-id') this.dataset.sheetNoteId = value;
    if (name === 'class') this.classes = new Set(String(value).split(' '));
  }

  findAll(predicate) {
    return this.children.flatMap(element => [
      ...(predicate(element) ? [element] : []),
      ...element.findAll(predicate),
    ]);
  }

  find(predicate) { return this.findAll(predicate)[0] || null; }

  querySelector(selector) {
    return this.find(element => selector.startsWith('#') ? element.attrs.id === selector.slice(1) : element.tag === selector);
  }

  getScreenCTM() { return { inverse: () => ({ scaleX, scaleY, offsetX, offsetY }) }; }

  createSVGPoint() {
    return {
      matrixTransform(matrix) {
        return { x: (this.x - matrix.offsetX) / matrix.scaleX, y: (this.y - matrix.offsetY) / matrix.scaleY };
      },
    };
  }

  closest() { return null; }

  fire(type, fields = {}) {
    assert.ok(!this.disabled, `${this.tag} is enabled`);
    assert.ok(this.handlers.has(type), `${this.tag} handles ${type}`);
    this.handlers.get(type)({ target: this, preventDefault() {}, ...fields });
  }
}

function createEditor({musicXml=SheetMusicXML}={}) {
  const nodes = new Map([...html.matchAll(/id="(sheet-[^"]+|composer-page)"/g)]
    .map(([, id]) => ['#' + id, new TestElement(id)]));
  const svg = nodes.get('#sheet-staff');
  const viewport = new TestElement('viewport');
  viewport.clientWidth = 1450;
  viewport.append(svg);

  const control = id => nodes.get('#sheet-' + id);
  const input = (id, value) => { control(id).value = String(value); return control(id); };
  const toggle = (id, checked) => { control(id).checked = checked; return control(id); };
  const press = id => control(id).fire('click');
  const defaults = {
    instrument: 'piano', clef: 'treble', 'time-signature': '4/4', 'key-signature': 'C',
    duration: 1, dots: 0, tempo: 120, title: 'Score test', accidental: 'none', voice: 1,
    zoom: 100, grid: 8, ending: 0,
  };
  for (const [id, value] of Object.entries(defaults)) input(id, value);
  toggle('note-names', true);
  control('time-signature').options = [{ value: '4/4' }];

  const storage = new Map();
  const timers = new Map();
  const audioEvents = [];
  let now = 0;
  let sequence = 0;

  function enqueue(callback, delay) {
    const id = ++sequence;
    timers.set(id, { callback, at: now + delay });
    return id;
  }

  const sandbox = {
    document: {
      querySelector: selector => nodes.get(selector) || svg.querySelector(selector),
      querySelectorAll: selector => selector.includes('.sheet-note') ? svg.findAll(element =>
        element.classes.has('sheet-note') && (!selector.includes('.playing') || element.classes.has('playing'))) : [],
      createElementNS: (_, tag) => new TestElement(tag),
      createElement: tag => new TestElement(tag),
    },
    localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) },
    info: { piano: { name: 'Piano' }, drums: { name: 'Drums' }, clarinet: { name: 'Clarinet' } },
    monophonicInstruments: new Set(['flute','clarinet']),
    SheetExpression,
    SheetMusicXML: musicXml,
    Option: function (name, value) { Object.assign(this, { name, value }); },
    console,
    performance: { now: () => now },
    setTimeout: enqueue,
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => enqueue(callback, 16),
    cancelAnimationFrame: id => timers.delete(id),
    ensureAudioReady: async () => true,
    loadInstrument: async () => null,
    playInstrumentNote(instrument, midi) {
      audioEvents.push({ kind: 'start', time: now, midi });
      return { instrument, midi };
    },
    playDrum(part) {
      audioEvents.push({ kind: 'start', time: now, midi: part });
      return { instrument:'drums', midi:part };
    },
    stopVoice(voice) { audioEvents.push({ kind: 'stop', time: now, midi: voice.midi }); },
  };

  const start = script.indexOf('const sheetProjectsStorageKey=');
  const end = script.indexOf('function recordCompositionEvent(');
  assert.ok(start >= 0 && end > start, 'editor source is available to the harness');
  const context = vm.createContext(sandbox);
  const run = code => vm.runInContext(code, context);
  run(script.slice(start, end) + '\nsetupSheetMusicEditor();');

  function pointer(beat, step, eventType = 'click') {
    const point = run(`(() => {
      const layout = sheetStaffGeometry();
      return {
        x: sheetBeatToX(${beat}, layout),
        y: sheetStepToY(${step}, layout) + sheetBeatSystem(${beat}, layout) * layout.height,
      };
    })()`);
    svg.fire(eventType, { clientX: point.x * scaleX + offsetX, clientY: point.y * scaleY + offsetY });
  }

  function advancePlayback(until = Infinity, {late=false} = {}) {
    let cursorSeen = false;
    let steps = 0;
    while (timers.size) {
      assert.ok(++steps < 2000, 'playback ends and stops scheduling frames');
      const [id, { callback, at }] = [...timers].sort((left, right) => left[1].at - right[1].at)[0];
      if (at > until) break;
      timers.delete(id);
      now = late?until:at;
      callback();
      cursorSeen ||= svg.querySelector('#sheet-playhead').attrs.visibility === 'visible';
    }
    if (Number.isFinite(until)) now = until;
    return cursorSeen;
  }

  return {
    run, svg, viewport, control, input, toggle, press, pointer, advancePlayback, audioEvents, storage,
    notes: () => JSON.parse(run('JSON.stringify(sheetNotes)')),
    systems: () => svg.findAll(element => element.classes.has('sheet-system')),
  };
}

test('sheet editor wraps staff systems and preserves a two-voice composition with repeat endings', async () => {
  const editor = createEditor();
  const { run, svg, viewport, input, toggle, press, pointer, notes, systems } = editor;
  assert.equal(run('sheetStaffGeometry().measuresPerSystem'), 2);
  assert.equal(systems().length, 1);
  viewport.clientWidth = 900;
  input('zoom', 100).fire('input');
  assert.equal(run('sheetStaffGeometry().measuresPerSystem'), 1);
  assert.equal(systems().length, 2);

  pointer(4, 4, 'pointermove');
  assert.equal(svg.querySelector('#sheet-note-preview').attrs.visibility, 'visible');
  assert.equal(svg.querySelector('#sheet-note-preview').querySelector('text').textContent, 'B4');
  pointer(4, 4);
  assert.equal(notes()[0].beat, 4);
  assert.equal(notes()[0].step, 4);
  assert.equal(systems().length, 3);
  assert.ok(systems()[1].find(element => element.dataset.sheetNoteId === notes()[0].id));

  toggle('repeat-end', true);
  input('ending', 1);
  press('apply-measure');
  assert.equal(notes()[0].repeatEnd, true);
  assert.equal(notes()[0].ending, 1);
  pointer(8, 5);
  input('ending', 2);
  press('apply-measure');
  assert.equal(notes()[1].ending, 2);
  pointer(0, 1);
  toggle('repeat-start', true);
  press('apply-measure');

  toggle('chord', true);
  pointer(2, 2);
  assert.equal(notes()[3].beat, 0);
  assert.equal(notes()[3].step, 2);
  assert.equal(notes()[3].durationBeats, notes()[2].durationBeats);
  toggle('chord', false);
  input('voice', 2);
  pointer(0, -2);
  assert.equal(notes()[4].voice, 2);
  assert.equal(notes()[4].beat, 0);

  press('save');
  const saved = notes();
  press('new');
  assert.equal(notes().length, 0);
  const reopen = editor.control('project-list').find(element => element.textContent === 'Open');
  assert.ok(reopen);
  reopen.fire('click');
  assert.deepEqual(notes(), saved);

  press('play');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(run('sheetPlaybackSession && !sheetPlaybackSession.preparing'));
  assert.ok(editor.advancePlayback(), 'the cursor appears during playback');
  const starts = editor.audioEvents.filter(event => event.kind === 'start');
  assert.deepEqual(starts.map(({ time, midi }) => [time, midi]), [
    [0, 60], [0, 65], [0, 67], [2000, 71], [4000, 60], [4000, 65], [4000, 67], [6000, 72],
  ]);
  assert.equal(editor.audioEvents.filter(event => event.kind === 'stop').length, 8);
  assert.equal(run('sheetPlaybackSession'), null);
  assert.equal(svg.querySelector('#sheet-playhead').attrs.visibility, 'hidden');
});

test('clef changes and undo/redo preserve the written pitch', () => {
  const { run, input, press, pointer, notes } = createEditor();
  pointer(0, -2);
  assert.equal(run('sheetResolveNotes()[0].midi'), 60);
  assert.equal(notes()[0].step, -2);
  input('clef', 'bass').fire('input');
  assert.equal(notes()[0].step, 10);
  assert.equal(run('sheetResolveNotes()[0].label'), 'C4');
  press('undo');
  assert.equal(run('sheetClef()'), 'treble');
  assert.equal(notes()[0].step, -2);
  press('redo');
  assert.equal(run('sheetClef()'), 'bass');
  assert.equal(notes()[0].step, 10);
  assert.equal(run('sheetResolveNotes()[0].midi'), 60);
});

test('a resize before redraw still places the note on the displayed measure and line', () => {
  const { run, svg, viewport, notes } = createEditor();
  const displayed = run('sheetStaffGeometry()');
  const x = run('sheetBeatToX(4.5)');
  const y = displayed.bottom - displayed.stepHeight*10;
  viewport.clientWidth = 900;

  svg.fire('pointermove', {clientX:x*scaleX+offsetX,clientY:y*scaleY+offsetY});
  const preview = svg.querySelector('#sheet-note-preview');
  assert.equal(preview.attrs.visibility,'visible');
  assert.equal(preview.querySelector('text').textContent,'A5');
  svg.fire('click', {clientX:x*scaleX+offsetX,clientY:y*scaleY+offsetY});
  assert.equal(notes()[0].beat,4.5);
  assert.equal(notes()[0].step,10);
});

test('editing ledger notes keeps the staff position and system height stable', () => {
  const { run, press, pointer, notes } = createEditor();
  const initial = run('sheetDisplayLayout()');
  pointer(0,14);
  pointer(1,-6);
  assert.deepEqual(notes().map(note=>note.step),[14,-6]);
  assert.equal(run('sheetDisplayLayout().bottom'),initial.bottom);
  assert.equal(run('sheetDisplayLayout().height'),initial.height);

  run("sheetNotes.push({id:'extreme',beat:2,step:20,durationBeats:1}); renderSheetStaff(); selectSheetNote('extreme');");
  const expanded = run('sheetDisplayLayout()');
  press('delete-note');
  assert.equal(run('sheetDisplayLayout().bottom'),expanded.bottom);
  assert.equal(run('sheetDisplayLayout().height'),expanded.height);
  press('new');
  assert.equal(run('sheetDisplayLayout().bottom'),initial.bottom);
});

test('time signatures are centered in the staff halves and stay before the first barline', () => {
  const { input, systems, viewport } = createEditor();
  viewport.clientWidth = 600;
  input('key-signature', 'C#').fire('input');

  for (const meter of ['2/2', '2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8', '12/16']) {
    input('time-signature', meter).fire('input');
    for (const system of systems()) {
      const lines = system.findAll(element => element.classes.has('sheet-staff-line')).map(line => Number(line.attrs.y1));
      const digits = system.findAll(element => element.classes.has('sheet-time-symbol'));
      assert.deepEqual(digits.map(digit => digit.textContent), meter.split('/'));
      assert.deepEqual(digits.map(digit => Number(digit.attrs.y)), [lines[1], lines[3]]);
      assert.equal(digits[0].attrs.x, digits[1].attrs.x);
      const firstBarline = system.find(element => element.classes.has('sheet-bar-line'));
      assert.ok(Number(digits[0].attrs.x) + 22 < Number(firstBarline.attrs.x1));
      for (const digit of digits) {
        assert.equal(digit.attrs['dominant-baseline'], 'central');
        if (digit.textContent.length > 1) assert.equal(digit.attrs.textLength, '38');
      }
    }
  }
});

test('pausing and stopping release the current voice and cancel later notes', async () => {
  const editor = createEditor();
  editor.pointer(0, 0);
  editor.pointer(1, 1);
  editor.press('play');
  await new Promise(resolve => setImmediate(resolve));
  editor.advancePlayback(200);
  editor.press('pause');
  assert.deepEqual(editor.audioEvents.map(({ kind, time, midi }) => [kind, time, midi]), [
    ['start', 0, 64], ['stop', 200, 64],
  ]);
  editor.advancePlayback(250);
  editor.press('play');
  await new Promise(resolve => setImmediate(resolve));
  editor.advancePlayback(350);
  editor.press('stop');
  editor.advancePlayback(1200);
  assert.deepEqual(editor.audioEvents.map(({ kind, time, midi }) => [kind, time, midi]), [
    ['start', 0, 64], ['stop', 200, 64], ['start', 250, 64], ['stop', 350, 64],
  ]);
  assert.equal(editor.svg.querySelector('#sheet-playhead').attrs.visibility, 'hidden');
});

test('staccato releases its highlight and readout during silence', async () => {
  const { control, input, press, pointer, advancePlayback, svg } = createEditor();
  pointer(0,0);
  input('articulation','staccato');
  press('apply-expression');
  pointer(2,1);
  press('play');
  await new Promise(resolve => setImmediate(resolve));
  advancePlayback(100);
  assert.equal(control('current-note').textContent,'Playing E4');
  advancePlayback(400);
  assert.equal(svg.findAll(node=>node.classes.has('playing')).length,0);
  assert.equal(control('current-note').textContent,'Playing sheet');
});

test('a late timer skips notes that already ended instead of attacking them together', async () => {
  const { press, pointer, advancePlayback, audioEvents } = createEditor();
  pointer(0,0);
  pointer(1,1);
  pointer(2,2);
  press('play');
  await new Promise(resolve => setImmediate(resolve));
  advancePlayback(1050,{late:true});
  assert.deepEqual(audioEvents.filter(event=>event.kind==='start').map(event=>event.midi),[67]);
});

test('Stop cuts an active percussion voice after its written note has ended', async () => {
  const { input, press, pointer, advancePlayback, audioEvents } = createEditor();
  input('instrument','drums').fire('change');
  input('duration',.125);
  pointer(0,0);
  pointer(2,1);
  press('play');
  await new Promise(resolve => setImmediate(resolve));
  advancePlayback(100);
  press('stop');
  assert.deepEqual(audioEvents.map(({kind,time})=>[kind,time]),[['start',0],['stop',100]]);
});

test('a tie attacks once, highlights each member, and leaves the following rest silent', async () => {
  const { run, press, advancePlayback, audioEvents, control, svg } = createEditor();
  run(`sheetNotes=[
    {id:'first',beat:0,step:0,durationBeats:1,tieTo:'second'},
    {id:'second',beat:1,step:0,durationBeats:1},
    {id:'rest',beat:2,step:0,durationBeats:1,rest:true}
  ]; renderSheetStaff();`);
  press('play');
  await new Promise(resolve => setImmediate(resolve));
  advancePlayback(650);
  assert.deepEqual(svg.findAll(node=>node.classes.has('playing')).map(note=>note.dataset.sheetNoteId),['second']);
  advancePlayback(1250);
  assert.equal(control('current-note').textContent,'Rest');
  assert.deepEqual(audioEvents.map(({kind,time,midi})=>[kind,time,midi]),[['start',0,64],['stop',1000,64]]);
  advancePlayback();
});

test('a MusicXML read cannot replace a saved score opened while the file was loading', async () => {
  const late={title:'Late file',instrument:'piano',notes:[],timeSignature:'4/4'};
  let parseCount=0;
  const editor=createEditor({musicXml:{importProject(){parseCount++;return late}}});
  editor.pointer(0,0);
  editor.input('title','Saved score');
  editor.press('save');
  editor.press('new');
  let resolveFile;
  const clean=editor.run('sheetImportMusicXML')({size:35,text:()=>new Promise(resolve=>{resolveFile=resolve})});
  editor.control('project-list').find(node=>node.textContent==='Open').fire('click');
  resolveFile('<score-partwise/>');
  await clean;
  assert.equal(parseCount,0);
  assert.equal(editor.control('title').value,'Saved score');
  assert.equal(editor.notes().length,1);
});

test('an unreadable file reports the problem and leaves the sheet intact', async () => {
  const editor=createEditor();
  editor.pointer(0,0);
  const before=editor.notes();
  await editor.run('sheetImportMusicXML')({size:35,text:async()=>{throw new Error('File read failed')}});
  assert.match(editor.control('status').textContent,/Could not import MusicXML.*File read failed/);
  assert.deepEqual(editor.notes(),before);
});

test('saving keeps unrecognized projects and leaves an unreadable store untouched', () => {
  const editor=createEditor();
  const key=editor.run('sheetProjectsStorageKey');
  const old={id:'old',instrument:'old-instrument',notes:[{legacyMark:'retain'}]};
  editor.storage.set(key,JSON.stringify([old]));
  editor.pointer(0,0);
  editor.press('save');
  assert.deepEqual(JSON.parse(editor.storage.get(key)).find(project=>project.id==='old'),old);
  editor.storage.set(key,'incomplete legacy data');
  editor.press('save');
  assert.equal(editor.storage.get(key),'incomplete legacy data');
  assert.match(editor.control('status').textContent,/existing sheet data could not be read/);
});

test('print systems use the score and stay the same when display zoom changes', () => {
  const editor=createEditor();
  editor.pointer(0,0);
  editor.pointer(4,1);
  editor.pointer(8,2);
  const description=()=>{
    const pages=editor.run('sheetBuildPrintPages()');
    return pages.children.map(system=>({
      viewBox:system.attrs.viewBox,
      measures:system.findAll(node=>node.classes.has('sheet-measure-number')).map(node=>node.textContent),
      notes:system.findAll(node=>node.classes.has('sheet-note')).length,
    }));
  };
  const before=description();
  assert.deepEqual(before.map(system=>system.notes),[2,1]);
  editor.viewport.clientWidth=600;
  editor.input('zoom',150).fire('input');
  assert.equal(editor.run('sheetDisplayLayout().measuresPerSystem'),1);
  assert.deepEqual(description(),before);
});
