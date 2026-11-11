# Dance Fight — how to play

**Version 1.0.0 · PolyForm Noncommercial 1.0.0 · one ~78 KB HTML file**

A single-file browser fighting game where the music is the combat system. No build step, no
dependencies, no install, no server. It runs offline and from `file://`.

- Open `index.html`, pick a song, fight.

## The idea

Your track is analysed for its real beat grid and the character's dance is locked to the audio
playhead, so it cannot drift and does not depend on frame rate. Every move is a dance move, and the
character never stops dancing — attack poses layer *over* the groove rather than replacing it.

**Rhythm is the damage system.** A move landed on the beat hits **60% harder** and builds a bigger
combo; shuffle-stepping in time charges the finisher meter.

## Controls

| Key | Move | Notes |
|---|---|---|
| `A` `D` | Shuffle step | dance-walk; stepping in time charges the finisher meter |
| `W` | Leap | arabesque |
| `S` | Dip | guards and dodges — hold to block |
| `J` | Arm Wave | fast, low damage |
| `K` | Spinning Kick | medium — a full 360° turn |
| `L` | Body-Roll Uppercut | heavy — rolls through a full turn |
| `Space` | Body-Roll Finisher | needs a full meter — a 720° spin |
| `P` | Pause / resume the music | |

On-screen controls appear automatically on a phone.

## Getting a song in

Press **Start** and it plays a default 128 BPM groove, or pick your own audio file. The beat grid is
measured from the file you choose, so a track with a clear pulse plays better than a wash of ambient
sound — and a track whose tempo drifts will be tracked as it drifts rather than being forced onto a
fixed grid.

## Running it locally

Open `index.html` in a modern browser — double-click it or drag it into a tab. There is nothing to
install and nothing to build.

## Licence

PolyForm Noncommercial 1.0.0. See [LICENSE](../LICENSE).
