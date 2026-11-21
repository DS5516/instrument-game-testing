const test = require('node:test');
const assert = require('node:assert/strict');
const { articulations, articulationTiming, renderArticulation, expandRepeatMeasures, playbackSegments, sustainLoopForSample } = require('../outputs/sheet-expression.js');

test('a monophonic performance chooses one chord tone and releases before the next attack', () => {
  const chains = [
    {start:0,end:2,members:[{midi:60,voice:2}]},
    {start:0,end:2,members:[{midi:64,voice:1}]},
    {start:1,end:2,members:[{midi:67,voice:1,articulation:'staccato'}]},
  ];
  const segments = playbackSegments(chains, beat => beat * 500, true);
  assert.deepEqual(segments.map(part => [part.first.midi, part.start, part.gate]), [[64,0,500],[67,500,750]]);
});

test('an undersized pitched sample gets an in-range, phase-aligned sustain loop', () => {
  const sampleRate=8800;
  const data=Float32Array.from({length:sampleRate},(_,index)=>Math.sin(2*Math.PI*index/20));
  const buffer={duration:1,sampleRate,getChannelData:()=>data};
  assert.equal(sustainLoopForSample(buffer,1,.5,69),null);
  const loop=sustainLoopForSample(buffer,1,2,69);
  assert.ok(loop.start>0&&loop.end>loop.start&&loop.end<buffer.duration);
  assert.ok(Math.abs(Math.sin(2*Math.PI*loop.start*440)-Math.sin(2*Math.PI*loop.end*440))<1e-5);
});

function createSvg(tag, attributes) {
  return {
    tag,
    attributes,
    children: [],
    append(...children) {
      this.children.push(...children);
    },
  };
}

test('articulation playback keeps neutral timing and applies duration or emphasis as required', () => {
  const normal = { durationFactor: 1, gainFactor: 1 };
  assert.deepEqual(articulationTiming(undefined), normal);
  assert.deepEqual(articulationTiming('tenuto'), normal);
  assert.equal(articulationTiming('staccato').durationFactor, 0.5);
  assert.equal(articulationTiming('accent').durationFactor, 1);
  assert.ok(articulationTiming('accent').gainFactor > 1);
  assert.ok(articulationTiming('marcato').gainFactor > articulationTiming('accent').gainFactor);
  assert.ok(articulationTiming('marcato').durationFactor < 1);
  assert.ok(articulationTiming('fermata').durationFactor > 1);
});

test('each supported articulation renders a vector symbol anchored at the supplied coordinates', () => {
  const shapes = {
    staccato: ['circle'],
    tenuto: ['path'],
    accent: ['path'],
    marcato: ['path'],
    fermata: ['path', 'circle'],
  };
  assert.deepEqual(Object.keys(articulations), Object.keys(shapes));
  for (const [name, tags] of Object.entries(shapes)) {
    const mark = renderArticulation(createSvg, name, 240, 95);
    assert.equal(mark.tag, 'g');
    assert.equal(mark.attributes.transform, 'translate(240 95)');
    assert.equal(mark.attributes['pointer-events'], 'none');
    assert.deepEqual(mark.children.map(child => child.tag), tags);
  }
  assert.equal(renderArticulation(createSvg, 'unknown', 240, 95), null);
});

test('orientation mirrors marcato and fermata below a note', () => {
  const upward = renderArticulation(createSvg, 'marcato', 0, 0);
  const downward = renderArticulation(createSvg, 'marcato', 0, 0, -1);
  assert.equal(upward.children[0].attributes.d, 'M -5 3.5 L 0 -4 L 5 3.5');
  assert.equal(downward.children[0].attributes.d, 'M -5 -3.5 L 0 4 L 5 -3.5');

  const aboveFermata = renderArticulation(createSvg, 'fermata', 0, 0);
  const belowFermata = renderArticulation(createSvg, 'fermata', 0, 0, -1);
  assert.equal(aboveFermata.children[1].attributes.cy, 1.5);
  assert.equal(belowFermata.children[1].attributes.cy, -1.5);
});

