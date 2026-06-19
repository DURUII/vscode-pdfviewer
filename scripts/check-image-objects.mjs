#!/usr/bin/env node
import path from "path";
import { pathToFileURL } from "url";

if (!Uint8Array.prototype.toHex) {
  Uint8Array.prototype.toHex = function toHex() {
    return Array.from(this, byte => byte.toString(16).padStart(2, "0")).join("");
  };
}

if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function getOrInsertComputed(key, create) {
    if (!this.has(key)) {
      this.set(key, create(key));
    }
    return this.get(key);
  };
}

if (!Math.sumPrecise) {
  Math.sumPrecise = values => Array.from(values).reduce((sum, value) => sum + value, 0);
}

class MinimalDOMMatrix {
  constructor(init = [1, 0, 0, 1, 0, 0]) {
    this.a = init[0] ?? 1;
    this.b = init[1] ?? 0;
    this.c = init[2] ?? 0;
    this.d = init[3] ?? 1;
    this.e = init[4] ?? 0;
    this.f = init[5] ?? 0;
  }
  multiplySelf() {
    return this;
  }
  preMultiplySelf() {
    return this;
  }
  invertSelf() {
    return this;
  }
  translate() {
    return this;
  }
  scale() {
    return this;
  }
}

globalThis.DOMMatrix ||= MinimalDOMMatrix;
globalThis.ImageData ||= class ImageData {};
globalThis.Path2D ||= class Path2D {};

