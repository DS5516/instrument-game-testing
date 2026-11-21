const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../outputs/script.js'), 'utf8');

function sourceBetween(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Found source between ${start} and ${end}`);
  return app.slice(from, to);
}

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = { setProperty() {} };
    this.clientHeight = 200;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => this.className?.split(' ').includes(name) || classes.has(name),
      toggle: (name, shows) => shows ? classes.add(name) : classes.delete(name),
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children.length = 0; }
  querySelectorAll(name) { return this.children.filter(child => child.classList.contains(name.slice(1))); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  closest(name) { return this.tagName === name ? this : null; }
  remove() { this.removed = true; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  fire(type, fields) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

const expected = {
  piano: 'C D E F G A B',
  guitar: 'C D E F G A B',
  violin: 'S A B C D E G',
  flute: 'C D E F G A B',
  clarinet: 'C D E F G A B',
  drums: 'D S A L ; F G H K J',
};

function buildHarness() {
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  const controls = new Map();
  const calls = [];
  const freePlay = [];
  const document = new Element('document');
  document.createElement = tag => new Element(tag);
  document.querySelector = id => {
    if (!controls.has(id)) {
      controls.set(id, new Element('div'));
      controls.get(id).parentElement = new Element('div');
    }
    return controls.get(id);
  };
  const player = new Element('div');
  player.dataset = {};
  const activeControls = new Set();
  const controlHeld = new Map();
  const clock = () => now;
  const setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
  const clearTimeout = id => timers.delete(id);
  const savedStats = { totalPerfectHits: 0, highestCombo: 0 };
  const sandbox = {
    document, Element, player, activeControls, controlHeld, setTimeout, clearTimeout, console,
    window: { setTimeout, clearTimeout, scrollTo() {} },
    performance: { now: clock },
    audio: null,
    loadInstrument: async () => {}, ensureAudioReady: async () => true,
    stopPlayback() {
      for (const button of activeControls) button.classList.remove('playing');
      activeControls.clear();
      controlHeld.clear();
    },
    stopVoice() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    rememberMappedKeyDown() {}, forgetMappedKeyUp() {},
    playFromComputerKey: () => freePlay.push('keydown'),
    releasePianoComputerKey: () => freePlay.push('keyup'),
    stopActiveSoundsKey() {},
    isTypingTarget: target => target.tagName === 'input',
    visiblePlayableNotes: instrument => Array.from(engine.pitches[instrument]),
    monophonicInstruments: new Set(['flute', 'clarinet']),
    rhythmWindowsFor: () => ({ perfect: 65, great: 125, good: 220 }),
    rhythmSongTotalBeats: song => song.pattern.length * song.step,
    playerProgress: { settings: {}, stats: savedStats },
    drumSongCharts: { test: [0, 1, 2] },
    playSongBacking() {}, playMetronomeClick() {}, updateRhythmStats() {},
    savePlayerProgress() {}, unlockAchievement() {},
    pitchName: midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`,
    playInstrumentNote(instrument, midi) {
      calls.push([instrument, midi]);
      engine.judgeRhythmInput(instrument, midi);
    },
    playDrum(part) {
      calls.push(['drums', part]);
      engine.judgeRhythmInput('drums', null, part);
    },
  };
  for (const instrument of ['clarinet', 'flute', 'guitar', 'drum', 'violin']) {
    for (const event of ['keydown', 'keyup']) {
      sandbox[instrument + 'KeyboardKey' + event.slice(3)] = () => freePlay.push(event);
    }
  }
  const engine = vm.runInNewContext([
    sourceBetween('const drumUrls=', 'const midiForName='),
    sourceBetween('const drumKeyboardMap=', 'const violinKeyboardMap='),
    sourceBetween('const rhythmPicker=', '// Original five practice songs.'),
    sourceBetween('function releaseControl(', 'function buildPiano('),
    sourceBetween('function lanePitches(', 'const rhythmWindowsFor='),
    sourceBetween('function rhythmShortcut(', 'function finishRhythmGame('),
    sourceBetween('function stopRhythmGame(', 'function exitRhythmGame('),
    sourceBetween("document.addEventListener('keydown',rememberMappedKeyDown", "window.addEventListener('blur'"),
    `({
      start(instrument, pattern) {
        selectedSong={id:'test',name:'Test',pattern,chords:[60],step:.5,bpm:120,difficulty:'Easy'};
        player.dataset.instrument=instrument;
        startRhythmGame();
        return rhythmState;
      },
      pitches: rhythmPitchLanes, renderRhythmFrame, judgeRhythmInput, stopRhythmGame
    })`,
  ].join('\n'), sandbox);

  const key = (key, fields = {}, type = 'keydown') => document.fire(type, {
    key: key === 'Space' ? ' ' : key.toLowerCase(),
    code: { 'Space': 'Space', ';': 'Semicolon' }[key] || 'Key' + key,
    ...fields,
  });
  return { ...engine, clock: value => { now = value; }, calls, freePlay, key, timers };
}

