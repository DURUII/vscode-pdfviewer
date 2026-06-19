import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { Disposable } from './disposable';

function escapeAttribute(value: string | vscode.Uri): string {
  return value.toString().replace(/"/g, '&quot;');
}

type PreviewState = 'Disposed' | 'Visible' | 'Active';

interface ScholarAnnotation {
  id: string;
  type: 'highlight' | 'comment' | 'question';
  pdf: string;
  createdAt: string;
  text: string;
  comment?: string;
  rects: Array<{
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
}

export class PdfPreview extends Disposable {
  private _previewState: PreviewState = 'Visible';

  constructor(
    private readonly extensionRoot: vscode.Uri,
    private readonly resource: vscode.Uri,
    private readonly webviewEditor: vscode.WebviewPanel
  ) {
    super();
    const resourceRoot = resource.with({
      path: resource.path.replace(/\/[^/]+?\.\w+$/, '/'),
    });

    webviewEditor.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, extensionRoot],
    };

    this._register(
      webviewEditor.webview.onDidReceiveMessage(async (message) => {
        switch (message.type) {
          case 'reopen-as-text': {
            vscode.commands.executeCommand(
              'vscode.openWith',
              resource,
              'default',
              webviewEditor.viewColumn
            );
            break;
          }
          case 'scholar-load-annotations': {
            await this.loadScholarAnnotations();
            break;
          }
          case 'scholar-create-annotation': {
            await this.createScholarAnnotation(message.annotation);
            break;
          }
          case 'scholar-ask-ai': {
            await this.createScholarQuestion(message.annotation);
            break;
          }
          case 'scholar-save-image-snapshot': {
            await this.saveScholarImageSnapshot(message);
            break;
          }
        }
      })
    );

    this._register(
      webviewEditor.onDidChangeViewState(() => {
        this.update();
      })
    );

    this._register(
      webviewEditor.onDidDispose(() => {
        this._previewState = 'Disposed';
      })
    );

    const watcher = this._register(
      vscode.workspace.createFileSystemWatcher(resource.fsPath)
    );
    this._register(
      watcher.onDidChange((e) => {
        if (e.toString() === this.resource.toString()) {
          this.reload();
        }
      })
    );
    this._register(
      watcher.onDidDelete((e) => {
        if (e.toString() === this.resource.toString()) {
          this.webviewEditor.dispose();
        }
      })
    );

    this.webviewEditor.webview.html = this.getWebviewContents();
    this.update();
  }

  private async loadScholarAnnotations(): Promise<void> {
    const annotations = await this.readScholarAnnotations();
    this.webviewEditor.webview.postMessage({
      type: 'scholar-annotations-loaded',
      annotations,
    });
  }

  private async createScholarAnnotation(
    annotation: ScholarAnnotation
  ): Promise<void> {
    if (!annotation || !annotation.text || !Array.isArray(annotation.rects)) {
      return;
    }
    if (annotation.type === 'comment' && !annotation.comment) {
      const comment = await vscode.window.showInputBox({
        prompt: 'Comment on selected PDF text',
      });
      if (comment === undefined) {
        return;
      }
      annotation = { ...annotation, comment };
    }
    const saved = await this.appendScholarAnnotation(annotation);
    this.webviewEditor.webview.postMessage({
      type: 'scholar-annotation-created',
      annotation: saved,
    });
  }

  private async createScholarQuestion(
    annotation: ScholarAnnotation
  ): Promise<void> {
    const comment = await vscode.window.showInputBox({
      prompt: 'Question or instruction for the agent',
      value: 'Explain this passage.',
    });
    if (comment === undefined) {
      return;
    }
    await this.createScholarAnnotation({
      ...annotation,
      type: 'question',
      comment,
    });
    await vscode.env.clipboard.writeText(
      [
        'Please help with this PDF passage.',
        '',
        `PDF: ${path.basename(this.resource.fsPath)}`,
        '',
        'Selected text:',
        annotation.text,
        '',
        'Question:',
        comment,
      ].join('\n')
    );
    vscode.window.showInformationMessage(
      'Scholar PDF Viewer saved the question and copied the AI prompt.'
    );
  }

  private async saveScholarImageSnapshot(message: {
    requestId?: string;
    dataUrl?: string;
    pageNumber?: number;
  }): Promise<void> {
    const requestId = message.requestId;
    try {
      const match = /^data:image\/png;base64,(.+)$/.exec(message.dataUrl || '');
      if (!match) {
        throw new Error('Invalid image snapshot payload.');
      }
      const dir = path.join(os.tmpdir(), 'scholar-pdfviewer');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
      const pdfBase = path
        .basename(this.resource.fsPath, path.extname(this.resource.fsPath))
        .replace(/[^A-Za-z0-9._-]+/g, '-');
      const page = Number.isFinite(message.pageNumber)
        ? `p${message.pageNumber}`
        : 'page';
      const filePath = path.join(
        dir,
        `${pdfBase}-${page}-${Date.now().toString(36)}.png`
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath),
        Buffer.from(match[1], 'base64')
      );
      await vscode.env.clipboard.writeText(filePath);
      this.webviewEditor.webview.postMessage({
        type: 'scholar-image-snapshot-saved',
        requestId,
        path: filePath,
      });
    } catch (err) {
      this.webviewEditor.webview.postMessage({
        type: 'scholar-image-snapshot-error',
        requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async appendScholarAnnotation(
    annotation: ScholarAnnotation
  ): Promise<ScholarAnnotation> {
    const saved = {
      ...annotation,
      id: annotation.id || this.createAnnotationId(),
      pdf: path.basename(this.resource.fsPath),
      createdAt: annotation.createdAt || new Date().toISOString(),
    };
    const uri = this.getScholarAnnotationsUri();
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(path.dirname(uri.fsPath))
    );
    const existing = await this.readFileText(uri);
    const next = `${existing}${
      existing.endsWith('\n') || !existing ? '' : '\n'
    }${JSON.stringify(saved)}\n`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
    return saved;
  }

  private async readScholarAnnotations(): Promise<ScholarAnnotation[]> {
    const text = await this.readFileText(this.getScholarAnnotationsUri());
    const annotations: ScholarAnnotation[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        annotations.push(JSON.parse(line) as ScholarAnnotation);
      } catch (_err) {
        // Ignore malformed lines so one bad manual edit does not break viewing.
      }
    }
    return annotations;
  }

  private async readFileText(uri: vscode.Uri): Promise<string> {
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(data).toString('utf8');
    } catch (err) {
      const code =
        err && typeof err === 'object'
          ? (err as { code?: string }).code
          : undefined;
      if (code === 'FileNotFound') {
        return '';
      }
      throw err;
    }
  }

  private getScholarAnnotationsUri(): vscode.Uri {
    const pdfDir = path.dirname(this.resource.fsPath);
    const pdfName = path.basename(this.resource.fsPath);
    return vscode.Uri.file(
      path.join(pdfDir, '.scholar', `${pdfName}.annotations.jsonl`)
    );
  }

  private createAnnotationId(): string {
    return `ann_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  private reload(): void {
    if (this._previewState !== 'Disposed') {
      this.webviewEditor.webview.postMessage({ type: 'reload' });
    }
  }

  private update(): void {
    if (this._previewState === 'Disposed') {
      return;
    }

    if (this.webviewEditor.active) {
      this._previewState = 'Active';
      return;
    }
    this._previewState = 'Visible';
  }

  private getWebviewContents(): string {
    const webview = this.webviewEditor.webview;
    const docPath = webview.asWebviewUri(this.resource);
    const cspSource = webview.cspSource;
    const resolveAsUri = (...p: string[]): vscode.Uri => {
      const uri = vscode.Uri.file(path.join(this.extensionRoot.path, ...p));
      return webview.asWebviewUri(uri);
    };

    const config = vscode.workspace.getConfiguration('pdf-preview');
    const citationPreviewScript = resolveAsUri(
      'lib',
      'citationPreview.js'
    ).with({
      query: `v=${Date.now().toString(36)}`,
    });
    const settings = {
      cMapUrl: resolveAsUri('lib', 'web', 'cmaps/').toString(),
      standardFontDataUrl: resolveAsUri(
        'lib',
        'web',
        'standard_fonts/'
      ).toString(),
      workerSrc: resolveAsUri('lib', 'build', 'pdf.worker.mjs').toString(),
      sandboxBundleSrc: resolveAsUri(
        'lib',
        'build',
        'pdf.sandbox.mjs'
      ).toString(),
      imageResourcesPath: resolveAsUri('lib', 'web', 'images/').toString(),
      path: docPath.toString(),
      defaults: {
        cursor: config.get('default.cursor') as string,
        scale: config.get('default.scale') as string,
        sidebar: config.get('default.sidebar') as boolean,
        scrollMode: config.get('default.scrollMode') as string,
        spreadMode: config.get('default.spreadMode') as string,
      },
    };
    const csp = [
      "default-src 'none'",
      `connect-src ${cspSource} blob: data:`,
      `script-src 'unsafe-inline' ${cspSource}`,
      `style-src 'unsafe-inline' ${cspSource}`,
      `img-src ${cspSource} blob: data:`,
      `font-src ${cspSource}`,
      `worker-src ${cspSource} blob:`,
      `child-src ${cspSource} blob:`,
      "object-src 'none'",
    ].join('; ');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta id="pdf-preview-config" data-config="${escapeAttribute(
    JSON.stringify(settings)
  )}">
  <link rel="stylesheet" href="${resolveAsUri('lib', 'web', 'pdf_viewer.css')}">
  <link rel="stylesheet" href="${resolveAsUri('lib', 'pdf.css')}">
  <link rel="stylesheet" href="${resolveAsUri('lib', 'scholarViewer.css')}">
  <script>
    (function () {
      function showPdfPreviewError(message) {
        var host = document.getElementById('pdf-preview-runtime-error');
        if (!host) {
          host = document.createElement('pre');
          host.id = 'pdf-preview-runtime-error';
          host.style.cssText = [
            'position: fixed',
            'inset: 12px',
            'z-index: 2147483647',
            'box-sizing: border-box',
            'overflow: auto',
            'white-space: pre-wrap',
            'margin: 0',
            'padding: 12px',
            'color: #f2f2f2',
            'background: rgba(120, 20, 20, 0.96)',
            'border: 1px solid rgba(255,255,255,0.35)',
            'font: 12px/1.45 var(--vscode-font-family, monospace)'
          ].join(';');
          document.documentElement.appendChild(host);
        }
        host.textContent = String(message || 'Unknown PDF preview error');
      }
      window.addEventListener('error', function (event) {
        showPdfPreviewError(event.message + '\\n' + (event.filename || '') + ':' + (event.lineno || 0) + ':' + (event.colno || 0));
      });
      window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        showPdfPreviewError(reason && (reason.stack || reason.message) || reason);
      });
      window.__showPdfPreviewError = showPdfPreviewError;
      window.PDFViewerApplication = window.PDFViewerApplication || {
        initializedPromise: Promise.resolve()
      };
    }());
  </script>
  <script type="module">
    import * as pdfjsWorker from '${resolveAsUri(
      'lib',
      'build',
      'pdf.worker.mjs'
    )}';
    globalThis.pdfjsWorker = pdfjsWorker;
  </script>
  <script src="${citationPreviewScript}"></script>
  <script type="module" src="${resolveAsUri(
    'lib',
    'scholarViewer.mjs'
  )}"></script>
</head>
<body>
  <div id="scholarToolbar">
    <button id="sidebarToggle" title="Toggle sidebar" aria-label="Toggle sidebar">☰</button>
    <button id="viewFind" title="Find in document" aria-label="Find in document">⌕</button>
    <button id="previous" title="Previous page" aria-label="Previous page">‹</button>
    <input id="pageNumber" type="number" min="1" value="1" aria-label="Page number">
    <span>/ <span id="pageCount">0</span></span>
    <button id="next" title="Next page" aria-label="Next page">›</button>
    <button id="zoomOutButton" title="Zoom out" aria-label="Zoom out">−</button>
    <select id="scaleSelect" title="Zoom" aria-label="Zoom">
      <option value="auto">Auto</option>
      <option value="page-width">Width</option>
      <option value="page-fit">Fit</option>
      <option value="0.75">75%</option>
      <option value="1">100%</option>
      <option value="1.25">125%</option>
      <option value="1.5">150%</option>
      <option value="2">200%</option>
    </select>
    <button id="zoomInButton" title="Zoom in" aria-label="Zoom in">+</button>
    <button id="highlightButton" title="Highlight" aria-label="Highlight">Highlight</button>
    <button id="textButton" title="Text" aria-label="Text">Text</button>
    <button id="inkButton" title="Draw" aria-label="Draw">Draw</button>
    <button id="stampButton" title="Image" aria-label="Image">Image</button>
    <button id="presentationMode" title="Presentation mode" aria-label="Presentation mode">⛶</button>
    <button id="printButton" title="Print" aria-label="Print">⎙</button>
    <button id="print" class="hiddenCompat" title="Print" aria-label="Print">⎙</button>
    <button id="saveButton" title="Download annotated PDF" aria-label="Download annotated PDF">Save</button>
    <button id="download" class="hiddenCompat" title="Download annotated PDF" aria-label="Download annotated PDF">Save</button>
    <button id="openFile" class="hiddenCompat" title="Open File" aria-label="Open File">Open</button>
    <button id="secondaryToolbarToggle" title="More tools" aria-label="More tools" aria-expanded="false">⋯</button>
    <span id="status"></span>
  </div>
  <div id="findbar" class="hidden" role="search" aria-label="Find in document">
    <input id="findInput" type="search" placeholder="Find in document" aria-label="Find in document">
    <button id="findPrevious" type="button" title="Previous match" aria-label="Previous match">↑</button>
    <button id="findNext" type="button" title="Next match" aria-label="Next match">↓</button>
    <label><input id="findHighlightAll" type="checkbox"> Highlight all</label>
    <label><input id="findMatchCase" type="checkbox"> Match case</label>
    <label><input id="findMatchDiacritics" type="checkbox"> Diacritics</label>
    <label><input id="findEntireWord" type="checkbox"> Whole words</label>
    <span id="findResultsCount" aria-live="polite"></span>
    <span id="findMsg" aria-live="polite"></span>
  </div>
  <div id="secondaryToolbar" class="hidden" role="menu" aria-label="More PDF tools">
    <button id="firstPage" type="button">First page</button>
    <button id="lastPage" type="button">Last page</button>
    <div class="toolbarSeparator"></div>
    <button id="pageRotateCw" type="button">Rotate clockwise</button>
    <button id="pageRotateCcw" type="button">Rotate counterclockwise</button>
    <div class="toolbarSeparator"></div>
    <button id="cursorSelectTool" class="toggled" type="button" aria-pressed="true">Select tool</button>
    <button id="cursorHandTool" type="button" aria-pressed="false">Hand tool</button>
    <div class="toolbarSeparator"></div>
    <button id="scrollPage" type="button">Page scrolling</button>
    <button id="scrollVertical" class="toggled" type="button">Vertical scrolling</button>
    <button id="scrollHorizontal" type="button">Horizontal scrolling</button>
    <button id="scrollWrapped" type="button">Wrapped scrolling</button>
    <div class="toolbarSeparator"></div>
    <button id="spreadNone" class="toggled" type="button">No spreads</button>
    <button id="spreadOdd" type="button">Odd spreads</button>
    <button id="spreadEven" type="button">Even spreads</button>
    <div class="toolbarSeparator"></div>
    <button id="documentProperties" type="button">Document properties</button>
    <button id="viewBookmark" type="button">Copy current view</button>
    <button id="secondaryOpenFile" class="hiddenCompat" type="button">Open file</button>
    <button id="secondaryPrint" class="hiddenCompat" type="button">Print</button>
    <button id="secondaryDownload" class="hiddenCompat" type="button">Save</button>
  </div>
  <div id="editorFreeTextParamsToolbar" class="editorParamsToolbar hidden" role="toolbar" aria-label="Text annotation parameters">
    <label>Color <input id="editorFreeTextColor" type="color" value="#000000"></label>
    <label>Size <input id="editorFreeTextFontSize" type="range" min="5" max="100" value="10"></label>
  </div>
  <div id="editorInkParamsToolbar" class="editorParamsToolbar hidden" role="toolbar" aria-label="Ink annotation parameters">
    <label>Color <input id="editorInkColor" type="color" value="#000000"></label>
    <label>Thickness <input id="editorInkThickness" type="range" min="1" max="20" value="1"></label>
    <label>Opacity <input id="editorInkOpacity" type="range" min="1" max="100" value="100"></label>
  </div>
  <div id="loadingBar" class="hidden" aria-hidden="true"><div id="loadingProgress"></div></div>
  <div id="scholarBody">
    <aside id="sidebarContainer" class="hidden" aria-label="PDF sidebar">
      <div id="sidebarTabs" role="tablist" aria-label="Sidebar views">
        <button id="viewThumbnail" class="active" type="button" role="tab" aria-selected="true" aria-controls="thumbnailView" title="Thumbnails">▦</button>
        <button id="viewOutline" type="button" role="tab" aria-selected="false" aria-controls="outlineView" title="Document outline">☷</button>
        <button id="viewAttachments" type="button" role="tab" aria-selected="false" aria-controls="attachmentsView" title="Attachments">⌘</button>
        <button id="viewLayers" type="button" role="tab" aria-selected="false" aria-controls="layersView" title="Layers">▤</button>
        <button id="currentOutlineItem" type="button" title="Find current outline item" disabled>◎</button>
      </div>
      <div id="thumbnailView" class="sidebarView" role="tabpanel" aria-labelledby="viewThumbnail"></div>
      <div id="outlineView" class="sidebarView hidden" role="tabpanel" aria-labelledby="viewOutline"></div>
      <div id="attachmentsView" class="sidebarView hidden" role="tabpanel" aria-labelledby="viewAttachments"></div>
      <div id="layersView" class="sidebarView hidden" role="tabpanel" aria-labelledby="viewLayers"></div>
      <div id="sidebarResizer" aria-label="Resize sidebar"></div>
    </aside>
    <div id="viewerContainer">
      <div id="viewer" class="pdfViewer"></div>
    </div>
  </div>
  <div id="selectionPopup" class="hidden" role="toolbar" aria-label="Scholar selection actions">
    <button id="selectionCopy" type="button" title="Copy selection">Copy</button>
    <button id="selectionHighlight" type="button" title="Highlight selection">Highlight</button>
    <button id="selectionComment" type="button" title="Comment on selection">Comment</button>
  </div>
  <div id="imagePopup" class="hidden" role="toolbar" aria-label="Scholar image actions">
    <button id="imageCopy" type="button" title="Save image crop and copy path">Copy Image</button>
  </div>
  <div id="commentPopup" class="hidden" role="dialog" aria-label="Comment">
    <textarea id="commentText" placeholder="Comment"></textarea>
    <div id="commentPopupActions">
      <button id="commentDelete">Delete</button>
      <button id="commentCancel">Cancel</button>
      <button id="commentSave">Save</button>
    </div>
  </div>
  <dialog id="documentPropertiesDialog" aria-label="Document properties">
    <div class="dialogHeader">Document Properties</div>
    <dl>
      <dt>File name</dt><dd id="fileNameField">-</dd>
      <dt>Title</dt><dd id="titleField">-</dd>
      <dt>Author</dt><dd id="authorField">-</dd>
      <dt>Subject</dt><dd id="subjectField">-</dd>
      <dt>Keywords</dt><dd id="keywordsField">-</dd>
      <dt>Creator</dt><dd id="creatorField">-</dd>
      <dt>Producer</dt><dd id="producerField">-</dd>
      <dt>PDF version</dt><dd id="versionField">-</dd>
      <dt>Page count</dt><dd id="pageCountField">-</dd>
      <dt>Creation date</dt><dd id="creationDateField">-</dd>
      <dt>Modified</dt><dd id="modificationDateField">-</dd>
    </dl>
    <div class="dialogActions">
      <button id="documentPropertiesClose" type="button">Close</button>
    </div>
  </dialog>
  <dialog id="passwordDialog" aria-label="Password required">
    <div class="dialogHeader">Password Required</div>
    <div class="passwordBody">
      <label id="passwordText" for="password">Enter the password to open this PDF file:</label>
      <input id="password" type="password">
    </div>
    <div class="dialogActions">
      <button id="passwordCancel" type="button">Cancel</button>
      <button id="passwordSubmit" type="button">OK</button>
    </div>
  </dialog>
  <dialog id="printServiceDialog" aria-label="Print progress">
    <div class="dialogHeader">Preparing document for printing...</div>
    <progress value="0" max="100"></progress>
    <div class="dialogActions">
      <button id="printCancel" type="button">Cancel</button>
    </div>
  </dialog>
  <input id="fileInput" class="hiddenCompat" type="file" accept="application/pdf">
  <div id="printContainer"></div>
</body>
</html>`;
  }
}
