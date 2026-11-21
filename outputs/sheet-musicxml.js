(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.SheetMusicXML = api;
})(function () {
  'use strict';

  const divisions = 960;
  const maxInput = 2_000_000;
  const maxNotes = 4000;
  const maxMeasures = 1000;
  const metadataName = 'instrument-testing-score-v1';
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const keys = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const types = { whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 };
  const typeForBeats = new Map(Object.entries(types).map(([name, beats]) => [beats, name]));
  const instrumentNames = { piano: 'Piano', guitar: 'Guitar', violin: 'Violin', flute: 'Flute', clarinet: 'B-flat Clarinet', drums: 'Drums' };
  const programs = { piano: 1, guitar: 25, violin: 41, flute: 74, clarinet: 72 };
  const dynamics = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
  const articulations = { staccato: 'staccato', tenuto: 'tenuto', accent: 'accent', marcato: 'strong-accent' };
  const alterationFor = { sharp: 1, flat: -1, natural: 0 };
  const accidentalFor = { '-1': 'flat', 0: 'natural', 1: 'sharp' };
  const dotFactors = [1, 1.5, 1.75];

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  function escapeXml(value) {
    return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    })[character]);
  }

  function hashScore(part) {
    let hash = 2166136261;
    for (const character of part.replace(/\r\n?/g, '\n')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16);
  }

  function meter(value) {
    const match = /^([1-9]|1[0-2])\/(2|4|8|16)$/.exec(value);
    check(match, 'Unsupported MusicXML time signature.');
    const beats = Number(match[1]), beatType = Number(match[2]);
    return { beats, beatType, length: beats * 4 / beatType };
  }

  function inferValue(beats, triplet) {
    for (const baseBeats of typeForBeats.keys()) {
      for (const [dots, multiplier] of dotFactors.entries()) {
        if (Math.abs(baseBeats * multiplier * (triplet ? 2 / 3 : 1) - beats) < 1e-6) return { baseBeats, dots };
      }
    }
    return null;
  }

  function cleanProject(project) {
    check(project && Array.isArray(project.notes) && project.notes.length <= maxNotes, 'MusicXML supports up to 4,000 notes.');
    const timeSignature = project.timeSignature || '4/4';
    const { length } = meter(timeSignature);
    const clef = project.clef || 'treble', keySignature = project.keySignature || 'C', instrument = project.instrument || 'piano';
    check(['treble', 'bass'].includes(clef), 'MusicXML supports treble and bass clefs.');
    check(keys.includes(keySignature), 'Unsupported MusicXML key signature.');
    check(Object.hasOwn(instrumentNames, instrument), 'Unsupported MusicXML instrument.');
    const knownIds = new Set();
    const notes = project.notes.map((note, index) => {
      const id = String(note.id ?? `xml-note-${index}`);
      check(id.length <= 120 && !knownIds.has(id), 'MusicXML note IDs must be unique.');
      knownIds.add(id);
      const beat = Number(note.beat), durationBeats = Number(note.durationBeats), step = Number(note.step), rest = !!note.rest;
      check(Number.isFinite(beat) && beat >= 0 && Number.isFinite(durationBeats) && durationBeats > 0 && beat + durationBeats <= maxMeasures * length, 'A note has unsupported timing or falls beyond 1,000 measures.');
      check(Number.isSafeInteger(step), 'A note is missing a valid staff position.');
      const octave = pitchAtStep(step, clef).octave;
      check(rest || octave >= 0 && octave <= 9, 'A pitch falls outside MusicXML’s octave range (0–9).');
      const result = { id, beat, durationBeats, step, rest, accidental: Object.hasOwn(alterationFor, note.accidental) ? note.accidental : 'none' };
      const value = typeForBeats.has(Number(note.baseBeats)) ? { baseBeats: Number(note.baseBeats), dots: Math.max(0, Math.min(2, Math.trunc(Number(note.dots) || 0))) } : inferValue(durationBeats, note.triplet);
      if (value) Object.assign(result, value);
      if ([1, 2].includes(Number(note.voice))) result.voice = Number(note.voice);
      if (note.triplet === true) result.triplet = true;
      if (['auto', 'join', 'break'].includes(note.beamMode)) result.beamMode = note.beamMode;
      if (typeof note.tieTo === 'string') result.tieTo = note.tieTo;
      if (typeof note.slurTo === 'string') result.slurTo = note.slurTo;
      if (Object.hasOwn(articulations, note.articulation) || note.articulation === 'fermata') result.articulation = note.articulation;
      if (dynamics.includes(note.dynamic)) result.dynamic = note.dynamic;
      if (note.tempo && Number.isFinite(Number(note.tempo)) && Number(note.tempo) > 0) result.tempo = Number(note.tempo);
      if (note.hairpin === 'crescendo' || note.hairpin === 'diminuendo') result.hairpin = note.hairpin;
      if (note.repeatStart === true) result.repeatStart = true;
      if (note.repeatEnd === true) result.repeatEnd = true;
      if (Number(note.ending) === 1 || Number(note.ending) === 2) result.ending = Number(note.ending);
      return result;
    });
    for (const note of notes) {
      if (!knownIds.has(note.tieTo) || note.tieTo === note.id) delete note.tieTo;
      if (!knownIds.has(note.slurTo) || note.slurTo === note.id) delete note.slurTo;
    }
    return {
      title: String(project.title || 'Imported score').slice(0, 48), composer: String(project.composer || '').slice(0, 36),
      instrument, bpm: Math.max(20, Math.min(300, Number(project.bpm) || 100)), clef, keySignature, timeSignature, notes,
    };
  }

  function pitchAtStep(step, clef) {
    const absolute = (clef === 'bass' ? 18 : 30) + step;
    return { letter: letters[((absolute % 7) + 7) % 7], octave: Math.floor(absolute / 7) };
  }

  function keyAlteration(letter, keySignature) {
    const fifths = keys.indexOf(keySignature) - 7;
    const order = fifths < 0 ? 'BEADGCF' : 'FCGDAEB';
    return order.indexOf(letter) < Math.abs(fifths) ? Math.sign(fifths) : 0;
  }

  function applyAccidentalOnset(carry, onset) {
    for (const [pitch, signs] of onset) {
      if (signs.size === 1) carry.set(pitch, signs.values().next().value);
      else carry.delete(pitch);
    }
    onset.clear();
  }

  function queueAccidental(onset, pitch, alteration) {
    if (!onset.has(pitch)) onset.set(pitch, new Set());
    onset.get(pitch).add(alteration);
  }

  function direction(content, playback = '', offset = 0) {
    const relative = offset ? `<offset${playback ? ' sound="yes"' : ''}>${offset}</offset>` : '';
    return `<direction><direction-type>${content}</direction-type>${relative}${playback}</direction>`;
  }

  function tempoDirection(bpm, offset = 0) {
    return direction(`<metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome>`, `<sound tempo="${bpm}"/>`, offset);
  }

  function arrangeDirections(notes, measures, measureTicks) {
    const byTick = new Map();
    for (const note of [...notes].sort((a, b) => a.beat - b.beat || a.step - b.step)) {
      if (!note.tempo && !note.dynamic && !note.hairpin) continue;
      const tick = Math.round(note.beat * divisions), marks = byTick.get(tick) || {};
      for (const kind of ['tempo', 'dynamic', 'hairpin']) if (note[kind]) marks[kind] = note[kind];
      byTick.set(tick, marks);
    }
    function add(tick, order, markup, endOfMeasure = false) {
      const bar = Math.floor((tick - (endOfMeasure && tick % measureTicks === 0 ? 1 : 0)) / measureTicks);
      const offset = tick - bar * measureTicks;
      measures[bar].directions.push({ offset, order, xml: markup(offset) });
    }
    let nextDynamic = Infinity, nextHairpin = Infinity;
    for (const [tick, marks] of [...byTick].reverse()) {
      if (marks.tempo) add(tick, 1, offset => tempoDirection(marks.tempo, offset));
      if (marks.dynamic) add(tick, 2, offset => direction(`<dynamics><${marks.dynamic}/></dynamics>`, '', offset));
      if (marks.hairpin) {
        const nextBarline = (Math.floor(tick / measureTicks) + 1) * measureTicks;
        const end = Math.min(nextHairpin, Number.isFinite(nextDynamic) ? nextDynamic : nextBarline);
        add(tick, 3, offset => direction(`<wedge type="${marks.hairpin}"/>`, '', offset));
        add(end, 0, offset => direction('<wedge type="stop"/>', '', offset), true);
        nextHairpin = tick;
      }
      if (marks.dynamic) nextDynamic = tick;
    }
  }

  function exportedLinks(notes) {
    const byId = new Map(notes.map(note => [note.id, note]));
    const possibleTies = new Map(), incomingSlurs = new Map(), outgoingSlurs = new Set();
    const addIncoming = (map, target, source) => {
      if (!map.has(target)) map.set(target, []);
      map.get(target).push(source);
    };
    for (const source of notes) {
      if (source.rest) continue;
      const tie = byId.get(source.tieTo);
      if (tie && !tie.rest && tie.beat > source.beat && tie.step === source.step
        && Math.abs(source.beat + source.durationBeats - tie.beat) < 1e-7) {
        addIncoming(possibleTies, tie.id, source.id);
      }
      const slur = byId.get(source.slurTo);
      if (slur && !slur.rest && Math.round(slur.beat * divisions) > Math.round(source.beat * divisions)) {
        outgoingSlurs.add(source.id);
        addIncoming(incomingSlurs, slur.id, source.id);
      }
    }
    return { byId, possibleTies, incomingSlurs, outgoingSlurs };
  }

  function numberSlurs(measures, incomingSlurs, outgoingSlurs) {
    const numbers = new Map(), active = new Set();
    for (const measure of measures) {
      for (const { note, first } of measure.notes) {
        if (!first) continue;
        for (const source of incomingSlurs.get(note.id) || []) active.delete(numbers.get(source));
        if (!outgoingSlurs.has(note.id)) continue;
        let number = 1;
        while (active.has(number)) number++;
        check(number <= 16, 'MusicXML supports up to 16 simultaneous slurs.');
        active.add(number);
        numbers.set(note.id, number);
      }
    }
    return numbers;
  }

  function melodicMarkings(pieces, beats, beatType) {
    const beams = new Map(), triplets = new Map();
    const groupLength = divisions * 4 / beatType * (beatType >= 8 && beats >= 6 && beats % 3 === 0 ? 3 : 1);
    for (const voice of [1, 2]) {
      const voicePieces = pieces.filter(piece => (piece.note.voice || 1) === voice);
      const primary = voicePieces.filter((piece, index) => {
        const previous = voicePieces[index - 1];
        return !previous || previous.local !== piece.local || previous.duration !== piece.duration || previous.note.rest || piece.note.rest;
      });
      const contiguous = (left, right) => left && right && left.local + left.duration === right.local;
      const levels = piece => !piece?.note.rest && piece?.first && piece?.last && piece.note.baseBeats ? Math.max(0, -Math.log2(piece.note.baseBeats)) : 0;
      const connected = (left, right) => contiguous(left, right) && levels(left) && levels(right) && right.note.beamMode !== 'break' && (right.note.beamMode === 'join' || Math.floor(left.local / groupLength) === Math.floor(right.local / groupLength));
      let group = [];
      for (const [index, piece] of primary.entries()) {
        const previous = primary[index - 1], next = primary[index + 1];
        const before = connected(previous, piece), after = connected(piece, next);
        if (before || after) {
          let markup = '';
          for (let level = 1; level <= levels(piece); level++) {
            const from = before && levels(previous) >= level, to = after && levels(next) >= level;
            const value = from && to ? 'continue' : from ? 'end' : to ? 'begin' : after ? 'forward hook' : 'backward hook';
            markup += `<beam number="${level}">${value}</beam>`;
          }
          beams.set(piece, markup);
        }
        if (piece.first && piece.last && piece.note.triplet) {
          if (group.length && (!contiguous(group.at(-1), piece) || group.at(-1).duration !== piece.duration)) group = [];
          group.push(piece);
          if (group.length === 3) {
            triplets.set(group[0], '<tuplet type="start"/>');
            triplets.set(piece, '<tuplet type="stop"/>');
            group = [];
          }
        } else group = [];
      }
    }
    return { beams, triplets };
  }

  function exportProject(project) {
    const score = cleanProject(project);
    const { length, beats, beatType } = meter(score.timeSignature), measureTicks = length * divisions;
    const source = [...score.notes].sort((a, b) => a.beat - b.beat || (a.voice || 1) - (b.voice || 1) || a.step - b.step);
    const lastTick = Math.max(0, ...source.map(note => Math.max(Math.round(note.beat * divisions) + 1, Math.round((note.beat + note.durationBeats) * divisions))));
    const measureCount = Math.max(1, Math.ceil(lastTick / measureTicks));
    const measures = Array.from({ length: measureCount }, () => ({ notes: [], directions: [], repeatStart: false, repeatEnd: false, ending: 0 }));
    const { byId, possibleTies, incomingSlurs, outgoingSlurs } = exportedLinks(source);
    const resolved = new Map(), carry = new Map(), onset = new Map(), incomingTies = new Map(), outgoingTies = new Map();
    arrangeDirections(source, measures, measureTicks);
    let lastMeasure = -1, lastTickAtOnset = -1;
    for (const [index, note] of source.entries()) {
      const start = Math.round(note.beat * divisions), end = Math.max(start + 1, Math.round((note.beat + note.durationBeats) * divisions));
      const home = Math.floor(start / measureTicks);
      const measure = measures[home];
      if (home !== lastMeasure) {
        carry.clear();
        onset.clear();
        lastMeasure = home;
      } else if (start !== lastTickAtOnset) applyAccidentalOnset(carry, onset);
      lastTickAtOnset = start;
      measure.repeatStart ||= !!note.repeatStart;
      measure.repeatEnd ||= !!note.repeatEnd;
      measure.ending ||= note.ending || 0;
      const pitch = pitchAtStep(note.step, score.clef), pitchKey = pitch.letter + pitch.octave;
      const explicit = alterationFor[note.accidental];
      const tieSources = possibleTies.get(note.id)?.filter(id => resolved.has(id) && (explicit === undefined || resolved.get(id) === explicit)) || [];
      const tieSource = tieSources.find(id => (byId.get(id).voice || 1) === (note.voice || 1)) ?? tieSources[0];
      if (tieSource !== undefined) {
        incomingTies.set(note.id, tieSource);
        outgoingTies.set(tieSource, note.id);
      }
      const alter = explicit ?? resolved.get(tieSource) ?? carry.get(pitchKey) ?? keyAlteration(pitch.letter, score.keySignature);
      if (!note.rest && explicit !== undefined) queueAccidental(onset, pitchKey, alter);
      resolved.set(note.id, alter);
      for (let cursor = start; cursor < end;) {
        const bar = Math.floor(cursor / measureTicks), local = cursor - bar * measureTicks;
        const duration = Math.min(end - cursor, measureTicks - local);
        const first = cursor === start, last = cursor + duration === end;
        measures[bar].notes.push({ note, pitch, alter, local, duration, first, last, index });
        cursor += duration;
      }
    }
    for (const measure of measures) {
      measure.notes.sort((a, b) => a.local - b.local || (a.note.voice || 1) - (b.note.voice || 1) || a.duration - b.duration || a.index - b.index);
    }
    const slurNumbers = numberSlurs(measures, incomingSlurs, outgoingSlurs);
    const measuresXml = measures.map((measure, measureIndex) => {
      let content = '';
      if (!measureIndex) {
        const clef = score.clef === 'bass' ? '<sign>F</sign><line>4</line>' : '<sign>G</sign><line>2</line>';
        const transpose = score.instrument === 'clarinet' ? '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' : '';
        content += `<attributes><divisions>${divisions}</divisions><key><fifths>${keys.indexOf(score.keySignature) - 7}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef>${clef}</clef>${transpose}</attributes>`;
      }
      if (measure.repeatStart || measure.ending) content += `<barline location="left">${measure.ending ? `<ending number="${measure.ending}" type="start"/>` : ''}${measure.repeatStart ? '<repeat direction="forward"/>' : ''}</barline>`;
      if (!measureIndex) content += tempoDirection(score.bpm);
      content += measure.directions.sort((a, b) => a.offset - b.offset || a.order - b.order).map(mark => mark.xml).join('');
      let cursor = 0, previous = null;
      const pieces = measure.notes;
      const { beams, triplets } = melodicMarkings(pieces, beats, beatType);
      for (const piece of pieces) {
        const { note, pitch, alter, local, duration, first, last } = piece;
        const voice = note.voice || 1;
        const chord = previous && previous.local === local && previous.duration === duration && !previous.note.rest && !note.rest && (previous.note.voice || 1) === voice;
        if (!chord && cursor !== local) {
          const movement = local > cursor ? 'forward' : 'backup';
          content += `<${movement}><duration>${Math.abs(local - cursor)}</duration></${movement}>`;
          cursor = local;
        }
        const value = first && last ? note : inferValue(duration / divisions, false);
        const type = value && typeForBeats.get(value.baseBeats);
        const displayedPitch = note.rest ? '<rest/>' : `<pitch><step>${pitch.letter}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch>`;
        const tieMarks = [];
        if (!note.rest) {
          const from = byId.get(incomingTies.get(note.id)), to = byId.get(outgoingTies.get(note.id));
          if (!first || from) {
            const sourceVoice = from?.voice || 1;
            tieMarks.push(['stop', first && sourceVoice !== voice ? sourceVoice : 0]);
          }
          if (!last || to) tieMarks.push(['start', last && (to?.voice || 1) !== voice ? voice : 0]);
        }
        let markings = tieMarks.map(([kind, number]) => `<tied type="${kind}"${number ? ` number="${number}"` : ''}/>`).join('');
        if (first) {
          for (const sourceId of incomingSlurs.get(note.id) || []) markings += `<slur type="stop" number="${slurNumbers.get(sourceId)}"/>`;
          if (slurNumbers.has(note.id)) markings += `<slur type="start" number="${slurNumbers.get(note.id)}"/>`;
        }
        markings += triplets.get(piece) || '';
        if (first && note.articulation === 'fermata') markings += '<fermata/>';
        const articulation = first && articulations[note.articulation];
        if (articulation) markings += `<articulations><${articulation}/></articulations>`;
        const accidental = !note.rest && first && note.accidental !== 'none' ? `<accidental>${note.accidental}</accidental>` : '';
        const triplet = first && last && note.triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '';
        content += `<note>${chord ? '<chord/>' : ''}${displayedPitch}<duration>${duration}</duration>${tieMarks.map(([kind]) => `<tie type="${kind}"/>`).join('')}<voice>${voice}</voice>${type ? `<type>${type}</type>${'<dot/>'.repeat(value.dots || 0)}` : ''}${accidental}${triplet}${beams.get(piece) || ''}${markings ? `<notations>${markings}</notations>` : ''}</note>`;
        if (!chord) cursor += duration;
        previous = piece;
      }
      if (cursor < measureTicks) content += `<forward><duration>${measureTicks - cursor}</duration></forward>`;
      if (measure.repeatEnd || measure.ending) content += `<barline location="right">${measure.ending ? `<ending number="${measure.ending}" type="stop"/>` : ''}${measure.repeatEnd ? '<repeat direction="backward"/>' : ''}</barline>`;
      return `<measure number="${measureIndex + 1}">${content}</measure>`;
    }).join('\n');
    const part = `<part id="P1">\n${measuresXml}\n</part>`;
    const metadata = escapeXml(JSON.stringify({ hash: hashScore(part), score }));
    const composer = score.composer ? `<creator type="composer">${escapeXml(score.composer)}</creator>` : '';
    const instrumentName = instrumentNames[score.instrument], program = programs[score.instrument];
    const midi = program ? `<score-instrument id="P1-I1"><instrument-name>${instrumentName}</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>${program}</midi-program></midi-instrument>` : '';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n<work><work-title>${escapeXml(score.title)}</work-title></work>\n<identification>${composer}<miscellaneous><miscellaneous-field name="${metadataName}">${metadata}</miscellaneous-field></miscellaneous></identification>\n<part-list><score-part id="P1"><part-name>${instrumentName}</part-name>${midi}</score-part></part-list>\n${part}\n</score-partwise>\n`;
    check(xml.length <= maxInput, 'This score is too large for MusicXML exchange.');
    return xml;
  }

  const children = (element, name) => Array.from(element?.children || []).filter(child => child.localName === name);
  const child = (element, name) => children(element, name)[0];
  const text = (element, name) => child(element, name)?.textContent.trim() || '';

  function importProject(xml, Parser = globalThis.DOMParser) {
    check(typeof xml === 'string' && xml.length <= maxInput, 'Choose a MusicXML file smaller than 2 MB.');
    check(!/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(xml), 'MusicXML with custom entities is unsupported.');
    check(typeof Parser === 'function', 'An XML parser is unavailable.');
    const root = new Parser().parseFromString(xml, 'application/xml').documentElement;
    check(root?.localName !== 'parsererror' && !root?.getElementsByTagName('parsererror').length, 'The MusicXML file is not valid XML.');
    check(root?.localName === 'score-partwise', 'Choose a non-compressed score-partwise MusicXML file.');
    const [part, extraPart] = children(root, 'part');
    check(part && !extraPart, 'Only single-part MusicXML scores can be imported.');
    const identification = child(root, 'identification');
    const composer = children(identification, 'creator').find(node => node.getAttribute('type') === 'composer')?.textContent.trim() || '';
    const title = text(child(root, 'work'), 'work-title') || text(root, 'movement-title') || 'Imported score';
    const partInfo = children(child(root, 'part-list'), 'score-part').find(node => node.getAttribute('id') === part.getAttribute('id'));
    const partName = text(partInfo, 'part-name').toLowerCase();
    const instrument = Object.keys(instrumentNames).find(key => partName.includes(key)) || 'piano';
    const field = children(child(identification, 'miscellaneous'), 'miscellaneous-field').find(node => node.getAttribute('name') === metadataName);
    if (field) {
      // Editor-only data is trusted for an unchanged score body. A score edited in another program is read from its notation.
      const originalPart = xml.match(/<part id="P1">[\s\S]*?<\/part>/)?.[0];
      let saved;
      try { saved = JSON.parse(field.textContent); } catch { /* Use the standard notation below. */ }
      if (saved?.score && originalPart && saved.hash === hashScore(originalPart)) {
        try { return cleanProject({ ...saved.score, title, composer, instrument }); }
        catch { /* Optional editor metadata should not make a valid MusicXML score unreadable. */ }
      }
    }

    const notes = [], openSlurs = new Map(), writtenPitches = new Map();
    const measures = children(part, 'measure');
    check(measures.length > 0 && measures.length <= maxMeasures, 'MusicXML supports one to 1,000 measures.');
    let clef = 'treble', keySignature = 'C', timeSignature = '4/4', bpm = 100;
    let beatDivisions = 1, baseBeat = 0, installedTempo = false;
    const directions = [];

    function readAttributes(attributes, measureIndex) {
      const staves = Number(text(attributes, 'staves') || '1');
      check(staves === 1, 'MusicXML scores with multiple staves are unsupported.');
      const div = text(attributes, 'divisions');
      if (div) { check(Number(div) > 0 && Number.isFinite(Number(div)), 'Invalid MusicXML divisions.'); beatDivisions = Number(div); }
      const key = child(attributes, 'key');
      if (key) {
        const fifths = text(key, 'fifths'), next = keys[Number(fifths) + 7];
        check(fifths !== '' && next, 'Only standard major and minor key signatures are supported.');
        check(!measureIndex || keySignature === next, 'Key signature changes are unsupported.'); keySignature = next;
      }
      const time = child(attributes, 'time');
      if (time) {
        const next = text(time, 'beats') + '/' + text(time, 'beat-type'); meter(next);
        check(children(time, 'beats').length === 1, 'Additive time signatures are unsupported.');
        check(!measureIndex || timeSignature === next, 'Time signature changes are unsupported.'); timeSignature = next;
      }
      const clefNode = child(attributes, 'clef');
      if (clefNode) {
        const sign = text(clefNode, 'sign'), line = text(clefNode, 'line'), shift = Number(text(clefNode, 'clef-octave-change') || '0');
        const next = sign === 'F' && line === '4' ? 'bass' : sign === 'G' && line === '2' ? 'treble' : '';
        check(next && !shift && children(attributes, 'clef').length === 1, 'Only standard treble and bass clefs are supported.');
        check(!measureIndex || clef === next, 'Clef changes are unsupported.'); clef = next;
      }
      const transpose = child(attributes, 'transpose');
      if (transpose) {
        const semitones = Number(text(transpose, 'chromatic'));
        check((instrument === 'clarinet' ? semitones === -2 : semitones === 0) && !Number(text(transpose, 'octave-change')), 'Unsupported MusicXML instrument transposition.');
      }
    }

    function addTempo(tempo, beat) {
      check(Number.isFinite(tempo) && tempo > 0, 'Invalid MusicXML tempo marking.');
      if (!installedTempo && Math.abs(beat) < 1e-6) {
        bpm = tempo;
        installedTempo = true;
      } else directions.push({ beat, tempo });
    }

    function readDirection(element, cursor) {
      const sound = child(element, 'sound'), soundTempo = sound?.getAttribute('tempo');
      const offsetNode = child(element, 'offset'), offset = Number(text(element, 'offset') || '0');
      check(Number.isFinite(offset), 'Invalid MusicXML direction offset.');
      const beat = baseBeat + cursor + offset / beatDivisions, event = { beat };
      const hasSoundTempo = soundTempo !== undefined && soundTempo !== null;
      if (hasSoundTempo) {
        const soundOffset = Number(child(sound, 'offset')?.textContent ?? (offsetNode?.getAttribute('sound') === 'yes' ? offset : 0));
        check(Number.isFinite(soundOffset), 'Invalid MusicXML sound offset.');
        addTempo(Number(soundTempo), baseBeat + cursor + soundOffset / beatDivisions);
      }
      for (const typeNode of children(element, 'direction-type')) {
        const dynamicsNode = child(typeNode, 'dynamics');
        if (dynamicsNode) {
          const [symbol, extra] = Array.from(dynamicsNode.children);
          check(!extra && dynamics.includes(symbol?.localName), 'An unsupported MusicXML dynamic was found.');
          event.dynamic = symbol.localName;
        }
        const mark = child(typeNode, 'metronome');
        if (!hasSoundTempo && mark) {
          const base = types[text(mark, 'beat-unit')], perMinute = Number(text(mark, 'per-minute'));
          const dots = children(mark, 'beat-unit-dot').length;
          check(base && perMinute > 0 && dots <= 2, 'An unsupported MusicXML tempo mark was found.');
          addTempo(base * perMinute * dotFactors[dots], beat);
        }
        const wedge = child(typeNode, 'wedge')?.getAttribute('type');
        if (wedge && wedge !== 'stop') {
          check(wedge === 'crescendo' || wedge === 'diminuendo', 'An unsupported MusicXML hairpin was found.');
          event.hairpin = wedge;
        }
      }
      if (event.dynamic || event.hairpin) directions.push(event);
    }

    for (const [measureIndex, measure] of measures.entries()) {
      const firstIndex = notes.length;
      let cursor = 0, furthest = 0, previousStart = 0, previous = null;
      let repeatStart = false, repeatEnd = false, ending = 0;
      for (const element of Array.from(measure.children)) {
        const tag = element.localName;
        if (tag === 'attributes') { readAttributes(element, measureIndex); continue; }
        if (tag === 'direction') { readDirection(element, cursor); continue; }
        if (tag === 'sound') {
          if (element.hasAttribute('tempo')) {
            const offset = Number(text(element, 'offset') || '0');
            check(Number.isFinite(offset), 'Invalid MusicXML sound offset.');
            addTempo(Number(element.getAttribute('tempo')), baseBeat + cursor + offset / beatDivisions);
          }
          continue;
        }
        if (tag === 'barline') {
          const repeat = child(element, 'repeat');
          if (repeat) {
            const times = repeat.getAttribute('times');
            check(!times || times === '2', 'Only two-pass MusicXML repeats are supported.');
            repeatStart ||= repeat.getAttribute('direction') === 'forward';
            repeatEnd ||= repeat.getAttribute('direction') === 'backward';
          }
          const endingNode = child(element, 'ending');
          if (endingNode) {
            const number = Number(endingNode.getAttribute('number'));
            check(number === 1 || number === 2, 'Only first and second MusicXML endings are supported.');
            if (endingNode.getAttribute('type') === 'start') ending = number;
          }
          continue;
        }
        if (tag !== 'note' && tag !== 'backup' && tag !== 'forward') continue;
        const durationBeats = Number(text(element, 'duration')) / beatDivisions;
        check(Number.isFinite(durationBeats) && durationBeats > 0, 'Grace, cue, and notes with missing durations are unsupported.');
        if (tag !== 'note') {
          cursor += tag === 'backup' ? -durationBeats : durationBeats;
          check(cursor >= -1e-6, 'The MusicXML measure moves before its bar line.');
          furthest = Math.max(furthest, cursor); previous = null; continue;
        }
        check(notes.length < maxNotes && !child(element, 'grace') && !child(element, 'cue'), 'MusicXML supports up to 4,000 notes and no grace or cue notes.');
        check(Number(text(element, 'staff') || '1') === 1, 'MusicXML scores with multiple staves are unsupported.');
        const voice = Number(text(element, 'voice') || '1'), chord = !!child(element, 'chord'), restNode = child(element, 'rest');
        check(voice === 1 || voice === 2, 'Only voices 1 and 2 are supported.');
        check(!chord || previous?.voice === voice && !previous.rest && !restNode, 'Invalid MusicXML chord.');
        const beat = baseBeat + (chord ? previousStart : Math.max(0, cursor));
        if (!chord) { previousStart = cursor; cursor += durationBeats; }
        furthest = Math.max(furthest, beat - baseBeat + durationBeats, cursor);
        const note = { id: `xml-note-${notes.length + 1}`, beat, durationBeats, rest: !!restNode, step: 4, accidental: 'none', voice };
        const modification = child(element, 'time-modification');
        if (modification) {
          check(text(modification, 'actual-notes') === '3' && text(modification, 'normal-notes') === '2', 'Only 3:2 MusicXML tuplets are supported.');
          note.triplet = true;
        }
        const name = text(element, 'type'), dotCount = children(element, 'dot').length, value = name ? { baseBeats: Object.hasOwn(types, name) ? types[name] : 0, dots: dotCount } : inferValue(durationBeats, note.triplet);
        // Untyped fragments are generated when an editor note crosses a bar line. External fragments may also carry an exact duration.
        check((value?.baseBeats || !name || restNode?.getAttribute('measure') === 'yes') && dotCount <= 2, 'An unsupported MusicXML note value was found.');
        if (value?.baseBeats) Object.assign(note, value);
        else if (restNode?.getAttribute('measure') === 'yes') { note.baseBeats = 4; note.dots = 0; }

        const notation = child(element, 'notations');
        if (!note.rest) {
          const pitch = child(element, 'pitch'), letter = text(pitch, 'step'), octave = Number(text(pitch, 'octave')), alter = Number(text(pitch, 'alter') || '0');
          check(pitch && letters.includes(letter) && text(pitch, 'octave') !== '' && Number.isInteger(octave) && [-1, 0, 1].includes(alter), 'Unpitched notes, microtonal pitches, and double accidentals are unsupported.');
          note.step = octave * 7 + letters.indexOf(letter) - (clef === 'bass' ? 18 : 30);
          const key = letter + octave, printed = text(element, 'accidental');
          check(!printed || Object.hasOwn(alterationFor, printed), 'An unsupported MusicXML accidental was found.');
          check(!printed || alterationFor[printed] === alter, 'A MusicXML accidental conflicts with its pitch.');
          const ties = new Map(children(element, 'tie').map(item => [item.getAttribute('type'), '']));
          const tied = children(notation, 'tied');
          for (const kind of ['start', 'stop']) {
            const edges = tied.filter(item => item.getAttribute('type') === kind);
            check(edges.length <= 1, 'Multiple MusicXML tie endpoints on one note are unsupported.');
            if (edges.length) ties.set(kind, edges[0].getAttribute('number') || '');
          }
          writtenPitches.set(note.id, { letter, key, alter, printed, ties });
        }
        const articulationNodes = Array.from(child(notation, 'articulations')?.children || []);
        if (child(notation, 'fermata')) note.articulation = 'fermata';
        if (articulationNodes.length) {
          const key = Object.keys(articulations).find(name => articulations[name] === articulationNodes[0].localName);
          check(key && articulationNodes.length === 1 && !note.articulation, 'Unsupported or simultaneous MusicXML articulations were found.'); note.articulation = key;
        }
        for (const link of children(notation, 'slur')) {
          const number = link.getAttribute('number') || '1', type = link.getAttribute('type');
          if (type !== 'start' && type !== 'stop') continue;
          check(!note.rest, 'MusicXML slurs must connect pitched notes.');
          const other = openSlurs.get(number);
          if (!other) openSlurs.set(number, { note, type });
          else {
            const source = type === 'start' ? note : other.note, target = type === 'stop' ? note : other.note;
            check(type !== other.type && source.beat < target.beat && !source.slurTo, 'A MusicXML slur does not have a unique later endpoint.');
            source.slurTo = target.id;
            openSlurs.delete(number);
          }
        }
        const beam = children(element, 'beam').find(item => !item.hasAttribute('number') || item.getAttribute('number') === '1')?.textContent.trim();
        if (beam === 'begin') note.beamMode = 'break';
        else if (beam === 'continue' || beam === 'end') note.beamMode = 'join';
        else if (!note.rest && note.baseBeats <= .5) note.beamMode = 'break';
        notes.push(note); previous = note;
      }
      const length = meter(timeSignature).length;
      check(furthest <= length + 1e-6, 'A MusicXML measure exceeds its time signature.');
      check(!(measure.getAttribute('implicit') === 'yes' && furthest < length - 1e-6), 'Pickup measures are unsupported.');
      if (repeatStart || repeatEnd || ending) {
        const note = notes[firstIndex];
        check(note, 'A MusicXML repeat or ending is attached to an empty measure.');
        if (repeatStart) note.repeatStart = true;
        if (repeatEnd) note.repeatEnd = true;
        if (ending) note.ending = ending;
      }
      baseBeat += length;
    }
    check(!openSlurs.size, 'A MusicXML slur is missing its endpoint.');
    const ordered = [...notes].sort((a, b) => a.beat - b.beat);
    const tieStarts = new Map();
    const carry = new Map(), onset = new Map(), length = meter(timeSignature).length;
    let lastMeasure = -1, lastOnset = -Infinity;
    for (const note of ordered) {
      const measure = Math.floor((note.beat + 1e-7) / length);
      if (measure !== lastMeasure) {
        carry.clear();
        onset.clear();
        lastMeasure = measure;
      } else if (Math.abs(note.beat - lastOnset) >= 1e-7) applyAccidentalOnset(carry, onset);
      lastOnset = note.beat;
      const pitch = writtenPitches.get(note.id);
      if (!pitch) continue;
      const tieKey = pitch.key + ':' + pitch.alter;
      const starts = tieStarts.get(tieKey) || [];
      if (pitch.ties.has('stop')) {
        const number = pitch.ties.get('stop');
        const candidates = starts.filter(start => Math.abs(start.note.beat + start.note.durationBeats - note.beat) < 1e-6
          && (!number || start.number === number));
        const sameVoice = candidates.filter(start => start.note.voice === note.voice);
        const match = candidates.length === 1 ? candidates[0] : sameVoice.length === 1 ? sameVoice[0] : null;
        check(match, 'A MusicXML tie ends without a matching, adjacent start.');
        match.note.tieTo = note.id;
        starts.splice(starts.indexOf(match), 1);
      }
      if (pitch.ties.has('start')) starts.push({ note, number: pitch.ties.get('start') });
      if (starts.length) tieStarts.set(tieKey, starts);
      else tieStarts.delete(tieKey);
      if (!pitch.printed && pitch.ties.has('stop')) continue;
      if (pitch.printed || pitch.alter !== (carry.get(pitch.key) ?? keyAlteration(pitch.letter, keySignature))) {
        note.accidental = pitch.printed || accidentalFor[pitch.alter];
        queueAccidental(onset, pitch.key, pitch.alter);
      }
    }
    check(!tieStarts.size, 'A MusicXML tie is missing its endpoint.');
    for (const { beat, ...markings } of directions) {
      const note = ordered.find(item => Math.abs(item.beat - beat) < 1e-6);
      check(note, 'A MusicXML tempo or dynamic marking falls between notes.');
      Object.assign(note, markings);
    }
    return cleanProject({ title, composer, instrument, bpm, clef, keySignature, timeSignature, notes });
  }

  return { exportProject, importProject };
});
