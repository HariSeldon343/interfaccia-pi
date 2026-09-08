import test from "node:test";
import assert from "node:assert/strict";
import libreria from "../app/public/library-core.js";

test("libreria: categorie, prima corrispondenza e default", () => {
  for (const [nome, categoria] of [["Decreto audit.pdf", "normativa"], ["verbale.docx", "audit"], ["fattura.xlsx", "client-evidence"], ["manuale.pdf", "linee-guida"], ["pagina.html", "web-clip"], ["appunti.txt", "documenti"]]) {
    assert.equal(libreria.categoriaFile(nome), categoria);
  }
});

test("libreria: slug ascii, riservati, vuoti, lunghi e collisioni", () => {
  assert.equal(libreria.nomeLibreria("Città è bella.PDF"), "citta-e-bella.pdf");
  for (const nome of ["CON", "prn", "aux", "nul", "COM1", "lpt9"]) assert.equal(libreria.nomeLibreria(nome + ".TXT"), "file-" + nome.toLowerCase() + ".txt");
  assert.equal(libreria.nomeLibreria("你好.pdf"), "documento.pdf");
  assert.equal(libreria.nomeLibreria("x".repeat(100) + ".pdf"), "x".repeat(80) + ".pdf");
  assert.equal(libreria.nomeLibreria("rapporto.pdf", 3), "rapporto-v3.pdf");
});

test("libreria: percorsi relativi normalizzati e rifiutati", () => {
  assert.equal(libreria.normalizzaPercorsoRelativo("cartella\\nota.txt"), "cartella/nota.txt");
  for (const percorso of ["../x", "a/../b", "/x", "C:x", "C:\\x", "\\\\server\\x", "a\u0000b", "a\nb", "a\u0085b", "a//b"]) assert.throws(() => libreria.normalizzaPercorsoRelativo(percorso), /relativo/);
});

test("libreria: esclusioni per cartella, tipo e dimensione", () => {
  assert.equal(libreria.motivoEsclusione({nome: ".nota.txt"}), "nascosto");
  assert.equal(libreria.motivoEsclusione({nome: ".nota.txt", percorsoRelativo: "Documenti/.nota.txt"}), "nascosto");
  assert.equal(libreria.motivoEsclusione({nome: ".git", cartella: true}), "cartella");
  for (const percorso of [".git/x", "node_modules/x", "a/.nascosta/x", "a/dist/x", "__pycache__/x", "venv/x"]) assert.equal(libreria.motivoEsclusione({nome: "x", percorsoRelativo: percorso, dimensione: 1}), "cartella");
  assert.equal(libreria.motivoEsclusione({nome: "RUN.EXE", dimensione: 1}), "tipo");
  assert.equal(libreria.motivoEsclusione({nome: "x.txt", dimensione: 10485761}), "dimensione");
  assert.equal(libreria.motivoEsclusione({nome: "x.txt", dimensione: 10485760}), "");
});

test("libreria: ripartizione conserva origine e immagini", () => {
  const immagine = {file: {name: "foto.png", type: "image/png", size: 4}, percorsoRelativo: "foto.png", daCartella: false};
  const documento = {file: {name: "nota.txt", type: "text/plain", size: 2}, percorsoRelativo: "a/nota.txt", daCartella: true};
  const risultato = libreria.ripartisciIngressi([immagine, documento]);
  assert.deepEqual(risultato.immagini, [immagine]);
  assert.deepEqual(risultato.file, [documento]);
  assert.equal(risultato.daCartella, true);
});

test("libreria: composizione 3, 8 e 12 riferimenti senza troncamento silenzioso", () => {
  const voci = Array.from({length: 12}, (_, i) => ({nome: "file" + i, percorso: "/raw/file" + i + ".testo.md", mimeType: "text/markdown", dimensione: 3}));
  for (const numero of [3, 8, 12]) {
    const risultato = libreria.componiVociBlocco(voci.slice(0, 2), voci.slice(2, numero), "/.ingest-index.json");
    assert.equal(risultato.voci.length, Math.min(numero, 8));
    assert.equal(Boolean(risultato.avviso), numero > 8);
    if (numero > 8) assert.deepEqual(risultato.voci[7], {nome: "indice della libreria", percorso: "/.ingest-index.json", mimeType: "application/json", dimensione: 0});
  }
  assert.throws(() => libreria.componiVociBlocco(voci, [], ""), /indice/);
});
