import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { estraiDocumento } from "../app/estrazione.mjs";
import { trovaRuntimeEstrazione } from "../app/estrazione-runtime.mjs";
import { pdfMinimo } from "./fixture-documenti.mjs";

test("PDF: estrae senza caricare pacchetti canvas non verificati presenti sul computer", async (t) => {
  const bundle = await trovaRuntimeEstrazione(resolve("app"));
  const base = resolve(".tmp-test");
  await mkdir(base, {recursive: true});
  const cartella = await mkdtemp(join(base, "pdf-isolato-"));
  t.after(async () => {
    delete globalThis.__t2CanvasEsternoCaricato;
    await rm(cartella, {recursive: true, force: true});
  });
  const guiDirectory = join(cartella, "app");
  await cp(bundle.radice, join(guiDirectory, "estrazione"), {recursive: true});
  const pacchetto = join(cartella, "node_modules", "@napi-rs", "canvas");
  await mkdir(pacchetto, {recursive: true});
  await writeFile(join(pacchetto, "package.json"), JSON.stringify({name: "@napi-rs/canvas", main: "index.js"}));
  await writeFile(join(pacchetto, "index.js"), "globalThis.__t2CanvasEsternoCaricato = true; module.exports = {};\n");
  const risultato = await estraiDocumento({nome: "prova.pdf", dati: pdfMinimo(), guiDirectory});
  assert.equal(risultato.stato, "ok", risultato.motivo);
  assert.match(risultato.testo, /Testo PDF verificato/);
  assert.equal(globalThis.__t2CanvasEsternoCaricato, undefined, "È stato caricato un pacchetto npm non verificato");
});
