const canvas = document.getElementById('kaleido');
const ctx = canvas.getContext('2d');
const iframe = document.querySelector('.source iframe');
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');
const renderCanvas = document.createElement('canvas');
const renderCtx = renderCanvas.getContext('2d');

const stats = {
  fpsEl: document.getElementById('stats-fps'),
  memEl: document.getElementById('stats-mem'),
  last: performance.now(),
  frames: 0,
};

const targetOrigin = '*';
const pendingMessages = [];
const viewerState = {
  pdb: '1cbs',
  representation: 'cartoon',
};
let lastBgSync = 0;

const GRADIENT_PRESETS = {
  rainbow: ['#ff004c', '#ffe600', '#00ff8a', '#00c8ff', '#6a00ff', '#ff00c8', '#ff004c'],
  atlas: ['#FEAC5E', '#C779D0', '#4BC0C8'],
  timber: ['#fc00ff', '#00dbde'],
  sunset: ['#ff7e5f', '#feb47b'],
  'cool-blues': ['#2193b0', '#6dd5ed'],
  'purple-dream': ['#cc2b5e', '#753a88'],
  'emerald-water': ['#348F50', '#56B4D3'],
  'juicy-orange': ['#FF8008', '#FFC837'],
  'moonlit-asteroid': ['#0F2027', '#203A43', '#2C5364'],
  mirage: ['#16222A', '#3A6073'],
};

const lerp = (a, b, t) => a + (b - a) * t;
const lerpHue = (a, b, t) => {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
};

const hexToHsl = (hex) => {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s, l };
};

const gradientAt = (presetKey, t) => {
  const colors = GRADIENT_PRESETS[presetKey];
  if (!colors || colors.length === 0) return null;
  const stops = colors.map(hexToHsl);
  if (stops.length === 1) return stops[0];
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const localT = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return {
    h: lerpHue(a.h, b.h, localT),
    s: lerp(a.s, b.s, localT),
    l: lerp(a.l, b.l, localT),
  };
};

const settings = {
  slices: 20,
  baseZoom: 1.9,
  radius: 0,
  offsetX: 0,
  offsetY: 0,
  targetX: 0,
  targetY: 0,
  targetRotation: 0,
  rotation: 0,
  rotationSpeed: 0.0015,
  ease: 0.08,
  mirror: true,
  spin: true,
  pulse: false,
  pulseAmount: 0.12,
  pulseSpeed: 0.9,
  drift: true,
  foregroundGradient: 'default',
  backgroundGradient: 'default',
  breathe: false,
  doubleLayer: false,
  trail: false,
  trailFade: 0.008,
  audioReactive: false,
  hueSpeed: 36,
};

let sourceCanvas = null;
let sourceReady = false;

const audioDrive = {
  ctx: null,
  stream: null,
  processor: null,
  gain: null,
  essentia: null,
  level: 0,
  pulse: 0,
  avg: 0,
};

const resize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  settings.radius = Math.hypot(width, height) * 0.55;

  renderCanvas.width = width * dpr;
  renderCanvas.height = height * dpr;
  renderCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const findSourceCanvas = () => {
  const doc = iframe?.contentDocument;
  if (!doc) return null;
  const canvases = doc.querySelectorAll('canvas');
  return canvases.length ? canvases[0] : null;
};

const waitForSource = () => {
  const candidate = findSourceCanvas();
  if (candidate) {
    sourceCanvas = candidate;
    sourceReady = true;
    return;
  }
  requestAnimationFrame(waitForSource);
};

if (iframe) {
  iframe.addEventListener('load', () => {
    waitForSource();
    while (pendingMessages.length) {
      iframe.contentWindow?.postMessage(pendingMessages.shift(), targetOrigin);
    }
  });
}

window.addEventListener('pointermove', (event) => {
  const nx = event.clientX / window.innerWidth - 0.5;
  const ny = event.clientY / window.innerHeight - 0.5;
  settings.targetRotation = Math.atan2(ny, nx);
  if (!settings.drift) return;
  settings.targetX = nx * settings.radius * 0.9;
  settings.targetY = ny * settings.radius * 0.9;
});

const ensureEssentia = async () => {
  if (audioDrive.essentia) return audioDrive.essentia;
  if (typeof EssentiaWASM !== 'function' || typeof Essentia !== 'function') return null;
  const wasm = await EssentiaWASM();
  audioDrive.essentia = new Essentia(wasm);
  return audioDrive.essentia;
};

