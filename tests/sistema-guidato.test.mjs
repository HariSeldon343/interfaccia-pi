import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  approvaDocumento,
  caricaDatiProgetto,
  collegaLibreriaTemplate,
  creaProgetto,
  elencaProgetti,
  esportaDocumentiApprovati,
  etichettaNaturaInformazione,
  generaBozzaDocumento,
  mappaTemplateDocumento,
  normalizzaSchemi,
  pianoDocumentaleBase,
  promptProssimoPasso,
  prossimeDomande,
  QUESTIONARIO_BASE,
  registraEvidenza,
  salvaRisposte,
  slugSicuro,
  valoriTemplateProgetto,
  verificaCompletezza,
} from "../app/extensions/sistema-guidato/core.mjs";
import { scriviArchivioZip } from "../app/extensions/sistema-guidato/office-package.mjs";

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

test("presenta le nature delle informazioni con etichette italiane leggibili", () => {
  assert.equal(etichettaNaturaInformazione("dichiarazione-utente"), "Dichiarazione dell'utente");
  assert.equal(etichettaNaturaInformazione("fatto-verificato"), "Fatto verificato");
  assert.equal(etichettaNaturaInformazione("fonte-normativa"), "Fonte normativa o contrattuale");
  assert.equal(etichettaNaturaInformazione("evidenza-collegata"), "Evidenza collegata da verificare");
});

test("normalizza nomi e schemi senza duplicati", () => {
  assert.equal(slugSicuro("Qualita' & Ambiente S.p.A."), "qualita-ambiente-s-p-a");
  assert.deepEqual(
    normalizzaSchemi("ISO 9001\n ISO 14001;iso 9001"),
    [
      { id: "iso-9001", titolo: "ISO 9001", fonte: "dichiarazione-utente", fileFonte: null, statoFonte: "da-collegare" },
      { id: "iso-14001", titolo: "ISO 14001", fonte: "dichiarazione-utente", fileFonte: null, statoFonte: "da-collegare" },
    ],
  );
});

test("il piano documentale generico ha dipendenze interne valide", () => {
  const piano = pianoDocumentaleBase();
  const id = new Set(piano.map((voce) => voce.id));
  assert.equal(piano.length, 14);
  assert.equal(id.size, piano.length);
  for (const documento of piano) {
    for (const dipendenza of documento.dipendenze) assert.equal(id.has(dipendenza), true, `${documento.id} -> ${dipendenza}`);
    assert.equal(documento.approvazione.stato, "non-richiesta");
  }
});

test("il questionario propone blocchi progressivi di massimo quattro domande", () => {
  assert.equal(QUESTIONARIO_BASE.length, 23);
  assert.equal(prossimeDomande({ risposte: [] }).length, 4);
  assert.deepEqual(prossimeDomande({ risposte: [{ questionId: "ORG-01", risposta: "Alfa" }] }).map((voce) => voce.id), ["ORG-02", "ORG-03", "CTX-01", "CTX-02"]);
});

test("crea e ritrova un progetto locale completo", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-sistema-guidato-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const { progetto, directory } = await creaProgetto(workspace, {
    id: "cliente-alpha",
    cliente: "Cliente Alpha",
    titolo: "SGI Alpha",
    consulente: "Antonio",
    schemi: "ISO 9001\nISO 14001",
    contesto: "Due sedi",
  });
  assert.equal(progetto.gateApprovazione, "richiesto-prima-esportazione");
  assert.equal((await elencaProgetti(workspace))[0].id, "cliente-alpha");
  const documenti = JSON.parse(await readFile(join(directory, "documents.json"), "utf8"));
  assert.equal(documenti.documenti.length, 14);
  assert.equal(await readFile(join(directory, "evidence.jsonl"), "utf8"), "");
  assert.match(await readFile(join(directory, "audit.jsonl"), "utf8"), /progetto-creato/);
  assert.match(promptProssimoPasso(progetto), /massimo quattro domande/);
});

test("collega i template per riferimento senza copiarli", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-sistema-workspace-"));
  const template = await mkdtemp(join(tmpdir(), "pi-sistema-template-"));
  t.after(() => Promise.all([
    rm(workspace, { recursive: true, force: true }),
    rm(template, { recursive: true, force: true }),
  ]));
  await mkdir(join(template, "procedure"));
  await Promise.all([
    writeFile(join(template, "manuale.docx"), "test"),
    writeFile(join(template, "procedure", "registro.xlsx"), "test"),
    writeFile(join(template, "segreto.exe"), "test"),
  ]);
  const { progetto } = await creaProgetto(workspace, {
    id: "beta",
    cliente: "Beta",
    schemi: "Schema interno",
  });
  const collegato = await collegaLibreriaTemplate(workspace, progetto.id, template);
  assert.equal(collegato.indice.conteggio, 2);
  assert.deepEqual(collegato.indice.file, ["manuale.docx", "procedure/registro.xlsx"]);
  assert.equal(collegato.progetto.templateLibrary.conteggio, 2);
  await assert.rejects(readFile(join(workspace, "manuale.docx")), /ENOENT/);
});

