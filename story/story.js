// Global JavaScript for the Christopher Ing story.
// Helper functions live here so scenes can focus on camera moves.
const STRUCTURE_URL =
  'https://www.ebi.ac.uk/pdbe/entry-files/download/1cbs.bcif';

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
  radius_factor: 2.5,
  radius_extent: 3.5,
};

const getCameraPreset = (overrides = {}) => ({
  direction: CAMERA_BASE.direction,
  up: CAMERA_BASE.up,
  radius_factor: CAMERA_BASE.radius_factor,
  radius_extent: CAMERA_BASE.radius_extent,
  ...overrides,
});

const buildCingProtein = () => {
  const structure = builder
    .download({ url: STRUCTURE_URL })
    .parse({ format: 'bcif' })
    .modelStructure({});

  const protein = structure.component({ selector: 'polymer' });
  const cartoon = protein.representation({ type: 'cartoon' });
  cartoon.color({
    custom: {
      molstar_color_theme_name: 'sequence-id',
      molstar_color_theme_params: {
        carbonColor: { name: 'sequence-id', params: {} },
      },
    },
  });

  structure
    .component({ selector: 'ligand' })
    .representation({ type: 'ball_and_stick' })
    .color({ color: '#d07a37' });

  return { structure, protein };
};
