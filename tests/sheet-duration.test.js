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
    sheetSnapPoint, sheetStaffGeometry, sheetBeatToX, sheetBeamGroups, sheetPlaybackChains, sheetResolveNotes,
    sheetRenderBeams, sheetRenderLinks, sheetRenderTriplets, sheetChordLayout, sheetTripletGroups, sheetBuildClock, sheetBuildGains, sheetCanMoveTo,
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

test('older dotted triplets infer their written value without changing their duration', () => {
  for (const base of [4, 2, 1, .5, .25, .125]) {
    for (const dots of [0, 1, 2]) {
      const expected = editor.sheetNoteValue(base, dots, true);
      const legacy = { durationBeats: expected.durationBeats, dots, triplet: true };
      assert.deepEqual({ ...editor.sheetReadNoteValue(legacy) }, { ...expected });
    }
  }
  assert.equal(editor.sheetNoteValueLabel({ durationBeats: 1 / 3, triplet: true }), 'Eighth triplet');
  assert.equal(editor.sheetNoteValue(.5, 'length').durationBeats, .5);
});

test('beams follow 4/4 and 6/8 subdivisions, with explicit joins and breaks', () => {
  const notes = [0, .5, 1, 1.25, 1.5, 1.75, 2].map((beat,id) => ({
    id, beat, durationBeats: beat>=1&&beat<2?.25:.5,
  }));
  const groups = (items, meter) => JSON.stringify(editor.sheetBeamGroups(items, meter).map(group=>group.map(note=>note.id)));
  assert.equal(groups(notes,'4/4'),'[[0,1],[2,3,4,5]]');
  assert.equal(groups(notes,'6/8'),'[[0,1,2,3],[4,5,6]]');
  notes[2].beamMode='join';
  notes[4].beamMode='break';
  assert.equal(groups(notes,'4/4'),'[[0,1,2,3],[4,5]]');
  notes[3].rest=true;
  assert.equal(groups(notes,'4/4'),'[[0,1,2],[4,5]]');
});

test('cross-bar accidental ties play once and do not change later untied notes', () => {
  const notes = [
    {id:'a',beat:3,step:0,durationBeats:1,accidental:'sharp',tieTo:'b'},
    {id:'b',beat:4,step:0,durationBeats:.5,accidental:'none',tieTo:'c'},
    {id:'c',beat:4.5,step:0,durationBeats:.5,accidental:'none'},
    {id:'d',beat:5,step:0,durationBeats:1,accidental:'none'},
  ];
  const resolved = editor.sheetResolveNotes(notes,{clef:'treble',keySignature:'C',timeSignature:'4/4'});
  assert.equal(JSON.stringify(resolved.map(note=>note.label)),'["E♯4","E♯4","E♯4","E4"]');
  const chains=editor.sheetPlaybackChains(resolved);
  assert.equal(chains.length,2);
  assert.equal(chains[0].members.length,3);
  assert.equal(chains[0].start,3);
  assert.equal(chains[0].end,5);
  assert.equal(editor.sheetPlaybackChains(resolved.slice(1)).length,2);
});

test('an invalid earlier link does not prevent the valid tie from carrying its pitch', () => {
  const notes = [
    { id: 'wrong', beat: 2, step: -1, durationBeats: 2, accidental: 'flat', tieTo: 'continuation' },
    { id: 'start', beat: 3, step: 0, durationBeats: 1, accidental: 'sharp', voice: 1, tieTo: 'continuation' },
    { id: 'continuation', beat: 4, step: 0, durationBeats: 1, accidental: 'none', voice: 2 },
  ];
  const resolved = editor.sheetResolveNotes(notes, { clef: 'treble', keySignature: 'C', timeSignature: '4/4' });
  assert.equal(resolved.find(note => note.id === 'continuation').midi, 65);
  const chain = editor.sheetPlaybackChains(resolved).find(item => item.members[0].id === 'start');
  assert.deepEqual(Array.from(chain.members, note => note.id), ['start', 'continuation']);
});

test('simultaneous voices resolve their own pitch independent of insertion order', () => {
  const at = (id, beat, accidental, voice) => ({ id, beat, step: -2, accidental, voice, durationBeats: .5 });
  const natural = at('natural', 0, 'none', 1), sharp = at('sharp', 0, 'sharp', 2);
  const carried = at('carried', .5, 'none', 1);
  const flat = at('flat', 1, 'flat', 1), sharpAgain = at('sharpAgain', 1, 'sharp', 2);
  const afterConflict = at('afterConflict', 1.5, 'none', 1);
  const resolve = notes => Object.fromEntries(editor.sheetResolveNotes(notes, { clef: 'treble', keySignature: 'C', timeSignature: '4/4' })
    .map(note => [note.id, note.midi]));
  const expected = { natural: 60, sharp: 61, carried: 61, flat: 59, sharpAgain: 61, afterConflict: 60 };
  assert.deepEqual(resolve([natural, sharp, carried, flat, sharpAgain, afterConflict]), expected);
  assert.deepEqual(resolve([sharp, natural, carried, sharpAgain, flat, afterConflict]), expected);
});

test('accidentals carry in their own octave and reset at each barline in either clef', () => {
  for (const [clef, step, normalMidi] of [['treble', 1, 65], ['bass', 6, 53]]) {
    const notes = [
      { id: 1, beat: 0, step, accidental: 'natural' },
      { id: 2, beat: 1, step, accidental: 'none' },
      { id: 3, beat: 2, step: step + 7, accidental: 'none' },
      { id: 4, beat: 3, step, accidental: 'flat' },
      { id: 5, beat: 4, step, accidental: 'none' },
    ].map(note => ({ ...note, durationBeats: 1 }));
    const resolved = editor.sheetResolveNotes(notes, { clef, keySignature: 'G', timeSignature: '4/4' });
    assert.deepEqual(Array.from(resolved, note => note.midi), [normalMidi, normalMidi, normalMidi + 13, normalMidi - 1, normalMidi + 1]);
  }
});

