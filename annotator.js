// Classic script (not a module) so this file loads from file:// without a server.
(function () {
'use strict';

const pdfjsLib = window.pdfjsLib;
const parseAnnotationJson = window.parseAnnotationJson;
const validateAnnotationData = window.validateAnnotationData;

const DEFAULT_PAGE_SIZE = { width: 612, height: 792 };

function getFabric() {
  const fabric = window.fabric;
  if (!fabric) {
    throw new Error('Fabric.js failed to load');
  }
  registerLineArrow(fabric);
  return fabric;
}

function registerLineArrow(fabric) {
  if (fabric.LineArrow) {
    return;
  }

  class LineArrow extends fabric.Line {
    static type = 'lineArrow';

    constructor(points, options = {}) {
      super(points, { objectCaching: false, ...options });
    }

    _render(ctx) {
      super._render(ctx);
      if (!this.visible) {
        return;
      }
      const dx = this.x2 - this.x1;
      const dy = this.y2 - this.y1;
      if (dx === 0 && dy === 0) {
        return;
      }

      const angle = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(dx / 2, dy / 2);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-20, 15);
      ctx.lineTo(-20, -15);
      ctx.closePath();
      ctx.fillStyle = this.stroke;
      ctx.fill();
      ctx.restore();
    }

    static fromObject(object) {
      const { x1, y1, x2, y2, ...rest } = object;
      return Promise.resolve(new this([x1, y1, x2, y2], rest));
    }
  }

  fabric.LineArrow = LineArrow;
  fabric.classRegistry.setClass(LineArrow);
  fabric.classRegistry.setClass(LineArrow, 'lineArrow');
}

function pointerFromEvent(canvas, event) {
  if (event?.scenePoint) {
    return event.scenePoint;
  }
  if (typeof canvas.getScenePoint === 'function') {
    return canvas.getScenePoint(event.e);
  }
  return canvas.getPointer(event.e);
}

function typeOf(object) {
  return String(object?.type || '').toLowerCase().replace(/-/g, '');
}

function isType(object, ...names) {
  const type = typeOf(object);
  return names.some((name) => type === String(name).toLowerCase().replace(/-/g, ''));
}

function newId() {
  return crypto.randomUUID();
}

function getPdfLib() {
  const lib = window.PDFLib;
  if (!lib?.PDFDocument) {
    throw new Error('pdf-lib failed to load');
  }
  return lib;
}

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const binary = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function downloadBytes(bytes, fileName, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function stampOverlay(page, image, viewWidth, viewHeight, degrees) {
  const angle = (((page.getRotation().angle % 360) + 360) % 360);
  const { width, height } = page.getSize();
  if (angle === 90) {
    page.drawImage(image, {
      x: width,
      y: 0,
      width: viewWidth,
      height: viewHeight,
      rotate: degrees(90),
    });
    return;
  }
  if (angle === 180) {
    page.drawImage(image, {
      x: width,
      y: height,
      width: viewWidth,
      height: viewHeight,
      rotate: degrees(180),
    });
    return;
  }
  if (angle === 270) {
    page.drawImage(image, {
      x: 0,
      y: height,
      width: viewWidth,
      height: viewHeight,
      rotate: degrees(270),
    });
    return;
  }
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: viewWidth,
    height: viewHeight,
  });
}

