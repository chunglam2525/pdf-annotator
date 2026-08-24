import { PdfAnnotator } from './annotator.js';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const viewer = document.getElementById('viewer');
const container = document.getElementById('pdf-container');
const emptyState = document.getElementById('empty-state');
const loading = document.getElementById('loading');
const errorBox = document.getElementById('error');
const docMeta = document.getElementById('doc-meta');
const zoomLabel = document.getElementById('zoom-label');
const fileInput = document.getElementById('file-input');
const jsonDialog = document.getElementById('json-dialog');
const jsonOutput = document.getElementById('json-output');
const colorInput = document.getElementById('color-input');
const opacityInput = document.getElementById('opacity-input');
const brushInput = document.getElementById('brush-input');
const fontInput = document.getElementById('font-input');

const annotator = new PdfAnnotator(container, {
  scale: 1,
  onReady: updateChrome,
  onToolChange: (tool) => setActiveToolButton(tool),
  onHistoryChange: updateChrome,
});

function hexToRgba(hex, opacity) {
  const value = hex.replace('#', '');
  const n = Number.parseInt(value, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

function currentColor() {
  return hexToRgba(colorInput.value, Number(opacityInput.value));
}

function applyColor() {
  annotator.setColor(currentColor());
}

function setActiveToolButton(tool) {
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
}

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || '';
}

function setBusy(isBusy) {
  loading.hidden = !isBusy;
  emptyState.hidden = isBusy || annotator.isReady;
  container.hidden = isBusy || !annotator.isReady;
}

function updateChrome() {
  const ready = annotator.isReady;
  docMeta.textContent = ready ? `${annotator.fileName} · ${annotator.pageCount} page${annotator.pageCount === 1 ? '' : 's'}` : 'No document';
  zoomLabel.textContent = `${Math.round(annotator.scale * 100)}%`;

  document.getElementById('undo-btn').disabled = !annotator.canUndo;
  document.getElementById('redo-btn').disabled = !annotator.canRedo;

  [
    'zoom-out',
    'zoom-in',
    'image-btn',
    'delete-btn',
    'clear-btn',
    'json-btn',
    'save-btn',
  ].forEach((id) => {
    document.getElementById(id).disabled = !ready;
  });
  document.querySelectorAll('[data-tool], #brush-input, #font-input, #color-input, #opacity-input').forEach((el) => {
    el.disabled = !ready;
  });
}

async function openPdf(source) {
  showError('');
  setBusy(true);
  try {
    await annotator.load(source);
    annotator.setColor(currentColor());
    annotator.setBrushSize(brushInput.value);
    annotator.setFontSize(fontInput.value);
    setActiveToolButton(annotator.tool);
  } catch (error) {
    console.error(error);
    showError(error.message || 'Could not open that PDF.');
    emptyState.hidden = false;
    container.hidden = true;
  } finally {
    loading.hidden = true;
    if (annotator.isReady) {
      emptyState.hidden = true;
      container.hidden = false;
    }
    updateChrome();
  }
}

function stepZoom(direction) {
  const current = annotator.scale;
  const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  const from = index === -1 ? ZOOM_STEPS.length - 1 : index;
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + direction))];
  return next;
}

function changeZoom(direction) {
  if (!annotator.isReady) {
    return;
  }
  const scale = stepZoom(direction);
  if (scale === annotator.scale) {
    return;
  }
  annotator.setZoom(scale);
  updateChrome();
}

function openFilePicker() {
  fileInput.click();
}

function isTypingTarget(target) {
  return Boolean(target.closest('input, select, textarea, [contenteditable="true"]'));
}

document.getElementById('open-btn').addEventListener('click', openFilePicker);
document.getElementById('empty-open').addEventListener('click', openFilePicker);
document.getElementById('zoom-out').addEventListener('click', () => changeZoom(-1));
document.getElementById('zoom-in').addEventListener('click', () => changeZoom(1));
document.getElementById('image-btn').addEventListener('click', () => annotator.addImage());
document.getElementById('undo-btn').addEventListener('click', () => annotator.undo());
document.getElementById('redo-btn').addEventListener('click', () => annotator.redo());
document.getElementById('delete-btn').addEventListener('click', () => annotator.deleteSelected());
document.getElementById('save-btn').addEventListener('click', () => annotator.savePdf());

document.getElementById('clear-btn').addEventListener('click', () => {
  if (window.confirm('Clear all annotations on this page?')) {
    annotator.clearPage();
  }
});

document.getElementById('json-btn').addEventListener('click', () => {
  jsonOutput.textContent = JSON.stringify(annotator.serialize(), null, 2);
  jsonDialog.showModal();
});

document.getElementById('close-json').addEventListener('click', () => jsonDialog.close());
document.getElementById('copy-json').addEventListener('click', async () => {
  await navigator.clipboard.writeText(jsonOutput.textContent);
  document.getElementById('copy-json').textContent = 'Copied';
  window.setTimeout(() => {
    document.getElementById('copy-json').textContent = 'Copy';
  }, 1200);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) {
    openPdf(file);
  }
});

document.querySelector('.tools').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tool]');
  if (!button || !annotator.isReady) {
    return;
  }
  annotator.setTool(button.dataset.tool);
});

colorInput.addEventListener('input', applyColor);
opacityInput.addEventListener('input', applyColor);
brushInput.addEventListener('change', () => annotator.setBrushSize(brushInput.value));
fontInput.addEventListener('change', () => annotator.setFontSize(fontInput.value));

viewer.addEventListener('dragover', (event) => {
  event.preventDefault();
  viewer.classList.add('dragover');
});

viewer.addEventListener('dragleave', () => viewer.classList.remove('dragover'));

viewer.addEventListener('drop', (event) => {
  event.preventDefault();
  viewer.classList.remove('dragover');
  const file = [...(event.dataTransfer?.files || [])].find((item) => item.type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'));
  if (file) {
    openPdf(file);
  } else {
    showError('Drop a PDF file to open it.');
    emptyState.hidden = annotator.isReady;
  }
});

document.addEventListener('keydown', (event) => {
  if (isTypingTarget(event.target) || annotator.isEditingText()) {
    return;
  }

  const key = event.key.toLowerCase();
  const meta = event.ctrlKey || event.metaKey;

  if (key === 'escape') {
    annotator.setTool('select');
    return;
  }
  if ((key === 'delete' || key === 'backspace') && annotator.isReady) {
    event.preventDefault();
    annotator.deleteSelected();
    return;
  }
  if (meta && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      annotator.redo();
    } else {
      annotator.undo();
    }
    return;
  }
  if (meta && key === 'y') {
    event.preventDefault();
    annotator.redo();
  }
});

updateChrome();
