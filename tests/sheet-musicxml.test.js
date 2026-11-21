const test = require('node:test');
const assert = require('node:assert/strict');
const { exportProject, importProject } = require('../outputs/sheet-musicxml');

// Node has no DOMParser. This small adapter handles the controlled XML fixtures in these tests.
// The app passes the browser's XML parser, which also validates document structure and namespaces.
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => entities[entity]);

class FixtureElement {
  constructor(localName, attrs = {}) { Object.assign(this, { localName, attrs, children: [], content: [] }); }
  append(value) { this.content.push(value); if (value instanceof FixtureElement) this.children.push(value); }
  get textContent() { return this.content.map(value => value instanceof FixtureElement ? value.textContent : value).join(''); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  getElementsByTagName(name) { return this.children.flatMap(item => [...(item.localName === name ? [item] : []), ...item.getElementsByTagName(name)]); }
}

class FixtureParser {
  parseFromString(source) {
    const document = new FixtureElement('document'), stack = [document];
    for (const token of source.match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('<?') || token.startsWith('<!')) continue;
      if (token.startsWith('</')) {
        assert.equal(stack.pop().localName, token.slice(2, -1));
        continue;
      }
      if (!token.startsWith('<')) { stack.at(-1).append(decode(token)); continue; }
      const localName = /^<([\w-]+)/.exec(token)[1];
      const attrs = Object.fromEntries([...token.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
      const element = new FixtureElement(localName, attrs);
      stack.at(-1).append(element);
      if (!token.endsWith('/>')) stack.push(element);
    }
    assert.equal(stack.length, 1, 'All opening tags have a matching closing tag');
    return { documentElement: document.children[0] };
  }
}

const makeNote = (id, beat, step, baseBeats, extra = {}) => ({ id, beat, step, baseBeats, durationBeats: baseBeats, dots: 0, accidental: 'none', rest: false, ...extra });
const withoutEditorMetadata = xml => xml.replace(/<identification>[\s\S]*?<\/identification>/, '');

test('exports standard timing, transposition, ties, slurs, dynamics, chords and voices', () => {
  const project = { title: 'A & B <study>', composer: 'D.', instrument: 'clarinet', bpm: 88, clef: 'bass', keySignature: 'F', timeSignature: '3/4', notes: [
    makeNote('c', 0, 10, 1, { dots: 1, durationBeats: 1.5, tieTo: 'd', slurTo: 'e', dynamic: 'mf', repeatStart: true }),
    makeNote('chord', 0, 12, 1, { dots: 1, durationBeats: 1.5 }),
    makeNote('d', 1.5, 10, .5, { tempo: 100 }),
    makeNote('e', 2, 11, .25, { articulation: 'marcato', ending: 1, repeatEnd: true }),
    makeNote('beam', 2.25, 12, .25, { beamMode: 'join' }),
    makeNote('voice', 0, 4, .125, { voice: 2, rest: true }),
  ] };
  const xml = exportProject(project);
  assert.match(xml, /<work-title>A &amp; B &lt;study&gt;<\/work-title>/);
  assert.match(xml, /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><\/transpose>/);
  assert.match(xml, /<pitch><step>C<\/step><octave>4<\/octave><\/pitch><duration>1440<\/duration><tie type="start"\/>/);
  assert.match(xml, /<type>quarter<\/type><dot\/>/);
  assert.match(xml, /<chord\/>/);
  assert.match(xml, /<backup><duration>1440<\/duration><\/backup>/);
  assert.match(xml, /<rest\/><duration>120<\/duration><voice>2<\/voice><type>32nd<\/type>/);
  assert.match(xml, /<tied type="stop"\/>/);
  assert.match(xml, /<slur type="stop" number="1"\/>/);
  assert.match(xml, /<dynamics><mf\/><\/dynamics>/);
  assert.match(xml, /<strong-accent\/>/);
  assert.match(xml, /<sound tempo="100"\/>/);
  assert.match(xml, /<ending number="1" type="start"\/><repeat direction="forward"\/>/);
  assert.match(xml, /<beam number="2">begin<\/beam>/);
  assert.deepEqual(importProject(xml, FixtureParser), project);
});

test('imports standard MusicXML without editor metadata', () => {
  const xml = `<score-partwise version="4.0">
    <work><work-title>External</work-title></work><part-list><score-part id="P2"><part-name>Flute</part-name></score-part></part-list>
    <part id="P2"><measure number="1">
    <attributes><divisions>12</divisions><key><fifths>1</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <direction><direction-type><dynamics><p/></dynamics></direction-type><sound tempo="80"/></direction>
    <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>12</duration><tie type="start"/><voice>1</voice><type>quarter</type><notations><slur type="start" number="1"/></notations></note>
    <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>12</duration><tie type="stop"/><voice>1</voice><type>quarter</type><notations><slur type="stop" number="1"/></notations></note>
    <backup><duration>24</duration></backup><forward><duration>12</duration></forward>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><articulations><staccato/></articulations></notations></note>
    </measure></part></score-partwise>`;
  const result = importProject(xml, FixtureParser);
  assert.equal(result.title, 'External');
  assert.equal(result.instrument, 'flute');
  assert.equal(result.keySignature, 'G');
  assert.equal(result.timeSignature, '2/4');
  assert.equal(result.bpm, 80);
  assert.deepEqual(result.notes.map(note => [note.beat, note.durationBeats, note.step]), [[0, 1, 1], [1, 1, 1], [1, 1 / 3, -2]]);
  assert.deepEqual(result.notes[0], { ...makeNote('xml-note-1', 0, 1, 1, { tieTo: 'xml-note-2', slurTo: 'xml-note-2', dynamic: 'p', voice: 1 }) });
  assert.equal(result.notes[2].triplet, true);
  assert.equal(result.notes[2].articulation, 'staccato');
});

test('shows external notation edits when previously exported metadata becomes stale', () => {
  const source = exportProject({ title: 'Before', notes: [makeNote('test', 0, 0, 1)] });
  const edited = source.replace('<step>E</step>', '<step>F</step>').replace('<work-title>Before</work-title>', '<work-title>After</work-title>');
  const imported = importProject(edited, FixtureParser);
  assert.equal(imported.title, 'After');
  assert.equal(imported.notes[0].step, 1);
  assert.equal(imported.id, undefined);
});

test('splits a cross-bar duration into standard ties and preserves the original editor note', () => {
  const source = exportProject({ timeSignature: '3/4', notes: [makeNote('cross-bar', 2, -2, 2)] });
  assert.match(source, /<measure number="2">/);
  assert.match(source, /<duration>960<\/duration><tie type="start"\/>/);
  assert.match(source, /<duration>960<\/duration><tie type="stop"\/>/);
  assert.equal(importProject(source, FixtureParser).notes.length, 1);
  const imported = importProject(source.replace(/<identification>[\s\S]*?<\/identification>/, ''), FixtureParser);
  assert.equal(imported.notes[0].tieTo, imported.notes[1].id);
  assert.deepEqual(imported.notes.map(note => [note.beat, note.durationBeats]), [[2, 1], [3, 1]]);
});

test('rejects unsupported multipart and multistaff scores with clear errors', () => {
  assert.throws(() => importProject('<score-partwise><part id="P1"/><part id="P2"/></score-partwise>', FixtureParser), /single-part/);
  assert.throws(() => importProject('<score-partwise><part id="P1"><measure number="1"><attributes><staves>2</staves></attributes></measure></part></score-partwise>', FixtureParser), /multiple staves/);
  assert.throws(() => importProject('<!DOCTYPE score-partwise [<!ENTITY sample "abc">]><score-partwise/>', FixtureParser), /custom entities/);
});

test('preserves supported tempo and pitch when a bass clef position exceeds 36 staff steps', () => {
  const xml = exportProject({ bpm: 240, clef: 'bass', notes: [makeNote('high', 0, 51, 1)] });
  assert.match(xml, /<step>B<\/step><octave>9<\/octave>/);
  assert.match(xml, /<sound tempo="240"\/>/);
  const parsed = importProject(xml, FixtureParser);
  assert.equal(parsed.bpm, 240);
  assert.equal(parsed.notes[0].step, 51);
  assert.throws(() => exportProject({ clef: 'bass', notes: [makeNote('outside', 0, 52, 1)] }), /octave range/);
});

test('exports numbered endings for two slurs that share a target', () => {
  const notes = [
    makeNote('first', 0, 0, 1, { slurTo: 'last' }),
    makeNote('second', 1, 2, 1, { slurTo: 'last' }),
    makeNote('last', 2, 4, 1),
  ];
  const xml = withoutEditorMetadata(exportProject({ notes }));
  assert.match(xml, /<slur type="stop" number="1"\/><slur type="stop" number="2"\/>/);
  const imported = importProject(xml, FixtureParser).notes;
  assert.equal(imported[0].slurTo, imported[2].id);
  assert.equal(imported[1].slurTo, imported[2].id);
});

test('edited ties do not produce an invalid link or inherit a stale accidental in ordinary XML', () => {
  const notes = [
    makeNote('sharp', 0, 0, 1, { accidental: 'sharp', tieTo: 'after-gap' }),
    makeNote('after-gap', 4, 0, 1),
    makeNote('before-flattened', 5, 3, 1, { tieTo: 'flattened' }),
    makeNote('flattened', 6, 3, 1, { accidental: 'flat' }),
    makeNote('voice-1', 7, 2, 1, { tieTo: 'voice-2' }),
    makeNote('voice-2', 8, 3, 1, { voice: 2 }),
  ];
  const xml = withoutEditorMetadata(exportProject({ notes }));
  assert.doesNotMatch(xml, /<tie(?:d)? /);
  const imported = importProject(xml, FixtureParser).notes;
  assert.equal(imported[0].accidental, 'sharp');
  assert.equal(imported[1].accidental, 'none');
  assert.equal(imported[3].accidental, 'flat');
});

test('ordinary XML keeps tempo and dynamic marks entered on a chord member', () => {
  const notes = [makeNote('c', 0, -2, 1), makeNote('e', 0, 0, 1, { tempo: 110, dynamic: 'p' })];
  const xml = withoutEditorMetadata(exportProject({ bpm: 90, notes }));
  const score = importProject(xml, FixtureParser);
  assert.equal(score.bpm, 90);
  assert.equal(score.notes[0].tempo, 110);
  assert.equal(score.notes[0].dynamic, 'p');
});

test('imports double-dotted metronome units and rejects a conflicting printed accidental', () => {
  const xml = `<score-partwise><part id="P1"><measure number="1">
    <direction><direction-type><metronome>
      <beat-unit>quarter</beat-unit><beat-unit-dot/><beat-unit-dot/><per-minute>80</per-minute>
    </metronome></direction-type></direction>
    <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><accidental>sharp</accidental></note>
    </measure></part></score-partwise>`;
  assert.equal(importProject(xml, FixtureParser).bpm, 140);
  assert.throws(() => importProject(xml.replace('>sharp<', '>flat<'), FixtureParser), /accidental conflicts with its pitch/);
});

test('places a hairpin end at the next dynamic and marks later tempos as audible offsets', () => {
  const notes = [
    makeNote('start', 0, 0, 1, { dynamic: 'p', hairpin: 'crescendo' }),
    makeNote('middle', 1, 1, 1, { tempo: 88 }),
    makeNote('end', 3, 4, 1, { dynamic: 'f' }),
  ];
  const xml = withoutEditorMetadata(exportProject({ notes }));
  assert.match(xml, /<wedge type="stop"\/><\/direction-type><offset>2880<\/offset>/);
  assert.match(xml, /<offset sound="yes">960<\/offset><sound tempo="88"\/>/);
  assert.deepEqual(importProject(xml, FixtureParser).notes.map(note => [note.beat, note.tempo, note.dynamic, note.hairpin]), [
    [0, undefined, 'p', 'crescendo'], [1, 88, undefined, undefined], [3, undefined, 'f', undefined],
  ]);
});

test('MusicXML accidentals take effect after simultaneous notes, irrespective of voice ordering', () => {
  const notes = [
    makeNote('v1', 0, 1, 1, { voice: 1, accidental: 'natural' }),
    makeNote('v2', 0, 1, 1, { voice: 2 }),
    makeNote('carried', 1, 1, 1, { voice: 1 }),
    makeNote('flat', 2, 1, 1, { voice: 1, accidental: 'flat' }),
    makeNote('sharp', 2, 1, 1, { voice: 2, accidental: 'sharp' }),
    makeNote('conflict', 3, 1, 1, { voice: 1 }),
  ];
  const xml = withoutEditorMetadata(exportProject({ notes, keySignature: 'G' }));
  const pitchAlterations = [...xml.matchAll(/<step>F<\/step>(?:<alter>(-?\d+)<\/alter>)?<octave>4<\/octave>/g)].map(match => Number(match[1] || 0));
  assert.deepEqual(pitchAlterations, [0, 1, 0, -1, 1, 1]);
  assert.deepEqual(importProject(xml, FixtureParser).notes.map(note => note.accidental), notes.map(note => note.accidental));
});

test('a tie across a barline carries its accidental only onto the tied note', () => {
  const notes = [
    makeNote('first', 3, 1, 1, { accidental: 'natural', tieTo: 'last' }),
    makeNote('last', 4, 1, 1),
    makeNote('other', 5, 1, 1),
  ];
  const xml = withoutEditorMetadata(exportProject({ notes, keySignature: 'G' }));
  const imported = importProject(xml, FixtureParser).notes;
  assert.equal(imported[0].tieTo, imported[1].id);
  assert.deepEqual(imported.map(note => note.accidental), ['natural', 'none', 'none']);
});

test('ties across voices stay linked in ordinary XML, including simultaneous unisons', () => {
  const notes = [
    makeNote('one', 0, 1, 1, { voice: 1, tieTo: 'four' }),
    makeNote('two', 0, 1, 1, { voice: 2, tieTo: 'three' }),
    makeNote('three', 1, 1, 1, { voice: 1 }),
    makeNote('four', 1, 1, 1, { voice: 2 }),
  ];
  const xml = withoutEditorMetadata(exportProject({ notes }));
  const imported = importProject(xml, FixtureParser).notes;
  assert.equal(imported[0].tieTo, imported[3].id);
  assert.equal(imported[1].tieTo, imported[2].id);
});

test('accepts a tie and slur whose stop appears before its start in score-partwise document order', () => {
  const xml = `<score-partwise><part id="P1"><measure number="1">
    <forward><duration>1</duration></forward>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><notations><tied type="stop"/><slur type="stop" number="1"/></notations></note>
    <backup><duration>2</duration></backup>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><notations><tied type="start"/><slur type="start" number="1"/></notations></note>
  </measure></part></score-partwise>`;
  const notes = importProject(xml, FixtureParser).notes;
  assert.deepEqual(notes.map(note => [note.beat, note.voice]), [[1, 1], [0, 2]]);
  assert.equal(notes[1].tieTo, notes[0].id);
  assert.equal(notes[1].slurTo, notes[0].id);
});

test('slurs that exchange endpoints in the same onset get consistent document-order numbers', () => {
  const notes = [
    makeNote('begins-first', 0, 0, 1, { slurTo: 'ends-first' }),
    makeNote('ends-first', 1, 0, 1),
    makeNote('begins-second', 1, 2, .5, { slurTo: 'ends-second' }),
    makeNote('ends-second', 2, 3, 1),
  ];
  const imported = importProject(withoutEditorMetadata(exportProject({ notes })), FixtureParser).notes;
  assert.equal(imported[0].slurTo, imported[2].id);
  assert.equal(imported[1].slurTo, imported[3].id);
});

test('corrupt optional metadata falls back to the actual MusicXML notation', () => {
  const source = exportProject({ notes: [makeNote('original-id', 0, 0, 1)] });
  const corrupt = source.replace('&quot;durationBeats&quot;:1', '&quot;durationBeats&quot;:null');
  assert.notEqual(corrupt, source);
  assert.deepEqual(importProject(corrupt, FixtureParser).notes.map(note => [note.id, note.durationBeats]), [['xml-note-1', 1]]);
});
