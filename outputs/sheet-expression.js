(function (root, factory) {
  const expression = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = expression;
  } else {
    root.SheetExpression = expression;
  }
})(globalThis, function () {
  'use strict';

  const articulations = Object.freeze({
    staccato: 'Staccato',
    tenuto: 'Tenuto',
    accent: 'Accent',
    marcato: 'Marcato',
    fermata: 'Fermata',
  });

  function articulationTiming(name) {
    switch (name) {
      case 'staccato': return { durationFactor: 0.5, gainFactor: 1 };
      case 'accent': return { durationFactor: 1, gainFactor: 1.24 };
      case 'marcato': return { durationFactor: 0.75, gainFactor: 1.35 };
      // A fermata gives the performer discretion. Playback holds it for 50% longer.
      case 'fermata': return { durationFactor: 1.5, gainFactor: 1 };
      default: return { durationFactor: 1, gainFactor: 1 };
    }
  }

  function renderArticulation(createSvg, name, x, y, side = 1) {
    if (!Object.hasOwn(articulations, name)) return null;

    const group = createSvg('g', {
      class: `sheet-articulation sheet-articulation-${name}`,
      transform: `translate(${x} ${y})`,
      'aria-hidden': 'true',
      'pointer-events': 'none',
    });
    const dot = (cy, radius) => createSvg('circle', {
      cx: 0, cy, r: radius, fill: 'currentColor',
    });
    const line = d => createSvg('path', {
      d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.65,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    const direction = side < 0 ? -1 : 1;

    switch (name) {
      case 'staccato':
        group.append(dot(0, 2.15));
        break;
      case 'tenuto':
        group.append(line('M -5 0 H 5'));
        break;
      case 'accent':
        group.append(line('M -5 -3.5 L 5 0 L -5 3.5'));
        break;
      case 'marcato':
        group.append(line(`M -5 ${3.5 * direction} L 0 ${-4 * direction} L 5 ${3.5 * direction}`));
        break;
      case 'fermata':
        group.append(
          line(`M -7 ${2.5 * direction} C -6 ${-8 * direction} 6 ${-8 * direction} 7 ${2.5 * direction}`),
          dot(1.5 * direction, 1.8),
        );
        break;
    }

    return group;
  }

  function expandRepeatMeasures(notes, measureBeats) {
    const beatsPerMeasure = Number(measureBeats);
    if (!Number.isFinite(beatsPerMeasure) || beatsPerMeasure <= 0) {
      throw new RangeError('A measure must have a positive beat count.');
    }

    const measures = new Map();
    let lastMeasure = -1;
    let sourceEndBeat = 0;
    for (const note of notes) {
      if (!Number.isFinite(note.beat) || note.beat < 0) continue;
      const index = Math.floor(note.beat / beatsPerMeasure);
      if (!measures.has(index)) measures.set(index, { notes: [] });
      const measure = measures.get(index);
      measure.notes.push(note);
      if (note.repeatStart) measure.repeatStart = true;
      if (note.repeatEnd) measure.repeatEnd = true;
      if (!measure.ending && (note.ending === 1 || note.ending === 2)) measure.ending = note.ending;
      lastMeasure = Math.max(lastMeasure, index);
      const duration = Number.isFinite(note.durationBeats) ? Math.max(0, note.durationBeats) : 0;
      sourceEndBeat = Math.max(sourceEndBeat, note.beat + duration);
    }

    const order = [];
    function appendMeasures(start, end, pass = 0) {
      let ending = 0;
      for (let index = start; index <= end; index += 1) {
        ending = measures.get(index)?.ending || ending;
        if (!pass || !ending || ending === pass) order.push(index);
      }
    }

    let repeatStart = 0;
    for (let index = 0; index <= lastMeasure; index += 1) {
      const measure = measures.get(index);
      if (measure?.repeatStart) {
        // A new start closes the pending passage as ordinary music. Nested repeats are unsupported.
        appendMeasures(repeatStart, index - 1);
        repeatStart = index;
      }
      if (measure?.repeatEnd) {
        appendMeasures(repeatStart, index, 1);
        appendMeasures(repeatStart, index, 2);
        repeatStart = index + 1;
      }
    }
    appendMeasures(repeatStart, lastMeasure);

    const expanded = [];
    const passages = [];
    let passage;
    let previousMeasure = -2;
    let endBeat = 0;
    order.forEach((index, playbackIndex) => {
      if (index !== previousMeasure + 1) {
        passage = new Map();
        passages.push(passage);
      }
      previousMeasure = index;
      const offset = (playbackIndex - index) * beatsPerMeasure;
      const measureEnd = index === lastMeasure ? sourceEndBeat + offset : (playbackIndex + 1) * beatsPerMeasure;
      endBeat = Math.max(endBeat, measureEnd);

      for (const note of measures.get(index)?.notes || []) {
        const occurrence = { ...note, id: `${note.id}@${expanded.length}`, sourceId: note.id, beat: note.beat + offset };
        expanded.push(occurrence);
        if (note.id !== undefined) passage.set(note.id, occurrence);
        if (Number.isFinite(note.durationBeats)) endBeat = Math.max(endBeat, occurrence.beat + note.durationBeats);
      }
    });

    for (const passageNotes of passages) {
      for (const note of passageNotes.values()) {
        for (const property of ['tieTo', 'slurTo']) {
          if (note[property] === undefined) continue;
          const target = passageNotes.get(note[property]);
          if (target && target.beat > note.beat) note[property] = target.id;
          else delete note[property];
        }
      }
    }
    expanded.sort((left, right) => left.beat - right.beat || (left.step || 0) - (right.step || 0));

    return { notes: expanded, endBeat };
  }

  return { articulations, articulationTiming, renderArticulation, expandRepeatMeasures };
});
