import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  getDocument,
} from "./build/pdf.mjs";
import {
  DownloadManager,
  EventBus,
  FindState,
  GenericL10n,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
} from "./web/pdf_viewer.mjs";

const config = JSON.parse(
  document.getElementById("pdf-preview-config").getAttribute("data-config")
);

GlobalWorkerOptions.workerSrc = config.workerSrc;

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });
const downloadManager = new DownloadManager();
const l10n = new GenericL10n();
let pdfDocument;
let uiManager;
let sidebarUiManager;
let restoreViewState = null;
let cursorTool = "select";
let currentSidebarView = "thumbnail";
let currentScrollMode = ScrollMode.VERTICAL;
let currentSpreadMode = SpreadMode.NONE;
let lastGestureScale = 1;

const container = document.getElementById("viewerContainer");
const viewerElement = document.getElementById("viewer");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarContainer = document.getElementById("sidebarContainer");
const viewThumbnail = document.getElementById("viewThumbnail");
const viewOutline = document.getElementById("viewOutline");
const viewAttachments = document.getElementById("viewAttachments");
const viewLayers = document.getElementById("viewLayers");
const currentOutlineItem = document.getElementById("currentOutlineItem");
const sidebarResizer = document.getElementById("sidebarResizer");
const thumbnailView = document.getElementById("thumbnailView");
const outlineView = document.getElementById("outlineView");
const attachmentsView = document.getElementById("attachmentsView");
const layersView = document.getElementById("layersView");
const pageNumberInput = document.getElementById("pageNumber");
const pageCount = document.getElementById("pageCount");
const scaleSelect = document.getElementById("scaleSelect");
const status = document.getElementById("status");
const findbar = document.getElementById("findbar");
const findInput = document.getElementById("findInput");
const findResultsCount = document.getElementById("findResultsCount");
const findMsg = document.getElementById("findMsg");
const secondaryToolbar = document.getElementById("secondaryToolbar");
const secondaryToolbarToggle = document.getElementById("secondaryToolbarToggle");
const documentPropertiesDialog = document.getElementById("documentPropertiesDialog");
const loadingBar = document.getElementById("loadingBar");
const loadingProgress = document.getElementById("loadingProgress");
const passwordDialog = document.getElementById("passwordDialog");
const passwordInput = document.getElementById("password");
const passwordSubmit = document.getElementById("passwordSubmit");
const passwordCancel = document.getElementById("passwordCancel");
const freeTextParamsToolbar = document.getElementById("editorFreeTextParamsToolbar");
const inkParamsToolbar = document.getElementById("editorInkParamsToolbar");
const commentPopup = document.getElementById("commentPopup");
const commentText = document.getElementById("commentText");
const commentSave = document.getElementById("commentSave");
const commentCancel = document.getElementById("commentCancel");
const commentDelete = document.getElementById("commentDelete");
const selectionPopup = document.getElementById("selectionPopup");
const selectionHighlight = document.getElementById("selectionHighlight");
const selectionComment = document.getElementById("selectionComment");

let activeCommentEditor = null;
let lastTextSelectionRange = null;
const appShim = (window.PDFViewerApplication =
  window.PDFViewerApplication || {});

function setStatus(text) {
  status.textContent = text || "";
  document.body.dataset.scholarStage = text || "";
}

function clampPopup(left, top) {
  const margin = 10;
  const rect = commentPopup.getBoundingClientRect();
  return {
    left: Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin)),
    top: Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin)),
  };
}

function hideCommentPopup() {
  commentPopup.classList.add("hidden");
  activeCommentEditor?.setCommentButtonStates?.({
    selected: false,
    hasPopup: false,
  });
  activeCommentEditor = null;
}

function showCommentPopup(editor, left, top) {
  activeCommentEditor = editor;
  commentText.value = editor?.comment?.text || editor?.comment || "";
  commentPopup.classList.remove("hidden");
  const pos = clampPopup(left, top);
  commentPopup.style.left = `${pos.left}px`;
  commentPopup.style.top = `${pos.top}px`;
  editor?.setCommentButtonStates?.({
    selected: true,
    hasPopup: true,
  });
  commentText.focus();
  commentText.select();
}

