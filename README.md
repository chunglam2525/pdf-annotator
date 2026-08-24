# PDF Annotator

Browser app for annotating PDFs: open a file, draw or highlight on the pages, then save a flattened PDF. The UI is plain HTML/CSS/JS. There is no build step and no jQuery.

![Screenshot](./Screenshot.png?raw=true "Screenshot")

Inspired by [RavishaHesh/PDFJsAnnotations](https://github.com/RavishaHesh/PDFJsAnnotations). This version is a full rewrite.

## Features

- Open a PDF from the file picker or by dropping it on the viewer
- Tools: select, pencil, text, highlight PDF text, arrow, rectangle, insert image
- Color, opacity, brush size, and font size
- Zoom, undo/redo, delete selected, clear the current page
- Inspect annotation JSON, then save a flattened PDF

## Libraries

Vendored copies live in `lib/`. Script tags in `index.html` load Fabric and jsPDF; `annotator.js` imports PDF.js as an ES module.

| Library | File | Role |
| --- | --- | --- |
| [PDF.js](https://mozilla.github.io/pdf.js/) 6.2.108 | `lib/pdf.min.mjs` + `lib/pdf.worker.min.mjs` | Parse the PDF, rasterize each page, and extract text for the highlight tool |
| [Fabric.js](https://fabricjs.com/) 7.4.0 | `lib/fabric.min.js` | Interactive canvas on each page: draw, move, resize, and serialize objects |
| [jsPDF](https://github.com/parallax/jsPDF) 4.2.1 | `lib/jspdf.umd.min.js` | Flatten each annotated canvas into a downloadable PDF |

To upgrade a library, replace the matching file in `lib/` and keep the same filenames, or update the `<script>` / `import` paths in `index.html` and `annotator.js`.

## Run locally

ES modules cannot load from `file://`. Serve the project folder, then open the URL in a browser:

```bash
npx serve .
```

Or any other static server (`python -m http.server`, VS Code Live Server, and so on).

## Project layout

| File | What to edit |
| --- | --- |
| `index.html` | Toolbar markup, tool buttons, style controls, empty state, JSON dialog |
| `styles.css` | Layout and theme. Colors are CSS variables on `:root` |
| `app.js` | Wires the UI to `PdfAnnotator`: file open, zoom, keyboard shortcuts, dialogs |
| `annotator.js` | Core engine: load pages, tools, history, serialize, export |
| `lib/` | Third-party libraries (usually leave these alone) |

`app.js` creates one `PdfAnnotator` and passes callbacks so the toolbar can stay in sync:

```js
const annotator = new PdfAnnotator(container, {
  scale: 1,
  onReady: updateChrome,
  onToolChange: (tool) => setActiveToolButton(tool),
  onHistoryChange: updateChrome,
});
```

Public methods you will call from UI code: `load`, `setTool`, `setColor`, `setBrushSize`, `setFontSize`, `setZoom`, `addImage`, `undo`, `redo`, `deleteSelected`, `clearPage`, `serialize`, `loadAnnotations`, `savePdf`.

## Change the UI

Toolbar buttons, labels, and the JSON dialog live in `index.html`. Styles live in `styles.css`.

Theme colors are CSS custom properties. Change `--bg`, `--card`, `--accent`, `--text`, and the rest at the top of `styles.css`. Light mode is already handled under `@media (prefers-color-scheme: light)`.

To add a toolbar button:

1. Add the button in `index.html` (copy an existing `.icon-btn` or `.btn`).
2. In `app.js`, attach a click handler that calls the matching `annotator` method.
3. If the control should disable until a PDF is open, add its id to the list in `updateChrome()`.

Zoom steps are the `ZOOM_STEPS` array at the top of `app.js`. Keyboard shortcuts (Esc, Delete, Ctrl/Cmd+Z, Ctrl/Cmd+Y) are in the `keydown` listener in the same file.

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

`serialize()` returns page objects without the PDF background image. `load(source, annotations)` can reopen a PDF and restore that JSON. `savePdf()` rasterizes each Fabric canvas through jsPDF, so the download is a flattened image PDF, not an editable annotation layer.

Change export quality in `savePdf()` (`quality`, `multiplier`, JPEG vs PNG). Change on-screen sharpness with the `renderScale` constructor option in `annotator.js`.

## License

MIT
