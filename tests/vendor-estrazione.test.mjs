import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SPEC_ESTRAZIONE, verificaIntegritaArchivio } from "../scripts/vendor-estrazione.mjs";
import { trovaBundleEstrazione, verificaBundleEstrazione } from "../app/estrazione-runtime.mjs";

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

async function temporanea(t) {
  await mkdir(join(RADICE, ".tmp-test"), { recursive: true });
  const cartella = await mkdtemp(join(RADICE, ".tmp-test", "vendor-estrazione-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return cartella;
}

async function creaBundle(radice) {
  const files = [];
  for (const path of SPEC_ESTRAZIONE.file) {
    const contenuto = Buffer.from(`Fixture verificata: ${path}\n`);
    await mkdir(dirname(join(radice, path)), { recursive: true });
    await writeFile(join(radice, path), contenuto);
    files.push({ path, size: contenuto.length, sha256: createHash("sha256").update(contenuto).digest("hex") });
  }
  await writeFile(join(radice, "manifest.json"), JSON.stringify({
    schema: 1,
    componente: "estrazione",
    pacchetto: { nome: SPEC_ESTRAZIONE.nome, versione: SPEC_ESTRAZIONE.versione, url: SPEC_ESTRAZIONE.url, integrita: SPEC_ESTRAZIONE.integrita },
    files,
  }));
}

test("estrazione blocca pdfjs e rifiuta un archivio con integrità errata", async (t) => {
  assert.deepEqual(SPEC_ESTRAZIONE.file, ["build/pdf.mjs", "LICENSE", "legacy/build/pdf.worker.mjs"]);
  assert.equal(SPEC_ESTRAZIONE.versione, "6.3.289");
  assert.equal(SPEC_ESTRAZIONE.integrita, "sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==");
  const cartella = await temporanea(t);
  const archivio = join(cartella, "errato.tgz");
  await writeFile(archivio, "archivio non autentico");
  await assert.rejects(verificaIntegritaArchivio(archivio), /Integrità.*non valida/);
});

test("estrazione verifica inventario e rifiuta file mancanti, alterati o extra", async (t) => {
  const cartella = await temporanea(t);
  await creaBundle(cartella);
  const risultato = await verificaBundleEstrazione(cartella);
  assert.equal(risultato.pdf, join(cartella, "build", "pdf.mjs"));
  assert.equal(risultato.worker, join(cartella, "legacy", "build", "pdf.worker.mjs"));
  await rm(risultato.worker);
  await assert.rejects(verificaBundleEstrazione(cartella), /mancante|divergente/);
  await creaBundle(cartella);
  await writeFile(risultato.pdf, "contenuto alterato");
  await assert.rejects(verificaBundleEstrazione(cartella), /alterato|Digest/);
  await creaBundle(cartella);
  await writeFile(join(cartella, "inatteso.txt"), "extra");
  await assert.rejects(verificaBundleEstrazione(cartella), /inatteso|divergente/);
});

test("estrazione localizza lo sviluppo e preferisce la disposizione installata", async (t) => {
  const cartella = await temporanea(t);
  const gui = join(cartella, "app");
  const sviluppo = join(cartella, "vendor", "estrazione");
  const installato = join(gui, "estrazione");
  await creaBundle(sviluppo);
  assert.equal(trovaBundleEstrazione(gui), sviluppo);
  await verificaBundleEstrazione(trovaBundleEstrazione(gui));
  await creaBundle(installato);
  assert.equal(trovaBundleEstrazione(gui), installato);
  const risultato = await verificaBundleEstrazione(trovaBundleEstrazione(gui));
  assert.equal(risultato.radice, installato);
});

test("estrazione rifiuta percorsi e pin contraffatti nel manifesto", async (t) => {
  const cartella = await temporanea(t);
  await creaBundle(cartella);
  const percorso = join(cartella, "manifest.json");
  const manifest = JSON.parse(await readFile(percorso, "utf8"));
  manifest.files[0].path = "../esterno.mjs";
  await writeFile(percorso, JSON.stringify(manifest));
  await assert.rejects(verificaBundleEstrazione(cartella), /Inventario.*non valido/);
  await creaBundle(cartella);
  const altro = JSON.parse(await readFile(percorso, "utf8"));
  altro.pacchetto.versione = "0.0.0";
  await writeFile(percorso, JSON.stringify(altro));
  await assert.rejects(verificaBundleEstrazione(cartella), /versione|bloccati|incompatibile/);
});

test("estrazione rifiuta anche file extra dichiarati nel manifest", async (t) => {
  const cartella = await temporanea(t);
  await creaBundle(cartella);
  const percorso = join(cartella, "manifest.json");
  const manifest = JSON.parse(await readFile(percorso, "utf8"));
  const dati = Buffer.from("file estraneo all'archivio selezionato");
  await writeFile(join(cartella, "extra.mjs"), dati);
  manifest.files.push({path: "extra.mjs", size: dati.length, sha256: createHash("sha256").update(dati).digest("hex")});
  await writeFile(percorso, JSON.stringify(manifest));
  await assert.rejects(verificaBundleEstrazione(cartella), /Inventario estrazione: numero di file non valido/);
});

test("estrazione rifiuta un percorso fuori allowlist a parità di lunghezza, hash e dimensione", async (t) => {
  const cartella = await temporanea(t);
  await creaBundle(cartella);
  const percorso = join(cartella, "manifest.json");
  const manifest = JSON.parse(await readFile(percorso, "utf8"));
  const precedente = manifest.files[0];
  const dati = await readFile(join(cartella, precedente.path));
  const path = "build/pdf.alternativo.mjs";
  await rm(join(cartella, precedente.path));
  await writeFile(join(cartella, path), dati);
  manifest.files[0] = {path, size: dati.length, sha256: createHash("sha256").update(dati).digest("hex")};
  assert.equal(manifest.files.length, SPEC_ESTRAZIONE.file.length);
  await writeFile(percorso, JSON.stringify(manifest));
  await assert.rejects(verificaBundleEstrazione(cartella), {message: "Inventario estrazione: percorso fuori allowlist: " + path});
});