const commentManager = {
  get dialogElement() {
    return commentPopup;
  },
  setSidebarUiManager(manager) {
    sidebarUiManager = manager;
  },
  showDialog(_uiManager, editor, left, top) {
    showCommentPopup(editor, left, top);
  },
  toggleCommentPopup(editor, isSelected, visibility) {
    if (!editor) {
      hideCommentPopup();
      return;
    }
    if (visibility === false) {
      return;
    }
    if (isSelected || visibility === true || activeCommentEditor !== editor) {
      const anchor = editor.elementBeforePopup || editor.div || viewerElement;
      const rect = anchor.getBoundingClientRect();
      showCommentPopup(editor, rect.right + 8, rect.top);
    } else {
      hideCommentPopup();
    }
  },
  makeCommentColor(color, opacity = 1) {
    if (Array.isArray(color)) {
      return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity})`;
    }
    return color || "rgba(255, 211, 77, 0.95)";
  },
  updateComment() {},
  updatePopupColor() {},
  removeComments() {},
  showSidebar(comments = []) {
    setStatus(`${comments.length} comment${comments.length === 1 ? "" : "s"}`);
  },
  hideSidebar() {},
  destroyPopup() {
    hideCommentPopup();
  },
  destroy() {
    sidebarUiManager = null;
    hideCommentPopup();
  },
};

const pdfViewer = new PDFViewer({
  container,
  viewer: viewerElement,
  eventBus,
  linkService,
  findController,
  downloadManager,
  l10n,
  annotationMode: AnnotationMode.ENABLE_FORMS,
  annotationEditorMode: AnnotationEditorType.NONE,
  annotationEditorHighlightColors:
    "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F," +
    "yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043",
  enableHighlightFloatingButton: false,
  enableUpdatedAddImage: true,
  enableNewAltTextWhenAddingImage: false,
  imageResourcesPath: config.imageResourcesPath,
  commentManager,
});

linkService.setViewer(pdfViewer);
Object.assign(appShim, {
  initializedPromise: Promise.resolve(),
  eventBus,
  pdfViewer,
  pdfLinkService: linkService,
});

eventBus.on("pagesinit", () => {
  if (restoreViewState) {
    setScrollMode(restoreViewState.scrollMode ?? currentScrollMode);
    setSpreadMode(restoreViewState.spreadMode ?? currentSpreadMode);
    pdfViewer.pagesRotation = restoreViewState.pagesRotation || 0;
    pdfViewer.currentScaleValue = restoreViewState.scaleValue || config.defaults?.scale || "auto";
  } else {
    setScrollMode(defaultScrollMode(config.defaults?.scrollMode));
    setSpreadMode(defaultSpreadMode(config.defaults?.spreadMode));
    pdfViewer.currentScaleValue = config.defaults?.scale || "auto";
  }
  scaleSelect.value = pdfViewer.currentScaleValue || config.defaults?.scale || "auto";
  pageCount.textContent = String(pdfViewer.pagesCount);
  pageNumberInput.max = String(pdfViewer.pagesCount);
  setSidebarOpen(
    restoreViewState ? !restoreViewState.sidebarHidden : !!config.defaults?.sidebar
  );
  setSidebarView(restoreViewState?.sidebarView || currentSidebarView);
  setStatus("Ready");
  if (restoreViewState) {
    const state = restoreViewState;
    restoreViewState = null;
    window.setTimeout(() => {
      pdfViewer.currentPageNumber = state.pageNumber || 1;
      container.scrollLeft = state.scrollLeft || 0;
      container.scrollTop = state.scrollTop || 0;
      pageNumberInput.value = String(pdfViewer.currentPageNumber);
    }, 0);
  }
});

eventBus.on("pagechanging", ({ pageNumber }) => {
  pageNumberInput.value = String(pageNumber);
  updateActiveThumbnail(pageNumber);
});

eventBus.on("scalechanging", ({ presetValue, scale }) => {
  const value = presetValue || String(scale);
  const existing = Array.from(scaleSelect.options).some(
    option => option.value === value
  );
  if (existing) {
    scaleSelect.value = value;
  } else {
    setCustomScaleOption(scale);
  }
});

eventBus.on("updatefindmatchescount", ({ matchesCount }) => {
  const current = matchesCount?.current || 0;
  const total = matchesCount?.total || 0;
  findResultsCount.textContent = total ? `${current} of ${total}` : "";
});

eventBus.on("updatefindcontrolstate", ({ state, matchesCount }) => {
  if (matchesCount) {
    const current = matchesCount.current || 0;
    const total = matchesCount.total || 0;
    findResultsCount.textContent = total ? `${current} of ${total}` : "";
  }
  if (!findMsg) {
    return;
  }
  findMsg.textContent =
    state === FindState.NOT_FOUND ? "No results" : state === FindState.WRAPPED ? "Wrapped" : "";
});

eventBus.on("annotationeditoruimanager", ({ uiManager: manager }) => {
  uiManager = manager;
});

eventBus.on(
  "showannotationeditorui",
  async ({
    mode,
    editId = null,
    isFromKeyboard = false,
    mustEnterInEditMode = false,
    editComment = false,
  }) => {
    if (!uiManager) {
      return;
    }
    await uiManager.updateMode(
      mode,
      editId,
      true,
      isFromKeyboard,
      mustEnterInEditMode,
      editComment
    );
    eventBus.dispatch("annotationeditormodechanged", {
      source: pdfViewer,
      mode,
    });
  }
);

function zoomBy(factor) {
  const current = pdfViewer.currentScale || 1;
  const next = Math.max(0.25, Math.min(4, current * factor));
  pdfViewer.currentScaleValue = String(Math.round(next * 100) / 100);
}

function setCustomScaleOption(scale) {
  if (!scale || !Number.isFinite(scale)) {
    return;
  }
  let option = scaleSelect.querySelector('option[value="custom"]');
  if (!option) {
    option = document.createElement("option");
    option.value = "custom";
    scaleSelect.append(option);
  }
  option.hidden = false;
  option.disabled = false;
  option.textContent = `${Math.round(scale * 100)}%`;
  scaleSelect.value = "custom";
}

function zoomAroundPoint(factor, clientX, clientY) {
  const oldScale = pdfViewer.currentScale || 1;
  const nextScale = Math.max(0.25, Math.min(5, oldScale * factor));
  if (Math.abs(nextScale - oldScale) < 0.001) {
    return;
  }
  const rect = container.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const offsetY = clientY - rect.top;
  const scrollLeft = container.scrollLeft;
  const scrollTop = container.scrollTop;
  pdfViewer.currentScaleValue = String(Math.round(nextScale * 10000) / 10000);
  setCustomScaleOption(nextScale);
  window.requestAnimationFrame(() => {
    const ratio = nextScale / oldScale;
    container.scrollLeft = (scrollLeft + offsetX) * ratio - offsetX;
    container.scrollTop = (scrollTop + offsetY) * ratio - offsetY;
  });
}

function defaultScrollMode(value) {
  switch (value) {
    case "page":
      return ScrollMode.PAGE;
    case "horizontal":
      return ScrollMode.HORIZONTAL;
    case "wrapped":
      return ScrollMode.WRAPPED;
    case "vertical":
    default:
      return ScrollMode.VERTICAL;
  }
}

function defaultSpreadMode(value) {
  switch (value) {
    case "odd":
      return SpreadMode.ODD;
    case "even":
      return SpreadMode.EVEN;
    case "none":
    default:
      return SpreadMode.NONE;
  }
}

function setToolbarPressed(id, pressed) {
  const button = document.getElementById(id);
  button?.classList.toggle("toggled", pressed);
  button?.setAttribute("aria-pressed", String(pressed));
}

function setScrollMode(mode) {
  currentScrollMode = mode;
  pdfViewer.scrollMode = mode;
  setToolbarPressed("scrollPage", mode === ScrollMode.PAGE);
  setToolbarPressed("scrollVertical", mode === ScrollMode.VERTICAL);
  setToolbarPressed("scrollHorizontal", mode === ScrollMode.HORIZONTAL);
  setToolbarPressed("scrollWrapped", mode === ScrollMode.WRAPPED);
}

function setSpreadMode(mode) {
  currentSpreadMode = mode;
  pdfViewer.spreadMode = mode;
  setToolbarPressed("spreadNone", mode === SpreadMode.NONE);
  setToolbarPressed("spreadOdd", mode === SpreadMode.ODD);
  setToolbarPressed("spreadEven", mode === SpreadMode.EVEN);
}

function setCursorTool(tool) {
  cursorTool = tool;
  document.body.classList.toggle("handTool", tool === "hand");
  setToolbarPressed("cursorSelectTool", tool === "select");
  setToolbarPressed("cursorHandTool", tool === "hand");
}

function snapshotViewState() {
  return {
    pageNumber: pdfViewer.currentPageNumber,
    scaleValue: pdfViewer.currentScaleValue || scaleSelect.value,
    scrollLeft: container.scrollLeft,
    scrollTop: container.scrollTop,
    sidebarHidden: sidebarContainer.classList.contains("hidden"),
    sidebarView: currentSidebarView,
    scrollMode: currentScrollMode,
    spreadMode: currentSpreadMode,
    pagesRotation: pdfViewer.pagesRotation || 0,
  };
}

function setSidebarView(view) {
  currentSidebarView = view;
  const buttons = {
    thumbnail: viewThumbnail,
    outline: viewOutline,
    attachments: viewAttachments,
    layers: viewLayers,
  };
  const panes = {
    thumbnail: thumbnailView,
    outline: outlineView,
    attachments: attachmentsView,
    layers: layersView,
  };
  for (const [name, button] of Object.entries(buttons)) {
    button?.classList.toggle("active", view === name);
    button?.setAttribute("aria-selected", String(view === name));
  }
  for (const [name, pane] of Object.entries(panes)) {
    pane?.classList.toggle("hidden", view !== name);
  }
}

function updateActiveThumbnail(pageNumber) {
  for (const item of thumbnailView.querySelectorAll(".thumbnailItem")) {
    item.classList.toggle("active", Number(item.dataset.pageNumber) === pageNumber);
  }
}

async function renderOutline() {
  outlineView.textContent = "";
  const outline = await pdfDocument.getOutline();
  if (!outline?.length) {
    const empty = document.createElement("div");
    empty.className = "sidebarEmpty";
    empty.textContent = "No outline";
    outlineView.append(empty);
    return;
  }
  outlineView.append(renderOutlineItems(outline));
  currentOutlineItem.disabled = false;
}

function renderOutlineItems(items) {
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outlineItem";
    button.textContent = item.title || "Untitled";
    button.title = item.title || "";
    button.addEventListener("click", () => {
      if (item.url) {
        window.open(item.url, "_blank", "noopener");
      } else if (item.dest) {
        linkService.goToDestination(item.dest);
      }
    });
    fragment.append(button);
    if (item.items?.length) {
      const children = document.createElement("div");
      children.className = "outlineChildren";
      children.append(renderOutlineItems(item.items));
      fragment.append(children);
    }
  }
  return fragment;
}

function dispatchFind(type = "find", findPrevious = false) {
  eventBus.dispatch("find", {
    source: window,
    type,
    query: findInput.value,
    phraseSearch: true,
    caseSensitive: document.getElementById("findMatchCase").checked,
    entireWord: document.getElementById("findEntireWord").checked,
    highlightAll: document.getElementById("findHighlightAll").checked,
    matchDiacritics: document.getElementById("findMatchDiacritics").checked,
    findPrevious,
  });
}

function closePopoversExcept(except) {
  if (except !== "findbar") {
    findbar.classList.add("hidden");
    document.getElementById("viewFind")?.setAttribute("aria-expanded", "false");
  }
  if (except !== "secondaryToolbar") {
    secondaryToolbar.classList.add("hidden");
    secondaryToolbarToggle?.setAttribute("aria-expanded", "false");
  }
}

function setSidebarOpen(open) {
  sidebarContainer.classList.toggle("hidden", !open);
  document.body.classList.toggle("sidebarOpen", open);
  sidebarToggle?.setAttribute("aria-expanded", String(open));
}

function setSidebarWidth(width) {
  const next = Math.max(160, Math.min(420, width));
  sidebarContainer.style.width = `${next}px`;
  document.body.style.setProperty("--scholar-sidebar-width", `${next}px`);
}

function setField(id, value) {
  const field = document.getElementById(id);
  if (field) {
    field.textContent = value || "-";
  }
}

function parsePdfDate(value) {
  if (!value || typeof value !== "string") {
    return "-";
  }
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!match) {
    return value;
  }
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00"] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

async function showDocumentProperties() {
  if (!pdfDocument) {
    return;
  }
  const metadata = await pdfDocument.getMetadata().catch(() => ({}));
  const info = metadata?.info || {};
  const fileName = decodeURIComponent((config.path.split("/").pop() || "document.pdf").split("?")[0]);
  setField("fileNameField", fileName);
  setField("titleField", info.Title);
  setField("authorField", info.Author);
  setField("subjectField", info.Subject);
  setField("keywordsField", info.Keywords);
  setField("creatorField", info.Creator);
  setField("producerField", info.Producer);
  setField("versionField", info.PDFFormatVersion);
  setField("pageCountField", String(pdfDocument.numPages || "-"));
  setField("creationDateField", parsePdfDate(info.CreationDate));
  setField("modificationDateField", parsePdfDate(info.ModDate));
  if (typeof documentPropertiesDialog.showModal === "function") {
    documentPropertiesDialog.showModal();
  } else {
    documentPropertiesDialog.setAttribute("open", "");
  }
}

function showPasswordDialog(updatePassword, reason) {
  const label = document.getElementById("passwordText");
  if (label) {
    label.textContent =
      reason === PasswordResponses.INCORRECT_PASSWORD
        ? "Invalid password. Please try again."
        : "Enter the password to open this PDF file:";
  }
  passwordInput.value = "";
  const submit = () => {
    cleanup();
    updatePassword(passwordInput.value);
  };
  const cancel = () => {
    cleanup();
    updatePassword(new Error("Password dialog cancelled."));
  };
  const onKeyDown = event => {
    if (event.key === "Enter") {
      submit();
    } else if (event.key === "Escape") {
      cancel();
    }
  };
  const cleanup = () => {
    passwordSubmit.removeEventListener("click", submit);
    passwordCancel.removeEventListener("click", cancel);
    passwordInput.removeEventListener("keydown", onKeyDown);
    passwordDialog.close?.();
    passwordDialog.removeAttribute("open");
  };
  passwordSubmit.addEventListener("click", submit);
  passwordCancel.addEventListener("click", cancel);
  passwordInput.addEventListener("keydown", onKeyDown);
  if (typeof passwordDialog.showModal === "function") {
    passwordDialog.showModal();
  } else {
    passwordDialog.setAttribute("open", "");
  }
  passwordInput.focus();
}

function dispatchEditorParam(type, value) {
  eventBus.dispatch("switchannotationeditorparams", {
    source: window,
    type,
    value,
  });
}

function setParamsToolbar(mode) {
  freeTextParamsToolbar.classList.toggle("hidden", mode !== AnnotationEditorType.FREETEXT);
  inkParamsToolbar.classList.toggle("hidden", mode !== AnnotationEditorType.INK);
}

async function renderAttachments() {
  attachmentsView.textContent = "";
  const attachments = await pdfDocument.getAttachments();
  if (!attachments || Object.keys(attachments).length === 0) {
    const empty = document.createElement("div");
    empty.className = "sidebarEmpty";
    empty.textContent = "No attachments";
    attachmentsView.append(empty);
    return;
  }
  for (const [name, attachment] of Object.entries(attachments)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outlineItem";
    button.textContent = name;
    button.title = name;
    button.addEventListener("click", () => {
      const blob = new Blob([attachment.content]);
      downloadManager.download(blob, "", name);
    });
    attachmentsView.append(button);
  }
}

async function renderLayers() {
  layersView.textContent = "";
  const optionalContentConfig = await pdfViewer.optionalContentConfigPromise.catch(() => null);
  const order = optionalContentConfig?.getOrder?.();
  if (!optionalContentConfig || !Array.isArray(order) || order.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sidebarEmpty";
    empty.textContent = "No layers";
    layersView.append(empty);
    return;
  }
  renderLayerItems(order, optionalContentConfig, layersView);
}

function renderLayerItems(items, optionalContentConfig, parent) {
  for (const item of items) {
    if (typeof item === "string") {
      const group = optionalContentConfig.getGroup?.(item);
      const label = document.createElement("label");
      label.className = "outlineItem";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = group?.visible ?? true;
      input.addEventListener("change", () => {
        optionalContentConfig.setVisibility?.(item, input.checked);
        pdfViewer.optionalContentConfigPromise = Promise.resolve(optionalContentConfig);
      });
      label.append(input, ` ${group?.name || item}`);
      parent.append(label);
    } else if (item?.name || item?.order) {
      const heading = document.createElement("div");
      heading.className = "sidebarEmpty";
      heading.textContent = item.name || "Layer group";
      parent.append(heading);
      if (Array.isArray(item.order)) {
        renderLayerItems(item.order, optionalContentConfig, parent);
      }
    }
  }
}

async function renderThumbnails() {
  thumbnailView.textContent = "";
  const pagesCount = pdfDocument.numPages;
  for (let pageNumber = 1; pageNumber <= pagesCount; pageNumber += 1) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "thumbnailItem";
    item.dataset.pageNumber = String(pageNumber);
    item.title = `Page ${pageNumber}`;
    item.addEventListener("click", () => {
      pdfViewer.currentPageNumber = pageNumber;
    });
    const label = document.createElement("div");
    label.textContent = String(pageNumber);
    item.append(label);
    thumbnailView.append(item);
    renderThumbnailCanvas(pageNumber, item).catch(err => {
      console.warn("Failed to render thumbnail", pageNumber, err);
    });
  }
  updateActiveThumbnail(pdfViewer.currentPageNumber || 1);
}

async function renderThumbnailCanvas(pageNumber, item) {
  const page = await pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = 116 / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.setAttribute("aria-label", `Thumbnail of page ${pageNumber}`);
  item.prepend(canvas);
  await page.render({ canvasContext: context, viewport }).promise;
}

function rememberTextSelection() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    hideSelectionPopup();
    return;
  }
  const range = selection.getRangeAt(0);
  const anchor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!anchor?.closest?.(".textLayer")) {
    return;
  }
  lastTextSelectionRange = range.cloneRange();
  showSelectionPopup(range);
}

function restoreTextSelection() {
  if (!lastTextSelectionRange) {
    return false;
  }
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(lastTextSelectionRange.cloneRange());
  return true;
}

function hideSelectionPopup() {
  selectionPopup.classList.add("hidden");
}

function showSelectionPopup(range) {
  const rects = Array.from(range.getClientRects()).filter(
    rect => rect.width > 0 && rect.height > 0
  );
  const rect = rects[rects.length - 1] || range.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    hideSelectionPopup();
    return;
  }
  selectionPopup.classList.remove("hidden");
  const popupRect = selectionPopup.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(
      rect.left + rect.width / 2 - popupRect.width / 2,
      window.innerWidth - popupRect.width - margin
    )
  );
  const below = rect.bottom + 8;
  const top =
    below + popupRect.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, rect.top - popupRect.height - 8);
  selectionPopup.style.left = `${left}px`;
  selectionPopup.style.top = `${top}px`;
}

function runSelectionAction(action) {
  if (!restoreTextSelection()) {
    return;
  }
  hideSelectionPopup();
  if (action === "comment") {
    uiManager?.commentSelection?.("floating_button");
  } else {
    uiManager?.highlightSelection?.("floating_button");
    resetSelectionMode({ reselectNewest: true });
  }
}

document.addEventListener("selectionchange", rememberTextSelection);
document.addEventListener("pointerup", rememberTextSelection, true);
document.addEventListener("mouseup", rememberTextSelection, true);
document.addEventListener("keyup", rememberTextSelection, true);
selectionPopup.addEventListener("mousedown", event => {
  event.preventDefault();
});
selectionHighlight.addEventListener("click", () => {
  runSelectionAction("highlight");
});
selectionComment.addEventListener("click", () => {
  runSelectionAction("comment");
});
document.addEventListener("scroll", hideSelectionPopup, true);

function setMode(mode) {
  uiManager?.updateMode(mode);
  setParamsToolbar(mode);
  document.getElementById("highlightButton").classList.toggle(
    "toggled",
    mode === AnnotationEditorType.HIGHLIGHT
  );
  document.getElementById("textButton").classList.toggle(
    "toggled",
    mode === AnnotationEditorType.FREETEXT
  );
  document.getElementById("inkButton").classList.toggle(
    "toggled",
    mode === AnnotationEditorType.INK
  );
  document.getElementById("stampButton").classList.toggle(
    "toggled",
    mode === AnnotationEditorType.STAMP
  );
}

function resetSelectionMode({ reselectNewest = false, preferredEditor = null } = {}) {
  window.setTimeout(() => {
    setMode(AnnotationEditorType.NONE);
    eventBus.dispatch("annotationeditormodechanged", {
      source: pdfViewer,
      mode: AnnotationEditorType.NONE,
    });
    if (preferredEditor?.div) {
      selectEditorElement(preferredEditor.div);
    } else if (reselectNewest) {
      selectNewestEditor();
    }
  }, 150);
}

function selectNewestEditor() {
  const editors = viewerElement.querySelectorAll(
    ".annotationEditorLayer :is(.highlightEditor, .freeTextEditor, .inkEditor, .stampEditor)"
  );
  const editor = editors[editors.length - 1];
  if (editor) {
    selectEditorElement(editor);
  }
}

function selectEditorElement(editor) {
  const rect = editor.getBoundingClientRect();
  const event = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  });
  editor.dispatchEvent(event);
}

function getCitationLinkAtPoint(x, y) {
  for (const element of document.elementsFromPoint(x, y)) {
    const link = element.closest?.(".annotationLayer section[data-internal-link] > a");
    if (link) {
      return link;
    }
  }
  return null;
}

function getEditorAtPoint(x, y) {
  const editors = Array.from(
    viewerElement.querySelectorAll(
      ".annotationEditorLayer :is(.highlightEditor, .freeTextEditor, .inkEditor, .stampEditor)"
    )
  ).reverse();
  return editors.find(editor => {
    const rect = editor.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
}

function handleReadModePointerDown(event) {
  if (!uiManager || uiManager.getMode?.() !== AnnotationEditorType.NONE) {
    return;
  }
  const target = event.target;
  if (
    target.closest?.("#selectionPopup, #commentPopup, .editToolbar, .annotationCommentButton")
  ) {
    return;
  }
  if (getCitationLinkAtPoint(event.clientX, event.clientY)) {
    return;
  }
  const editor = getEditorAtPoint(event.clientX, event.clientY);
  if (editor) {
    selectEditorElement(editor);
    return;
  }
  if (target.closest?.(".page")) {
    uiManager.unselectAll?.();
    hideCommentPopup();
    hideSelectionPopup();
  }
}

function labelEditorToolbarButtons(root = document) {
  ensureToolbarCommentButtons(root);
  const labels = [
    [".editToolbar .colorPicker", "Change highlight color"],
    [
      ".editToolbar .commentButton, .editToolbar .comment, .editToolbar .scholarCommentButton",
      "Add or edit comment",
    ],
    [".editToolbar .deleteButton", "Remove highlight"],
    [".annotationCommentButton", "Open comment"],
  ];
  for (const [selector, label] of labels) {
    for (const button of root.querySelectorAll(selector)) {
      button.title = label;
      button.setAttribute("aria-label", label);
    }
  }
}

function ensureToolbarCommentButtons(root = document) {
  const toolbars = root.matches?.(".editToolbar")
    ? [root]
    : Array.from(root.querySelectorAll?.(".editToolbar") || []);
  for (const toolbar of toolbars) {
    if (toolbar.querySelector(".comment, .commentButton, .scholarCommentButton")) {
      continue;
    }
    const editor = toolbar.closest(
      ".highlightEditor, .freeTextEditor, .inkEditor, .stampEditor"
    );
    if (!editor?.querySelector(".annotationCommentButton")) {
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comment scholarCommentButton";
    button.title = "Add or edit comment";
    button.setAttribute("aria-label", "Add or edit comment");
    button.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      editor.querySelector(".annotationCommentButton")?.click();
    });
    const deleteButton = toolbar.querySelector(".deleteButton");
    deleteButton?.before(button);
  }
}

const toolbarObserver = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        labelEditorToolbarButtons(node);
      }
    }
  }
});
toolbarObserver.observe(viewerElement, { childList: true, subtree: true });
document.addEventListener("pointerdown", handleReadModePointerDown, true);

document.getElementById("viewFind").addEventListener("click", () => {
  const hidden = findbar.classList.contains("hidden");
  closePopoversExcept("findbar");
  findbar.classList.toggle("hidden", !hidden);
  document.getElementById("viewFind").setAttribute("aria-expanded", String(hidden));
  if (hidden) {
    findInput.focus();
    findInput.select();
  } else {
    eventBus.dispatch("findbarclose", { source: window });
  }
});

findInput.addEventListener("input", () => {
  dispatchFind("find", false);
});

findInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    dispatchFind("again", event.shiftKey);
  } else if (event.key === "Escape") {
    findbar.classList.add("hidden");
    eventBus.dispatch("findbarclose", { source: window });
  }
});

document.getElementById("findPrevious").addEventListener("click", () => {
  dispatchFind("again", true);
});

document.getElementById("findNext").addEventListener("click", () => {
  dispatchFind("again", false);
});

for (const id of [
  "findHighlightAll",
  "findMatchCase",
  "findMatchDiacritics",
  "findEntireWord",
]) {
  document.getElementById(id).addEventListener("change", () => {
    dispatchFind("find", false);
  });
}

document.getElementById("editorFreeTextColor")?.addEventListener("input", event => {
  dispatchEditorParam(AnnotationEditorParamsType.FREETEXT_COLOR, event.target.value);
});

document.getElementById("editorFreeTextFontSize")?.addEventListener("input", event => {
  dispatchEditorParam(AnnotationEditorParamsType.FREETEXT_SIZE, Number(event.target.value));
});

document.getElementById("editorInkColor")?.addEventListener("input", event => {
  dispatchEditorParam(AnnotationEditorParamsType.INK_COLOR, event.target.value);
});

document.getElementById("editorInkThickness")?.addEventListener("input", event => {
  dispatchEditorParam(AnnotationEditorParamsType.INK_THICKNESS, Number(event.target.value));
});

document.getElementById("editorInkOpacity")?.addEventListener("input", event => {
  dispatchEditorParam(AnnotationEditorParamsType.INK_OPACITY, Number(event.target.value) / 100);
});

secondaryToolbarToggle.addEventListener("click", () => {
  const hidden = secondaryToolbar.classList.contains("hidden");
  closePopoversExcept("secondaryToolbar");
  secondaryToolbar.classList.toggle("hidden", !hidden);
  secondaryToolbarToggle.setAttribute("aria-expanded", String(hidden));
});

sidebarToggle.addEventListener("click", () => {
  setSidebarOpen(sidebarContainer.classList.contains("hidden"));
});

viewThumbnail.addEventListener("click", () => {
  setSidebarView("thumbnail");
});

viewOutline.addEventListener("click", () => {
  setSidebarView("outline");
});

viewAttachments.addEventListener("click", () => {
  setSidebarView("attachments");
});

viewLayers.addEventListener("click", () => {
  setSidebarView("layers");
});

currentOutlineItem.addEventListener("click", () => {
  setSidebarOpen(true);
  setSidebarView("outline");
  const active = outlineView.querySelector(".outlineItem.active");
  active?.scrollIntoView?.({ block: "nearest" });
});

let sidebarDrag = null;
sidebarResizer.addEventListener("pointerdown", event => {
  sidebarDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    width: sidebarContainer.getBoundingClientRect().width,
  };
  document.body.classList.add("resizingSidebar");
  sidebarResizer.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

sidebarResizer.addEventListener("pointermove", event => {
  if (!sidebarDrag || sidebarDrag.pointerId !== event.pointerId) {
    return;
  }
  setSidebarWidth(sidebarDrag.width + event.clientX - sidebarDrag.x);
});

sidebarResizer.addEventListener("pointerup", event => {
  if (!sidebarDrag || sidebarDrag.pointerId !== event.pointerId) {
    return;
  }
  sidebarDrag = null;
  document.body.classList.remove("resizingSidebar");
  sidebarResizer.releasePointerCapture?.(event.pointerId);
});

document.getElementById("previous").addEventListener("click", () => {
  pdfViewer.previousPage();
});

document.getElementById("next").addEventListener("click", () => {
  pdfViewer.nextPage();
});

document.getElementById("firstPage").addEventListener("click", () => {
  pdfViewer.currentPageNumber = 1;
});

document.getElementById("lastPage").addEventListener("click", () => {
  pdfViewer.currentPageNumber = pdfViewer.pagesCount || pdfDocument?.numPages || 1;
});

document.getElementById("pageRotateCw").addEventListener("click", () => {
  pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
});

document.getElementById("pageRotateCcw").addEventListener("click", () => {
  pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 270) % 360;
});

document.getElementById("cursorSelectTool").addEventListener("click", () => {
  setCursorTool("select");
});

document.getElementById("cursorHandTool").addEventListener("click", () => {
  setCursorTool("hand");
});

document.getElementById("scrollPage").addEventListener("click", () => {
  setScrollMode(ScrollMode.PAGE);
});

document.getElementById("scrollVertical").addEventListener("click", () => {
  setScrollMode(ScrollMode.VERTICAL);
});

document.getElementById("scrollHorizontal").addEventListener("click", () => {
  setScrollMode(ScrollMode.HORIZONTAL);
});

document.getElementById("scrollWrapped").addEventListener("click", () => {
  setScrollMode(ScrollMode.WRAPPED);
});

document.getElementById("spreadNone").addEventListener("click", () => {
  setSpreadMode(SpreadMode.NONE);
});

document.getElementById("spreadOdd").addEventListener("click", () => {
  setSpreadMode(SpreadMode.ODD);
});

document.getElementById("spreadEven").addEventListener("click", () => {
  setSpreadMode(SpreadMode.EVEN);
});

document.getElementById("documentProperties").addEventListener("click", () => {
  closePopoversExcept();
  showDocumentProperties().catch(err => console.warn("Failed to show properties", err));
});

document.getElementById("documentPropertiesClose").addEventListener("click", () => {
  documentPropertiesDialog.close?.();
  documentPropertiesDialog.removeAttribute("open");
});

document.getElementById("viewBookmark").addEventListener("click", async () => {
  const value = `${config.path}#page=${pdfViewer.currentPageNumber}`;
  await navigator.clipboard?.writeText?.(value);
  setStatus("Copied current view");
});

