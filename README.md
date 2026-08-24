# PDF Annotator

Browser app for annotating PDFs: open a file, draw or highlight on the pages, then save. The UI is plain HTML/CSS/JS. There is no build step, no bundler, and no jQuery.

Open `index.html` in a browser. A local HTTP server is not required.

![Screenshot](./Screenshot.png?raw=true "Screenshot")

Inspired by [RavishaHesh/PDFJsAnnotations](https://github.com/RavishaHesh/PDFJsAnnotations). This version is a full rewrite.

## Features

- Open a PDF from the file picker or by dropping it on the viewer
- Start from a blank page if you have no PDF
- Tools: select, pencil, text, highlight PDF text, arrow, rectangle, insert image
- Color, opacity, brush size, and font size
- Zoom, undo/redo, delete selected, clear the current page
- Insert or remove blank pages from the buttons between pages
- Edit annotation JSON in the dialog, then Apply (validated first)
- Save keeps the original PDF text and stamps annotations on top

## Run

Double-click `index.html`, or open that file from the browser. Scripts are classic `<script>` tags (not ES modules), so `file://` works in Chrome, Edge, and Firefox.

Hard-refresh (`Ctrl+F5`) after you replace files in `lib/`.

## Libraries

Vendored copies live in `lib/`. `index.html` loads them in this order: Fabric, pdf-lib, the PDF.js worker, PDF.js, then the app scripts.

| Library | File | Role |
| --- | --- | --- |
| [PDF.js](https://mozilla.github.io/pdf.js/) 6.2.108 | `lib/pdf.min.js` + `lib/pdf.worker.min.js` | Parse the PDF, rasterize each page, and extract text for the highlight tool. The worker runs on the main thread so `file://` does not need a Web Worker. |
| [Fabric.js](https://fabricjs.com/) 7.4.0 | `lib/fabric.min.js` | Interactive canvas on each page: draw, move, resize, and serialize objects |
| [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 | `lib/pdf-lib.min.js` | Write the saved PDF: copy original pages (text stays selectable) and overlay annotations |

To upgrade a library, replace the matching file in `lib/` and keep the same filenames. PDF.js must stay a classic script (not `.mjs`), and both the main file and worker should stay wrapped so they do not leak globals into the page.

## Project layout

| File | What to edit |
| --- | --- |
| `index.html` | Toolbar markup, tool buttons, style controls, empty state, JSON dialog, script tags |
| `styles.css` | Layout and theme. Colors are CSS variables on `:root` |
| `app.js` | Wires the UI to `PdfAnnotator`: file open, zoom, keyboard shortcuts, dialogs |
| `annotator.js` | Core engine: load pages, tools, history, blank pages, serialize, export |
| `annotation-json.js` | Parse and validate annotation JSON before import |
| `lib/` | Third-party libraries (usually leave these alone) |

`app.js` creates one `PdfAnnotator` and passes callbacks so the toolbar can stay in sync:

```js
const annotator = new PdfAnnotator(container, {
  scale: 1,
  onReady: updateChrome,
  onToolChange: (tool) => setActiveToolButton(tool),
  onHistoryChange: updateChrome,
  onPagesChange: updateChrome,
});
```

Useful methods from UI code: `load`, `setTool`, `setColor`, `setBrushSize`, `setFontSize`, `setZoom`, `addImage`, `addBlankPage`, `removeBlankPage`, `undo`, `redo`, `deleteSelected`, `clearPage`, `serialize`, `validateAnnotations`, `importAnnotations`, `savePdf`.

## Change the UI

Toolbar buttons, labels, and the JSON dialog live in `index.html`. Styles live in `styles.css`.

Theme colors are CSS custom properties. Change `--bg`, `--card`, `--accent`, `--text`, and the rest at the top of `styles.css`. Light mode is already handled under `@media (prefers-color-scheme: light)`.

To add a toolbar button:

1. Add the button in `index.html` (copy an existing `.icon-btn` or `.btn`).
2. In `app.js`, attach a click handler that calls the matching `annotator` method.
3. If the control should disable until a document is open, add its id to the list in `updateChrome()`.

Zoom steps are the `ZOOM_STEPS` array at the top of `app.js`. Keyboard shortcuts (Esc, Delete, Ctrl/Cmd+Z, Ctrl/Cmd+Y) are in the `keydown` listener in the same file.

Blank-page insert and remove controls are created in `annotator.js` (`syncInsertSlots` and the remove button on added pages), not in the toolbar.

## Add or change tools

Tools are named strings (`select`, `pencil`, `text`, `highlight`, `arrow`, `rect`). `app.js` only reads `data-tool` from the toolbar and calls `annotator.setTool(...)`. Drawing behavior is in `annotator.js`.

Typical places to edit:

- `setTool()` — enable drawing mode, selection, or the PDF text layer
- `onMouseDown` / `onMouseMove` / `onMouseUp` — click-and-drag tools (see `arrow` and `rect`)
- `highlightSelection()` — text highlight, which uses the PDF.js text layer instead of a mouse draft
- `registerLineArrow()` — example of a custom Fabric class (`LineArrow`)

To add a new shape tool (for example a circle):

1. Add a button in `index.html` with `data-tool="circle"`.
2. In `onMouseDown`, create a Fabric object (such as `fabric.Circle`) and store it on `this.draft`.
3. Update `onMouseMove` / `onMouseUp` for that draft kind, then `pushHistory` so undo/redo works.
4. If the object needs a custom type for JSON reload, register it on `fabric.classRegistry` the same way `LineArrow` is registered.

Color and size changes go through `setColor`, `setBrushSize`, and `setFontSize`. Recolor logic for selected objects is in `recolor()`.

## Load, save, and reuse annotations

`serialize()` returns page objects without the PDF background image. Open **JSON**, edit the text, then **Apply**. `validateAnnotations()` runs first and rejects invalid JSON or a page count that does not match the open document.

`savePdf()` copies original PDF pages with [pdf-lib](https://github.com/Hopding/pdf-lib) so existing text stays selectable, then stamps a transparent PNG of the Fabric annotations on top. Blank pages you added are written as new pages. Annotation drawings themselves are raster, not native PDF annotation objects.

On-screen sharpness is the `renderScale` constructor option in `annotator.js`. Overlay export uses the same scale.

## License

MIT