test("salva risposte con provenienza esplicita e collega evidenze senza copiarle", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-sistema-risposte-"));
  const evidenza = join(workspace, "evidenza.txt");
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(evidenza, "verbale verificato", "utf8");
  const { progetto } = await creaProgetto(workspace, { id: "risposte", cliente: "Risposte Srl", schemi: "ISO 9001" });
  const salvate = await salvaRisposte(workspace, progetto.id, [
    { questionId: "ORG-01", risposta: "Risposte S.r.l. - P.IVA 123" },
    { questionId: "ORG-02", risposta: "Sede unica a Bologna" },
  ]);
  assert.equal(salvate.salvate, 2);
  assert.equal(salvate.risposte.risposte[0].natura, "dichiarazione-utente");
  const collegata = await registraEvidenza(workspace, progetto.id, {
    percorso: evidenza,
    descrizione: "Verbale della direzione",
    natura: "fatto-verificato",
    questionId: "ORG-01",
    documenti: ["GOV-01"],
  });
  assert.equal(collegata.evidenza.copiaNelProgetto, false);
  assert.equal(collegata.evidenza.sha256.length, 64);
  const dati = await caricaDatiProgetto(workspace, progetto.id);
  assert.equal(dati.risposte.risposte[0].evidenze.length, 1);
  assert.equal(valoriTemplateProgetto(dati.progetto, dati.risposte).CLIENTE_DENOMINAZIONE, "Risposte S.r.l. - P.IVA 123");
});

test("genera, approva ed esporta soltanto copie integre dei template", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-sistema-output-"));
  const template = await mkdtemp(join(tmpdir(), "pi-sistema-office-"));
  t.after(() => Promise.all([
    rm(workspace, { recursive: true, force: true }),
    rm(template, { recursive: true, force: true }),
  ]));
  const xml = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>{{CLIENTE_NOME}}</w:t></w:r></w:p><w:p><w:r><w:t>[[PROGETTO_TITOLO]]</w:t></w:r></w:p></w:body></w:document>';
  await writeFile(join(template, "profilo.docx"), scriviArchivioZip([
    { nome: "[Content_Types].xml", dati: Buffer.from("<Types/>"), metodo: 0 },
    { nome: "word/document.xml", dati: Buffer.from(xml), metodo: 8 },
  ]));
  const { progetto } = await creaProgetto(workspace, { id: "output", cliente: "Output Srl", titolo: "SGI Output", schemi: "ISO 9001" });
  await collegaLibreriaTemplate(workspace, progetto.id, template);
  await mappaTemplateDocumento(workspace, progetto.id, "GOV-01", "profilo.docx");
  const generata = await generaBozzaDocumento(workspace, progetto.id, "GOV-01");
  assert.equal(generata.documento.stato, "bozza-generata");
  assert.equal(generata.revisione.sostituzioni, 2);
  const approvata = await approvaDocumento(workspace, progetto.id, "GOV-01", "Antonio", "Controllo visivo eseguito");
  assert.equal(approvata.documento.approvazione.stato, "approvato");
  const esportata = await esportaDocumentiApprovati(workspace, progetto.id, ["GOV-01"]);
  assert.equal(esportata.manifesto.file.length, 1);
  assert.match(await readFile(join(esportata.cartella, "manifest.json"), "utf8"), /Controllo visivo eseguito/);
});

test("la verifica di completezza mantiene chiuso il gate finche mancano risposte e approvazioni", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-sistema-gate-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const { progetto } = await creaProgetto(workspace, { id: "gate", cliente: "Gate", schemi: "Schema interno" });
  const dati = await caricaDatiProgetto(workspace, progetto.id);
  const esito = verificaCompletezza(dati);
  assert.equal(esito.prontoPerEsportazione, false);
  assert.ok(esito.obbligatorieMancanti.length > 0);
  assert.equal(esito.documentiApprovati, 0);
});

test("l'estensione usa soltanto primitive RPC sicure e non cambia sessione", async () => {
  const sorgente = await readFile(join(RADICE, "app", "extensions", "sistema-guidato", "index.ts"), "utf8");
  assert.match(sorgente, /registerCommand\("sistema"/);
  assert.match(sorgente, /ctx\.ui\.(?:select|input|editor|confirm)/);
  assert.doesNotMatch(sorgente, /ctx\.ui\.custom|switchSession|newSession/);
});
