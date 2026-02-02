const canvas = document.getElementById('kaleido');
const ctx = canvas.getContext('2d');
const iframe = document.querySelector('.source iframe');

const settings = {
  slices: 20,
  zoom: 1.35,
  radius: 0,
  offsetX: 0,
  offsetY: 0,
  targetX: 0,
  targetY: 0,
  rotation: 0,
  rotationSpeed: 0.0015,
  ease: 0.08,
};

let sourceCanvas = null;
let sourceReady = false;

const resize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  settings.radius = Math.min(width, height) * 0.6;
};

const findSourceCanvas = () => {
  const doc = iframe.contentDocument;
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

iframe.addEventListener('load', () => {
  waitForSource();
});

window.addEventListener('pointermove', (event) => {
  const nx = event.clientX / window.innerWidth - 0.5;
  const ny = event.clientY / window.innerHeight - 0.5;
  settings.targetX = nx * settings.radius * 0.9;
  settings.targetY = ny * settings.radius * 0.9;
});

const draw = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.clearRect(0, 0, width, height);

  if (!sourceReady || !sourceCanvas) {
    ctx.save();
    ctx.fillStyle = '#0b0f12';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '16px "Space Grotesk", sans-serif';
    ctx.fillText('Loading Mol* viewer…', 24, height - 24);
    ctx.restore();
    requestAnimationFrame(draw);
    return;
  }

  settings.offsetX += (settings.targetX - settings.offsetX) * settings.ease;
  settings.offsetY += (settings.targetY - settings.offsetY) * settings.ease;
  settings.rotation += settings.rotationSpeed;

  const pattern = ctx.createPattern(sourceCanvas, 'repeat');
  if (!pattern) {
    requestAnimationFrame(draw);
    return;
  }

  const sliceAngle = (Math.PI * 2) / settings.slices;
  const halfSlice = sliceAngle / 2;
  const sourceSize = Math.min(sourceCanvas.width, sourceCanvas.height);
  const scale = (settings.radius / sourceSize) * settings.zoom;

  ctx.save();
  ctx.translate(width / 2, height / 2);

  for (let i = 0; i < settings.slices; i += 1) {
    ctx.save();
    ctx.rotate(sliceAngle * i);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, settings.radius, -halfSlice, halfSlice);
    ctx.closePath();
    ctx.clip();

    ctx.rotate(Math.PI / 2);
    ctx.scale(scale, scale);
    if (i % 2 === 0) {
      ctx.scale(-1, 1);
    }

    ctx.translate(
      settings.offsetX - sourceCanvas.width / 2,
      settings.offsetY - sourceCanvas.height / 2
    );
    ctx.rotate(settings.rotation);
    ctx.fillStyle = pattern;
    ctx.fill();

    ctx.restore();
  }

  ctx.restore();
  requestAnimationFrame(draw);
};

resize();
window.addEventListener('resize', resize);
requestAnimationFrame(draw);
