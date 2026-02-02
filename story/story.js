// Global JavaScript for the Christopher Ing story.
// Helper functions live here so scenes can focus on camera moves.
const STORY_ASSET_ROOT = './assets';
const STRUCTURE_URL =
  'https://www.ebi.ac.uk/pdbe/entry-files/download/1cbs.bcif';
const ANNOTATIONS_URI = './annotations.cif';
const ANNOTATIONS_BLOCK = 'cing_annotations';
const ANNOTATIONS_CATEGORY = 'annotations';

builder.canvas({
  background_color: '#f5efe7',
  custom: {
    molstar_postprocessing: {
      enable_ssao: true,
      ssao_params: {
        samples: 32,
        radius: 5,
        bias: 1,
        blurKernelSize: 11,
        blurDepthBias: 0.5,
        resolutionScale: 1,
        color: '0x000000',
        transparentThreshold: 0.4,
      },
    },
  },
});

const CAMERA_BASE = {
  direction: [1.0, 0.6, 1.2],
  up: [0, 1, 0],
  radius_factor: 3.0,
  radius_extent: 4.0,
};

const CAMERA_PRESETS = {
  origin: { direction: [1.2, 0.4, 0.8] },
  research: { direction: [-1.0, 0.5, 1.2] },
  build: { direction: [0.3, 1.1, -1.0] },
  community: { direction: [-0.9, 1.0, -0.2] },
  now: { direction: [0.8, -0.4, -1.2] },
};

const getCameraPreset = (key, overrides = {}) => {
  const preset = (key && CAMERA_PRESETS[key]) || {};
  return {
    direction: preset.direction ?? CAMERA_BASE.direction,
    up: preset.up ?? CAMERA_BASE.up,
    radius_factor: preset.radius_factor ?? CAMERA_BASE.radius_factor,
    radius_extent: preset.radius_extent ?? CAMERA_BASE.radius_extent,
    ...overrides,
  };
};

const ANNOTATION_POINTS = {
  origin: { chain: 'A', start: 12, end: 12 },
  research: { chain: 'A', start: 28, end: 28 },
  build: { chain: 'A', start: 55, end: 55 },
  community: { chain: 'A', start: 88, end: 88 },
  now: { chain: 'A', start: 120, end: 120 },
};

const buildCingProtein = () => {
  const structure = builder
    .download({ url: STRUCTURE_URL })
    .parse({ format: 'bcif' })
    .modelStructure({});

  const protein = structure.component({ selector: 'polymer' });
  const surface = protein.representation({ type: 'surface' });
  surface.color({ color: '#4d6b73' });
  surface.colorFromUri({
    uri: ANNOTATIONS_URI,
    format: 'cif',
    block_header: ANNOTATIONS_BLOCK,
    category_name: ANNOTATIONS_CATEGORY,
    field_name: 'color',
    schema: 'residue_range',
  });

  structure.labelFromUri({
    uri: ANNOTATIONS_URI,
    format: 'cif',
    block_header: ANNOTATIONS_BLOCK,
    category_name: ANNOTATIONS_CATEGORY,
    field_name: 'label',
    schema: 'residue_range',
  });

  structure.tooltipFromUri({
    uri: ANNOTATIONS_URI,
    format: 'cif',
    block_header: ANNOTATIONS_BLOCK,
    category_name: ANNOTATIONS_CATEGORY,
    field_name: 'tooltip',
    schema: 'residue_range',
  });

  structure
    .component({ selector: 'ligand' })
    .label({ text: 'Retinoic Acid' })
    .representation({ type: 'ball_and_stick' })
    .color({ color: '#d07a37' });

  return { structure, protein };
};

const focusAnnotation = (structure, key, options = {}) => {
  const point = ANNOTATION_POINTS[key];
  if (!point) return;

  const focusTarget = structure.component({
    selector: {
      label_asym_id: point.chain,
      beg_label_seq_id: point.start,
      end_label_seq_id: point.end,
    },
  });

  const camera = getCameraPreset(key, options);
  focusTarget.focus(camera);
};
