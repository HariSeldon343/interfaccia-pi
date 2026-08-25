import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const ALLEGATI = require("../public/attachment-core.js");

test("i file locali viaggiano nel prompt ma restano separabili dalla richiesta visibile", () => {
  const messaggio = ALLEGATI.creaMessaggioConFile("Analizza il documento", [{
    tipo: "file",
    id: "locale-1",
    nome: "rapporto.pdf",
    percorso: "C:\\Archivio\\rapporto.pdf",
    mimeType: "application/pdf",
    dimensione: 1234,
  }]);
  assert.match(messaggio, /^<pi_gui_files_v1>/);
  const separato = ALLEGATI.separaMessaggioConFile(messaggio);
  assert.equal(separato.testo, "Analizza il documento");
  assert.deepEqual(separato.file, [{
    tipo: "file",
    id: "",
    nome: "rapporto.pdf",
    percorso: "C:\\Archivio\\rapporto.pdf",
    mimeType: "application/pdf",
    dimensione: 1234,
  }]);
});

test("un blocco file malformato non viene nascosto", () => {
  const originale = "<pi_gui_files_v1>\nnon-json\n</pi_gui_files_v1>\nTesto";
  assert.deepEqual(ALLEGATI.separaMessaggioConFile(originale), {
    testo: originale,
    file: [],
  });
});

test("immagini e file generici restano distinti e hanno firme stabili", () => {
  const immagine = { tipo: "immagine", mimeType: "image/png", data: "AA==" };
  const file = {
    tipo: "file",
    nome: "nota.txt",
    percorso: "C:\\Temp\\nota.txt",
    dimensione: 9,
  };
  assert.equal(ALLEGATI.allegatoImmagine(immagine), true);
  assert.equal(ALLEGATI.allegatoFile(immagine), false);
  assert.equal(ALLEGATI.allegatoFile(file), true);
  assert.equal(ALLEGATI.firmaAllegato(file), "file:C:\\Temp\\nota.txt:9");
  const digestAtteso = createHash("sha256")
    .update("image/png\0AA==", "utf8")
    .digest("hex");
  assert.equal(ALLEGATI.firmaAllegato(immagine), `image-sha256:${digestAtteso}`);
  assert.match(ALLEGATI.firmaAllegato(immagine), /^image-sha256:[0-9a-f]{64}$/);
  assert.equal(
    ALLEGATI.firmaAllegato({ ...immagine }),
    ALLEGATI.firmaAllegato(immagine),
    "la stessa immagine deve conservare la stessa firma anche in un nuovo oggetto",
  );
});

test("la firma distingue immagini con stessa lunghezza e stessi bordi", () => {
  const prefisso = "A".repeat(32);
  const suffisso = "Z".repeat(32);
  const prima = {
    tipo: "immagine",
    mimeType: "image/png",
    data: prefisso + "B".repeat(64) + suffisso,
  };
  const seconda = {
    ...prima,
    data: prefisso + "C".repeat(64) + suffisso,
  };
  assert.equal(prima.data.length, seconda.data.length);
  assert.equal(prima.data.slice(0, 32), seconda.data.slice(0, 32));
  assert.equal(prima.data.slice(-32), seconda.data.slice(-32));
  assert.notEqual(ALLEGATI.firmaAllegato(prima), ALLEGATI.firmaAllegato(seconda));
});
