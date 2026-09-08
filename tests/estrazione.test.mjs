import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { estraiDocumento, spezzaRighe } from "../app/estrazione.mjs";
import { trovaRuntimeEstrazione } from "../app/estrazione-runtime.mjs";
import { docxMinimo, pdfMinimo, zipDocumento } from "./fixture-documenti.mjs";

test("estrazione: PDF minimo con il bundle verificato", async () => {
  await assert.doesNotReject(trovaRuntimeEstrazione(resolve("app")), "Manca vendor/estrazione verificato: eseguire npm run vendor:estrazione");
  const risultato = await estraiDocumento({nome: "prova.pdf", dati: pdfMinimo()});
  assert.equal(risultato.stato, "ok", risultato.motivo);
  assert.equal(risultato.pagine, 1);
  assert.match(risultato.contenuto, /## Pagina 1\nTesto PDF verificato/);
});

test("estrazione: PDF senza testo segnala la necessità di OCR", async () => {
  await assert.doesNotReject(trovaRuntimeEstrazione(resolve("app")), "Manca vendor/estrazione verificato: eseguire npm run vendor:estrazione");
  const risultato = await estraiDocumento({nome: "scansione.pdf", dati: pdfMinimo("")});
  assert.equal(risultato.stato, "vuoto", risultato.motivo);
  assert.match(risultato.contenuto, /nessun testo estraibile, probabile scansione: serve OCR/);
});

test("estrazione: righe al massimo di 1000 caratteri anche senza spazi", () => {
  for (const testo of ["parola ".repeat(18000), "à".repeat(62000)]) {
    const righe = spezzaRighe(testo).split("\n");
    assert.ok(righe.every((riga) => riga.length <= 1000));
    assert.ok(righe.length > 50);
  }
});

test("estrazione: DOCX paragrafi, entità, tab, interruzioni e tabelle", async () => {
  const xml = "<w:document><w:body><w:p><w:r><w:t>À &amp; &lt; &gt; &quot; &apos; &#232; &#x1F642;</w:t><w:tab/><w:t>colonna</w:t><w:br/><w:t>seconda riga</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>cella A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cella B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Fine</w:t></w:r></w:p></w:body></w:document>";
  for (const metodo of [0, 8]) {
    const risultato = await estraiDocumento({nome: "prova.docx", dati: zipDocumento({"word/document.xml": xml}, {metodo})});
    assert.equal(risultato.stato, "ok", risultato.motivo);
    assert.equal(risultato.testo, "À & < > \" ' è 🙂\tcolonna\nseconda riga\ncella A | cella B\nFine");
    assert.match(risultato.contenuto, /Parser: office-xml/);
  }
});

test("estrazione: XLSX segue rels e ordine fogli, stringhe condivise e inline, celle mancanti", async () => {
  const dati = zipDocumento({
    "xl/workbook.xml": "<workbook><sheets><sheet name=\"Secondo &amp; ultimo\" r:id=\"r2\"/><sheet name=\"Primo\" r:id=\"r1\"/></sheets></workbook>",
    "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"r1\" Target=\"worksheets/sheet1.xml\"/><Relationship Target=\"worksheets/sheet2.xml\" Id=\"r2\"/></Relationships>",
    "xl/sharedStrings.xml": "<sst><si><r><t>Condi</t></r><r><t>visa &amp; &#xE8;</t></r></si></sst>",
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"C1\"><v>42</v></c><c r=\"D1\"/></row></sheetData></worksheet>",
    "xl/worksheets/sheet2.xml": "<worksheet><sheetData><row><c r=\"A1\" t=\"inlineStr\"><is><t>Inline &lt;testo&gt; &#233;</t></is></c><c r=\"B1\" t=\"b\"><v>1</v></c></row></sheetData></worksheet>",
  });
  const risultato = await estraiDocumento({nome: "dati.xlsx", dati});
  assert.equal(risultato.stato, "ok", risultato.motivo);
  assert.equal(risultato.testo, "## Foglio Secondo & ultimo\nInline <testo> é\t1\n\n## Foglio Primo\nCondivisa & è\t\t42\t");
  assert.equal(risultato.pagine, 2);
});

test("estrazione: PPTX segue ordine della presentazione e rels, concatena a:t", async () => {
  const dati = zipDocumento({
    "ppt/presentation.xml": "<p:presentation><p:sldIdLst><p:sldId id=\"5\" r:id=\"seconda\"/><p:sldId r:id=\"prima\" id=\"4\"/></p:sldIdLst></p:presentation>",
    "ppt/_rels/presentation.xml.rels": "<Relationships><Relationship Id=\"prima\" Target=\"slides/slide1.xml\"/><Relationship Id=\"seconda\" Target=\"/ppt/slides/slide2.xml\"/></Relationships>",
    "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Ultima slide</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Prima &amp; </a:t></a:r><a:r><a:t>&#232; &quot;qui&quot;</a:t></a:r></a:p><a:p><a:r><a:t>Altro paragrafo</a:t></a:r></a:p></p:sld>",
  });
  const risultato = await estraiDocumento({nome: "presentazione.pptx", dati});
  assert.equal(risultato.stato, "ok", risultato.motivo);
  assert.equal(risultato.pagine, 2);
  assert.equal(risultato.testo, "## Slide 1\nPrima & è \"qui\"\nAltro paragrafo\n\n## Slide 2\nUltima slide");
});

test("estrazione: ZIP corrotto, CRC errato, ZIP64 e directory incoerente danno errore", async () => {
  const archivio = zipDocumento({"word/document.xml": "<w:document/>"}, {metodo: 0});
  const crcErrato = Buffer.from(archivio);
  crcErrato[30 + Buffer.byteLength("word/document.xml")] ^= 1;
  const zip64 = Buffer.from(archivio);
  zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
  const localeErrato = Buffer.from(archivio);
  localeErrato[30] ^= 1;
  for (const dati of [Buffer.from("archivio corrotto"), crcErrato, zip64, localeErrato, zipDocumento({"word/document.xml": "x"}, {metodo: 99})]) {
    const risultato = await estraiDocumento({nome: "rotto.docx", dati});
    assert.equal(risultato.stato, "errore", risultato.motivo);
    assert.match(risultato.motivo, /ZIP/);
    assert.equal(risultato.contenuto, null);
  }
});

test("estrazione: bomba ZIP rifiutata anche se mente, limite cumulato prima della decompressione", async () => {
  const bomba = zipDocumento({"word/document.xml": Buffer.alloc(50 * 1024 * 1024 + 1, 65)});
  const dichiarata = await estraiDocumento({nome: "bomba.docx", dati: bomba});
  assert.equal(dichiarata.stato, "errore", dichiarata.motivo);
  assert.match(dichiarata.motivo, /50 MiB/);
  const indice = bomba.readUInt32LE(bomba.length - 6);
  bomba.writeUInt32LE(1, 22);
  bomba.writeUInt32LE(1, indice + 24);
  const nascosta = await estraiDocumento({nome: "bomba.docx", dati: bomba});
  assert.equal(nascosta.stato, "errore", nascosta.motivo);
  assert.match(nascosta.motivo, /limite|decompress/i);
  const cumulato = zipDocumento({a: "a", b: "b", c: "c", d: "d", e: "e"});
  let posizione = cumulato.readUInt32LE(cumulato.length - 6);
  for (let numero = 0; numero < 5; numero += 1) {
    cumulato.writeUInt32LE(50 * 1024 * 1024, posizione + 24);
    posizione += 46 + cumulato.readUInt16LE(posizione + 28);
  }
  const risultato = await estraiDocumento({nome: "oltre.docx", dati: cumulato});
  assert.equal(risultato.stato, "errore", risultato.motivo);
  assert.match(risultato.motivo, /200 MiB/);
});

test("estrazione: limite di caratteri, righe del sidecar e conteggio UTF-8 del testo originale", async () => {
  const lungo = await estraiDocumento({nome: "lungo.docx", dati: docxMinimo("à".repeat(5_000_050))});
  assert.equal(lungo.stato, "ok", lungo.motivo);
  assert.equal(lungo.caratteri, 5_000_000);
  assert.match(lungo.motivo, /troncato/);
  assert.ok(lungo.contenuto.split("\n").every((riga) => riga.length <= 1000));
  const originale = await estraiDocumento({nome: "accenti.txt", dati: Buffer.from("Città è qui")});
  assert.equal(originale.caratteri, "Città è qui".length);
  assert.equal(originale.parser, "testo-originale");
  assert.equal(originale.contenuto, null);
});

test("estrazione: XLSX sparso limita l'espansione delle celle mancanti a 5 milioni", async () => {
  const righe = Array.from({length: 1200}, (_, indice) => "<row><c r=\"XFD" + (indice + 1) + "\"><v>1</v></c></row>").join("");
  const dati = zipDocumento({
    "xl/workbook.xml": "<workbook><sheets><sheet name=\"Sparso\" r:id=\"r1\"/></sheets></workbook>",
    "xl/_rels/workbook.xml.rels": "<Relationships><Relationship Id=\"r1\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData>" + righe + "</sheetData></worksheet>",
  });
  const risultato = await estraiDocumento({nome: "sparso.xlsx", dati});
  assert.equal(risultato.stato, "ok", risultato.motivo);
  assert.equal(risultato.caratteri, 5_000_000);
  assert.match(risultato.motivo, /troncato/);
  assert.ok(risultato.contenuto.split("\n").every((riga) => riga.length <= 1000));
});

test("estrazione: emoji a cavallo di cinque milioni non lascia surrogate isolate nel sidecar", async () => {
  const testo = "a".repeat(4_999_999) + "🙂";
  assert.equal(testo.length, 5_000_001);
  const risultato = await estraiDocumento({nome: "emoji.docx", dati: docxMinimo(testo)});
  assert.equal(risultato.stato, "ok", risultato.motivo);
  assert.equal(risultato.caratteri, 4_999_999);
  assert.match(risultato.motivo, /troncato/);
  assert.equal(risultato.testo.at(-1), "a");
  assert.equal(risultato.testo.isWellFormed(), true);
  assert.equal(risultato.contenuto.isWellFormed(), true);
  assert.equal(Buffer.from(risultato.contenuto, "utf8").toString("utf8"), risultato.contenuto);
});
