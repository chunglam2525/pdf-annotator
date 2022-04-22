function SimpleStackException(msg) {
  this.message = msg;
  this.name = 'SimpleStackException';
}

function SimpleStack() {
  var MAX_ENTRIES = 2048;
  var self = this;
  self.sp = -1; // stack pointer
  self.entries = []; // stack heap

  self.push = function(newEntry) {
    if (self.sp > MAX_ENTRIES - 1) {
      throw new SimpleStackException('Can not push on a full stack.');
    }
    self.sp++;
    self.entries[self.sp] = newEntry;
    // make sure to clear the "future" stack after a push occurs
    self.entries.splice(self.sp + 1, self.entries.length);
  };

  self.pop = function() {
    if (self.sp < 0) {
      throw new SimpleStackException('Can not pop from an empty stack.');
    }
    var entry = self.entries[self.sp];
    self.sp--;
    return entry;
  };

  self.reversePop = function() {
    self.sp++;
    if (!self.entries[self.sp]) {
      self.sp--;
      throw new SimpleStackException('Can not reverse pop an entry that has never been created.');
    }
    return self.entries[self.sp];
  }
}

var lut = [];
for (var i = 0; i < 256; i++) {
  lut[i] = (i < 16 ? '0' : '') + (i).toString(16);
}

function generateUuid() {
  var d0 = Math.random() * 0xffffffff | 0;
  var d1 = Math.random() * 0xffffffff | 0;
  var d2 = Math.random() * 0xffffffff | 0;
  var d3 = Math.random() * 0xffffffff | 0;
  return lut[d0 & 0xff] + lut[d0 >> 8 & 0xff] + lut[d0 >> 16 & 0xff] + lut[d0 >> 24 & 0xff] + '-' +
    lut[d1 & 0xff] + lut[d1 >> 8 & 0xff] + '-' + lut[d1 >> 16 & 0x0f | 0x40] + lut[d1 >> 24 & 0xff] + '-' +
    lut[d2 & 0x3f | 0x80] + lut[d2 >> 8 & 0xff] + '-' + lut[d2 >> 16 & 0xff] + lut[d2 >> 24 & 0xff] +
    lut[d3 & 0xff] + lut[d3 >> 8 & 0xff] + lut[d3 >> 16 & 0xff] + lut[d3 >> 24 & 0xff];
}

fabric.Object.prototype.uuid = "";
fabric.Object.prototype.toObject = (function(toObject) {
  return function() {
    return fabric.util.object.extend(toObject.call(this), {
      uuid: this.uuid,
    });
  };
})(fabric.Object.prototype.toObject);

