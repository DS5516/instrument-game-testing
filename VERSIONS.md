# Instrument Testing Versions

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
