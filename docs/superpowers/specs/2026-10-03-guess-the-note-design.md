# Guess the note: design

**Date:** 2026-10-03
**Status:** draft
**Amends:** [2026-09-29-music-theory-design.md](2026-09-29-music-theory-design.md) (the "Sound" non-goal)
**Builds on:** D-19 (Theory tab, quizzes), D-22 (Practice: browser-rendered audio played through the existing engine)

## Summary

A third quiz in the Theory tab's **Practice** group, **Guess the note**. Stemcraft plays one
note in the instrument's own voice (the Practice tab's synthesised bass, or its plucked
guitar), and the player says which note it was, either with the 12 note buttons or by
tapping where it is on the neck.

By default an **A is played first** as a reference, so the player is working out an
interval (relative pitch, which can be learned and is what playing along by ear needs).
A setting turns the reference off for anyone who wants to train absolute pitch.

It is relaxed practice like the other two quizzes: no score, rounds, streaks or timer.
A wrong answer is marked and explained, the question stays until it is right, and notes
the player found tricky come back a little more often (`quiz.ts` weighting).

## Decisions

- **One tool, two answer modes.** `answer: name | neck`. *Name* is graded by pitch class,
  so any octave counts, as in *Name the note*. *Neck* is graded by exact pitch: every cell
  on the shown neck that sounds that MIDI note is right, so a G3 played on the D string
  at fret 5 is also right at the G string, open.
- **Reference.** `reference: a | none`. With `a`, the A nearest the target is played
  first (at most a tritone away, and the lower one on a tie), then a short gap, then the
  target. The prompt says "A, then ?". With `none`, only the target plays.
- **The target is drawn from the focus**, with the same three controls as the Fretboard
  quiz: strings, fret range, naturals or with sharps/flats. That keeps every note
  playable on the neck in front of the player, and in *neck* mode always answerable.
  The focus is stored separately from the Fretboard quiz's, and when the instrument
  changes it is carried over with `focusFor` in the same way.
- **Voice follows the Theory instrument** (`theory.json`): `bassNote` for a bass and
  `pluckNote` for a guitar, both reused unchanged from `practice/audio/voices.ts`.
- **Audio goes through the existing engine (D-22's reasoning, recorded as D-23).** Each
  question is rendered offline into Float32Arrays at 48 kHz as four stem-shaped
  buffers: the voice goes in the slot Practice uses for it (`bass` for a bass, `other`
  for a guitar), and the other slots are silent. They are handed to one
  `EngineController` per visit with `replaceStems`, and then `seek(0)` and `play()`. The
  engine's `ended` event stops it. The Theory tab gets no second audio path, clock or
  `AudioContext`.
- **Autoplay.** Browsers block audio until the user does something. The first question
  shows **▶ Play** and nothing sounds until it is pressed. After that, every new question
  plays by itself. **Replay** (or the Space key) plays the current question again. Replays
  are free and never count against the answer.
- **History.** `quiz: "ear"`, `mode: "<answer>/<reference>"` (for example `name/a`),
  `item: "m<midi>"`. Only the first try is recorded. Weighting, the never-twice-in-a-row
  rule and **Start fresh** behave exactly as in the other quizzes.
- **Feedback.** In *name* mode: "✕ not G. Try again." In *neck* mode the tapped pitch is
  compared with the target:
  - "✕ right note, an octave too high" when the pitch class matches;
  - "✕ that's G2, a major 2nd too low" within an octave;
  - "✕ that's G1, more than an octave too low" further away.

  After a right answer the next question plays, and a quiet line under the prompt says
  what the last one was ("That was D3"), so the player hears the answer confirmed.

## Schema

`theory.json` stays at version 1. The change only adds fields, and each has a default:

```json
"quiz": {
  "settings": {
    "fretboard": { "...": "unchanged" },
    "theory": { "...": "unchanged" },
    "ear": { "answer": "name", "reference": "a", "strings": [], "frets": [0, 12], "accidentals": false }
  },
  "history": [{ "quiz": "ear", "mode": "name/a", "item": "m43", "correct": true, "at": "…" }]
}
```

`last_tool` accepts `"guess-note"`. An older file without `ear` reads with the defaults.
Unknown values are still rejected (`extra="forbid"`, Literals).

## Units

| Unit | Does | Depends on |
| --- | --- | --- |
| `music/earQuiz.ts` | `referenceMidi`, `earQuestion` (pick a target from the focus, weighted), `judgeNeck` and `judgeName` (feedback text) | `quiz.ts` (focus, weighting), `positions.ts` |
| `theory/audio/guessRender.ts` | `renderGuess(kind, target, reference)` → `StemChannels[4]` at 48 kHz | `practice/audio/voices.ts` |
| `theory/useGuessSound.ts` | one engine per visit: `play(stems)`, `replay()`, `playing`, `error`; the engine factory can be swapped in tests | `EngineController.createFromStems` |
| `theory/tools/GuessNote.tsx` | the screen: prompt, Play/Replay, the answer (note picker or neck), feedback, focus controls, help, Start fresh | the three above, `TheoryNeck`, `NotePicker` |

## Errors (N-08)

| Situation | Behaviour |
| --- | --- |
| The engine cannot be created (no AudioWorklet, the rate is not 48 kHz) | A red line with the real message instead of Play. The quiz is not offered without sound |
| The focus leaves no notes | The existing `QuizFocusError` message with **Widen the focus** |
| theory.json unreadable | The same "needs theory.json" line as the other quizzes |

## Non-goals

- Intervals, chords or melodies by ear. They would reuse the same renderer and hook,
  but they are not in this design.
- A drone, or a reference other than A.
- Changing the voices: the bass and guitar sounds stay exactly as Practice uses them.

## Testing

- `earQuiz`: the reference is at most a tritone away and the lower A on a tie; targets
  stay inside the focus; with a seeded RNG, weighting keeps working and the same item
  never comes twice in a row; every feedback case is checked.
- `guessRender`: the voice is in the right slot and the other slots are silent; the
  reference starts at frame 0 and the target at the documented frame; the buffer ends
  after the release; nothing clips.
- `useGuessSound` with a fake engine: created once, then `replaceStems` for each new
  question; play, replay and ended; a failed create shows its error.
- `GuessNote` (jsdom, fake engine): Play arms autoplay; a right name answer records and
  plays the next question; a wrong answer explains and keeps the question; a neck
  answer accepts every cell with the exact pitch; Space replays; settings save; the
  focus problem shows its way out.
- By ear in the browser, on bass and guitar, with and without the reference.