document.getElementById("presentationMode").addEventListener("click", () => {
  (container.requestFullscreen || document.documentElement.requestFullscreen)?.call(container);
});

document.getElementById("printButton").addEventListener("click", () => {
  window.print();
});

document.getElementById("print")?.addEventListener("click", () => {
  document.getElementById("printButton").click();
});

document.getElementById("secondaryPrint")?.addEventListener("click", () => {
  document.getElementById("printButton").click();
});

let handDrag = null;
container.addEventListener("pointerdown", event => {
  if (cursorTool !== "hand" || event.button !== 0) {
    return;
  }
  if (event.target.closest?.("button, input, textarea, select, a, #selectionPopup, #commentPopup")) {
    return;
  }
  handDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: container.scrollLeft,
    top: container.scrollTop,
  };
  document.body.classList.add("handToolDragging");
  container.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

container.addEventListener("pointermove", event => {
  if (!handDrag || handDrag.pointerId !== event.pointerId) {
    return;
  }
  container.scrollLeft = handDrag.left - (event.clientX - handDrag.x);
  container.scrollTop = handDrag.top - (event.clientY - handDrag.y);
});

container.addEventListener("pointerup", event => {
  if (!handDrag || handDrag.pointerId !== event.pointerId) {
    return;
  }
  handDrag = null;
  document.body.classList.remove("handToolDragging");
  container.releasePointerCapture?.(event.pointerId);
});

container.addEventListener(
  "wheel",
  event => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const factor = Math.exp(-event.deltaY * 0.01);
    zoomAroundPoint(factor, event.clientX, event.clientY);
  },
  { passive: false }
);

