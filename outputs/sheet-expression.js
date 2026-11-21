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
      const index = Math.floor((note.beat + 1e-7) / beatsPerMeasure);
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

    return { notes: expanded, endBeat, measureOrder: order };
  }

  function playbackSegments(chains, time, monophonic = false) {
    const ordered = [...chains].sort((a, b) => a.start - b.start);
    const segments = [];
    for (const chain of ordered) {
      const first = chain.members[0];
      const { durationFactor, gainFactor } = articulationTiming(first.articulation);
      const start = time(chain.start), end = time(chain.end);
      const gate = chain.members.length > 1 || first.articulation === 'fermata' || first.rest
        ? end : start + (end - start) * durationFactor;
      const segment = { chain, first, start, end, gate, gainFactor };
      segments.push(segment);
    }
    if (!monophonic) return segments;
    const playable = [];
    const rests = [];
    for (const current of segments) {
      if (current.first.rest) { rests.push(current); continue; }
      const previous = playable.at(-1);
      if (!previous || Math.abs(previous.start - current.start) > 0.001) {
        if (previous) previous.gate = Math.min(previous.gate, current.start);
        playable.push(current);
      } else {
        const a = previous.first, b = current.first;
        if ((b.voice || 1) < (a.voice || 1) || ((b.voice || 1) === (a.voice || 1) && b.midi > a.midi)) {
          playable[playable.length - 1] = current;
        }
      }
    }
    return [...playable, ...rests].sort((a, b) => a.start - b.start);
  }

  function sustainLoopForSample(buffer, rate, holdSeconds, midi) {
    if (!holdSeconds || !(rate > 0) || holdSeconds <= buffer.duration / rate) return null;
    if (typeof buffer.getChannelData !== 'function' || !(buffer.sampleRate > 0)) return null;
    const samples = buffer.getChannelData(0);
    const period = buffer.sampleRate / (440 * 2 ** ((midi - 69) / 12));
    const start = Math.floor(samples.length * 0.32);
    const center = start + Math.round((samples.length * 0.38) / period) * period;
    const radius = Math.ceil(period / 2);
    const finish = Math.min(samples.length - 32, Math.round(center) + radius);
    const begin = Math.max(start + Math.ceil(period * 4), Math.round(center) - radius);
    if (!(begin <= finish)) return null;
    const probeLength = Math.min(Math.ceil(period), samples.length - start);
    let energy = 0;
    for (let frame = start; frame < start + probeLength; frame++) energy += samples[frame] ** 2;
    if (energy / probeLength < 1e-7) return null;
    let end = begin, bestError = Infinity;
    for (let frame = begin; frame <= finish; frame++) {
      let error = 0;
      for (let k = 0; k < 24; k += 3) {
        const delta = samples[start + k] - samples[frame + k];
        error += delta * delta;
      }
      if (error < bestError) { bestError = error; end = frame; }
    }
    return { start: start / buffer.sampleRate, end: end / buffer.sampleRate };
  }

  return { articulations, articulationTiming, renderArticulation, expandRepeatMeasures, playbackSegments, sustainLoopForSample };
});
