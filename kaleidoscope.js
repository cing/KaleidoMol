const canvas = document.getElementById('kaleido');
const ctx = canvas.getContext('2d');
const iframe = document.querySelector('.source iframe');
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');
const renderCanvas = document.createElement('canvas');
const renderCtx = renderCanvas.getContext('2d');
const bloomCanvas = document.createElement('canvas');
const bloomCtx = bloomCanvas.getContext('2d');

const trailHistory = [];
const TRAIL_HISTORY_SIZE = 20;

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
  background: 'default',
  illustrative: false,
};

const sendForegroundToViewer = (payload) => {
  const handler = iframe?.contentWindow?.__mvsSetForeground;
  if (typeof handler === 'function') {
    handler(payload);
    return true;
  }
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'set-foreground', ...payload }, targetOrigin);
    return true;
  }
  return false;
};

let lastBgSync = 0;
let lastFgSync = 0;
let lastFgMode = 'sequence';
let lastFgColor = '';
let lastBgMode = '';
let lastBgValue = '';

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

const hslToHex = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh >= 0 && hh < 1) {
    r = c;
    g = x;
  } else if (hh < 2) {
    r = x;
    g = c;
  } else if (hh < 3) {
    g = c;
    b = x;
  } else if (hh < 4) {
    g = x;
    b = c;
  } else if (hh < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  const toByte = (v) => Math.round((v + m) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
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
  doubleLayer: false,
  trail: false,
  glow: true,
  audioReactive: false,
  hueSpeed: 36,
  illustrative: false,
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
  const dpr = 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  settings.radius = Math.hypot(width, height) * 0.55;

  renderCanvas.width = width * dpr;
  renderCanvas.height = height * dpr;
  renderCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);

  bloomCanvas.width = Math.ceil(width * 0.25);
  bloomCanvas.height = Math.ceil(height * 0.25);
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
  settings.targetX = nx * settings.radius * 0.3;
  settings.targetY = ny * settings.radius * 0.3;
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
  const sliceOverlap = 0.004;
  const sourceSize = Math.min(patternSource.width, patternSource.height);
  const scale = (settings.radius / sourceSize) * zoom;

  targetCtx.save();
  targetCtx.translate(width / 2, height / 2);

  for (let i = 0; i < slices; i += 1) {
    targetCtx.save();
    targetCtx.rotate(sliceAngle * i);

    targetCtx.beginPath();
    targetCtx.moveTo(0, 0);
    targetCtx.arc(0, 0, settings.radius, -halfSlice - sliceOverlap, halfSlice + sliceOverlap);
    targetCtx.closePath();
    targetCtx.clip();

    targetCtx.rotate(Math.PI / 2);
    targetCtx.scale(scale, scale);
    if (mirror && i % 2 === 0) {
      targetCtx.scale(-1, 1);
    }

    targetCtx.translate(offsetX, offsetY);
    targetCtx.rotate(rotation);
    targetCtx.translate(
      -patternSource.width / 2,
      -patternSource.height / 2
    );
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

  ctx.clearRect(0, 0, width, height);

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
  const cycleT = (now * settings.hueSpeed) / 360;
  const pulse =
    settings.pulse
      ? Math.sin(performance.now() * 0.001 * settings.pulseSpeed) *
        settings.pulseAmount
      : 0;

  const dynamicSlices = settings.slices;
  const dynamicZoom =
    settings.baseZoom *
    (1 + pulse + audioLevel * 0.35 + audioPulse * 0.6);
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

  const bgSelection = settings.backgroundGradient;
  const bgStops = GRADIENT_PRESETS[bgSelection] || [];
  let bgMaskColor = '#f5efe7';
  if (bgSelection === 'black') bgMaskColor = '#000000';
  if (bgSelection === 'white') bgMaskColor = '#ffffff';
  if (!['default', 'black', 'white'].includes(bgSelection) && bgStops.length > 0) {
    const bgColor = gradientAt(bgSelection, cycleT % 1);
    if (bgColor) {
      bgMaskColor = `hsl(${Math.round(bgColor.h)} 100% ${Math.round(
        Math.max(0.28, Math.min(0.52, bgColor.l * 0.75 + 0.12)) * 100
      )}%)`;
    }
  }

  let patternSource = sourceCanvas;
  if (maskCtx) {
    if (maskCanvas.width !== sourceCanvas.width || maskCanvas.height !== sourceCanvas.height) {
      maskCanvas.width = sourceCanvas.width;
      maskCanvas.height = sourceCanvas.height;
    }

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.drawImage(sourceCanvas, 0, 0);
    const axisMaskSize = Math.round(Math.min(maskCanvas.width, maskCanvas.height) * 0.18);
    maskCtx.fillStyle = bgMaskColor;
    maskCtx.fillRect(0, maskCanvas.height - axisMaskSize, axisMaskSize, axisMaskSize);
    patternSource = maskCanvas;
  }

  const currentOffsetX = settings.offsetX + audioOffsetX;
  const currentOffsetY = settings.offsetY + audioOffsetY;

  trailHistory.push({
    rotation: settings.rotation,
    zoom: dynamicZoom,
    offsetX: currentOffsetX,
    offsetY: currentOffsetY,
  });
  if (trailHistory.length > TRAIL_HISTORY_SIZE) {
    trailHistory.shift();
  }

  if (renderCtx) {
    renderCtx.clearRect(0, 0, width, height);

    renderLayer(renderCtx, {
      slices: dynamicSlices,
      zoom: dynamicZoom,
      rotation: settings.rotation,
      offsetX: currentOffsetX,
      offsetY: currentOffsetY,
      mirror: settings.mirror,
      patternSource,
    });

    if (settings.trail && trailHistory.length > 1) {
      const trailCopies = 3;
      const len = trailHistory.length;
      for (let i = 1; i <= trailCopies; i++) {
        const histIdx = Math.max(0, len - 1 - i * 5);
        const past = trailHistory[histIdx];
        renderCtx.save();
        renderCtx.globalAlpha = 0.35 / i;
        renderLayer(renderCtx, {
          slices: dynamicSlices,
          zoom: past.zoom * (1 + i * 0.04),
          rotation: past.rotation,
          offsetX: past.offsetX,
          offsetY: past.offsetY,
          mirror: settings.mirror,
          patternSource,
        });
        renderCtx.restore();
      }
    }

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
    const isStaticBg = ['default', 'black', 'white'].includes(bgSelection);
    const interval = isStaticBg ? 600 : 120;
    const shouldSend = nowMs - lastBgSync > interval;
    if (shouldSend) {
      if (bgSelection === 'default') {
        if (lastBgMode !== 'static' || lastBgValue !== 'default') {
          iframe.contentWindow.postMessage(
            { type: 'set-bg', mode: 'static', color: 'default' },
            targetOrigin
          );
          lastBgMode = 'static';
          lastBgValue = 'default';
        }
      } else if (bgSelection === 'black') {
        if (lastBgMode !== 'static' || lastBgValue !== '#000000') {
          iframe.contentWindow.postMessage(
            { type: 'set-bg', mode: 'static', color: '#000000' },
            targetOrigin
          );
          lastBgMode = 'static';
          lastBgValue = '#000000';
        }
      } else if (bgSelection === 'white') {
        if (lastBgMode !== 'static' || lastBgValue !== '#ffffff') {
          iframe.contentWindow.postMessage(
            { type: 'set-bg', mode: 'static', color: '#ffffff' },
            targetOrigin
          );
          lastBgMode = 'static';
          lastBgValue = '#ffffff';
        }
      } else {
        const bgColor = gradientAt(bgSelection, cycleT % 1);
        if (bgColor) {
          iframe.contentWindow.postMessage(
            {
              type: 'set-bg',
              mode: 'hsl',
              hue: bgColor.h,
              saturation: 1,
              lightness: Math.max(0.28, Math.min(0.42, bgColor.l * 0.85 + 0.12)),
            },
            targetOrigin
          );
          lastBgMode = 'hsl';
          lastBgValue = bgSelection;
        }
      }
      lastBgSync = nowMs;
    }

    const needsMolstarFg = ['black', 'white'].includes(bgSelection);
    if (needsMolstarFg) {
      if (fgGradientKey === 'default') {
        if (lastFgMode !== 'sequence' || nowMs - lastFgSync > 800) {
          sendForegroundToViewer({ mode: 'sequence' });
          lastFgMode = 'sequence';
          lastFgColor = '';
          lastFgSync = nowMs;
        }
      } else if (fgColor) {
        const fgHex = hslToHex(
          fgColor.h,
          Math.min(1, 0.9 + fgColor.s * 0.6),
          Math.max(0.35, Math.min(0.6, fgColor.l * 0.8 + 0.12))
        );
        if (nowMs - lastFgSync > 160 || fgHex !== lastFgColor || lastFgMode !== 'uniform') {
          sendForegroundToViewer({ mode: 'uniform', color: fgHex });
          lastFgSync = nowMs;
          lastFgMode = 'uniform';
          lastFgColor = fgHex;
        }
      }
    } else if (lastFgMode !== 'sequence') {
      sendForegroundToViewer({ mode: 'sequence' });
      lastFgMode = 'sequence';
      lastFgColor = '';
    }
  }

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = `saturate(${saturation}) contrast(${contrast}) hue-rotate(${hue}deg)`;
  ctx.drawImage(renderCanvas, 0, 0, destWidth, destHeight);

  const fgStops = GRADIENT_PRESETS[fgGradientKey] || [];
  const blockOverlay = ['black', 'white'].includes(settings.backgroundGradient);
  const useTintGradient =
    !blockOverlay &&
    ((useGradient && fgStops.length > 0) ||
      (bgStops.length > 0 && !['default'].includes(settings.backgroundGradient)));

  if (useTintGradient) {
    const gradientKey = fgStops.length > 0 ? fgGradientKey : settings.backgroundGradient;
    const gradient = ctx.createLinearGradient(0, 0, destWidth, destHeight);
    const t = cycleT % 1;
    const c1 = gradientAt(gradientKey, t);
    const c2 = gradientAt(gradientKey, (t + 0.33) % 1);
    const c3 = gradientAt(gradientKey, (t + 0.66) % 1);
    const toHsl = (c) =>
      `hsl(${Math.round(c.h)} 100% ${Math.round(
        Math.max(0.28, Math.min(0.52, c.l * 0.75 + 0.12)) * 100
      )}%)`;
    gradient.addColorStop(0, toHsl(c1));
    gradient.addColorStop(0.5, toHsl(c2));
    gradient.addColorStop(1, toHsl(c3));
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, destWidth, destHeight);
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, destWidth, destHeight);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (settings.glow && bloomCtx) {
    const bw = bloomCanvas.width;
    const bh = bloomCanvas.height;
    bloomCtx.clearRect(0, 0, bw, bh);
    bloomCtx.filter = 'blur(8px) brightness(1.6) saturate(1.4)';
    bloomCtx.drawImage(canvas, 0, 0, bw, bh);
    bloomCtx.filter = 'none';

    const darkBg = ['black', 'moonlit-asteroid'].includes(settings.backgroundGradient);
    const blendMode = darkBg ? 'screen' : 'multiply';

    ctx.filter = 'none';
    ctx.globalCompositeOperation = blendMode;
    ctx.globalAlpha = 0.7;
    const s1 = 1.12;
    ctx.drawImage(bloomCanvas,
      destWidth * (1 - s1) * 0.5, destHeight * (1 - s1) * 0.5,
      destWidth * s1, destHeight * s1);
    ctx.globalAlpha = 0.5;
    const s2 = 1.25;
    ctx.drawImage(bloomCanvas,
      destWidth * (1 - s2) * 0.5, destHeight * (1 - s2) * 0.5,
      destWidth * s2, destHeight * s2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
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
  illustrative: document.getElementById('toggle-illustrative'),
  audio: document.getElementById('toggle-audio'),
  doubleLayer: document.getElementById('toggle-double'),
  trail: document.getElementById('toggle-trail'),
  togglePanel: document.getElementById('controls-toggle'),
  reset: document.getElementById('control-reset'),
  pdbInput: document.getElementById('control-pdb'),
  pdbLoad: document.getElementById('control-pdb-load'),
  pdbBrowse: document.getElementById('control-pdb-browse'),
  pdbFile: document.getElementById('control-pdb-file'),
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

  settings.slices = Number(controls.slices.value);
  settings.baseZoom = Number(controls.zoom.value);
  settings.rotationSpeed = Number(controls.speed.value);
  settings.mirror = controls.mirror.checked;
  settings.spin = controls.spin.checked;
  settings.foregroundGradient = controls.foregroundGradient?.value || 'default';
  settings.backgroundGradient = controls.backgroundGradient?.value || 'default';
  settings.pulse = controls.pulse.checked;
  settings.drift = controls.drift.checked;
  settings.doubleLayer = controls.doubleLayer.checked;
  settings.trail = controls.trail.checked;
  settings.illustrative = controls.illustrative?.checked || false;
  viewerState.pdb = controls.pdbInput?.value?.trim().toLowerCase() || viewerState.pdb;
  viewerState.illustrative = settings.illustrative;
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
    if (['black', 'white', 'default'].includes(settings.backgroundGradient)) {
      viewerState.background = settings.backgroundGradient;
      reloadViewer();
    }
  });

  controls.pulse.addEventListener('change', (event) => {
    settings.pulse = event.target.checked;
  });

  controls.drift.addEventListener('change', (event) => {
    settings.drift = event.target.checked;
  });

  controls.glow.addEventListener('change', (event) => {
    settings.glow = event.target.checked;
  });

  controls.illustrative?.addEventListener('change', (event) => {
    settings.illustrative = event.target.checked;
    viewerState.illustrative = settings.illustrative;
    sendToViewer({
      type: 'set-illustrative',
      enabled: settings.illustrative,
    });
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
    if (viewerState.background) {
      url.searchParams.set('bg', viewerState.background);
    }
    if (viewerState.illustrative) {
      url.searchParams.set('illustrative', '1');
    } else {
      url.searchParams.delete('illustrative');
    }
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

  controls.pdbBrowse?.addEventListener('click', () => {
    controls.pdbFile?.click();
  });

  controls.pdbFile?.addEventListener('change', () => {
    const file = controls.pdbFile.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    let format = 'pdb';
    if (name.endsWith('.cif') || name.endsWith('.mmcif')) format = 'mmcif';
    if (name.endsWith('.bcif')) format = 'bcif';

    const reader = new FileReader();
    if (format === 'bcif') {
      reader.onload = () => {
        const arr = new Uint8Array(reader.result);
        sendToViewer({
          type: 'load-file',
          data: Array.from(arr),
          format,
          binary: true,
        });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        sendToViewer({
          type: 'load-file',
          data: reader.result,
          format,
          binary: false,
        });
      };
      reader.readAsText(file);
    }
    const label = file.name.replace(/\.[^.]+$/, '').slice(0, 6);
    controls.pdbInput.value = label;
    controls.pdbFile.value = '';
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
    settings.doubleLayer = false;
    settings.trail = false;
    settings.audioReactive = false;
    settings.illustrative = false;

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
    if (controls.illustrative) {
      controls.illustrative.checked = false;
    }
    controls.audio.checked = false;
    controls.doubleLayer.checked = false;
    controls.trail.checked = false;
    controls.pdbInput.value = '1cbs';
    controls.representationRadios.forEach((radio) => {
      radio.checked = radio.value === 'cartoon';
    });

    stopAudio();

    syncSlider(controls.slices, controls.slicesValue);
    syncSlider(controls.zoom, controls.zoomValue, (v) => Number(v).toFixed(2));
    syncSlider(controls.speed, controls.speedValue, (v) => Number(v).toFixed(4));

    viewerState.pdb = '1cbs';
    viewerState.representation = 'cartoon';
    viewerState.illustrative = false;
    sendToViewer({
      type: 'set-structure',
      pdb: viewerState.pdb,
      representation: viewerState.representation,
    });
    sendToViewer({
      type: 'set-illustrative',
      enabled: false,
    });
    reloadViewer();
    lastBgSync = 0;
  });

  const cycleSelect = (select, settingKey, onChange) => {
    if (!select) return;
    const options = Array.from(select.options);
    const idx = options.findIndex((o) => o.value === select.value);
    select.selectedIndex = (idx + 1) % options.length;
    settings[settingKey] = select.value;
    if (onChange) onChange(select.value);
  };

  const toggleCheck = (checkbox, settingKey, onChange) => {
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    settings[settingKey] = checkbox.checked;
    if (onChange) onChange(checkbox.checked);
  };

  const nudgeSlider = (slider, output, settingKey, delta, format) => {
    if (!slider) return;
    const min = Number(slider.min);
    const max = Number(slider.max);
    const step = Number(slider.step) || 1;
    const val = Math.min(max, Math.max(min, Number(slider.value) + step * delta));
    slider.value = String(val);
    settings[settingKey] = val;
    syncSlider(slider, output, format);
  };

  const cycleRepresentation = () => {
    const radios = Array.from(controls.representationRadios);
    const idx = radios.findIndex((r) => r.checked);
    const next = (idx + 1) % radios.length;
    radios[next].checked = true;
    viewerState.representation = radios[next].value;
    sendToViewer({
      type: 'set-structure',
      pdb: viewerState.pdb,
      representation: viewerState.representation,
    });
    reloadViewer();
  };

  window.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case 'f': cycleSelect(controls.foregroundGradient, 'foregroundGradient'); break;
      case 'b': cycleSelect(controls.backgroundGradient, 'backgroundGradient', () => {
        lastBgSync = 0;
            if (['black', 'white', 'default'].includes(settings.backgroundGradient)) {
          viewerState.background = settings.backgroundGradient;
          reloadViewer();
        }
      }); break;
      case 'r': cycleRepresentation(); break;
      case 'm': toggleCheck(controls.mirror, 'mirror'); break;
      case 's': toggleCheck(controls.spin, 'spin'); break;
      case 'p': toggleCheck(controls.pulse, 'pulse'); break;
      case 'd': toggleCheck(controls.drift, 'drift'); break;
      case 'g': toggleCheck(controls.glow, 'glow'); break;
      case 'i': toggleCheck(controls.illustrative, 'illustrative', (on) => {
        viewerState.illustrative = on;
        sendToViewer({ type: 'set-illustrative', enabled: on });
      }); break;
      case 'l': toggleCheck(controls.doubleLayer, 'doubleLayer'); break;
      case 't': toggleCheck(controls.trail, 'trail'); break;
      case 'h':
        controlsVisible = !controlsVisible;
        updateControlsVisibility();
        break;
      case 'ArrowUp': nudgeSlider(controls.zoom, controls.zoomValue, 'baseZoom', 1, (v) => Number(v).toFixed(2)); break;
      case 'ArrowDown': nudgeSlider(controls.zoom, controls.zoomValue, 'baseZoom', -1, (v) => Number(v).toFixed(2)); break;
      case 'ArrowRight': nudgeSlider(controls.speed, controls.speedValue, 'rotationSpeed', 1, (v) => Number(v).toFixed(4)); break;
      case 'ArrowLeft': nudgeSlider(controls.speed, controls.speedValue, 'rotationSpeed', -1, (v) => Number(v).toFixed(4)); break;
      case ']': nudgeSlider(controls.slices, controls.slicesValue, 'slices', 1); break;
      case '[': nudgeSlider(controls.slices, controls.slicesValue, 'slices', -1); break;
      case 'x': controls.save?.click(); break;
      default: return;
    }
    event.preventDefault();
  });

  document.body.dataset.controls = 'ready';
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindControls);
} else {
  bindControls();
}
