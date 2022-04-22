var pdf;
var zoomScale = 1;
var outputJson = {};

function renderPDF() {
  pdf = new PDFAnnotate('pdf-container', 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf', {
    onPageUpdated(page, oldData, newData) {
      console.log(page, oldData, newData);
    },
    ready() {
      console.log('Plugin initialized successfully');
      pdf.loadFromJSON(outputJson);
    },
    scale: zoomScale,
    pageImageCompression: 'MEDIUM', // FAST, MEDIUM, SLOW(Helps to control the new PDF file size)
  });
}

function changeActiveTool(event) {
  var element = $(event.target).hasClass('tool-button')
    ? $(event.target)
    : $(event.target).parents('.tool-button').first();
  $('.tool-button.active').removeClass('active');
  $(element).addClass('active');
}

function enableSelector(event) {
  event.preventDefault();
  changeActiveTool(event);
  pdf.enableSelector();
}

function enablePencil(event) {
  event.preventDefault();
  changeActiveTool(event);
  pdf.enablePencil();
}

function enableAddText(event) {
  event.preventDefault();
  changeActiveTool(event);
  pdf.enableAddText(function () {
    $('.tool-button').first().find('i').click();
  });
}

function enableAddArrow(event) {
  event.preventDefault();
  changeActiveTool(event);
  pdf.enableAddArrow(function () {
    $('.tool-button').first().find('i').click();
  });
}

function addImage(event) {
  event.preventDefault();
  pdf.addImageToCanvas();
}

function enableRectangle(event) {
  event.preventDefault();
  changeActiveTool(event);
  pdf.enableRectangle(function () {
    $('.tool-button').first().find('i').click();
  });
}

function undo(event) {
  event.preventDefault();
  pdf.undo();
}

function redo(event) {
  event.preventDefault();
  pdf.redo();
}

function deleteSelectedObject(event) {
  event.preventDefault();
  pdf.deleteSelectedObject();
}

function savePDF() {
  // pdf.savePdf();
  pdf.savePdf('output.pdf'); // save with given file name
}

function clearPage() {
  pdf.clearActivePage();
}

function showPdfData() {
  pdf.serializePdf(function (string) {
    $('#dataModal .modal-body pre')
      .first()
      .text(JSON.stringify(JSON.parse(string), null, 4));
    $('#dataModal').modal('show');
  });
}

function showVal(a){
  pdf.serializePdf(function (string) {
    outputJson = JSON.parse(string);
  });
  zoomScale = Number(a);
  renderPDF();
  // $('#pdf-container').css("zoom", Number(a));
}

$(function () {
  $('.color-picker').minicolors({
    control: $('.color-picker').attr('data-control') || 'hue',
    defaultValue: $('.color-picker').attr('data-defaultValue') || '',
    format: $('.color-picker').attr('data-format') || 'hex',
    keywords: $('.color-picker').attr('data-keywords') || '',
    inline: $('.color-picker').attr('data-inline') === 'true',
    letterCase: $('.color-picker').attr('data-letterCase') || 'lowercase',
    opacity: $('.color-picker').attr('data-opacity'),
    position: $('.color-picker').attr('data-position') || 'bottom',
    swatches: $('.color-picker').attr('data-swatches') ? $('.color-picker').attr('data-swatches').split('|') : [],
    change: function(hex, opacity) {
      pdf.setColor(hex ? hex : 'transparent');
    },
    theme: 'default'
  });

  $('#brush-size').change(function () {
    var width = $(this).val();
    pdf.setBrushSize(width);
  });

  $('#font-size').change(function () {
    var font_size = $(this).val();
    pdf.setFontSize(font_size);
  });
});

renderPDF();
