# KaleidoMol

A kaleidoscopic protein structure viewer. Enter any PDB code and watch the molecule transform into a living mandala.

**[Live demo](https://cing.github.io/KaleidoMol/)**

![KaleidoMol screenshot](assets/kaleidoscope.png)

## Features

- Load any protein from the PDB by code (e.g. `1cbs`, `4hhb`) or browse a local PDB/CIF file
- Cartoon, spacefill, and molecular surface representations
- Interactive drift — mouse position shifts the pattern within the kaleidoscope
- Adjustable slices, zoom, and spin speed
- Mirror, pulse, glow, trail, and double-layer effects
- Foreground and background color gradient presets
- Audio-reactive mode via microphone (Essentia.js)
- Illustrative rendering toggle
- PNG export

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `f` | Cycle foreground gradient |
| `b` | Cycle background gradient |
| `r` | Cycle representation (cartoon / spacefill / surface) |
| `m` | Toggle mirror |
| `s` | Toggle auto spin |
| `p` | Toggle pulse |
| `d` | Toggle drift |
| `g` | Toggle glow |
| `i` | Toggle illustrative |
| `l` | Toggle double layer |
| `t` | Toggle trails |
| `h` | Hide / show controls |
| `x` | Save PNG snapshot |
| `[` / `]` | Decrease / increase slices |
| `↑` / `↓` | Increase / decrease zoom |
| `←` / `→` | Decrease / increase spin speed |

## How it works

KaleidoMol embeds a [Mol\*](https://molstar.org/) protein viewer in a hidden iframe, captures its canvas output, and renders it through a kaleidoscopic transform — slicing the image into pie-shaped wedges, mirroring alternating slices, and rotating the result. The kaleidoscope and viewer communicate via `postMessage` to synchronize colors, representations, and structures.

## Running locally

Serve the files with any static HTTP server:

```bash
python -m http.server
```

No build step, no dependencies, no package manager.

## License

MIT