window.addEventListener("gesturestart", event => {
  lastGestureScale = event.scale || 1;
  event.preventDefault();
});

window.addEventListener("gesturechange", event => {
  event.preventDefault();
  const scale = event.scale || 1;
  const factor = scale / lastGestureScale;
  lastGestureScale = scale;
  zoomAroundPoint(factor, event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2);
});

document.getElementById("zoomOutButton").addEventListener("click", () => {
  zoomBy(1 / 1.1);
});

document.getElementById("zoomInButton").addEventListener("click", () => {
  zoomBy(1.1);
});

pageNumberInput.addEventListener("change", () => {
  pdfViewer.currentPageNumber = Number(pageNumberInput.value) || 1;
});

scaleSelect.addEventListener("change", () => {
  pdfViewer.currentScaleValue = scaleSelect.value;
});

document.getElementById("highlightButton").addEventListener("click", () => {
  setMode(
    uiManager?.getMode?.() === AnnotationEditorType.HIGHLIGHT
      ? AnnotationEditorType.NONE
      : AnnotationEditorType.HIGHLIGHT
  );
});

document.getElementById("textButton").addEventListener("click", () => {
  setMode(
    uiManager?.getMode?.() === AnnotationEditorType.FREETEXT
      ? AnnotationEditorType.NONE
      : AnnotationEditorType.FREETEXT
  );
});