var PDFAnnotate = function (container_id, url, options = {}) {
  this.actionHistory = new SimpleStack();
  this.number_of_pages = 0;
  this.pages_rendered = 0;
  this.active_tool = 0; // 0 - Free hand, 1 - Pen, 2 - Text, 3 - Arrow, 4 - Rectangle
  this.fabricObjects = [];
  this.fabricObjectsData = [];
  this.color = '#212121';
  this.font_size = 16;
  this.active_canvas = 0;
  this.container_id = container_id;
  this.url = url;
  this.pageImageCompression = options.pageImageCompression ?
    options.pageImageCompression.toUpperCase() :
    'NONE';
  this.textBoxText = 'Sample Text';
  this.format;
  this.orientation;
  var inst = this;

  var loadingTask = pdfjsLib.getDocument(this.url);
  loadingTask.promise.then(
    function (pdf) {
      inst.number_of_pages = pdf.numPages;
      $('#'+inst.container_id).empty();
      $("#"+inst.container_id).css("display", "none");
      for (let i = 1; i <= pdf.numPages; i++) {
        pdf.getPage(i).then(function (page) {
          if (typeof inst.format === 'undefined' ||
            typeof inst.orientation === 'undefined') {
            var originalViewport = page.getViewport({ scale: 1 });
            inst.format = [originalViewport.width, originalViewport.height];
            inst.orientation =
              originalViewport.width > originalViewport.height ?
                'landscape' :
                'portrait';
          }

          var viewport = page.getViewport({ scale: options.scale ? options.scale : 1 });
          var canvas = document.createElement('canvas');
          document.getElementById(inst.container_id).appendChild(canvas);
          canvas.className = 'pdf-canvas';
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          context = canvas.getContext('2d');

          var renderContext = {
            canvasContext: context,
            viewport: viewport,
          };
          var renderTask = page.render(renderContext);
          renderTask.promise.then(function () {
            $('.pdf-canvas').each(function (index, el) {
              $(el).attr('id', 'page-' + (index + 1) + '-canvas');
            });
            inst.pages_rendered++;
            if (inst.pages_rendered == inst.number_of_pages) inst.initFabric();
          });
        });
      }
    },
    function (reason) {
      console.error(reason);
    }
  );

  this.initFabric = function () {
    var inst = this;
    let canvases = $('#' + inst.container_id + ' canvas');
    canvases.each(function (index, el) {
      var background = el.toDataURL('image/png');
      var fabricObj = new fabric.Canvas(el.id, {
        freeDrawingBrush: {
          width: 1,
          color: inst.color
        },
      });
      fabricObj.setZoom(options.scale ? options.scale : 1);
      inst.fabricObjects.push(fabricObj);
      if (typeof options.onPageUpdated == 'function') {
        fabricObj.on('object:added', function () {
          var oldValue = Object.assign({}, inst.fabricObjectsData[index]);
          inst.fabricObjectsData[index] = fabricObj.toJSON();
          options.onPageUpdated(
            index + 1,
            oldValue,
            inst.fabricObjectsData[index]
          );
        });
      }
      fabricObj.setBackgroundImage(
        background,
        fabricObj.renderAll.bind(fabricObj),
        {
          scaleX: options.scale ? 1/options.scale : 1,
          scaleY: options.scale ? 1/options.scale : 1
        }
      );
      $(fabricObj.upperCanvasEl).click(function (event) {
        inst.active_canvas = index;
        inst.fabricClickHandler(event, fabricObj);
      });
      fabricObj.on('after:render', function () {
        inst.fabricObjectsData[index] = fabricObj.toJSON();
        fabricObj.off('after:render');
      });

      // action history stack
      // TODO: IText: add/remove | Arrow: add | modify | unclear
      fabricObj.on('path:created', function(path) {
        var object = path.path;
        object.uuid = generateUuid();
        inst.actionHistory.push({
          type: 'object_added',
          pageIndex: index,
          object: JSON.stringify(object)
        });
      });
      fabricObj.on('object:added', function(e) {
        var object = e.target;
        if (object.type !== 'rect' && object.type !== 'image') {
          return;
        }
        // if the object has not been given an uuid, that means it is a fresh object created by this client
        if (!object.uuid) {
          object.uuid = generateUuid();
        }
        if (!object.bypassHistory) {
          inst.actionHistory.push({
            type: 'object_added',
            pageIndex: index,
            object: JSON.stringify(object)
          });
        }
      });
      fabricObj.on('object:removed', function(e) {
        var object = e.target;
        if (!object.bypassHistory) {
          inst.actionHistory.push({
            type: 'object_removed',
            pageIndex: index,
            object: JSON.stringify(object)
          });
        }
      });
      // end of action history stack

      if (index === canvases.length - 1 && typeof options.ready === 'function') {
        $("#"+inst.container_id).css("display", "block");
        options.ready();
      }
    });
  };

  this.fabricClickHandler = function (event, fabricObj) {
    var inst = this;
    var toolObj;
    if (inst.active_tool == 2) {
      toolObj = new fabric.IText(inst.textBoxText, {
        left: event.clientX - fabricObj.upperCanvasEl.getBoundingClientRect().left,
        top: event.clientY - fabricObj.upperCanvasEl.getBoundingClientRect().top,
        fill: inst.color,
        fontSize: inst.font_size,
        selectable: true
      });
    } else if (inst.active_tool == 4) {
      toolObj = new fabric.Rect({
        left: event.clientX - fabricObj.upperCanvasEl.getBoundingClientRect().left,
        top: event.clientY - fabricObj.upperCanvasEl.getBoundingClientRect().top,
        width: 100,
        height: 100,
        fill: inst.color
      });
    }

    if (toolObj) {
      fabricObj.add(toolObj);
      fabricObj.setActiveObject(toolObj);
      if (inst.active_tool == 2) toolObj.enterEditing();
      inst.active_tool = 0;
      $('.tool-button').first().find('i').click();
    }
  };

  this.getFabricObjectByUuid = function (canvas, uuid) {
    var fabricObject = null;
    canvas.getObjects().forEach(function(object) {
      if (object.uuid === uuid) {
        fabricObject = object;
      }
    });
    return fabricObject;
  };
};

