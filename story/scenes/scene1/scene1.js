// Overview scene.
const { protein } = buildCingProtein();
const overviewCamera = getCameraPreset(null, {
  radius_factor: 1.6,
  radius_extent: 6,
});
protein.focus(overviewCamera);