document.getElementById("inkButton").addEventListener("click", () => {
  setMode(
    uiManager?.getMode?.() === AnnotationEditorType.INK
      ? AnnotationEditorType.NONE
      : AnnotationEditorType.INK
  );
});

document.getElementById("stampButton").addEventListener("click", () => {
  setMode(
    uiManager?.getMode?.() === AnnotationEditorType.STAMP
      ? AnnotationEditorType.NONE
      : AnnotationEditorType.STAMP
  );
});

commentSave.addEventListener("click", () => {
  const editor = activeCommentEditor;
  if (activeCommentEditor) {
    activeCommentEditor.comment = commentText.value;
    uiManager?.updateComment?.(activeCommentEditor);
  }
  hideCommentPopup();
  resetSelectionMode({ preferredEditor: editor });
});

commentDelete.addEventListener("click", () => {
  const editor = activeCommentEditor;
  if (activeCommentEditor) {
    activeCommentEditor.comment = "";
    uiManager?.deleteComment?.(activeCommentEditor, commentText.value);
  }
  hideCommentPopup();
  resetSelectionMode({ preferredEditor: editor });
});

commentCancel.addEventListener("click", () => {
  const editor = activeCommentEditor;
  hideCommentPopup();
  resetSelectionMode({ preferredEditor: editor });
});

