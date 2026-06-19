"use strict";

(function () {
  const vscode = acquireVsCodeApi();
  const HIGHLIGHT_COLOR = "rgba(255, 213, 79, 0.36)";
  const COMMENT_COLOR = "rgba(64, 156, 255, 0.38)";
  const QUESTION_COLOR = "rgba(197, 134, 192, 0.38)";

  let toolbar;
  let activeSelection;
  let annotations = [];

  function injectStyles() {
    if (document.getElementById("scholar-overlay-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "scholar-overlay-styles";
    style.textContent = `
      .scholar-selection-toolbar {
        position: fixed;
        z-index: 100001;
        display: flex;
        gap: 1px;
        overflow: hidden;
        color: var(--vscode-editorWidget-foreground, var(--vscode-foreground, #cccccc));
        background: var(--vscode-editorWidget-background, #252526);
        border: 1px solid var(--vscode-widget-border, #454545);
        border-radius: 4px;
        box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-size: var(--vscode-font-size, 12px);
      }
      .scholar-selection-toolbar.hidden {
        display: none;
      }
      .scholar-selection-toolbar button {
        border: 0;
        border-radius: 0;
        color: inherit;
        background: transparent;
        padding: 5px 9px;
        font: inherit;
        cursor: pointer;
      }
      .scholar-selection-toolbar button:hover {
        background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
      }
      .scholar-selection-toolbar button:focus {
        outline: 1px solid var(--vscode-focusBorder, #007fd4);
        outline-offset: -1px;
      }
      .scholar-overlay-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 4;
      }
      .scholar-annotation-mark {
        position: absolute;
        border-radius: 2px;
        mix-blend-mode: multiply;
      }
      .scholar-annotation-mark.comment,
      .scholar-annotation-mark.question {
        box-shadow: 0 0 0 1px rgba(64, 156, 255, 0.35) inset;
      }
      .scholar-comment-pin {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        background: var(--vscode-button-background, #0e639c);
        box-shadow: 0 0 0 2px var(--vscode-editor-background, #ffffff);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureToolbar() {
    if (toolbar) {
      return toolbar;
    }
    toolbar = document.createElement("div");
    toolbar.className = "scholar-selection-toolbar hidden";
    toolbar.innerHTML = `
      <button type="button" data-action="highlight">Highlight</button>
      <button type="button" data-action="comment">Comment</button>
      <button type="button" data-action="ask">Ask</button>
    `;
    toolbar.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    toolbar.addEventListener("click", onToolbarClick);
    document.body.appendChild(toolbar);
    return toolbar;
  }

  function onToolbarClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || !activeSelection) {
      return;
    }
    const action = button.getAttribute("data-action");
    const annotation = {
      id: createId(),
      type: action === "ask" ? "question" : action,
      pdf: "",
      createdAt: new Date().toISOString(),
      text: activeSelection.text,
      rects: activeSelection.rects,
    };
    if (action === "ask") {
      vscode.postMessage({ type: "scholar-ask-ai", annotation });
    } else {
      vscode.postMessage({ type: "scholar-create-annotation", annotation });
    }
    window.getSelection().removeAllRanges();
    hideToolbar();
  }

  function createId() {
    return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function onMouseUp() {
    setTimeout(() => {
      const selection = getPdfSelection();
      if (!selection) {
        hideToolbar();
        return;
      }
      activeSelection = selection;
      showToolbar(selection.viewportRect);
    }, 0);
  }

  function getPdfSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return undefined;
    }
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      return undefined;
    }

    const rects = [];
    let union;
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 2 || rect.height < 2) {
          continue;
        }
        const page = findPageForRect(rect);
        if (!page) {
          continue;
        }
        const pageRect = page.getBoundingClientRect();
        rects.push({
          page: Number(page.dataset.pageNumber),
          left: (rect.left - pageRect.left) / pageRect.width,
          top: (rect.top - pageRect.top) / pageRect.height,
          width: rect.width / pageRect.width,
          height: rect.height / pageRect.height,
        });
        union = unionRect(union, rect);
      }
    }
    if (!rects.length || !union) {
      return undefined;
    }
    return { text, rects, viewportRect: union };
  }

  function findPageForRect(rect) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let element = document.elementFromPoint(cx, cy);
    while (element && !element.classList.contains("page")) {
      element = element.parentElement;
    }
    if (element) {
      return element;
    }
    return Array.from(document.querySelectorAll(".page")).find((page) => {
      const pageRect = page.getBoundingClientRect();
      return cx >= pageRect.left && cx <= pageRect.right && cy >= pageRect.top && cy <= pageRect.bottom;
    });
  }

  function unionRect(current, rect) {
    if (!current) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    }
    return {
      left: Math.min(current.left, rect.left),
      top: Math.min(current.top, rect.top),
      right: Math.max(current.right, rect.right),
      bottom: Math.max(current.bottom, rect.bottom),
    };
  }

  function showToolbar(rect) {
    const host = ensureToolbar();
    host.classList.remove("hidden");
    const width = host.offsetWidth;
    const height = host.offsetHeight;
    const margin = 8;
    let left = rect.left + (rect.right - rect.left) / 2 - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = rect.top - height - 8;
    if (top < margin) {
      top = rect.bottom + 8;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  function hideToolbar() {
    activeSelection = undefined;
    if (toolbar) {
      toolbar.classList.add("hidden");
    }
  }

  function installMessageHandlers() {
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || !message.type) {
        return;
      }
      if (message.type === "scholar-annotations-loaded") {
        annotations = Array.isArray(message.annotations) ? message.annotations : [];
        renderAllAnnotations();
      } else if (message.type === "scholar-annotation-created" && message.annotation) {
        annotations.push(message.annotation);
        renderAllAnnotations();
      }
    });
  }

  function renderAllAnnotations() {
    clearAnnotationLayers();
    for (const annotation of annotations) {
      renderAnnotation(annotation);
    }
  }

  function clearAnnotationLayers() {
    for (const layer of document.querySelectorAll(".scholar-overlay-layer")) {
      layer.textContent = "";
    }
  }

  function renderAnnotation(annotation) {
    for (const rect of annotation.rects || []) {
      const page = document.querySelector(`.page[data-page-number="${rect.page}"]`);
      if (!page) {
        continue;
      }
      const layer = ensureOverlayLayer(page);
      const mark = document.createElement("div");
      mark.className = `scholar-annotation-mark ${annotation.type}`;
      mark.title = annotation.comment || annotation.text || "";
      mark.style.left = `${rect.left * 100}%`;
      mark.style.top = `${rect.top * 100}%`;
      mark.style.width = `${rect.width * 100}%`;
      mark.style.height = `${rect.height * 100}%`;
      mark.style.background = annotationColor(annotation.type);
      layer.appendChild(mark);
    }

    const first = annotation.rects && annotation.rects[0];
    if (first && (annotation.type === "comment" || annotation.type === "question")) {
      const page = document.querySelector(`.page[data-page-number="${first.page}"]`);
      if (page) {
        const pin = document.createElement("div");
        pin.className = "scholar-comment-pin";
        pin.title = annotation.comment || annotation.text || "";
        pin.style.left = `${(first.left + first.width) * 100}%`;
        pin.style.top = `${first.top * 100}%`;
        ensureOverlayLayer(page).appendChild(pin);
      }
    }
  }

  function annotationColor(type) {
    if (type === "comment") {
      return COMMENT_COLOR;
    }
    if (type === "question") {
      return QUESTION_COLOR;
    }
    return HIGHLIGHT_COLOR;
  }

  function ensureOverlayLayer(page) {
    let layer = page.querySelector(".scholar-overlay-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "scholar-overlay-layer";
      page.appendChild(layer);
    }
    return layer;
  }

  function observePages() {
    const observer = new MutationObserver(() => {
      renderAllAnnotations();
    });
    const viewer = document.getElementById("viewer");
    if (viewer) {
      observer.observe(viewer, { childList: true });
    }
    window.addEventListener("resize", renderAllAnnotations);
  }

  function install() {
    injectStyles();
    ensureToolbar();
    installMessageHandlers();
    observePages();
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("scroll", hideToolbar, true);
    vscode.postMessage({ type: "scholar-load-annotations" });
  }

  window.addEventListener("load", () => {
    if (window.PDFViewerApplication && window.PDFViewerApplication.initializedPromise) {
      window.PDFViewerApplication.initializedPromise.then(install);
    } else {
      install();
    }
  }, { once: true });
}());