PDFAnnotate.prototype.enableSelector = function () {
  var inst = this;
  inst.active_tool = 0;
  if (inst.fabricObjects.length > 0) {
    $.each(inst.fabricObjects, function (index, fabricObj) {
      fabricObj.isDrawingMode = false;
    });
  }
};

PDFAnnotate.prototype.enablePencil = function () {
  var inst = this;
  inst.active_tool = 1;
  if (inst.fabricObjects.length > 0) {
    $.each(inst.fabricObjects, function (index, fabricObj) {
      fabricObj.isDrawingMode = true;
    });
  }
};

PDFAnnotate.prototype.enableAddText = function () {
  var inst = this;
  inst.active_tool = 2;
  if (inst.fabricObjects.length > 0) {
    $.each(inst.fabricObjects, function (index, fabricObj) {
      fabricObj.isDrawingMode = false;
    });
  }
};

PDFAnnotate.prototype.enableRectangle = function () {
  var inst = this;
  var fabricObj = inst.fabricObjects[inst.active_canvas];
  inst.active_tool = 4;
  if (inst.fabricObjects.length > 0) {
    $.each(inst.fabricObjects, function (index, fabricObj) {
      fabricObj.isDrawingMode = false;
    });
  }
};

PDFAnnotate.prototype.enableAddArrow = function (onDrawnCallback = null) {
  var inst = this;
  inst.active_tool = 3;
  if (inst.fabricObjects.length > 0) {
    $.each(inst.fabricObjects, function (index, fabricObj) {
      fabricObj.isDrawingMode = false;
      new Arrow(fabricObj, inst.color, function () {
        inst.active_tool = 0;
        if (typeof onDrawnCallback === 'function') {
          onDrawnCallback();
        }
      });
    });
  }
};

PDFAnnotate.prototype.addImageToCanvas = function () {
  var inst = this;
  var fabricObj = inst.fabricObjects[inst.active_canvas];

  if (fabricObj) {
    var inputElement = document.createElement('input');
    inputElement.type = 'file';
    inputElement.accept = '.jpg,.jpeg,.png,.PNG,.JPG,.JPEG';
    inputElement.onchange = function () {
      var reader = new FileReader();
      reader.addEventListener(
        'load',
        function () {
          inputElement.remove();
          var image = new Image();
          image.onload = function () {
            fabricObj.add(new fabric.Image(image));
          };
          image.src = this.result;
        },
        false
      );
      reader.readAsDataURL(inputElement.files[0]);
    };
    document.getElementsByTagName('body')[0].appendChild(inputElement);
    inputElement.click();
  }
};

PDFAnnotate.prototype.undo = function () {
  var inst = this;
  var action, fabricObj, objectCandidate;
  try {
    action = inst.actionHistory.pop();
    fabricObj = inst.fabricObjects[action.pageIndex];
  } catch (e) {
    console.log(e.message);
    return;
  }
  if (action.type === 'object_added') {
    objectCandidate = JSON.parse(action.object);
    var object = inst.getFabricObjectByUuid(fabricObj, objectCandidate.uuid);
    object.bypassHistory = true;
    fabricObj.remove(object);
  } else if (action.type === 'object_removed') {
    objectCandidate = JSON.parse(action.object);
    fabric.util.enlivenObjects([objectCandidate], function(actualObjects) {
      actualObjects[0].uuid = objectCandidate.uuid;
      var object = actualObjects[0];
      object.bypassHistory = true;
      fabricObj.add(object);
      object.bypassHistory = false;
    });
  }
};

PDFAnnotate.prototype.redo = function () {
  var inst = this;
  var action, fabricObj, objectCandidate;
  try {
    action = inst.actionHistory.reversePop();
    fabricObj = inst.fabricObjects[action.pageIndex];
  } catch (e) {
    console.log(e.message);
    return;
  }
  if (action.type === 'object_added') {
    objectCandidate = JSON.parse(action.object);
    fabric.util.enlivenObjects([objectCandidate], function(actualObjects) {
      actualObjects[0].uuid = objectCandidate.uuid;
      var object = actualObjects[0];
      object.bypassHistory = true;
      fabricObj.add(object);
      object.bypassHistory = false;
    });
  } else if (action.type === 'object_removed') {
    objectCandidate = JSON.parse(action.object);
    var object = inst.getFabricObjectByUuid(fabricObj, objectCandidate.uuid);
    object.bypassHistory = true;
    fabricObj.remove(object);
    object.bypassHistory = false;
  }
};