test('the renderer draws double beams and distinct tie and slur curves', () => {
  const layout = {bottom:142,stepHeight:10,left:210,measureWidth:596,measureBeats:4};
  const drawn = [];
  const svg = {append: node => drawn.push(node)};
  context.document = {createElementNS: (_namespace,tag)=>({
    tag,
    attributes:{},
    setAttribute(name,value){this.attributes[name]=value;},
  })};
  const notes = [
    {id:'a',beat:0,step:0,durationBeats:.25,midi:64,tieTo:'b',slurTo:'c'},
    {id:'b',beat:.25,step:0,durationBeats:.25,midi:64},
    {id:'c',beat:.5,step:2,durationBeats:.5,midi:67},
  ];
  editor.sheetRenderBeams(svg,editor.sheetBeamGroups(notes,'4/4'),layout);
  assert.equal(drawn.filter(node=>node.attributes.class==='sheet-beam').length,3);
  editor.sheetRenderLinks(svg,notes,layout);
  assert.deepEqual(drawn.filter(node=>node.tag==='path').map(node=>node.attributes.class), ['sheet-tie','sheet-slur']);
});

test('a chord stem reaches every notehead before it meets the beam', () => {
  const layout = { bottom: 142, stepHeight: 10, left: 210, measureWidth: 596, measureBeats: 4 };
  const notes = [
    { id: 'low', beat: 0, step: -2, durationBeats: .5 },
    { id: 'high', beat: 0, step: 5, durationBeats: .5 },
    { id: 'next', beat: .5, step: -2, durationBeats: .5 },
  ];
  const { chordStems } = editor.sheetChordLayout(notes, layout);
  const stems = editor.sheetRenderBeams({ append() {} }, [[notes[0], notes[2]]], layout, false, chordStems);
  assert.equal(stems.get('low').startY, 162);
  assert.equal(stems.get('low').y, 56);
});

test('flags follow the written value independently of the dots', () => {
  for (const [count, base] of [1, .5, .25, .125].entries()) {
    assert.equal(editor.sheetFlagCount(editor.sheetNoteValue(base, 2).baseBeats), count);
  }
});

test('three eighth-note triplets occupy exactly one quarter-note beat', () => {
  const duration=editor.sheetNoteValue(.5,0,true);
  const notes=[0,1/3,2/3].map((beat,id)=>({id,beat,...duration}));
  assert.equal(notes[2].beat+notes[2].durationBeats,1);
  assert.equal(editor.sheetTripletGroups(notes).length,1);
  assert.equal(editor.sheetNoteValueLabel(notes[0]),'Eighth triplet');
});

test('three triplet onsets with a middle chord render one bracket and one number', () => {
  const value = editor.sheetNoteValue(.5, 0, true);
  const notes = [0, 1 / 3, 1 / 3, 2 / 3].map((beat, id) => ({ id, beat, step: id, ...value }));
  const layout = { top: 62, bottom: 142, stepHeight: 10, left: 210, measureWidth: 596, measureBeats: 4 };
  const drawn = [];
  context.document = { createElementNS: () => ({
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  }) };
  editor.sheetRenderTriplets({ append: (...nodes) => drawn.push(...nodes) }, notes, layout);
  assert.deepEqual(drawn.map(node => node.attributes.class), ['sheet-tuplet-bracket', 'sheet-tuplet-number']);
  assert.equal(Number(drawn[1].attributes.x), editor.sheetBeatToX(1 / 3, layout));
});

test('tempo changes and fermatas delay later beats on the same clock', () => {
  const clock=editor.sheetBuildClock([
    {beat:0,durationBeats:1,articulation:'fermata'},
    {beat:2,durationBeats:1,tempo:60},
  ],120);
  assert.deepEqual([0,1,2,3].map(clock),[0,750,1250,2250]);
});

test('a crescendo interpolates gains toward the next explicit dynamic', () => {
  const notes=[
    {id:0,beat:0,dynamic:'p',hairpin:'crescendo'},
    {id:1,beat:1},
    {id:2,beat:2,dynamic:'f'},
    {id:3,beat:3},
  ];
  const gains=editor.sheetBuildGains(notes,4);
  assert.equal(gains.get(0),.56);
  assert.ok(Math.abs(gains.get(1)-.89)<1e-8);
  assert.equal(gains.get(2),1.22);
  assert.equal(gains.get(3),1.22);
});

test('a horizontal move respects rests, chord durations, and independent voices', () => {
  const note={id:'moving',voice:1,durationBeats:1,step:0};
  const other=[{id:'held',beat:1,durationBeats:1,voice:1,step:2},{id:'rest',beat:4,durationBeats:1,voice:1,rest:true}];
  assert.equal(editor.sheetCanMoveTo(note,.5,0,other),false);
  assert.equal(editor.sheetCanMoveTo(note,1,2,other),false);
  assert.equal(editor.sheetCanMoveTo(note,1,0,other),true);
  assert.equal(editor.sheetCanMoveTo(note,4,0,other),false);
  assert.equal(editor.sheetCanMoveTo({...note,voice:2},4,0,other),true);
  assert.equal(editor.sheetCanMoveTo({...note,durationBeats:.5},1,0,other),false);
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