test('Rhythm Mode shows and plays the assigned shortcuts for all six instruments', () => {
  for (const [instrument, letters] of Object.entries(expected)) {
    const app = buildHarness();
    const state = app.start(instrument, [0, 1, 2]);
    assert.equal(state.pads.map(pad => pad.children[0].textContent).join(' '), letters, instrument);
    assert.ok(state.events.every(event => event.el.textContent === state.pads[event.lane].children[0].textContent));
    if (instrument === 'clarinet') {
      assert.equal(state.pads[0].children[1].textContent, 'C4');
      assert.match(state.pads[0].attributes.get('aria-label'), /concert A♯3/);
    }
    state.pads.forEach((pad, index) => {
      const letter = pad.children[0].textContent;
      assert.equal(pad.attributes.get('aria-keyshortcuts'), letter);
      app.key(letter);
      app.key(letter, {}, 'keyup');
      const lane = state.lanes[index];
      assert.deepEqual(app.calls[index], [instrument, instrument === 'drums' ? lane.part : lane]);
    });
    assert.equal(app.calls.length, state.lanes.length);
    assert.deepEqual(app.freePlay, []);
  }
});

test('a chord highlights both pads, ignores key repeat, and releases each key separately', () => {
  const app = buildHarness();
  const state = app.start('piano', [[0, 1], 2]);
  const [c, d, e] = state.pads;
  app.clock(state.startAt + state.leadInMs);
  app.renderRhythmFrame(state.startAt + state.leadInMs);
  assert.ok(c.classList.contains('rhythm-ready'));
  assert.ok(d.classList.contains('rhythm-ready'));
  assert.ok(!e.classList.contains('rhythm-ready'));
  app.key('C');
  app.key('C', { repeat: true });
  app.key('D');
  assert.ok(c.classList.contains('rhythm-key-held'));
  assert.ok(d.classList.contains('rhythm-key-held'));
  assert.ok(c.classList.contains('rhythm-hit'));
  assert.equal(state.hits, 2);
  assert.deepEqual(app.calls, [['piano', 60], ['piano', 62]]);
  app.key('C', {}, 'keyup');
  assert.ok(!c.classList.contains('rhythm-key-held'));
  assert.ok(d.classList.contains('rhythm-key-held'));
  app.key('D', {}, 'keyup');
  assert.equal(state.heldKeys.size, 0);
  app.clock(state.startAt + state.leadInMs + 250);
  e.fire('pointerdown');
  assert.ok(e.classList.contains('rhythm-pressed'));
  assert.equal(state.hits, 3);
  e.fire('pointerup');
  assert.ok(!e.classList.contains('playing'));
  assert.deepEqual(app.calls.at(-1), ['piano', 64]);
});

test('Space pauses and resumes once, clearing every highlight and hold', () => {
  const app = buildHarness();
  const state = app.start('clarinet', [0, 1, 2]);
  const at = state.startAt + state.leadInMs;
  app.clock(at);
  app.renderRhythmFrame(at);
  app.key('C');
  assert.ok(app.timers.size > 0);
  assert.equal(app.key('Space').defaultPrevented, true);
  assert.equal(state.pausedAt, at);
  assert.ok(state.pads.every(pad => pad.disabled));
  assert.equal(state.heldKeys.size, 0);
  assert.equal(app.timers.size, 0);
  for (const name of ['rhythm-ready', 'rhythm-pressed', 'rhythm-key-held', 'rhythm-hit']) {
    assert.ok(state.pads.every(pad => !pad.classList.contains(name)), name);
  }
  app.key('D');
  app.key('Space', { repeat: true });
  assert.equal(app.calls.length, 1);
  assert.equal(state.pausedAt, at);
  app.clock(at + 500);
  app.key('Space');
  assert.equal(state.pausedAt, null);
  assert.ok(state.pads.every(pad => !pad.disabled));
  app.key('D');
  assert.deepEqual(app.calls, [['clarinet', 58], ['clarinet', 60]]);
  app.stopRhythmGame();
  assert.equal(app.timers.size, 0);
});
