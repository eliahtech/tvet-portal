import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";
import { id, fail } from "../util.js";
// Native canvas is loaded only when a PDF preview is generated (admin uploads),
// so a problem with the native module can never stop the whole site from starting.
let canvasModule;
async function loadCanvas() {
  if (!canvasModule) {
    canvasModule = await import("@napi-rs/canvas");
    globalThis.DOMMatrix ??= canvasModule.DOMMatrix;
    globalThis.ImageData ??= canvasModule.ImageData;
    globalThis.Path2D ??= canvasModule.Path2D;
  }
  return canvasModule;
}
// pdfjs requires forward slashes and a trailing slash, even on Windows
const pdfjsDir = (name) =>
  fileURLToPath(
    new URL(`../../node_modules/pdfjs-dist/${name}/`, import.meta.url),
  )
    .replace(/\\/g, "/")
    .replace(/\/?$/, "/");
export function storage({
  directory = process.env.DATA_DIR || "./data",
  client,
} = {}) {
  const supabase =
    client ||
    (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false } },
        )
      : null);
  const bucket = process.env.STORAGE_BUCKET || "papers";
  const safe = (k) => {
    if (!/^[a-z0-9-]+\/(?:[a-z0-9-]+\.)?[a-z0-9]+$/i.test(k))
      fail(400, "Invalid storage object");
    return path.join(directory, "private", k);
  };
  return {
    remote: !!supabase,
    async put(bytes, ext = "pdf", area = "documents") {
      const key = area + "/" + id() + "." + ext;
      if (supabase) {
        const { error } = await supabase.storage
          .from(bucket)
          .upload(key, bytes, {
            contentType:
              ext === "pdf"
                ? "application/pdf"
                : ext === "png"
                  ? "image/png"
                  : "image/jpeg",
            upsert: false,
          });
        if (error) throw Error("Document storage upload failed");
      } else {
        const p = safe(key);
        await mkdir(path.dirname(p), { recursive: true });
        await writeFile(p, bytes);
      }
      return key;
    },
    async get(key) {
      if (supabase) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(key, 60);
        if (error) throw Error("Unable to access stored document");
        const r = await fetch(data.signedUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) throw Error("Document fetch failed");
        return Buffer.from(await r.arrayBuffer());
      }
      return readFile(safe(key));
    },
    async remove(key) {
      if (!key) return;
      if (supabase) {
        const { error } = await supabase.storage.from(bucket).remove([key]);
        if (error) throw Error("Document removal failed");
      } else
        try {
          await unlink(safe(key));
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
    },
  };
}
export async function inspectPdf(bytes) {
  if (bytes.subarray(0, 5).toString() !== "%PDF-")
    fail(400, "Upload a valid PDF document");
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    fail(400, "The PDF is invalid or encrypted");
  }
  if (pdf.getPageCount() < 1) fail(400, "The PDF has no pages");
  // Rebuild visible pages to drop JavaScript actions and attachments from uploaded PDFs.
  if (pdf.getPageCount() > 500) fail(400, "PDFs are limited to 500 pages");
  const clean = await PDFDocument.create();
  for (const original of pdf.getPages()) {
    const { width, height } = original.getSize();
    if (width > 3000 || height > 3000)
      fail(400, "PDF page dimensions are too large");
    const p = clean.addPage([width, height]);
    p.drawPage(await clean.embedPage(original), { x: 0, y: 0 });
  }
  const cleanBytes = Buffer.from(await clean.save());
  const preview = await PDFDocument.create(),
    first = clean.getPage(0),
    { width, height } = first.getSize();
  // Rasterize and crop BEFORE embedding. A PDF clipping box alone retains hidden paid text.
  const { createCanvas } = await loadCanvas();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(cleanBytes),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    standardFontDataUrl: pdfjsDir("standard_fonts"),
    wasmUrl: pdfjsDir("wasm"),
  });
  const doc = await loading.promise;
  let png;
  try {
    const source = await doc.getPage(1),
      viewport = source.getViewport({ scale: Math.min(1.5, 1000 / width) }),
      canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
    await source.render({ canvasContext: canvas.getContext("2d"), viewport })
      .promise;
    const crop = createCanvas(canvas.width, Math.ceil(canvas.height * 0.45));
    crop.getContext("2d").drawImage(canvas, 0, 0);
    png = crop.toBuffer("image/png");
  } finally {
    await loading.destroy();
  }
  const cropped = await preview.embedPng(png);
  const page = preview.addPage([width, height * 0.45 + 72]);
  page.drawImage(cropped, { x: 0, y: 72, width, height: height * 0.45 });
  const font = await preview.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: 72,
    color: rgb(0.06, 0.09, 0.16),
  });
  page.drawText("LIMITED PREVIEW - PURCHASE FOR FULL DOCUMENT", {
    x: 20,
    y: 30,
    size: Math.min(12, width / 50),
    font,
    color: rgb(1, 1, 1),
  });
  page.drawText("PREVIEW", {
    x: width * 0.2,
    y: height * 0.2,
    size: 44,
    font,
    rotate: degrees(20),
    color: rgb(0.06, 0.46, 0.43),
    opacity: 0.2,
  });
  return {
    bytes: cleanBytes,
    pages: clean.getPageCount(),
    preview: Buffer.from(await preview.save()),
  };
}