function toObjectJson(object) {
  return object.toObject(['uuid']);
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function multiplyTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

async function fillTextLayer(page, container, viewport) {
  const textContent = await page.getTextContent();
  container.replaceChildren();
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;

  const spans = [];
  for (const item of textContent.items) {
    if (!item.str) {
      continue;
    }
    const tx = multiplyTransform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (!fontHeight) {
      continue;
    }
    const span = document.createElement('span');
    span.textContent = item.str;
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    container.appendChild(span);
    spans.push({ span, width: item.width });
  }

  for (const { span, width } of spans) {
    if (span.offsetWidth > 0 && width > 0) {
      span.style.transform = `scaleX(${width / span.offsetWidth})`;
    }
  }
}

async function enliven(json) {
  const fabric = getFabric();
  const Klass = fabric.classRegistry.getClass(json.type);
  const object = await Klass.fromObject(json);
  object.uuid = json.uuid;
  return object;
}

class PdfAnnotator {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.options = options;
    this.scale = options.scale || 1;
    this.renderScale = options.renderScale || Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));
    this.color = options.color || 'rgba(33, 33, 33, 1)';
    this.brushSize = options.brushSize || 2;
    this.fontSize = options.fontSize || 16;
    this.tool = 'select';
    this.source = null;
    this.sourceBytes = null;
    this.fileName = '';
    this.activePage = 0;
    this.format = null;
    this.orientation = 'portrait';
    this.canvases = [];
    this.pageImages = [];
    this.pageSizes = [];
    this.pageShells = [];
    this.pageHosts = [];
    this.pageBlank = [];
    this.history = [];
    this.historyIndex = -1;
    this.ignoreHistory = false;
    this.draft = null;
    document.addEventListener('mouseup', () => {
      if (this.tool === 'highlight') {
        window.requestAnimationFrame(() => this.highlightSelection());
      }
    });
  }

  get isReady() {
    return this.canvases.length > 0;
  }

  get pageCount() {
    return this.canvases.length;
  }

  get canUndo() {
    return this.historyIndex >= 0;
  }

  get canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  async load(source, annotations = null, { preserveHistory = false } = {}) {
    getFabric();
    this.disposeCanvases();
    if (!preserveHistory) {
      this.resetHistory();
    }

    this.source = await this.normalizeSource(source);
    this.fileName = this.nameFromSource(source);
    this.sourceBytes = await this.bytesFromSource(this.source);
    this.source = { data: this.sourceBytes.slice() };
    this.activePage = 0;

    const pdf = await pdfjsLib.getDocument(this.source).promise;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      if (pageNumber === 1) {
        this.format = [unscaled.width, unscaled.height];
        this.orientation = unscaled.width > unscaled.height ? 'landscape' : 'portrait';
      }

      const renderViewport = page.getViewport({ scale: this.renderScale });
      const element = document.createElement('canvas');
      element.width = renderViewport.width;
      element.height = renderViewport.height;
      const context = element.getContext('2d');
      const renderTask = page.render({
        canvas: element,
        canvasContext: context,
        viewport: renderViewport,
      });
      await (renderTask.promise ?? renderTask);

      await this.mountPage(
        {
          width: unscaled.width,
          height: unscaled.height,
          pageImage: element.toDataURL('image/png'),
          atIndex: pageNumber - 1,
          element,
          fillText: (textLayer) => fillTextLayer(page, textLayer, page.getViewport({ scale: 1 })),
        },
        { syncSlots: false }
      );
    }

    this.syncInsertSlots();
    this.setTool(this.tool, { keepSelection: true, silent: true });

    if (annotations) {
      await this.importAnnotations(annotations, { resetHistory: false });
    }

    this.options.onReady?.();
  }

  setZoom(scale) {
    if (!this.isReady || scale === this.scale) {
      return;
    }
    this.scale = scale;
    this.canvases.forEach((canvas, index) => {
      const { width, height } = this.pageSizes[index];
      canvas.setDimensions({
        width: width * scale,
        height: height * scale,
      });
      canvas.setZoom(scale);
      canvas.requestRenderAll();
      this.layoutShell(this.pageShells[index], width, height);
    });
  }

  setTool(name, { keepSelection = false, silent = false } = {}) {
    this.tool = name;
    this.cancelDraft();

    const selectingText = name === 'highlight';
    for (const canvas of this.canvases) {
      canvas.isDrawingMode = name === 'pencil';
      canvas.selection = name === 'select';
      canvas.skipTargetFind = name !== 'select';
      canvas.defaultCursor = name === 'select' ? 'default' : 'crosshair';
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.color = this.color;
        canvas.freeDrawingBrush.width = this.brushSize;
      }
      if (!keepSelection) {
        canvas.discardActiveObject();
      }
      canvas.requestRenderAll();
    }
    for (const shell of this.pageShells) {
      shell.classList.toggle('text-selectable', selectingText);
    }
    if (!selectingText) {
      window.getSelection()?.removeAllRanges();
    }

    if (!silent) {
      this.options.onToolChange?.(name);
    }
  }

  setColor(color) {
    this.color = color;
    for (const canvas of this.canvases) {
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.color = color;
      }
      const object = canvas.getActiveObject();
      if (object && !isType(object, 'image', 'activeSelection')) {
        this.recolor(object, color);
        canvas.requestRenderAll();
      }
    }
  }

  setBrushSize(size) {
    this.brushSize = Number(size) || 1;
    for (const canvas of this.canvases) {
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.width = this.brushSize;
      }
    }
  }

  setFontSize(size) {
    this.fontSize = Number(size) || 16;
    const canvas = this.activeCanvas();
    const object = canvas?.getActiveObject();
    if (object && isType(object, 'i-text', 'text')) {
      object.set('fontSize', this.fontSize);
      canvas.requestRenderAll();
    }
  }

  async undo() {
    if (!this.canUndo) {
      return;
    }
    const entry = this.history[this.historyIndex];
    this.historyIndex -= 1;
    await this.applyHistory(entry, 'undo');
    this.options.onHistoryChange?.();
  }

  async redo() {
    if (!this.canRedo) {
      return;
    }
    this.historyIndex += 1;
    const entry = this.history[this.historyIndex];
    await this.applyHistory(entry, 'redo');
    this.options.onHistoryChange?.();
  }

  deleteSelected() {
    const canvas = this.activeCanvas();
    if (!canvas) {
      return;
    }
    const object = canvas.getActiveObject();
    if (!object) {
      return;
    }
    if (isType(object, 'activeSelection')) {
      object.forEachObject((child) => canvas.remove(child));
      canvas.discardActiveObject();
    } else {
      canvas.remove(object);
    }
    canvas.requestRenderAll();
  }

  clearPage() {
    const canvas = this.activeCanvas();
    if (!canvas || canvas.getObjects().length === 0) {
      return;
    }
    const objects = canvas.getObjects().map((object) => toObjectJson(object));
    this.ignoreHistory = true;
    canvas.getObjects().slice().forEach((object) => canvas.remove(object));
    this.ignoreHistory = false;
    this.pushHistory({
      type: 'clear',
      pageIndex: this.activePage,
      objects,
    });
    canvas.requestRenderAll();
  }

  addImage() {
    const canvas = this.activeCanvas();
    if (!canvas) {
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/webp';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', async () => {
        const fabric = getFabric();
        const image = await fabric.Image.fromURL(reader.result);
        image.set({ originX: 'left', originY: 'top' });
        const maxWidth = (this.pageSizes[this.activePage]?.width || canvas.getWidth() / this.scale) * 0.5;
        if (image.width > maxWidth) {
          image.scaleToWidth(maxWidth);
        }
        canvas.add(image);
        canvas.setActiveObject(image);
        canvas.requestRenderAll();
      });
      reader.readAsDataURL(file);
    });
    input.click();
  }

  async addBlankPage(index = this.pageCount) {
    if (!this.container) {
      throw new Error('Annotator container is missing.');
    }

    const atIndex = Math.trunc(Number(index));
    if (!Number.isFinite(atIndex) || atIndex < 0 || atIndex > this.pageCount) {
      throw new Error(`Page index must be between 0 and ${this.pageCount}.`);
    }

    if (!this.format) {
      this.format = [DEFAULT_PAGE_SIZE.width, DEFAULT_PAGE_SIZE.height];
      this.orientation = 'portrait';
      this.fileName = this.fileName || 'untitled.pdf';
    }

    const neighbor = this.pageSizes[Math.min(atIndex, this.pageSizes.length - 1)] || {
      width: this.format[0],
      height: this.format[1],
    };
    const width = neighbor.width;
    const height = neighbor.height;

    await this.mountPage({
      width,
      height,
      pageImage: this.createBlankPageImage(width, height),
      atIndex,
      blank: true,
    });

    this.activePage = atIndex;
    this.shiftHistoryPageIndices(atIndex, 1);
    this.pageHosts[atIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.options.onPagesChange?.();
    return atIndex;
  }

  isBlankPage(index) {
    return Boolean(this.pageBlank[index]);
  }

  removeBlankPage(index) {
    const atIndex = Math.trunc(Number(index));
    if (!Number.isFinite(atIndex) || atIndex < 0 || atIndex >= this.pageCount) {
      throw new Error('That page does not exist.');
    }
    if (!this.isBlankPage(atIndex)) {
      throw new Error('Only added blank pages can be removed.');
    }

    this.cancelDraft();
    const canvas = this.canvases[atIndex];
    const host = this.pageHosts[atIndex];
    canvas?.dispose();
    host?.remove();

    this.canvases.splice(atIndex, 1);
    this.pageImages.splice(atIndex, 1);
    this.pageSizes.splice(atIndex, 1);
    this.pageShells.splice(atIndex, 1);
    this.pageHosts.splice(atIndex, 1);
    this.pageBlank.splice(atIndex, 1);
    this.resetHistory();

    if (this.pageCount === 0) {
      this.container.replaceChildren();
      this.format = null;
      this.orientation = 'portrait';
      this.fileName = '';
      this.source = null;
      this.sourceBytes = null;
      this.activePage = 0;
    } else {
      this.activePage = Math.min(atIndex, this.pageCount - 1);
      this.reindexPages();
      this.syncInsertSlots();
      this.setTool(this.tool, { keepSelection: true, silent: true });
    }

    this.options.onPagesChange?.();
    return atIndex;
  }

  serialize() {
    return {
      page_setup: {
        format: this.format,
        orientation: this.orientation,
      },
      pages: this.canvases.map((canvas) => {
        const json = canvas.toObject(['uuid']);
        json.backgroundImage = null;
        json.background = '';
        return json;
      }),
    };
  }

  validateAnnotations(input) {
    return validateAnnotationData(parseAnnotationJson(input), {
      pageCount: this.isReady ? this.pageCount : undefined,
    });
  }

  async importAnnotations(input, { resetHistory = true } = {}) {
    if (!this.isReady) {
      throw new Error('Open a PDF or add a blank page before importing annotations.');
    }
    const valid = this.validateAnnotations(input);
    await this.loadAnnotations(valid);
    if (resetHistory) {
      this.resetHistory();
    }
    this.options.onHistoryChange?.();
    return valid;
  }

  async loadAnnotations(data) {
    const pages = data.pages ?? data;
    this.ignoreHistory = true;
    await Promise.all(
      this.canvases.map((canvas, index) => {
        if (!pages[index]) {
          return Promise.resolve();
        }
        return canvas.loadFromJSON(pages[index]).then(async () => {
          canvas.setZoom(this.scale);
          await this.applyBackground(canvas, index);
          canvas.requestRenderAll();
        });
      })
    );
    this.ignoreHistory = false;
  }

  async savePdf(fileName = this.fileName || 'annotated.pdf') {
    if (!this.canvases.length || !this.format) {
      return;
    }

    const { PDFDocument, degrees } = getPdfLib();
    const exportName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    const sourceDoc = this.sourceBytes
      ? await PDFDocument.load(this.sourceBytes, { ignoreEncryption: true })
      : null;
    const outDoc = await PDFDocument.create();

    if (sourceDoc) {
      const title = sourceDoc.getTitle();
      if (title) {
        outDoc.setTitle(title);
      }
    }

    let sourceIndex = 0;
    for (let index = 0; index < this.pageCount; index += 1) {
      const { width, height } = this.pageSizes[index];
      let page;
      if (this.pageBlank[index] || !sourceDoc) {
        page = outDoc.addPage([width, height]);
      } else {
        const [copied] = await outDoc.copyPages(sourceDoc, [sourceIndex]);
        page = outDoc.addPage(copied);
        sourceIndex += 1;
      }

      const overlay = this.annotationPng(index);
      if (overlay) {
        const image = await outDoc.embedPng(dataUrlToBytes(overlay));
        stampOverlay(page, image, width, height, degrees);
      }
    }

    const bytes = await outDoc.save();
    downloadBytes(bytes, exportName, 'application/pdf');
  }

  annotationPng(index) {
    const canvas = this.canvases[index];
    if (!canvas || canvas.getObjects().length === 0) {
      return null;
    }

    const backgroundImage = canvas.backgroundImage;
    const backgroundColor = canvas.backgroundColor;
    canvas.backgroundImage = null;
    canvas.backgroundColor = '';
    canvas.renderAll();
    const dataUrl = canvas.toDataURL({
      format: 'png',
      multiplier: this.renderScale / this.scale,
      enableRetinaScaling: false,
    });
    canvas.backgroundImage = backgroundImage;
    canvas.backgroundColor = backgroundColor;
    canvas.requestRenderAll();
    return dataUrl;
  }

  isEditingText() {
    return this.canvases.some((canvas) => canvas.getActiveObject()?.isEditing);
  }

  activeCanvas() {
    return this.canvases[this.activePage] || null;
  }

  disposeCanvases() {
    for (const canvas of this.canvases) {
      canvas.dispose();
    }
    this.canvases = [];
    this.pageImages = [];
    this.pageSizes = [];
    this.pageShells = [];
    this.pageHosts = [];
    this.pageBlank = [];
    this.draft = null;
    this.container.replaceChildren();
  }

  async bytesFromSource(source) {
    if (source?.data instanceof Uint8Array) {
      return source.data.slice();
    }
    if (source?.data instanceof ArrayBuffer) {
      return new Uint8Array(source.data.slice(0));
    }
    if (source?.url || typeof source === 'string') {
      const url = source.url || source;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Could not read the original PDF for saving.');
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error('Unsupported PDF source');
  }

  async normalizeSource(source) {
    if (typeof source === 'string' || (source && source.url) || (source && source.data)) {
      return typeof source === 'string' ? { url: source } : source;
    }
    if (source instanceof File) {
      return { data: new Uint8Array(await source.arrayBuffer()) };
    }
    if (source instanceof ArrayBuffer) {
      return { data: new Uint8Array(source) };
    }
    if (source instanceof Uint8Array) {
      return { data: source };
    }
    throw new Error('Unsupported PDF source');
  }

  nameFromSource(source) {
    if (source instanceof File) {
      return source.name;
    }
    if (typeof source === 'string') {
      try {
        return decodeURIComponent(source.split('/').pop() || 'document.pdf');
      } catch {
        return 'document.pdf';
      }
    }
    return this.fileName || 'document.pdf';
  }

  layoutShell(shell, pageWidth, pageHeight) {
    shell.style.width = `${pageWidth * this.scale}px`;
    shell.style.height = `${pageHeight * this.scale}px`;
    shell.style.setProperty('--page-zoom', String(this.scale));
  }

  createBlankPageImage(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * this.renderScale));
    canvas.height = Math.max(1, Math.round(height * this.renderScale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  async mountPage({ width, height, pageImage, atIndex, element, fillText, blank = false }, { syncSlots = true } = {}) {
    const fabric = getFabric();
    const canvasEl = element || document.createElement('canvas');
    if (!element) {
      canvasEl.width = Math.max(1, Math.round(width * this.renderScale));
      canvasEl.height = Math.max(1, Math.round(height * this.renderScale));
    }

    const shell = document.createElement('div');
    shell.className = 'page-shell';
    this.layoutShell(shell, width, height);
    shell.appendChild(canvasEl);

    const host = document.createElement('div');
    host.className = 'page-block';
    if (blank) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'page-remove-btn';
      remove.dataset.removeAt = String(atIndex);
      remove.textContent = 'Remove blank page';
      remove.title = 'Remove this added blank page';
      host.appendChild(remove);
    }
    host.appendChild(shell);

    const nextHost = this.pageHosts[atIndex];
    if (nextHost) {
      this.container.insertBefore(host, nextHost);
    } else {
      this.container.appendChild(host);
    }

    this.pageImages.splice(atIndex, 0, pageImage);
    this.pageSizes.splice(atIndex, 0, { width, height });
    this.pageShells.splice(atIndex, 0, shell);
    this.pageHosts.splice(atIndex, 0, host);
    this.pageBlank.splice(atIndex, 0, Boolean(blank));

    const canvas = new fabric.Canvas(canvasEl, {
      selection: this.tool === 'select',
      preserveObjectStacking: true,
    });
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = this.color;
    canvas.freeDrawingBrush.width = this.brushSize;
    canvas.setDimensions({
      width: width * this.scale,
      height: height * this.scale,
    });
    canvas.setZoom(this.scale);
    this.canvases.splice(atIndex, 0, canvas);
    await this.applyBackground(canvas, atIndex);
    this.bindCanvas(canvas);

    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    textLayer.style.width = `${width}px`;
    textLayer.style.height = `${height}px`;
    shell.appendChild(textLayer);
    if (fillText) {
      await fillText(textLayer);
    }

    this.reindexPages();
    if (syncSlots) {
      this.syncInsertSlots();
      this.setTool(this.tool, { keepSelection: true, silent: true });
    }
  }

  reindexPages() {
    this.pageShells.forEach((shell, index) => {
      shell.dataset.pageIndex = String(index);
      const canvas = shell.querySelector('canvas');
      if (canvas) {
        canvas.id = `page-${index + 1}`;
      }
      const remove = this.pageHosts[index]?.querySelector('[data-remove-at]');
      if (remove) {
        remove.dataset.removeAt = String(index);
      }
    });
  }

  syncInsertSlots() {
    for (const slot of this.container.querySelectorAll('.page-insert')) {
      slot.remove();
    }

    const count = this.pageShells.length;
    for (let index = 0; index <= count; index += 1) {
      const slot = document.createElement('div');
      slot.className = 'page-insert';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page-insert-btn';
      button.dataset.insertAt = String(index);
      if (index === 0) {
        button.textContent = 'Add blank page at start';
        button.title = 'Insert a blank page before page 1';
      } else if (index === count) {
        button.textContent = 'Add blank page at end';
        button.title = `Insert a blank page after page ${count}`;
      } else {
        button.textContent = `Add blank page after ${index}`;
        button.title = `Insert a blank page between page ${index} and page ${index + 1}`;
      }
      slot.appendChild(button);
      const before = this.pageHosts[index];
      if (before) {
        this.container.insertBefore(slot, before);
      } else {
        this.container.appendChild(slot);
      }
    }
  }

  indexOfCanvas(canvas) {
    return this.canvases.indexOf(canvas);
  }

  shiftHistoryPageIndices(fromIndex, delta) {
    for (const entry of this.history) {
      if (entry.pageIndex >= fromIndex) {
        entry.pageIndex += delta;
      }
    }
  }

  highlightColor() {
    const match = String(this.color).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, 0.35)`;
    }
    return 'rgba(255, 214, 0, 0.35)';
  }

  highlightSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const root = range.commonAncestorContainer;
    const fromNode = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
    const shell = fromNode?.closest('.page-shell');
    if (!shell || !this.container.contains(shell)) {
      return;
    }

    const pageIndex = Number(shell.dataset.pageIndex);
    const canvas = this.canvases[pageIndex];
    if (!canvas) {
      return;
    }

    const bounds = canvas.upperCanvasEl.getBoundingClientRect();
    const fabric = getFabric();
    const fill = this.highlightColor();
    const added = [];

    this.ignoreHistory = true;
    for (const rect of range.getClientRects()) {
      if (rect.width < 2 || rect.height < 2) {
        continue;
      }
      if (rect.bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right) {
        continue;
      }
      const object = new fabric.Rect({
        left: (rect.left - bounds.left) / this.scale,
        top: (rect.top - bounds.top) / this.scale,
        originX: 'left',
        originY: 'top',
        width: rect.width / this.scale,
        height: rect.height / this.scale,
        fill,
        selectable: true,
        rx: 1,
        ry: 1,
      });
      object.uuid = newId();
      canvas.add(object);
      canvas.sendObjectToBack(object);
      added.push(object);
    }
    this.ignoreHistory = false;
    selection.removeAllRanges();

    if (added.length) {
      this.activePage = pageIndex;
      this.pushHistory({
        type: 'addGroup',
        pageIndex,
        objects: added.map((object) => toObjectJson(object)),
      });
      canvas.requestRenderAll();
    }
  }

  async applyBackground(canvas, index) {
    const fabric = getFabric();
    const image = await fabric.Image.fromURL(this.pageImages[index]);
    image.set({
      originX: 'left',
      originY: 'top',
      scaleX: 1 / this.renderScale,
      scaleY: 1 / this.renderScale,
      selectable: false,
      evented: false,
    });
    canvas.backgroundImage = image;
    canvas.requestRenderAll();
  }

  bindCanvas(canvas) {
    canvas.on('mouse:down', (event) => {
      const pageIndex = this.indexOfCanvas(canvas);
      if (pageIndex < 0) {
        return;
      }
      this.activePage = pageIndex;
      this.onMouseDown(canvas, pageIndex, event);
    });
    canvas.on('mouse:move', (event) => this.onMouseMove(canvas, event));
    canvas.on('mouse:up', () => {
      const pageIndex = this.indexOfCanvas(canvas);
      if (pageIndex >= 0) {
        this.onMouseUp(canvas, pageIndex);
      }
    });
    canvas.on('object:added', (event) => {
      const pageIndex = this.indexOfCanvas(canvas);
      if (pageIndex >= 0) {
        this.recordAdd(pageIndex, event.target);
      }
    });
    canvas.on('object:removed', (event) => {
      const pageIndex = this.indexOfCanvas(canvas);
      if (pageIndex >= 0) {
        this.recordRemove(pageIndex, event.target);
      }
    });
  }

  onMouseDown(canvas, pageIndex, event) {
    if (event.target && this.tool === 'select') {
      return;
    }

    const pointer = pointerFromEvent(canvas, event);

    if (this.tool === 'text') {
      const text = new (getFabric().IText)('Text', {
        left: pointer.x,
        top: pointer.y,
        originX: 'left',
        originY: 'top',
        fill: this.color,
        fontSize: this.fontSize,
        selectable: true,
      });
      canvas.add(text);
      canvas.setActiveObject(text);
      text.enterEditing();
      text.selectAll();
      this.setTool('select', { keepSelection: true });
      return;
    }

    if (this.tool === 'arrow') {
      const line = new (getFabric().LineArrow)([pointer.x, pointer.y, pointer.x, pointer.y], {
        strokeWidth: Math.max(2, this.brushSize),
        fill: this.color,
        stroke: this.color,
        originX: 'center',
        originY: 'center',
        selectable: true,
        objectCaching: false,
        _draft: true,
      });
      canvas.add(line);
      canvas.setActiveObject(line);
      this.draft = { canvas, pageIndex, object: line, kind: 'arrow', x: pointer.x, y: pointer.y };
      return;
    }

    if (this.tool === 'rect') {
      const rect = new (getFabric().Rect)({
        left: pointer.x,
        top: pointer.y,
        originX: 'left',
        originY: 'top',
        width: 0,
        height: 0,
        fill: this.color,
        selectable: true,
        _draft: true,
      });
      canvas.add(rect);
      canvas.setActiveObject(rect);
      this.draft = { canvas, pageIndex, object: rect, kind: 'rect', x: pointer.x, y: pointer.y };
    }
  }

  onMouseMove(canvas, event) {
    if (!this.draft || this.draft.canvas !== canvas) {
      return;
    }

    const pointer = pointerFromEvent(canvas, event);
    const { object, kind, x, y } = this.draft;

    if (kind === 'arrow') {
      object.set({ x2: pointer.x, y2: pointer.y });
    } else if (kind === 'rect') {
      object.set({
        left: Math.min(x, pointer.x),
        top: Math.min(y, pointer.y),
        width: Math.abs(pointer.x - x),
        height: Math.abs(pointer.y - y),
      });
    }

    object.setCoords();
    canvas.requestRenderAll();
  }

  onMouseUp(canvas, pageIndex) {
    if (!this.draft || this.draft.canvas !== canvas) {
      return;
    }

    const { object, kind } = this.draft;
    const tooSmall =
      kind === 'arrow'
        ? distance(object.x1, object.y1, object.x2, object.y2) < 8
        : object.width < 4 && object.height < 4;

    this.ignoreHistory = true;
    if (tooSmall) {
      canvas.remove(object);
      this.draft = null;
      this.ignoreHistory = false;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      return;
    }

    object._draft = false;
    if (!object.uuid) {
      object.uuid = newId();
    }
    this.ignoreHistory = false;
    this.pushHistory({
      type: 'add',
      pageIndex,
      objectJson: toObjectJson(object),
    });
    this.draft = null;
    this.setTool('select', { keepSelection: true });
  }

  cancelDraft() {
    if (!this.draft) {
      return;
    }
    const { canvas, object } = this.draft;
    this.ignoreHistory = true;
    canvas.remove(object);
    this.ignoreHistory = false;
    this.draft = null;
  }

  recordAdd(pageIndex, object) {
    if (!object || object._draft || this.ignoreHistory) {
      return;
    }
    if (!object.uuid) {
      object.uuid = newId();
    }
    this.pushHistory({
      type: 'add',
      pageIndex,
      objectJson: toObjectJson(object),
    });
  }

  recordRemove(pageIndex, object) {
    if (!object || object._draft || this.ignoreHistory) {
      return;
    }
    this.pushHistory({
      type: 'remove',
      pageIndex,
      objectJson: toObjectJson(object),
    });
  }

  pushHistory(entry) {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(entry);
    this.historyIndex = this.history.length - 1;
    this.options.onHistoryChange?.();
  }

  resetHistory() {
    this.history = [];
    this.historyIndex = -1;
    this.options.onHistoryChange?.();
  }

  async applyHistory(entry, direction) {
    const canvas = this.canvases[entry.pageIndex];
    if (!canvas) {
      return;
    }

    this.activePage = entry.pageIndex;
    this.ignoreHistory = true;
    const undo = direction === 'undo';

    if (entry.type === 'add') {
      if (undo) {
        this.removeByUuid(canvas, entry.objectJson.uuid);
      } else {
        await this.addFromJson(canvas, entry.objectJson);
      }
    } else if (entry.type === 'remove') {
      if (undo) {
        await this.addFromJson(canvas, entry.objectJson);
      } else {
        this.removeByUuid(canvas, entry.objectJson.uuid);
      }
    } else if (entry.type === 'addGroup') {
      if (undo) {
        for (const json of entry.objects) {
          this.removeByUuid(canvas, json.uuid);
        }
      } else {
        for (const json of entry.objects) {
          await this.addFromJson(canvas, json);
        }
      }
    } else if (entry.type === 'clear') {
      if (undo) {
        for (const json of entry.objects) {
          await this.addFromJson(canvas, json);
        }
      } else {
        for (const json of entry.objects) {
          this.removeByUuid(canvas, json.uuid);
        }
      }
    }

    this.ignoreHistory = false;
    canvas.requestRenderAll();
  }

  removeByUuid(canvas, uuid) {
    const object = canvas.getObjects().find((item) => item.uuid === uuid);
    if (object) {
      canvas.remove(object);
    }
  }

  async addFromJson(canvas, json) {
    const object = await enliven(json);
    canvas.add(object);
  }

  recolor(object, color) {
    if (isType(object, 'i-text', 'text', 'rect')) {
      object.set('fill', color);
      return;
    }
    object.set('stroke', color);
    if (isType(object, 'lineArrow')) {
      object.set('fill', color);
    }
  }
}

window.PdfAnnotator = PdfAnnotator;
})();
