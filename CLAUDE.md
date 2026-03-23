# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cing.net is an interactive protein visualization and storytelling site combining a kaleidoscope animation engine with a Mol* protein viewer. It is a **zero-dependency vanilla JavaScript project** — no package.json, no build system, no bundler.

## Development

**Serve locally** with any static HTTP server:
```bash
python -m http.server
```

**Rebuild the Mol* viewer** (only needed when editing `story.yaml` or scene `.js` files):
```bash
# Requires the MolViewStories CLI from https://github.com/molstar/mol-view-stories
# From the story/ directory:
mvs build . -f html -o viewer.html
```

**Quick edits** to protein labels/tooltips can be made directly in `story/annotations.cif` — no rebuild needed.

There are no lint, test, or build commands.

## Architecture

### Entry Points
- **`index.html`** — Main page. Renders a full-screen canvas with the kaleidoscope effect and embeds the Mol* viewer in an iframe.
- **`story/viewer.html`** — Mol* protein viewer (MolViewStories-generated). Loaded as a child iframe.

### Core Files
- **`kaleidoscope.js`** — Animation engine. Captures the protein viewer canvas from the iframe, applies kaleidoscopic slice/mirror/rotation transforms, and renders to the main canvas. Contains all state (`settings` and `viewerState` objects), the animation loop (`draw()`), audio-reactive processing (Essentia.js), gradient system, and control panel wiring.
- **`kaleidoscope.css`** — Styling for the kaleidoscope page: glassmorphism control panel, animated conic-gradient background, CSS variables (`--ink`, `--glass`, `--accent`).
- **`styles.css`** — General UI styles.

### Parent–Iframe Communication
The kaleidoscope (parent) and Mol* viewer (child iframe) communicate via `postMessage()`. The parent sends messages to change PDB code, representation, background color/mode, foreground gradient, and illustrative mode. The viewer listens for these and updates Mol* accordingly. Messages use `targetOrigin: '*'`.

### Story / Scene System
The `story/` directory uses the MolViewStories framework:
- **`story.yaml`** — Global story configuration.
- **`story.js`** — Story-wide setup, defines `buildCingProtein()` helper.
- **`scenes/`** — Each subdirectory is a narrative scene with a `.yaml` (timing/transitions), `.js` (camera/annotation setup), and `.md` (panel content).
- **`annotations.cif`** — Residue-based labels and tooltips for the protein structure.

### External Libraries (CDN-loaded)
- **Mol* (molstar@5.5.0)** — Protein structure visualization via MolViewStories.
- **Essentia.js (0.1.3)** — Real-time audio analysis for audio-reactive effects (band-pass filtering, RMS energy).

### Key Patterns
- **State**: Mutable `settings` and `viewerState` objects in `kaleidoscope.js` — no state management library.
- **Canvas rendering**: Three canvas layers (display, mask for hiding axes, render for double-layer effects). Uses `createPattern()` + `clip()` for the kaleidoscope slices.
- **Throttled sync**: Background/foreground state changes to the iframe are debounced (600ms static, 120ms gradients).
- **High-DPI**: Canvas dimensions account for `devicePixelRatio`.
