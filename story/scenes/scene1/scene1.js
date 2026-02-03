// Overview scene.
const { protein } = buildCingProtein();
const overviewCamera = getCameraPreset({
  radius_factor: 1.25,
  radius_extent: 5,
});
protein.focus(overviewCamera);