const note = (id, beat, placements = {}) => ({ id, beat, durationBeats: 1, ...placements });
const occurrences = result => result.notes.map(({ sourceId, beat }) => [sourceId, beat]);

test('scores without repeats preserve gaps, durations, and the exact ending beat', () => {
  const notes = [note('a', 1), note('b', 8.5, { durationBeats: 0.5, rest: true })];
  const result = expandRepeatMeasures(notes, 4);
  assert.deepEqual(occurrences(result), [['a', 1], ['b', 8.5]]);
  assert.equal(result.notes[1].durationBeats, 0.5);
  assert.equal(result.notes[1].rest, true);
  assert.equal(result.endBeat, 9);
  assert.notEqual(result.notes[0], notes[0]);
  assert.equal(notes[0].id, 'a');
  assert.deepEqual(expandRepeatMeasures([], 4), { notes: [], endBeat: 0, measureOrder: [] });
});

test('repeat flags affect the full measures that contain them and play twice', () => {
  const notes = [
    note('intro', 0), note('startA', 4), note('startB', 6, { repeatStart: true }),
    note('lastA', 8, { repeatEnd: true }), note('lastB', 10), note('outro', 12),
  ];
  const result = expandRepeatMeasures(notes, 4);
  assert.deepEqual(occurrences(result), [
    ['intro', 0], ['startA', 4], ['startB', 6], ['lastA', 8], ['lastB', 10],
    ['startA', 12], ['startB', 14], ['lastA', 16], ['lastB', 18], ['outro', 20],
  ]);
  assert.equal(result.endBeat, 21);
  assert.equal(new Set(result.notes.map(item => item.id)).size, result.notes.length);
});

test('an unpaired backward repeat returns to the beginning', () => {
  const notes = [note('first', 0), note('last', 3, { repeatEnd: true })];
  const result = expandRepeatMeasures(notes, 3);
  assert.deepEqual(occurrences(result), [['first', 0], ['last', 3], ['first', 6], ['last', 9]]);
  assert.equal(result.endBeat, 10);
});

test('a multi-measure first ending is skipped on the second pass and the second ending plays once', () => {
  const notes = [
    note('start', 0, { repeatStart: true }), note('theme', 3),
    note('firstEndingA', 6, { ending: 1 }), note('firstEndingB', 9, { repeatEnd: true }),
    note('secondEnding', 12, { ending: 2 }), note('outro', 15),
  ];
  const result = expandRepeatMeasures(notes, 3);
  assert.deepEqual(occurrences(result), [
    ['start', 0], ['theme', 3], ['firstEndingA', 6], ['firstEndingB', 9],
    ['start', 12], ['theme', 15], ['secondEnding', 18], ['outro', 21],
  ]);
  assert.equal(result.endBeat, 22);
});

test('ties and slurs refer to the proper occurrences and cannot cross a repeat jump', () => {
  const notes = [
    note('start', 0, { repeatStart: true, slurTo: 'middle' }),
    note('middle', 3, { tieTo: 'end' }),
    note('end', 4, { repeatEnd: true, slurTo: 'outro' }),
    note('outro', 8, { tieTo: 'start' }),
  ];
  const { notes: [firstStart, firstMiddle, firstEnd, nextStart, nextMiddle, nextEnd, outro] } = expandRepeatMeasures(notes, 4);
  assert.equal(firstStart.slurTo, firstMiddle.id);
  assert.equal(firstMiddle.tieTo, firstEnd.id);
  assert.equal(firstEnd.slurTo, undefined);
  assert.equal(nextStart.slurTo, nextMiddle.id);
  assert.equal(nextMiddle.tieTo, nextEnd.id);
  assert.equal(nextEnd.slurTo, outro.id);
  assert.equal(outro.tieTo, undefined);
  assert.equal(notes[2].slurTo, 'outro');
});