const startAudio = async () => {
  if (audioDrive.ctx) return true;
  if (!navigator.mediaDevices?.getUserMedia) return false;

  try {
    const essentia = await ensureEssentia();
    if (!essentia) return false;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(1024, 1, 1);
    const gain = ctx.createGain();
    gain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!settings.audioReactive || !audioDrive.essentia) return;
      const input = event.inputBuffer.getChannelData(0);
      if (!input || input.length === 0) return;

      const vector = audioDrive.essentia.arrayToVector(input);
      const band = audioDrive.essentia.BandPass(
        vector,
        140,
        100,
        ctx.sampleRate
      );
      const bandSignal = band?.signal ?? band ?? vector;
      const rmsResult = audioDrive.essentia.RMS(bandSignal);
      const rms =
        typeof rmsResult === 'number'
          ? rmsResult
          : rmsResult?.rms ?? 0;

      const energy = Math.min(1, Math.max(0, rms * 10));
      audioDrive.level = audioDrive.level * 0.82 + energy * 0.18;
      audioDrive.avg = audioDrive.avg * 0.985 + energy * 0.015;
      const diff = Math.max(0, energy - audioDrive.avg);
      const pulse = Math.min(1, diff * 6.5);
      audioDrive.pulse = audioDrive.pulse * 0.6 + pulse * 0.4;
    };

    source.connect(processor);
    processor.connect(gain);
    gain.connect(ctx.destination);

    audioDrive.ctx = ctx;
    audioDrive.stream = stream;
    audioDrive.processor = processor;
    audioDrive.gain = gain;
    audioDrive.level = 0;
    audioDrive.pulse = 0;
    audioDrive.avg = 0;

    return true;
  } catch (error) {
    console.warn('Audio input failed', error);
    return false;
  }
};

const stopAudio = () => {
  if (audioDrive.processor) {
    audioDrive.processor.onaudioprocess = null;
    audioDrive.processor.disconnect();
  }
  if (audioDrive.gain) {
    audioDrive.gain.disconnect();
  }
  if (audioDrive.stream) {
    audioDrive.stream.getTracks().forEach((track) => track.stop());
  }
  if (audioDrive.ctx) {
    audioDrive.ctx.close();
  }

  audioDrive.ctx = null;
  audioDrive.stream = null;
  audioDrive.processor = null;
  audioDrive.gain = null;
  audioDrive.level = 0;
  audioDrive.pulse = 0;
  audioDrive.avg = 0;
};

const renderLayer = (targetCtx, options) => {
  const {
    slices,
    zoom,
    rotation,
    offsetX,
    offsetY,
    mirror,
    patternSource,
  } = options;

  const width = window.innerWidth;
  const height = window.innerHeight;

  const pattern = targetCtx.createPattern(patternSource, 'repeat');
  if (!pattern) return;

  const sliceAngle = (Math.PI * 2) / slices;
  const halfSlice = sliceAngle / 2;
  const sourceSize = Math.min(patternSource.width, patternSource.height);
  const scale = (settings.radius / sourceSize) * zoom;

  targetCtx.save();
  targetCtx.translate(width / 2, height / 2);

  for (let i = 0; i < slices; i += 1) {
    targetCtx.save();
    targetCtx.rotate(sliceAngle * i);

    targetCtx.beginPath();
    targetCtx.moveTo(0, 0);
    targetCtx.arc(0, 0, settings.radius, -halfSlice, halfSlice);
    targetCtx.closePath();
    targetCtx.clip();

    targetCtx.rotate(Math.PI / 2);
    targetCtx.scale(scale, scale);
    if (mirror && i % 2 === 0) {
      targetCtx.scale(-1, 1);
    }

    targetCtx.translate(
      offsetX - patternSource.width / 2,
      offsetY - patternSource.height / 2
    );
    targetCtx.rotate(rotation);
    targetCtx.fillStyle = pattern;
    targetCtx.fill();

    targetCtx.restore();
  }

  targetCtx.restore();
};

