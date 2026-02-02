# Christopher Ing - MolViewStories Source

This folder contains the MolViewStories source that powers the 3D protein viewer for cing.net.

## Quick edits (no rebuild needed)
- Update floating labels + panel text in `annotations.cif` and refresh the page.

## Rebuild the viewer HTML
If you edit `story.yaml` or `scenes/scene1/scene1.js`, rebuild `viewer.html` with the MolViewStories CLI:

```bash
# Clone the MolViewStories repo (includes the CLI)
# https://github.com/molstar/mol-view-stories

# From the repo's /cli directory:
# deno task build

# Then from this folder:
# mvs build . -f html -o viewer.html
```

## Files
- `story.yaml` - global story settings
- `scenes/scene1/scene1.js` - MolViewSpec builder script for the protein view
- `scenes/scene1/scene1.md` - narrative panel content
- `annotations.cif` - labels + tooltips tied to residues (edit to customize)
