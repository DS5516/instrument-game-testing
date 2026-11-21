# Instrument Testing Versions

## 0.8.0 — Round 5: score layout, playback, and export (2026-11-21)

- Added staff wrapping, measure numbers, zoom, selectable snap grids, note labels, an eraser, and undo and redo shortcuts. Horizontal moves respect rhythm within each voice. Changing clefs preserves written pitch.
- Added chord entry, two independent voices, additional meters, repeat barlines, and first and second endings.
- Added a moving playback cursor and repeat-aware playback. Transport stop and pause clear scheduled events and active voices.
- Added MusicXML import and export for supported single-part scores, plus a print layout for printing or saving as PDF through the browser. Import creates a new composition, and hitting the local save limit preserves existing projects.
- Node tests and a simulated editor run cover wrapped placement, clefs, chord and voice input, markup saving, repeat timing, cursor updates, release, and MusicXML interchange. Browser interaction, live audio, and printed PDF output remain unverified.

## 0.7.0 — Round 4: articulation, dynamics, and tuplets (2026-11-21)

- Added staccato, tenuto, accent, marcato, and fermata symbols and playback effects.
- Added written dynamics, crescendo and diminuendo hairpins, and local tempo markings.
- Added triplet placement, grouping, and playback at two-thirds of the written length.
- Tested triplet duration and grouping, articulation output, dynamic gain interpolation, and the playback clock across tempo changes and fermatas.

## 0.6.0 — Round 3: beams, ties, and slurs (2026-11-21)

- Added automatic meter-based beams, including secondary beams for sixteenths and explicit join or break controls.
- Added ties and slurs between selected notes. A tie across a barline preserves the held pitch and plays the chain with one attack.
- Added an explicit Apply to selected action so choosing the next note value preserves the existing note.
- Tested grouping in 4/4 and 6/8, beam and curve output, and cross-bar ties including inherited accidentals. A simulated DOM also covered mixed-duration entry, 32nd-note flags, and saving and reopening.

## 0.5.0 — Round 2: dotted and thirty-second notes (2026-11-21)

- Added thirty-second notes and rests and zero, one, or two augmentation dots. Written symbols retain their base shape while duration changes by the exact dot multiplier.
- Spaced the staff to make shorter notes easier to place. Snapping also recognizes nearby note endings between regular grid positions.
- Removed the sheet player's minimum 90 ms note length so short notes end at their written duration.
- Node tests cover each duration, flag counts, compatibility with duration-only notes, and the finer placement grid.

## 0.4.0 — Staff placement regression round (2026-11-21)

- Consolidated pointer-to-staff pitch snapping so placement and vertical dragging use the same SVG-coordinate step conversion.
- Recalculate a dragged note from the pointer-up location before committing, preventing the last pointer position from being lost.
- Centralized ledger-line step generation and used it for rendering; reduced dense-label collisions by showing pitch labels only on hovered or selected notes while retaining every note's accessible label.
- Added automated regression tests for all nine treble and bass staff line/space pitches, ledger pitches, transformed SVG coordinates, and drag release placement.
- Tested with Node's built-in test runner and JavaScript syntax check. Browser interaction testing was not available in this environment.
- Reason: complete the requested placement and dragging round with repeatable coverage before adding notation features.

## 0.1.0 — Music sheet editor first round (2026-11-14)

- Added a clickable treble/bass staff with whole, half, quarter, eighth, and sixteenth notes, rests, accidentals, key signatures, and 4/4, 3/4, and 6/8 meters.
- Added playback controls with pause, stop, restart, tempo adjustment, note highlighting, and playback through the selected instrument. Clarinet notation displays written pitch and sounds a whole step lower.
- Added local save, open, duplicate, and delete for sheet projects, with undo, redo, copy, paste, and note deletion.
- Kept the existing instrument recorder and its saved recordings available under a collapsed section.
- Preserved the clarinet keyboard note's minimum audible duration so a brief key tap is heard in Free Play and Rhythm Mode.
- Deferred MusicXML, PDF, and MIDI import/export, and advanced notation to later rounds.

## 0.2.0 — Connect recorded and written compositions (2026-11-14)

- Added a visible Create Music navigation tab so the sheet editor and recording tools are reachable from the main game.
- Added Open as sheet for saved recordings. It converts recorded pitches, beat positions, durations, and drum parts into a saved editable sheet while keeping the original recording.
- Added saved sheet projects to Rhythm Mode and made falling notes, lanes, timing, and progress use the composition's actual note pitches and beat positions.
- Applied the sheet's key signature, clef, and time signature when resolving saved notes; converted clarinet written pitches to their concert playback pitch.
- Expanded the staff vertically for high and low notes so imported notes remain visible.
- Reason: connect the existing recorder, notation editor, and rhythm game without replacing their current flows.
- Tested editor navigation, staff note entry, sheet save, custom-song selection and play, recording conversion, clarinet written/concert pitch labeling, syntax, and diff formatting. Browser audio used the built-in fallback because sample files were unavailable in the local test run.

## 0.3.0 — Correct staff note placement (2026-11-15)

- Unified staff, note, ledger-line, and beat positions around shared SVG geometry and screen-to-SVG coordinate conversion.
- Removed the 30-unit staff jump caused by adding a note on the top line; the staff now stays fixed through the regular staff range and only expands when ledger space is needed.
- Clicking a notehead selects it, while clicking its stem or ledger line places a note at that exact staff position.
- Added a pitch preview before placement and vertical drag editing for existing noteheads.
- Added asset version tags so browsers request the updated editor styles and script.
- Tested all nine treble lines/spaces, bass top and bottom lines, treble A5 and bass E2 ledger positions, scroll and phone-width placement, preview visibility, stem clicks, note dragging, JavaScript syntax, and browser console errors. Browser zoom was not separately automated.
- Reason: stop staff reflow and broad note hit areas from making clicks appear to land on the wrong pitch before adding further notation tools.

## 0.0.1 — Existing game

- Starting point: six virtual instruments, Free Play, Rhythm Mode, Song Library, and recorded-song storage.