const draw = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (stats.fpsEl || stats.memEl) {
    stats.frames += 1;
    const now = performance.now();
    const delta = now - stats.last;
    if (delta > 500) {
      const fps = Math.round((stats.frames * 1000) / delta);
      if (stats.fpsEl) stats.fpsEl.textContent = `FPS ${fps}`;
      if (stats.memEl) {
        const heap = performance.memory?.usedJSHeapSize;
        stats.memEl.textContent = heap ? `MEM ${Math.round(heap / (1024 * 1024))}MB` : 'MEM --';
      }
      stats.frames = 0;
      stats.last = now;
    }
  }

  if (!settings.trail) {
    ctx.clearRect(0, 0, width, height);
  } else {
    ctx.fillStyle = `rgba(245, 239, 231, ${settings.trailFade})`;
    ctx.fillRect(0, 0, width, height);
  }

  if (!sourceReady || !sourceCanvas) {
    ctx.save();
    ctx.fillStyle = 'rgba(245, 239, 231, 0.8)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '16px "Space Grotesk", sans-serif';
    ctx.fillText('Loading Mol* viewer…', 24, height - 24);
    ctx.restore();
    requestAnimationFrame(draw);
    return;
  }

  if (!settings.drift) {
    settings.targetX = 0;
    settings.targetY = 0;
  }
  settings.offsetX += (settings.targetX - settings.offsetX) * settings.ease;
  settings.offsetY += (settings.targetY - settings.offsetY) * settings.ease;

  const audioLevel = settings.audioReactive ? audioDrive.level : 0;
  const audioPulse = settings.audioReactive ? audioDrive.pulse : 0;
  const now = performance.now() * 0.001;
  const breathWave = settings.breathe ? Math.sin(now * 0.9) : 0;
  const pulse =
    settings.pulse
      ? Math.sin(performance.now() * 0.001 * settings.pulseSpeed) *
        settings.pulseAmount
      : 0;

  const dynamicSlices = Math.max(
    6,
    Math.round(settings.slices + breathWave * 5)
  );
  const dynamicZoom =
    settings.baseZoom *
    (1 + pulse + breathWave * 0.08 + audioLevel * 0.35 + audioPulse * 0.6);
  const dynamicSpeed = settings.rotationSpeed + audioPulse * 0.03 + audioLevel * 0.006;

  if (settings.spin) {
    settings.rotation += dynamicSpeed;
  } else {
    const delta = settings.targetRotation - settings.rotation;
    const wrapped = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
    settings.rotation += wrapped * 0.08;
  }

  const audioDrift = audioPulse * settings.radius * 0.14;
  const audioOrbit = audioLevel * settings.radius * 0.04;
  const audioOffsetX = Math.cos(now * 2.1) * audioDrift + Math.sin(now * 0.9) * audioOrbit;
  const audioOffsetY = Math.sin(now * 1.7) * audioDrift + Math.cos(now * 1.3) * audioOrbit;

  let patternSource = sourceCanvas;
  if (maskCtx) {
    if (maskCanvas.width !== sourceCanvas.width || maskCanvas.height !== sourceCanvas.height) {
      maskCanvas.width = sourceCanvas.width;
      maskCanvas.height = sourceCanvas.height;
    }

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.drawImage(sourceCanvas, 0, 0);
    const axisMaskSize = Math.round(Math.min(maskCanvas.width, maskCanvas.height) * 0.18);
    maskCtx.fillStyle = '#f5efe7';
    maskCtx.fillRect(0, maskCanvas.height - axisMaskSize, axisMaskSize, axisMaskSize);
    patternSource = maskCanvas;
  }

  if (renderCtx) {
    renderCtx.clearRect(0, 0, width, height);
    renderLayer(renderCtx, {
      slices: dynamicSlices,
      zoom: dynamicZoom,
      rotation: settings.rotation,
      offsetX: settings.offsetX + audioOffsetX,
      offsetY: settings.offsetY + audioOffsetY,
      mirror: settings.mirror,
      patternSource,
    });

    if (settings.doubleLayer) {
      renderCtx.save();
      renderCtx.globalCompositeOperation = 'screen';
      renderCtx.globalAlpha = 0.7;
      renderLayer(renderCtx, {
        slices: Math.max(6, dynamicSlices - 2),
        zoom: dynamicZoom * 0.92,
        rotation: -settings.rotation * 1.4 + now * 0.6,
        offsetX: -settings.offsetX * 0.5 - audioOffsetX * 0.4,
        offsetY: settings.offsetY * 0.5 + audioOffsetY * 0.4,
        mirror: !settings.mirror,
        patternSource,
      });
      renderCtx.restore();
    }
  }

  const cycleT = (now * settings.hueSpeed) / 360;
  const fgGradientKey = settings.foregroundGradient;
  const fgColor =
    fgGradientKey !== 'default'
      ? gradientAt(fgGradientKey, cycleT % 1)
      : null;
  const useGradient = fgGradientKey !== 'default';
  const hue = useGradient ? 0 : audioPulse * 140 + audioLevel * 80;
  const saturationBase = fgColor ? 1.05 + fgColor.s * 0.7 : 1.35;
  const saturation = saturationBase + audioLevel * 0.6 + audioPulse * 0.45;
  const contrast = 1.1 + audioLevel * 0.25 + audioPulse * 0.2;
  const destWidth = width;
  const destHeight = height;

  if (iframe?.contentWindow) {
    const nowMs = performance.now();
    const bgSelection = settings.backgroundGradient;
    const animatedBg = !['default', 'black', 'white'].includes(bgSelection);
    const interval = animatedBg ? 120 : 600;
    const shouldSend = nowMs - lastBgSync > interval;
    if (shouldSend) {
      if (bgSelection === 'default') {
        iframe.contentWindow.postMessage({ type: 'set-bg', mode: 'default' }, targetOrigin);
      } else if (bgSelection === 'black') {
        iframe.contentWindow.postMessage(
          { type: 'set-bg', mode: 'hsl', hue: 0, saturation: 0, lightness: 0 },
          targetOrigin
        );
      } else if (bgSelection === 'white') {
        iframe.contentWindow.postMessage(
          { type: 'set-bg', mode: 'hsl', hue: 0, saturation: 0, lightness: 1 },
          targetOrigin
        );
      } else {
        const bgColor = gradientAt(bgSelection, cycleT % 1);
        if (bgColor) {
          iframe.contentWindow.postMessage(
            {
              type: 'set-bg',
              mode: 'hsl',
              hue: bgColor.h,
              saturation: bgColor.s,
              lightness: bgColor.l,
            },
            targetOrigin
          );
        }
      }
      lastBgSync = nowMs;
    }
  }

  ctx.save();
  ctx.globalAlpha = settings.trail ? 0.78 : 1;
  ctx.filter = `saturate(${saturation}) contrast(${contrast}) hue-rotate(${hue}deg)`;
  ctx.drawImage(renderCanvas, 0, 0, destWidth, destHeight);
  if (useGradient && fgColor) {
    const gradient = ctx.createLinearGradient(0, 0, destWidth, destHeight);
    const stops = GRADIENT_PRESETS[fgGradientKey] || [];
    if (stops.length > 0) {
      const t = cycleT % 1;
      const c1 = gradientAt(fgGradientKey, t);
      const c2 = gradientAt(fgGradientKey, (t + 0.35) % 1);
      const c3 = gradientAt(fgGradientKey, (t + 0.7) % 1);
      const toHsl = (c) =>
        `hsl(${Math.round(c.h)} ${Math.round(c.s * 100)}% ${Math.round(c.l * 100)}%)`;
      gradient.addColorStop(0, toHsl(c1));
      gradient.addColorStop(0.55, toHsl(c2));
      gradient.addColorStop(1, toHsl(c3));
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, destWidth, destHeight);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.restore();

  requestAnimationFrame(draw);
};

