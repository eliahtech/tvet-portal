import * as pdfjs from "/vendor/pdfjs/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.mjs";
const q = new URLSearchParams(location.search),
  preview = q.get("preview") === "1",
  rid = q.get("id");
let doc,
  page = 1,
  busy = false;
const status = document.querySelector("#viewer-status");
async function render() {
  if (busy || !doc) return;
  busy = true;
  try {
    const p = await doc.getPage(page),
      v = p.getViewport({ scale: 1.5 }),
      c = document.querySelector("#pdf");
    c.width = v.width;
    c.height = v.height;
    await p.render({ canvasContext: c.getContext("2d"), viewport: v }).promise;
    document.querySelector("#page-label").textContent =
      page + " / " + doc.numPages;
    document.querySelector("#prev").disabled = page === 1;
    document.querySelector("#next").disabled = page === doc.numPages;
    status.textContent = preview
      ? "Limited preview — the full paper requires purchase."
      : "";
  } finally {
    busy = false;
  }
}
document.querySelector("#prev").onclick = () => {
  if (!busy && page > 1) {
    page--;
    render();
  }
};
document.querySelector("#next").onclick = () => {
  if (!busy && page < doc.numPages) {
    page++;
    render();
  }
};
try {
  if (!/^[a-z0-9-]+$/i.test(rid || "")) throw Error("Invalid paper");
  const url = preview
    ? "/api/resources/" + rid + "/preview"
    : "/api/files/" + rid;
  const response = await fetch(url);
  if (!response.ok) {
    const e = await response.json();
    throw Error(e.error || "Unable to load this document");
  }
  doc = await pdfjs.getDocument({
    data: new Uint8Array(await response.arrayBuffer()),
    isEvalSupported: false,
    standardFontDataUrl: "/vendor/pdfjs-fonts/",
    cMapUrl: "/vendor/pdfjs-cmaps/",
    cMapPacked: true,
    wasmUrl: "/vendor/pdfjs-wasm/",
  }).promise;
  await render();
  if (!preview) {
    const a = document.querySelector("#download");
    a.href = url + "?download=1";
    a.hidden = false;
  }
} catch (e) {
  status.className = "viewer-error";
  status.textContent = e.message;
  document.querySelector("#pdf").hidden = true;
}
