import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CLIPBOARD = require("../public/clipboard-core.js");

class FileFinto {
  constructor(contenuto, nome, opzioni = {}) {
    this.contenuto = contenuto;
    this.name = nome;
    this.type = opzioni.type || "";
    this.lastModified = opzioni.lastModified;
    this.size = contenuto.reduce((totale, voce) => totale + Number(voce?.size || 0), 0);
  }
}

const ADESSO = Date.parse("2026-08-25T09:10:11.123Z");
const opzioni = { FileCtor: FileFinto, adesso: ADESSO };

function file(nome, type, size = 10) {
  return { name: nome, type, size };
}

test("estrae un PNG dagli items e assegna un nome riconoscibile allo screenshot", () => {
  const originale = file("image.png", "image/png", 123);
  const risultato = CLIPBOARD.immaginiDaClipboard({
    items: [{ kind: "file", type: "image/png", getAsFile: () => originale }],
    files: [],
  }, opzioni);
  assert.equal(risultato.length, 1);
  assert.equal(risultato[0].name, "screenshot-2026-08-25T09-10-11-123Z.png");
  assert.equal(risultato[0].type, "image/png");
  assert.equal(risultato[0].size, 123);
});

test("usa clipboardData.files come fallback WebView2 e conserva i nomi reali", () => {
  const originale = file("diagramma finale.JPG", "IMAGE/JPEG", 77);
  const risultato = CLIPBOARD.immaginiDaClipboard({ items: [], files: [originale] }, opzioni);
  assert.deepEqual(risultato, [originale]);
});

test("un item senza file ricade sui files e non produce allegati fantasma", () => {
  const fallback = file("fallback.webp", "image/webp", 5);
  const risultato = CLIPBOARD.immaginiDaClipboard({
    items: [{ kind: "file", type: "image/png", getAsFile: () => null }],
    files: [fallback],
  }, opzioni);
  assert.deepEqual(risultato, [fallback]);
});

test("se items e parziale usa la raccolta files piu completa senza duplicare", () => {
  const uno = file("uno.png", "image/png", 5);
  const due = file("due.png", "image/png", 6);
  const risultato = CLIPBOARD.immaginiDaClipboard({
    items: [
      { kind: "file", type: "image/png", getAsFile: () => uno },
      { kind: "file", type: "image/png", getAsFile: () => null },
    ],
    files: [uno, due],
  }, opzioni);
  assert.deepEqual(risultato, [uno, due]);
});

test("testo, SVG, BMP e file non immagine non vengono trattati come screenshot", () => {
  const risultato = CLIPBOARD.immaginiDaClipboard({
    items: [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/svg+xml", getAsFile: () => file("x.svg", "image/svg+xml") },
      { kind: "file", type: "image/bmp", getAsFile: () => file("x.bmp", "image/bmp") },
      { kind: "file", type: "application/pdf", getAsFile: () => file("x.pdf", "application/pdf") },
    ],
    files: [],
  }, opzioni);
  assert.deepEqual(risultato, []);
});

test("una clipboard mista restituisce solo le immagini e il chiamante decide il preventDefault", () => {
  const immagine = file("image.gif", "image/gif", 8);
  const risultato = CLIPBOARD.immaginiDaClipboard({
    items: [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/gif", getAsFile: () => immagine },
    ],
  }, opzioni);
  assert.equal(risultato.length, 1);
  assert.equal(risultato[0].name, "screenshot-2026-08-25T09-10-11-123Z.gif");
});

test("piu screenshot ricevono nomi distinti e mantengono l'ordine", () => {
  const risultato = CLIPBOARD.immaginiDaClipboard({
    files: [
      file("image.png", "image/png", 1),
      file("image.png", "image/png", 2),
    ],
  }, opzioni);
  assert.deepEqual(risultato.map((voce) => voce.name), [
    "screenshot-2026-08-25T09-10-11-123Z.png",
    "screenshot-2026-08-25T09-10-11-123Z-2.png",
  ]);
});

test("la compatibilita immagini segue i metadati del modello senza supposizioni", () => {
  assert.equal(CLIPBOARD.supportoImmaginiModello({ input: ["text"] }), false);
  assert.equal(CLIPBOARD.supportoImmaginiModello({ input: ["text", "image"] }), true);
  assert.equal(CLIPBOARD.supportoImmaginiModello({}), null);
  assert.equal(CLIPBOARD.supportoImmaginiModello(null), null);
});