resize();
window.addEventListener('resize', resize);
requestAnimationFrame(draw);

const controls = {
  slices: document.getElementById('control-slices'),
  slicesValue: document.getElementById('control-slices-value'),
  zoom: document.getElementById('control-zoom'),
  zoomValue: document.getElementById('control-zoom-value'),
  speed: document.getElementById('control-speed'),
  speedValue: document.getElementById('control-speed-value'),
  foregroundGradient: document.getElementById('foreground-gradient'),
  backgroundGradient: document.getElementById('background-gradient'),
  mirror: document.getElementById('toggle-mirror'),
  spin: document.getElementById('toggle-spin'),
  pulse: document.getElementById('toggle-pulse'),
  drift: document.getElementById('toggle-drift'),
  glow: document.getElementById('toggle-glow'),
  audio: document.getElementById('toggle-audio'),
  breathe: document.getElementById('toggle-breathe'),
  doubleLayer: document.getElementById('toggle-double'),
  trail: document.getElementById('toggle-trail'),
  togglePanel: document.getElementById('controls-toggle'),
  reset: document.getElementById('control-reset'),
  pdbInput: document.getElementById('control-pdb'),
  pdbLoad: document.getElementById('control-pdb-load'),
  save: document.getElementById('control-save'),
  representationRadios: document.querySelectorAll('input[name=\"representation\"]'),
};

