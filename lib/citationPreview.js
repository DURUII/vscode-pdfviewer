"use strict";

(function () {
  const HOVER_OPEN_DELAY = 120;
  const HOVER_CLOSE_DELAY = 350;
  const POPUP_WIDTH = 520;
  const MIN_POPUP_WIDTH = 520;
  const MAX_POPUP_HEIGHT = 520;
  const MAX_REFERENCE_CHARS = 2200;
  const FALLBACK_REFERENCE_LINES = 20;

  let popup;
  let openTimer;
  let closeTimer;
  let activeLink;
  const pageTextCache = new Map();
  const pageLinesCache = new Map();
  const previewCache = new Map();

  function injectStyles() {
    if (document.getElementById("citation-preview-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "citation-preview-styles";
    style.textContent = `
      .citation-preview-popup {
        position: fixed;
        z-index: 100000;
        box-sizing: border-box;
        width: min(${POPUP_WIDTH}px, calc(100vw - 24px));
        min-width: min(${MIN_POPUP_WIDTH}px, calc(100vw - 24px));
        max-height: min(${MAX_POPUP_HEIGHT}px, calc(100vh - 24px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground, #cccccc));
        background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, #252526));
        border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, #454545));
        box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
        border-radius: 4px;
        padding: 0;
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-size: var(--vscode-font-size, 12px);
        line-height: 1.45;
      }
      .citation-preview-popup.hidden {
        display: none;
      }
      .citation-preview-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
        color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground, #f2f2f2));
        font-weight: 600;
        flex: 0 0 auto;
      }
      .citation-preview-cite {
        color: var(--vscode-descriptionForeground, #9d9d9d);
        font-weight: 400;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 50%;
      }
      .citation-preview-body {
        min-height: 0;
        overflow: auto;
        padding: 10px;
        white-space: normal;
      }
      .citation-preview-body::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      .citation-preview-body::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
      }
      .citation-preview-body::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7));
      }
      .citation-preview-muted {
        padding: 10px;
        color: var(--vscode-descriptionForeground, #a5a5a5);
      }
      .citation-preview-reference {
        margin: 0;
        white-space: pre-wrap;
        color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground, #cccccc));
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-size: var(--vscode-font-size, 12px);
        line-height: 1.5;
      }
      .citation-preview-preview {
        width: 100%;
        max-height: 380px;
        object-fit: contain;
        background: var(--vscode-editor-background, #ffffff);
        border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
        border-radius: 2px;
      }
      .citation-preview-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 8px 10px;
        border-top: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
        flex: 0 0 auto;
      }
      .citation-preview-button {
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 2px;
        color: var(--vscode-button-foreground, #ffffff);
        background: var(--vscode-button-background, #0e639c);
        padding: 3px 10px;
        font: inherit;
        cursor: pointer;
      }
      .citation-preview-button:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
      }
      .citation-preview-button:focus {
        outline: 1px solid var(--vscode-focusBorder, #007fd4);
        outline-offset: 2px;
      }
      .annotationLayer .linkAnnotation > a.citation-preview-active {
        background: var(--vscode-editor-wordHighlightBackground, rgba(87, 87, 87, 0.35));
        box-shadow: 0 0 0 1px var(--vscode-focusBorder, rgba(0, 127, 212, 0.65)) inset;
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePopup() {
    if (popup) {
      return popup;
    }
    popup = document.createElement("div");
    popup.className = "citation-preview-popup hidden";
    popup.addEventListener("mouseenter", () => {
      clearTimeout(closeTimer);
    });
    popup.addEventListener("mouseleave", scheduleClose);
    document.body.appendChild(popup);
    return popup;
  }

  function scheduleClose() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hidePopup, HOVER_CLOSE_DELAY);
  }

  function hidePopup() {
    if (popup) {
      popup.classList.add("hidden");
    }
    if (activeLink) {
      activeLink.classList.remove("citation-preview-active");
      activeLink = undefined;
    }
  }

  function getInternalLink(target) {
    const link = target.closest && target.closest(".annotationLayer section[data-internal-link] > a");
    if (!link) {
      return undefined;
    }
    const text = getTextUnderLink(link) || link.textContent || link.getAttribute("aria-label") || link.title || "";
    const href = link.getAttribute("href") || "";
    if (!href || href === "#") {
      return undefined;
    }
    return { link, text, href };
  }

  function intersects(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function expandRect(rect, pixels) {
    return {
      left: rect.left - pixels,
      right: rect.right + pixels,
      top: rect.top - pixels,
      bottom: rect.bottom + pixels,
    };
  }

  function getTextUnderLink(link) {
    const page = link.closest(".page");
    if (!page) {
      return "";
    }
    const linkRect = expandRect(link.getBoundingClientRect(), 1);
    const spans = Array.from(page.querySelectorAll(".textLayer span"));
    const parts = [];
    for (const span of spans) {
      const spanText = span.textContent || "";
      if (!spanText.trim()) {
        continue;
      }
      if (intersects(linkRect, span.getBoundingClientRect())) {
        parts.push(spanText);
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function parseHashDestination(href) {
    let rawHash = "";
    try {
      rawHash = new URL(href, window.location.href).hash;
    } catch (_err) {
      rawHash = href.includes("#") ? href.slice(href.indexOf("#")) : href;
    }
    if (!rawHash || rawHash === "#") {
      return undefined;
    }
    const hash = decodeURIComponent(rawHash.slice(1));
    const pageMatch = hash.match(/(?:^|&)page=(\d+)/);
    if (pageMatch) {
      return { pageNumber: Number(pageMatch[1]), raw: hash };
    }
    try {
      const explicitDest = JSON.parse(hash);
      return { explicitDest, raw: hash };
    } catch (_err) {
      return { namedDest: hash, raw: hash };
    }
  }

  async function resolveDestination(href) {
    const parsed = parseHashDestination(href);
    const app = window.PDFViewerApplication;
    const doc = app && app.pdfDocument;
    if (!parsed || !doc) {
      return undefined;
    }
    if (parsed.pageNumber) {
      return parsed;
    }

    let explicitDest = parsed.explicitDest;
    if (!explicitDest && parsed.namedDest) {
      explicitDest = await doc.getDestination(parsed.namedDest);
    }
    if (!Array.isArray(explicitDest)) {
      return parsed;
    }

    const destRef = explicitDest[0];
    let pageNumber;
    if (Number.isInteger(destRef)) {
      pageNumber = destRef + 1;
    } else if (destRef && typeof destRef === "object") {
      const pageIndex = await doc.getPageIndex(destRef);
      pageNumber = pageIndex + 1;
    }
    const destinationPoint = getDestinationPoint(explicitDest);
    return Object.assign({}, parsed, destinationPoint, { explicitDest, pageNumber });
  }

  function getDestinationPoint(explicitDest) {
    const left = explicitDest.length > 2 && Number.isFinite(explicitDest[2]) ? explicitDest[2] : undefined;
    const top = explicitDest.length > 3 && Number.isFinite(explicitDest[3]) ? explicitDest[3] : undefined;
    return { left, top };
  }

  async function getPageText(pageNumber) {
    const app = window.PDFViewerApplication;
    const doc = app && app.pdfDocument;
    if (!doc || !pageNumber || pageNumber < 1 || pageNumber > doc.numPages) {
      return "";
    }
    if (pageTextCache.has(pageNumber)) {
      return pageTextCache.get(pageNumber);
    }
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = [];
    let current = "";
    let lastY;
    for (const item of textContent.items || []) {
      const y = item.transform && Math.round(item.transform[5]);
      if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 3) {
        if (current.trim()) {
          lines.push(current.trim());
        }
        current = "";
      }
      current += (current ? " " : "") + (item.str || "");
      if (y !== undefined) {
        lastY = y;
      }
    }
    if (current.trim()) {
      lines.push(current.trim());
    }
    const text = lines.join("\n");
    pageTextCache.set(pageNumber, text);
    return text;
  }

  async function getPageVisualLines(pageNumber) {
    const app = window.PDFViewerApplication;
    const doc = app && app.pdfDocument;
    if (!doc || !pageNumber || pageNumber < 1 || pageNumber > doc.numPages) {
      return [];
    }
    if (pageLinesCache.has(pageNumber)) {
      return pageLinesCache.get(pageNumber);
    }

    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageMidX = viewport.width / 2;
    const textContent = await page.getTextContent();
    const rows = [];
    for (const item of textContent.items || []) {
      const text = item.str || "";
      const transform = item.transform || [];
      if (!text.trim() || !Number.isFinite(transform[4]) || !Number.isFinite(transform[5])) {
        continue;
      }
      const x = transform[4];
      const y = transform[5];
      const width = Number.isFinite(item.width) ? item.width : 0;
      const column = x < pageMidX ? 0 : 1;
      let row = rows.find((candidate) => candidate.column === column && Math.abs(candidate.y - y) <= 3);
      if (!row) {
        row = { column, y, items: [] };
        rows.push(row);
      }
      row.items.push({ text, x, y, width, endX: x + width });
    }

    const visualLines = [];
    for (const row of rows) {
      const items = row.items.sort((a, b) => a.x - b.x);
      visualLines.push(buildVisualLine(items, row.y, row.column));
    }

    const sorted = visualLines
      .filter((line) => line.text)
      .sort((a, b) => {
        if (a.column !== b.column) {
          return a.column - b.column;
        }
        if (Math.abs(a.y - b.y) > 3) {
          return b.y - a.y;
        }
        return a.x - b.x;
      });
    pageLinesCache.set(pageNumber, sorted);
    return sorted;
  }

  function buildVisualLine(items, y, column) {
    const text = items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
    const x = Math.min(...items.map((item) => item.x));
    const endX = Math.max(...items.map((item) => item.endX));
    return {
      text,
      x,
      y,
      endX,
      column,
    };
  }

  async function getReferenceSearchText(pageNumber) {
    const app = window.PDFViewerApplication;
    const doc = app && app.pdfDocument;
    const pages = [pageNumber];
    if (doc && pageNumber < doc.numPages) {
      pages.push(pageNumber + 1);
    }
    const lineChunks = await Promise.all(pages.map((page) => getPageVisualLines(page)));
    const visualText = lineChunks.flat().map((line) => line.text).filter(Boolean).join("\n");
    if (visualText) {
      return visualText;
    }
    const chunks = await Promise.all(pages.map((page) => getPageText(page)));
    return chunks.filter(Boolean).join("\n");
  }

  function extractCitationNumbers(linkText) {
    const text = (linkText || "").replace(/\s+/g, " ");
    const numbers = [];
    const matches = text.match(/\d+(?:\s*[-–]\s*\d+)?/g) || [];
    for (const match of matches) {
      const range = match.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 50) {
          for (let n = start; n <= end; n++) {
            numbers.push(n);
          }
        }
      } else {
        numbers.push(Number(match));
      }
    }
    return numbers.filter(Number.isFinite);
  }

  function extractReferenceEntry(pageText, citationNumbers) {
    if (!pageText.trim()) {
      return "";
    }
    const normalized = pageText.replace(/[ \t]+/g, " ");
    for (const n of citationNumbers) {
      const patterns = [
        new RegExp(String.raw`(?:^|\n)\s*\[${n}\]\s+([\s\S]*?)(?=\n\s*\[\d+\]\s+|$)`, "m"),
        new RegExp(String.raw`(?:^|\n)\s*${n}\.\s+([\s\S]*?)(?=\n\s*\d+\.\s+|$)`, "m"),
      ];
      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match && match[1]) {
          return `[${n}] ${match[1].trim()}`.slice(0, MAX_REFERENCE_CHARS);
        }
      }
    }
    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    const referenceStart = lines.findIndex((line) => /^(references|bibliography|works cited)$/i.test(line));
    const start = referenceStart >= 0 ? referenceStart + 1 : 0;
    return lines.slice(start, start + FALLBACK_REFERENCE_LINES).join("\n").slice(0, MAX_REFERENCE_CHARS);
  }

  async function extractReferenceFromVisualLines(destination, citationNumbers) {
    if (!citationNumbers.length) {
      return "";
    }
    const app = window.PDFViewerApplication;
    const doc = app && app.pdfDocument;
    const pageNumber = destination && destination.pageNumber;
    const pages = [pageNumber];
    if (doc && pageNumber < doc.numPages) {
      pages.push(pageNumber + 1);
    }

    const targetLines = await getPageVisualLines(pageNumber);
    for (const n of citationNumbers) {
      const anchored = extractReferenceNumberFromLines(targetLines, n, destination);
      if (anchored) {
        return anchored;
      }
    }

    for (const page of pages.filter((page) => page !== pageNumber)) {
      const lines = await getPageVisualLines(page);
      for (const n of citationNumbers) {
        const reference = extractReferenceNumberFromLines(lines, n);
        if (reference) {
          return reference;
        }
      }
    }
    return "";
  }

  function extractReferenceNumberFromLines(lines, n, destination) {
    const startPattern = new RegExp(String.raw`^\s*(?:\[${n}\]|${n}\.)\s+`);
    const nextPattern = /^\s*(?:\[\d+\]|\d+\.)\s+/;
    const startIndex = findReferenceStartIndex(lines, startPattern, destination);
    if (startIndex < 0) {
      return "";
    }

    const startLine = lines[startIndex];
    const parts = [startLine.text];
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.column !== startLine.column) {
        continue;
      }
      if (nextPattern.test(line.text)) {
        break;
      }
      parts.push(line.text);
      if (parts.join(" ").length >= MAX_REFERENCE_CHARS) {
        break;
      }
    }
    return parts.join("\n").slice(0, MAX_REFERENCE_CHARS);
  }

  function findReferenceStartIndex(lines, startPattern, destination) {
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      if (startPattern.test(lines[i].text)) {
        candidates.push({ index: i, line: lines[i] });
      }
    }
    if (!candidates.length) {
      return -1;
    }
    if (!destination || (!Number.isFinite(destination.top) && !Number.isFinite(destination.left))) {
      return candidates[0].index;
    }
    candidates.sort((a, b) => referenceAnchorDistance(a.line, destination) - referenceAnchorDistance(b.line, destination));
    const best = candidates[0];
    const distance = referenceAnchorDistance(best.line, destination);
    return distance < 140 ? best.index : -1;
  }

  function referenceAnchorDistance(line, destination) {
    const dy = Number.isFinite(destination.top) ? Math.abs(line.y - destination.top) : 0;
    const dx = Number.isFinite(destination.left) ? Math.abs(line.x - destination.left) * 0.35 : 0;
    return dy + dx;
  }

  async function renderPagePreview(pageNumber) {
    if (previewCache.has(pageNumber)) {
      return previewCache.get(pageNumber);
    }
    const app = window.PDFViewerApplication;
    const doc = app && app.pdfDocument;
    if (!doc || !pageNumber) {
      return "";
    }
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.28 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    previewCache.set(pageNumber, dataUrl);
    return dataUrl;
  }

  function positionPopup(host, link) {
    const rect = link.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(POPUP_WIDTH, window.innerWidth - margin * 2);
    host.style.width = `${Math.max(0, width)}px`;
    host.style.maxHeight = `${Math.max(160, window.innerHeight - margin * 2)}px`;
    const hostRect = host.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - hostRect.width / 2;
    left = Math.min(left, window.innerWidth - hostRect.width - margin);
    left = Math.max(margin, left);
    let top = rect.bottom + 8;
    if (top + hostRect.height > window.innerHeight - margin) {
      top = rect.top - hostRect.height - 8;
    }
    top = Math.min(top, window.innerHeight - hostRect.height - margin);
    top = Math.max(margin, top);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatReferenceForDisplay(reference) {
    const normalized = normalizeReferenceText(reference);
    const quoted = normalized.match(/^(.*?)(["“])(.+?)(["”])([.,]?\s*)(.*)$/);
    if (quoted) {
      const authors = quoted[1].replace(/[,\s]+$/, "").trim();
      const title = quoted[3].trim();
      const tail = quoted[6].replace(/^\s*,\s*/, "").trim();
      const tailParts = splitReferenceTail(tail);
      return [authors, `“${title}”`, tailParts.source, tailParts.details]
        .filter(Boolean)
        .join("\n");
    }
    return wrapReferenceByCommas(normalized);
  }

  function normalizeReferenceText(reference) {
    return String(reference)
      .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, "$1$2")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/([“"])\s+/g, "$1")
      .replace(/\s+([”"])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitReferenceTail(tail) {
    if (!tail) {
      return { source: "", details: "" };
    }
    const parts = tail.split(/\s*,\s*/).filter(Boolean);
    const detailStart = parts.findIndex((part) => /^(vol\.|no\.|pp\.|p\.|pages?|art\.|doi\b|isbn\b|issn\b)/i.test(part));
    if (detailStart >= 0) {
      return {
        source: parts.slice(0, detailStart).join(", "),
        details: parts.slice(detailStart).join(", "),
      };
    }
    if (parts.length > 2 && /\b\d{4}\.?$/.test(parts[parts.length - 1])) {
      return {
        source: parts.slice(0, -1).join(", "),
        details: parts[parts.length - 1],
      };
    }
    return { source: tail, details: "" };
  }

  function wrapReferenceByCommas(reference) {
    const parts = reference.split(/\s*,\s*/).filter(Boolean);
    if (parts.length <= 2) {
      return reference;
    }
    const lines = [];
    let current = "";
    for (const part of parts) {
      const next = current ? `${current}, ${part}` : part;
      if (current && next.length > 92) {
        lines.push(current);
        current = part;
      } else {
        current = next;
      }
    }
    if (current) {
      lines.push(current);
    }
    return lines.join("\n");
  }

  async function showPreview(linkInfo) {
    const { link, text, href } = linkInfo;
    const host = ensurePopup();
    activeLink = link;
    link.classList.add("citation-preview-active");
    host.classList.remove("hidden");
    host.innerHTML = `
      <div class="citation-preview-title">
        <span>Reference</span>
        <span class="citation-preview-cite">${escapeHtml(text || "internal link")}</span>
      </div>
      <div class="citation-preview-muted">Loading target…</div>
    `;
    positionPopup(host, link);

    try {
      const destination = await resolveDestination(href);
      if (activeLink !== link) {
        return;
      }
      if (!destination || !destination.pageNumber) {
        host.innerHTML = `
          <div class="citation-preview-title"><span>Reference</span></div>
          <div class="citation-preview-muted">Could not resolve this PDF link target.</div>
        `;
        positionPopup(host, link);
        return;
      }
      const citationNumbers = extractCitationNumbers(text);
      const referenceFromLines = await extractReferenceFromVisualLines(destination, citationNumbers);
      const pageText = referenceFromLines || citationNumbers.length ? "" : await getReferenceSearchText(destination.pageNumber);
      const reference = referenceFromLines || extractReferenceEntry(pageText, citationNumbers);

      let body;
      if (reference) {
        body = `<pre class="citation-preview-reference">${escapeHtml(formatReferenceForDisplay(reference))}</pre>`;
      } else {
        const dataUrl = await renderPagePreview(destination.pageNumber);
        body = dataUrl
          ? `<img class="citation-preview-preview" src="${dataUrl}" alt="Target page preview">`
          : `<div class="citation-preview-muted">No reference text could be extracted.</div>`;
      }

      host.innerHTML = `
        <div class="citation-preview-title">
          <span>Reference</span>
          <span class="citation-preview-cite">${escapeHtml(text || `page ${destination.pageNumber}`)}</span>
        </div>
        <div class="citation-preview-body">${body}</div>
        <div class="citation-preview-actions">
          <button class="citation-preview-button" data-action="jump">Open</button>
        </div>
      `;
      host.querySelector('[data-action="jump"]').addEventListener("click", () => {
        hidePopup();
        link.click();
      });
      positionPopup(host, link);
    } catch (err) {
      host.innerHTML = `
        <div class="citation-preview-title"><span>Reference</span></div>
        <div class="citation-preview-muted">${escapeHtml(err && err.message ? err.message : "Could not preview this link.")}</div>
      `;
      positionPopup(host, link);
    }
  }

  function onMouseOver(event) {
    const linkInfo = getInternalLink(event.target);
    if (!linkInfo) {
      return;
    }
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (activeLink && activeLink !== linkInfo.link) {
      activeLink.classList.remove("citation-preview-active");
    }
    openTimer = setTimeout(() => {
      showPreview(linkInfo);
    }, HOVER_OPEN_DELAY);
  }

  function onMouseOut(event) {
    if (!activeLink && !openTimer) {
      return;
    }
    const related = event.relatedTarget;
    if (related && (related === popup || (popup && popup.contains(related)))) {
      return;
    }
    const link = event.target.closest && event.target.closest(".annotationLayer section[data-internal-link] > a");
    if (link) {
      scheduleClose();
    }
  }

  function install() {
    injectStyles();
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("scroll", () => {
      if (popup && !popup.classList.contains("hidden")) {
        hidePopup();
      }
    }, true);
  }

  window.addEventListener("load", () => {
    if (window.PDFViewerApplication && window.PDFViewerApplication.initializedPromise) {
      window.PDFViewerApplication.initializedPromise.then(install);
    } else {
      install();
    }
  }, { once: true });
}());
