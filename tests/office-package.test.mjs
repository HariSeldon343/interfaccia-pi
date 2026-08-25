import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compilaTemplateOffice,
  generaDossierWord,
  leggiArchivioZip,
  risolviTemplateNellaRadice,
  scriviArchivioZip,
} from "../app/extensions/sistema-guidato/office-package.mjs";

function voce(nome, testo, metodo = 8) {
  return { nome, dati: Buffer.from(testo, "utf8"), metodo };
}

test("compila placeholder DOCX anche quando Word li divide in piu run", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-office-docx-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const sorgente = join(radice, "modello.docx");
  const output = join(radice, "output.docx");
  const documento = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    '<w:p><w:r><w:t>{{CLI</w:t></w:r><w:r><w:t>ENTE_NOME}}</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Progetto: [[PROGETTO_TITOLO]]</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>{{EVIDENZA_MANCANTE}}</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join("");
  const archivio = scriviArchivioZip([
    voce("[Content_Types].xml", "<Types/>", 0),
    voce("_rels/.rels", "<Relationships/>", 0),
    voce("word/document.xml", documento),
  ]);
  await writeFile(sorgente, archivio);
  const esito = await compilaTemplateOffice(sorgente, output, {
    CLIENTE_NOME: "Alfa & Beta S.p.A.",
    PROGETTO_TITOLO: "SGI <2026>",
  });
  assert.equal(esito.sostituzioni, 2);
  assert.deepEqual(esito.tokenResidui, ["EVIDENZA_MANCANTE"]);
  assert.equal(esito.perChiave.CLIENTE_NOME, 1);
  const compilato = leggiArchivioZip(await readFile(output));
  const xml = compilato.find((elemento) => elemento.nome === "word/document.xml").dati.toString("utf8");
  assert.match(xml, /Alfa &amp; Beta S\.p\.A\./);
  assert.match(xml, /SGI &lt;2026&gt;/);
  assert.doesNotMatch(xml, /\{\{CLIENTE_NOME\}\}/);
});

test("compila stringhe XLSX senza modificare le altre parti del pacchetto", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-office-xlsx-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const sorgente = join(radice, "registro.xlsx");
  const output = join(radice, "registro-r1.xlsx");
  const archivio = scriviArchivioZip([
    voce("[Content_Types].xml", "<Types/>", 0),
    voce("xl/workbook.xml", "<workbook><sheets/></workbook>"),
    voce("xl/sharedStrings.xml", '<sst><si><r><t>[[CLIENTE_</t></r><r><t>NOME]]</t></r></si></sst>'),
  ]);
  await writeFile(sorgente, archivio);
  const esito = await compilaTemplateOffice(sorgente, output, { CLIENTE_NOME: "Gamma" });
  assert.equal(esito.sostituzioni, 1);
  const compilato = leggiArchivioZip(await readFile(output));
  assert.equal(compilato.find((elemento) => elemento.nome === "xl/workbook.xml").dati.toString("utf8"), "<workbook><sheets/></workbook>");
  assert.match(compilato.find((elemento) => elemento.nome === "xl/sharedStrings.xml").dati.toString("utf8"), /Gamma/);
});

test("genera un dossier Word fattuale preservando le proprieta di sezione del template", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-office-dossier-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const sorgente = join(radice, "stile.docx");
  const output = join(radice, "dossier.docx");
  const documento = '<w:document xmlns:w="x"><w:body><w:p><w:pPr><w:sectPr><w:pgSz w:w="10000"/></w:sectPr></w:pPr><w:r><w:t>Copertina da conservare</w:t></w:r></w:p><w:p><w:r><w:t>Contenuto precedente</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:body></w:document>';
  await writeFile(sorgente, scriviArchivioZip([
    voce("[Content_Types].xml", "<Types/>", 0),
    voce("word/document.xml", documento),
  ]));
  const esito = await generaDossierWord(sorgente, output, {
    titolo: "Profilo del sistema",
    metadati: [{ etichetta: "Cliente", valore: "Alfa & Beta" }],
    sezioni: [{ titolo: "Campo", testo: "Sede <Bologna>", natura: "dichiarazione-utente" }],
    mancanti: ["Evidenza di approvazione"],
  });
  assert.equal(esito.sezioni, 1);
  assert.deepEqual(esito.campiMancanti, ["Evidenza di approvazione"]);
  const xml = leggiArchivioZip(await readFile(output)).find((elemento) => elemento.nome === "word/document.xml").dati.toString("utf8");
  assert.match(xml, /Copertina da conservare/);
  assert.doesNotMatch(xml, /Contenuto precedente/);
  assert.match(xml, /Profilo del sistema/);
  assert.match(xml, /Alfa &amp; Beta/);
  assert.match(xml, /Sede &lt;Bologna&gt;/);
  assert.match(xml, /Da completare/);
  assert.doesNotMatch(xml, /•/);
  assert.match(xml, /<w:pgSz w:w="10000"\/>/);
  assert.match(xml, /<w:pgSz w:w="11906"\/>/);
});

test("compila template Markdown e segnala i token non valorizzati", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-office-md-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const sorgente = join(radice, "modello.md");
  const output = join(radice, "bozza.md");
  await writeFile(sorgente, "# {{CLIENTE_NOME}}\n\n[[CAMPO_MANCANTE]]\n", "utf8");
  const esito = await compilaTemplateOffice(sorgente, output, { cliente_nome: "Delta" });
  assert.equal(await readFile(output, "utf8"), "# Delta\n\n[[CAMPO_MANCANTE]]\n");
  assert.deepEqual(esito.tokenResidui, ["CAMPO_MANCANTE"]);
});

test("rifiuta voci ZIP ambigue e percorsi template fuori dalla libreria", () => {
  assert.throws(() => scriviArchivioZip([voce("../segreto.xml", "x")]), /non sicura/);
  assert.throws(() => risolviTemplateNellaRadice("C:\\libreria", "..\\segreto.docx"), /non confinato/);
  assert.equal(risolviTemplateNellaRadice("C:\\libreria", "procedure/modello.docx"), "C:\\libreria\\procedure\\modello.docx");
});