const setBodyClass = (name, enabled) => {
  document.body.classList.toggle(name, enabled);
};

const syncSlider = (slider, output, format) => {
  if (!slider || !output) return;
  const value = slider.value;
  output.textContent = format ? format(value) : value;
};

const bindControls = () => {
  if (!controls.slices) return;

  setBodyClass('glow-off', false);

  settings.slices = Number(controls.slices.value);
  settings.baseZoom = Number(controls.zoom.value);
  settings.rotationSpeed = Number(controls.speed.value);
  settings.mirror = controls.mirror.checked;
  settings.spin = controls.spin.checked;
  settings.foregroundGradient = controls.foregroundGradient?.value || 'default';
  settings.backgroundGradient = controls.backgroundGradient?.value || 'default';
  settings.pulse = controls.pulse.checked;
  settings.drift = controls.drift.checked;
  settings.breathe = controls.breathe.checked;
  settings.doubleLayer = controls.doubleLayer.checked;
  settings.trail = controls.trail.checked;
  viewerState.pdb = controls.pdbInput?.value?.trim().toLowerCase() || viewerState.pdb;
  const activeRepresentation = Array.from(controls.representationRadios).find((radio) => radio.checked);
  if (activeRepresentation) {
    viewerState.representation = activeRepresentation.value;
  }

  syncSlider(controls.slices, controls.slicesValue);
  syncSlider(controls.zoom, controls.zoomValue, (v) => Number(v).toFixed(2));
  syncSlider(controls.speed, controls.speedValue, (v) => Number(v).toFixed(4));

  const updateSlices = (event) => {
    settings.slices = Number(event.target.value);
    syncSlider(controls.slices, controls.slicesValue);
  };
  controls.slices.addEventListener('input', updateSlices);
  controls.slices.addEventListener('change', updateSlices);

  const updateZoom = (event) => {
    settings.baseZoom = Number(event.target.value);
    syncSlider(controls.zoom, controls.zoomValue, (v) => Number(v).toFixed(2));
  };
  controls.zoom.addEventListener('input', updateZoom);
  controls.zoom.addEventListener('change', updateZoom);

  const updateSpeed = (event) => {
    settings.rotationSpeed = Number(event.target.value);
    syncSlider(controls.speed, controls.speedValue, (v) => Number(v).toFixed(4));
  };
  controls.speed.addEventListener('input', updateSpeed);
  controls.speed.addEventListener('change', updateSpeed);

  controls.mirror.addEventListener('change', (event) => {
    settings.mirror = event.target.checked;
  });

  controls.spin.addEventListener('change', (event) => {
    settings.spin = event.target.checked;
  });

  controls.foregroundGradient?.addEventListener('change', (event) => {
    settings.foregroundGradient = event.target.value;
  });

  controls.backgroundGradient?.addEventListener('change', (event) => {
    settings.backgroundGradient = event.target.value;
    lastBgSync = 0;
  });

  controls.pulse.addEventListener('change', (event) => {
    settings.pulse = event.target.checked;
  });

  controls.drift.addEventListener('change', (event) => {
    settings.drift = event.target.checked;
  });

  controls.glow.addEventListener('change', (event) => {
    setBodyClass('glow-off', !event.target.checked);
  });

  const sendToViewer = (payload) => {
    if (!iframe?.contentWindow) {
      pendingMessages.push(payload);
      return;
    }
    iframe.contentWindow.postMessage(payload, targetOrigin);
  };

  const reloadViewer = () => {
    if (!iframe) return;
    const url = new URL(iframe.getAttribute('src') || 'story/viewer.html', window.location.href);
    url.searchParams.set('pdb', viewerState.pdb);
    url.searchParams.set('rep', viewerState.representation);
    url.searchParams.set('t', String(Date.now()));
    iframe.src = url.toString();
  };

  const applyStructure = () => {
    const raw = controls.pdbInput?.value?.trim().toLowerCase() ?? '';
    if (!raw) return;
    const sanitized = raw.replace(/[^a-z0-9]/g, '');
    if (!sanitized) return;
    controls.pdbInput.value = sanitized;
    viewerState.pdb = sanitized;
    sendToViewer({
      type: 'set-structure',
      pdb: viewerState.pdb,
      representation: viewerState.representation,
    });
    reloadViewer();
  };

  controls.pdbLoad?.addEventListener('click', applyStructure);
  controls.pdbInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyStructure();
    }
  });

  controls.save?.addEventListener('click', () => {
    const overlay = document.querySelector('.overlay');
    const prevVisibility = overlay?.style.visibility;
    const prevPointer = overlay?.style.pointerEvents;
    if (overlay) {
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
    }
    requestAnimationFrame(() => {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'kaleidoscope.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        if (overlay) {
          overlay.style.visibility = prevVisibility || '';
          overlay.style.pointerEvents = prevPointer || '';
        }
      }
    });
  });

    controls.representationRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        viewerState.representation = radio.value;
        sendToViewer({
          type: 'set-structure',
          pdb: viewerState.pdb,
          representation: viewerState.representation,
        });
        reloadViewer();
      });
    });

  controls.audio.addEventListener('change', async (event) => {
    if (event.target.checked) {
      const ok = await startAudio();
      settings.audioReactive = ok;
      if (!ok) {
        event.target.checked = false;
      }
    } else {
      settings.audioReactive = false;
      stopAudio();
    }
  });

  controls.breathe.addEventListener('change', (event) => {
    settings.breathe = event.target.checked;
  });

  controls.doubleLayer.addEventListener('change', (event) => {
    settings.doubleLayer = event.target.checked;
  });

  controls.trail.addEventListener('change', (event) => {
    settings.trail = event.target.checked;
  });

  let controlsVisible = true;
  const updateControlsVisibility = () => {
    document.body.classList.toggle('controls-hidden', !controlsVisible);
    if (controls.togglePanel) {
      controls.togglePanel.textContent = controlsVisible ? 'hide' : 'Show';
      controls.togglePanel.setAttribute('aria-expanded', String(controlsVisible));
    }
  };

  controls.togglePanel?.addEventListener('click', () => {
    controlsVisible = !controlsVisible;
    updateControlsVisibility();
  });

  updateControlsVisibility();

  controls.reset.addEventListener('click', () => {
    settings.slices = 20;
    settings.baseZoom = 1.9;
    settings.rotationSpeed = 0.0015;
    settings.mirror = true;
    settings.spin = true;
    settings.pulse = false;
    settings.drift = true;
    settings.foregroundGradient = 'default';
    settings.backgroundGradient = 'default';
    settings.breathe = false;
    settings.doubleLayer = false;
    settings.trail = false;
    settings.audioReactive = false;

    controls.slices.value = String(settings.slices);
    controls.zoom.value = String(settings.baseZoom);
    controls.speed.value = String(settings.rotationSpeed);
    controls.mirror.checked = true;
    controls.spin.checked = true;
    if (controls.foregroundGradient) {
      controls.foregroundGradient.value = 'default';
    }
    if (controls.backgroundGradient) {
      controls.backgroundGradient.value = 'default';
    }
    controls.pulse.checked = false;
    controls.drift.checked = true;
    controls.glow.checked = true;
    controls.audio.checked = false;
    controls.breathe.checked = false;
    controls.doubleLayer.checked = false;
    controls.trail.checked = false;
    controls.pdbInput.value = '1cbs';
    controls.representationRadios.forEach((radio) => {
      radio.checked = radio.value === 'cartoon';
    });

    setBodyClass('glow-off', false);
    stopAudio();

    syncSlider(controls.slices, controls.slicesValue);
    syncSlider(controls.zoom, controls.zoomValue, (v) => Number(v).toFixed(2));
    syncSlider(controls.speed, controls.speedValue, (v) => Number(v).toFixed(4));

    viewerState.pdb = '1cbs';
    viewerState.representation = 'cartoon';
    sendToViewer({
      type: 'set-structure',
      pdb: viewerState.pdb,
      representation: viewerState.representation,
    });
    reloadViewer();
    lastBgSync = 0;
  });

  document.body.dataset.controls = 'ready';
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindControls);
} else {
  bindControls();
}