document.getElementById("saveButton").addEventListener("click", async () => {
  if (!pdfDocument) {
    return;
  }
  setStatus("Saving annotations...");
  const data = await pdfDocument.saveDocument();
  const blob = new Blob([data], { type: "application/pdf" });
  downloadManager.download(blob, config.path, "annotated.pdf");
  setStatus("Downloaded annotated PDF");
});

document.getElementById("download")?.addEventListener("click", () => {
  document.getElementById("saveButton").click();
});

document.getElementById("secondaryDownload")?.addEventListener("click", () => {
  document.getElementById("saveButton").click();
});

for (const id of ["openFile", "secondaryOpenFile"]) {
  document.getElementById(id)?.addEventListener("click", () => {
    document.getElementById("fileInput")?.click();
  });
}

document.getElementById("fileInput")?.addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const url = URL.createObjectURL(file);
  load({ url }).catch(err => {
    console.error(err);
    window.__showPdfPreviewError?.(err.stack || err.message || err);
  });
});

async function load(options = {}) {
  if (options.restore) {
    restoreViewState = snapshotViewState();
  }
  setStatus("Loading PDF...");
  loadingBar?.classList.remove("hidden");
  if (loadingProgress) {
    loadingProgress.style.width = "0";
  }
  if (pdfDocument) {
    pdfViewer.setDocument(null);
    linkService.setDocument(null);
  }
  const loadingTask = getDocument({
    url: options.url || config.path,
    useWorkerFetch: false,
    cMapUrl: config.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: config.standardFontDataUrl,
  });
  loadingTask.onProgress = progress => {
    document.body.dataset.pdfProgress = `${progress.loaded || 0}/${
      progress.total || 0
    }`;
    if (loadingProgress && progress.total) {
      loadingProgress.style.width = `${Math.min(100, Math.round(progress.loaded / progress.total * 100))}%`;
    }
  };
  loadingTask.onPassword = (updatePassword, reason) => {
    showPasswordDialog(updatePassword, reason);
  };
  pdfDocument = await loadingTask.promise;
  loadingBar?.classList.add("hidden");
  setStatus("PDF loaded");
  appShim.pdfDocument = pdfDocument;
  pdfViewer.setDocument(pdfDocument);
  setStatus("Viewer document set");
  linkService.setDocument(pdfDocument, null);
  renderOutline().catch(err => console.warn("Failed to render outline", err));
  renderThumbnails().catch(err => console.warn("Failed to render thumbnails", err));
  renderAttachments().catch(err => console.warn("Failed to render attachments", err));
  renderLayers().catch(err => console.warn("Failed to render layers", err));
  setStatus("Link service ready");
}

window.addEventListener("message", event => {
  if (event.data?.type === "reload") {
    load({ restore: true }).catch(err => {
      console.error(err);
      window.__showPdfPreviewError?.(err.stack || err.message || err);
    });
  }
});

load().catch(err => {
  console.error(err);
  window.__showPdfPreviewError?.(err.stack || err.message || err);
});
