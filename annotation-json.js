// Classic script (not a module) so this file loads from file:// without a server.
(function () {
'use strict';

class AnnotationJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnnotationJsonError';
  }
}

const KNOWN_OBJECT_TYPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'triangle',
  'image',
  'text',
  'itext',
  'textbox',
  'group',
  'linearrow',
  'activeselection',
]);

const MAX_OBJECTS = 20_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeType(type) {
  return String(type || '')
    .toLowerCase()
    .replace(/-/g, '');
}

function validateFabricObject(object, path, extraTypes, stats) {
  if (!isPlainObject(object)) {
    throw new AnnotationJsonError(`${path} must be an object.`);
  }
  if (typeof object.type !== 'string' || !object.type.trim()) {
    throw new AnnotationJsonError(`${path} is missing a type.`);
  }

  const type = normalizeType(object.type);
  if (!KNOWN_OBJECT_TYPES.has(type) && !extraTypes?.has(type)) {
    throw new AnnotationJsonError(`${path} has unsupported type "${object.type}".`);
  }

  stats.objects += 1;
  if (stats.objects > MAX_OBJECTS) {
    throw new AnnotationJsonError('JSON has too many objects.');
  }

  if ((type === 'group' || type === 'activeselection') && object.objects != null) {
    if (!Array.isArray(object.objects)) {
      throw new AnnotationJsonError(`${path}.objects must be an array.`);
    }
    object.objects.forEach((child, index) => {
      validateFabricObject(child, `${path}.objects[${index}]`, extraTypes, stats);
    });
  }
}

function parseAnnotationJson(input) {
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) {
      throw new AnnotationJsonError('JSON is empty.');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new AnnotationJsonError('JSON is not valid.');
    }
  }
  if (input == null || typeof input !== 'object') {
    throw new AnnotationJsonError('Annotation data must be a JSON object.');
  }
  return input;
}

function validateAnnotationData(data, { pageCount, extraTypes } = {}) {
  if (data == null) {
    throw new AnnotationJsonError('JSON is empty.');
  }

  let pageSetup = null;
  let pages;

  if (Array.isArray(data)) {
    pages = data;
  } else if (isPlainObject(data)) {
    if (Array.isArray(data.pages)) {
      pages = data.pages;
    } else if (Array.isArray(data.objects)) {
      pages = [data];
    } else if (data.pages != null) {
      throw new AnnotationJsonError('pages must be an array.');
    } else {
      throw new AnnotationJsonError('JSON must include a pages array.');
    }

    if (data.page_setup != null) {
      if (!isPlainObject(data.page_setup)) {
        throw new AnnotationJsonError('page_setup must be an object.');
      }
      const { format, orientation } = data.page_setup;
      if (format != null) {
        const validFormat =
          Array.isArray(format) &&
          format.length === 2 &&
          format.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
        if (!validFormat) {
          throw new AnnotationJsonError('page_setup.format must be [width, height] in positive numbers.');
        }
      }
      if (orientation != null && orientation !== 'portrait' && orientation !== 'landscape') {
        throw new AnnotationJsonError('page_setup.orientation must be "portrait" or "landscape".');
      }
      pageSetup = data.page_setup;
    }
  } else {
    throw new AnnotationJsonError('JSON must be an object or an array of pages.');
  }

  if (!Array.isArray(pages)) {
    throw new AnnotationJsonError('pages must be an array.');
  }
  if (pages.length === 0) {
    throw new AnnotationJsonError('pages must contain at least one page.');
  }
  if (pageCount != null && pages.length !== pageCount) {
    throw new AnnotationJsonError(
      `JSON has ${pages.length} page${pages.length === 1 ? '' : 's'} but the document has ${pageCount}.`
    );
  }

  const stats = { objects: 0 };
  pages.forEach((page, index) => {
    if (page == null) {
      throw new AnnotationJsonError(`pages[${index}] is empty.`);
    }
    if (!isPlainObject(page)) {
      throw new AnnotationJsonError(`pages[${index}] must be an object.`);
    }
    if (!Array.isArray(page.objects)) {
      throw new AnnotationJsonError(`pages[${index}] is missing an objects array.`);
    }
    page.objects.forEach((object, objectIndex) => {
      validateFabricObject(object, `pages[${index}].objects[${objectIndex}]`, extraTypes, stats);
    });
  });

  return {
    page_setup: pageSetup,
    pages,
  };
}

window.AnnotationJsonError = AnnotationJsonError;
window.parseAnnotationJson = parseAnnotationJson;
window.validateAnnotationData = validateAnnotationData;
})();