function multiplyMatrices(first, second) {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function applyMatrix(point, matrix) {
  const [x, y] = point;
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

function getViewportBbox(matrix, viewport) {
  const points = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(point => {
    const [x, y] = applyMatrix(point, matrix);
    return viewport.convertToViewportPoint(x, y);
  });
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    area: Math.max(0, right - left) * Math.max(0, bottom - top),
  };
}

function inflateBbox(bbox, padding) {
  return {
    ...bbox,
    left: bbox.left - padding,
    top: bbox.top - padding,
    right: bbox.right + padding,
    bottom: bbox.bottom + padding,
    width: bbox.width + padding * 2,
    height: bbox.height + padding * 2,
    area: (bbox.width + padding * 2) * (bbox.height + padding * 2),
  };
}

function getViewportBboxFromMinMax(matrix, viewport, minMax, padding = 0) {
  const bbox = getViewportBbox(
    [
      matrix[0] * (minMax[2] - minMax[0]),
      matrix[1] * (minMax[2] - minMax[0]),
      matrix[2] * (minMax[3] - minMax[1]),
      matrix[3] * (minMax[3] - minMax[1]),
      matrix[0] * minMax[0] + matrix[2] * minMax[1] + matrix[4],
      matrix[1] * minMax[0] + matrix[3] * minMax[1] + matrix[5],
    ],
    viewport
  );
  return padding ? inflateBbox(bbox, padding) : bbox;
}

function addImageHit(hits, matrix, viewport, opIndex) {
  const bbox = getViewportBbox(matrix, viewport);
  if (bbox.width < 8 || bbox.height < 8 || bbox.area < 96) {
    return;
  }
  hits.push({
    opIndex,
    ...bbox,
  });
}

function addVectorPrimitive(primitives, matrix, viewport, opIndex, minMax, lineWidth) {
  if (!minMax || minMax.length < 4) {
    return;
  }
  const extra = Math.max(0.5, lineWidth / 2);
  const bbox = getViewportBboxFromMinMax(
    matrix,
    viewport,
    [minMax[0] - extra, minMax[1] - extra, minMax[2] + extra, minMax[3] + extra]
  );
  if (bbox.width < 1 || bbox.height < 1 || bbox.area < 4) {
    return;
  }
  primitives.push({
    opIndex,
    primitiveCount: 1,
    ...bbox,
  });
}

function bboxesAreNear(first, second, gap) {
  return !(
    first.right + gap < second.left ||
    second.right + gap < first.left ||
    first.bottom + gap < second.top ||
    second.bottom + gap < first.top
  );
}

function mergeBbox(first, second) {
  const left = Math.min(first.left, second.left);
  const top = Math.min(first.top, second.top);
  const right = Math.max(first.right, second.right);
  const bottom = Math.max(first.bottom, second.bottom);
  return {
    ...first,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    area: Math.max(0, right - left) * Math.max(0, bottom - top),
    primitiveCount: (first.primitiveCount || 0) + (second.primitiveCount || 0),
  };
}

function clampBboxToViewport(bbox, viewport) {
  const left = Math.max(0, Math.min(viewport.width, bbox.left));
  const top = Math.max(0, Math.min(viewport.height, bbox.top));
  const right = Math.max(0, Math.min(viewport.width, bbox.right));
  const bottom = Math.max(0, Math.min(viewport.height, bbox.bottom));
  return {
    ...bbox,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    area: Math.max(0, right - left) * Math.max(0, bottom - top),
  };
}

function clusterVectorPrimitives(primitives, viewport) {
  const gap = Math.max(4, Math.min(viewport.width, viewport.height) * 0.006);
  const clusters = [];
  for (const primitive of primitives) {
    let cluster = inflateBbox(primitive, 2);
    let merged = true;
    while (merged) {
      merged = false;
      for (let index = clusters.length - 1; index >= 0; index -= 1) {
        if (!bboxesAreNear(cluster, clusters[index], gap)) {
          continue;
        }
        cluster = mergeBbox(cluster, clusters[index]);
        clusters.splice(index, 1);
        merged = true;
      }
    }
    clusters.push(cluster);
  }

  const pageArea = viewport.width * viewport.height;
  return clusters
    .map(cluster => clampBboxToViewport(inflateBbox(cluster, 4), viewport))
    .filter(cluster => {
      const isRule =
        (cluster.width > 180 && cluster.height < 14) ||
        (cluster.height > 180 && cluster.width < 14);
      const isLargePageBackground = cluster.area > pageArea * 0.72;
      const isFigureSized = cluster.width >= 28 && cluster.height >= 28 && cluster.area >= 900;
      const hasEnoughPrimitives = cluster.primitiveCount >= 8;
      return !isRule && !isLargePageBackground && isFigureSized && hasEnoughPrimitives;
    })
    .sort((a, b) => b.area - a.area);
}

async function main() {
  const pdfPath = process.argv[2];
  const showDetails = process.argv.includes("--details");
  if (!pdfPath) {
    console.error("Usage: node scripts/check-image-objects.mjs <file.pdf> [--details]");
    process.exitCode = 2;
    return;
  }

  const viewerScale = Number(process.env.SCHOLAR_PDF_SCALE || 96 / 72);
  const pdfjs = await import("../lib/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.resolve("lib/build/pdf.worker.mjs")
  ).href;
  const task = pdfjs.getDocument({
    url: pathToFileURL(path.resolve(pdfPath)).href,
    useWorkerFetch: false,
  });
  const document = await task.promise;
  const imageOps = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintImageMaskXObjectRepeat,
  ]);

  let totalImageOps = 0;
  let totalClickableBboxes = 0;
  let totalVectorOps = 0;
  let totalVectorPrimitives = 0;
  let totalVectorFigures = 0;
  const pagesWithImages = [];
  const pagesWithVectorFigures = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: viewerScale, rotation: 0 });
    const operatorList = await page.getOperatorList();
    const hits = [];
    const vectorPrimitives = [];
    const stack = [];
    let matrix = [1, 0, 0, 1, 0, 0];
    let lineWidth = 1;
    let imageOpCount = 0;
    let vectorOpCount = 0;

    for (let index = 0; index < operatorList.fnArray.length; index += 1) {
      const fn = operatorList.fnArray[index];
      const args = operatorList.argsArray[index] || [];
      switch (fn) {
        case pdfjs.OPS.save:
          stack.push({ matrix: matrix.slice(), lineWidth });
          break;
        case pdfjs.OPS.restore: {
          const state = stack.pop();
          matrix = state?.matrix || [1, 0, 0, 1, 0, 0];
          lineWidth = state?.lineWidth || 1;
          break;
        }
        case pdfjs.OPS.transform:
          matrix = multiplyMatrices(matrix, args);
          break;
        case pdfjs.OPS.setLineWidth:
          lineWidth = Number(args[0]) || 1;
          break;
        case pdfjs.OPS.paintImageXObject:
        case pdfjs.OPS.paintInlineImageXObject:
        case pdfjs.OPS.paintImageMaskXObject:
          imageOpCount += 1;
          addImageHit(hits, matrix, viewport, index);
          break;
        case pdfjs.OPS.paintImageXObjectRepeat:
        case pdfjs.OPS.paintImageMaskXObjectRepeat: {
          const [, scaleX, scaleY, positions = []] = args;
          imageOpCount += Math.max(1, positions.length / 2);
          for (let i = 0; i < positions.length; i += 2) {
            addImageHit(
              hits,
              multiplyMatrices(matrix, [scaleX, 0, 0, scaleY, positions[i], positions[i + 1]]),
              viewport,
              index
            );
          }
          break;
        }
        case pdfjs.OPS.constructPath:
          vectorOpCount += 1;
          addVectorPrimitive(vectorPrimitives, matrix, viewport, index, args[2], lineWidth);
          break;
        default:
          if (imageOps.has(fn)) {
            imageOpCount += 1;
          }
      }
    }

    totalImageOps += imageOpCount;
    totalClickableBboxes += hits.length;
    const vectorFigures = clusterVectorPrimitives(vectorPrimitives, viewport);
    totalVectorOps += vectorOpCount;
    totalVectorPrimitives += vectorPrimitives.length;
    totalVectorFigures += vectorFigures.length;
    if (imageOpCount || hits.length) {
      pagesWithImages.push(`${pageNumber}:${imageOpCount}/${hits.length}`);
      console.log(
        `page ${pageNumber}: ${imageOpCount} image op(s), ${hits.length} clickable bbox(es)`
      );
      if (showDetails) {
        for (const hit of hits) {
          console.log(
            `  op ${hit.opIndex}: left=${hit.left.toFixed(1)} top=${hit.top.toFixed(1)} width=${hit.width.toFixed(1)} height=${hit.height.toFixed(1)}`
          );
        }
      }
    }
    if (vectorFigures.length) {
      pagesWithVectorFigures.push(`${pageNumber}:${vectorOpCount}/${vectorFigures.length}`);
      console.log(
        `page ${pageNumber}: ${vectorOpCount} vector path op(s), ${vectorPrimitives.length} primitive bbox(es), ${vectorFigures.length} vector figure bbox(es)`
      );
      if (showDetails) {
        for (const figure of vectorFigures) {
          console.log(
            `  vector: left=${figure.left.toFixed(1)} top=${figure.top.toFixed(1)} width=${figure.width.toFixed(1)} height=${figure.height.toFixed(1)} primitives=${figure.primitiveCount || 0}`
          );
        }
      }
    }
  }

  console.log(
    `summary: ${document.numPages} page(s), ${totalImageOps} image op(s), ${totalClickableBboxes} clickable bbox(es)`
  );
  if (showDetails) {
    console.log(`bbox scale: ${viewerScale}`);
  }
  console.log(
    `pages op/bbox: ${pagesWithImages.length ? pagesWithImages.join(", ") : "none"}`
  );
  console.log(
    `vector summary: ${totalVectorOps} path op(s), ${totalVectorPrimitives} primitive bbox(es), ${totalVectorFigures} figure bbox(es)`
  );
  console.log(
    `vector pages path/figure: ${
      pagesWithVectorFigures.length ? pagesWithVectorFigures.join(", ") : "none"
    }`
  );
  await task.destroy();
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