PDFAnnotate.prototype.deleteSelectedObject = function () {
  var inst = this;
  var activeObject = inst.fabricObjects[inst.active_canvas].getActiveObject();
  if (activeObject) {
    if (confirm('Are you sure ?')) {
      inst.fabricObjects[inst.active_canvas].remove(activeObject);
    }
  }
};

PDFAnnotate.prototype.savePdf = function (fileName) {
  var inst = this;
  var format = inst.format || 'a4';
  var orientation = inst.orientation || 'portrait';
  if (!inst.fabricObjects.length) return;
  var doc = new jspdf.jsPDF({ format, orientation });
  if (typeof fileName === 'undefined') {
    fileName = `${new Date().getTime()}.pdf`;
  }

  inst.fabricObjects.forEach(function (fabricObj, index) {
    if (index != 0) {
      doc.addPage(format, orientation);
      doc.setPage(index + 1);
    }
    doc.addImage(
      fabricObj.toDataURL({
        format: 'png',
      }),
      inst.pageImageCompression == 'NONE' ? 'PNG' : 'JPEG',
      0,
      0,
      doc.internal.pageSize.getWidth(),
      doc.internal.pageSize.getHeight(),
      `page-${index + 1}`,
      ['FAST', 'MEDIUM', 'SLOW'].indexOf(inst.pageImageCompression) >= 0 ?
        inst.pageImageCompression :
        undefined
    );
    if (index === inst.fabricObjects.length - 1) {
      doc.save(fileName);
    }
  });
};

PDFAnnotate.prototype.setBrushSize = function (size) {
  var inst = this;
  $.each(inst.fabricObjects, function (index, fabricObj) {
    fabricObj.freeDrawingBrush.width = parseInt(size, 10) || 1;
  });
};

PDFAnnotate.prototype.setColor = function (color) {
  var inst = this;
  inst.color = color;
  $.each(inst.fabricObjects, function (index, fabricObj) {
    fabricObj.freeDrawingBrush.color = color;
  });
};

PDFAnnotate.prototype.setFontSize = function (size) {
  this.font_size = size;
};

PDFAnnotate.prototype.clearActivePage = function () {
  var inst = this;
  var fabricObj = inst.fabricObjects[inst.active_canvas];
  var bg = fabricObj.backgroundImage;
  if (confirm('Are you sure?')) {
    fabricObj.clear();
    fabricObj.setBackgroundImage(bg, fabricObj.renderAll.bind(fabricObj));
    inst.actionHistory = new SimpleStack();
  }
};

PDFAnnotate.prototype.serializePdf = function (callback) {
  var inst = this;
  var pageAnnotations = [];
  inst.fabricObjects.forEach(function (fabricObject) {
    fabricObject.clone(function (fabricObjectCopy) {
      fabricObjectCopy.setBackgroundImage(null);
      fabricObjectCopy.setBackgroundColor('');
      pageAnnotations.push(fabricObjectCopy);
      if (pageAnnotations.length === inst.fabricObjects.length) {
        var data = {
          page_setup: {
            format: inst.format,
            orientation: inst.orientation,
          },
          pages: pageAnnotations,
        };
        callback(JSON.stringify(data));
      }
    });
  });
};

PDFAnnotate.prototype.loadFromJSON = function (jsonData) {
  var inst = this;
  var { page_setup, pages } = jsonData;
  if (typeof pages === 'undefined') {
    pages = jsonData;
  }
  if (
    typeof page_setup === 'object' &&
    typeof page_setup.format === 'string' &&
    typeof page_setup.orientation === 'string'
  ) {
    inst.format = page_setup.format;
    inst.orientation = page_setup.orientation;
  }
  $.each(inst.fabricObjects, function (index, fabricObj) {
    if (pages.length > index) {
      fabricObj.loadFromJSON(pages[index], function () {
        inst.fabricObjectsData[index] = fabricObj.toJSON();
      });
    }
  });
};

PDFAnnotate.prototype.setDefaultTextForTextBox = function (text) {
  var inst = this;
  if (typeof text === 'string') {
    inst.textBoxText = text;
  }
};
