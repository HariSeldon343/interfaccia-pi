import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const navigazione = require("../app/public/navigazione-core.js");
const vista = require("../app/public/view-core.js");
const consiglioCore = require("../app/public/consiglio-core.js");
const righe = (gruppi) => gruppi.flatMap((gruppo) => gruppo.voci.flatMap((voce) => voce.righe || [voce]));

test("le conversazioni si raggruppano per cartella, le omonime mostrano il percorso e le aperte non compaiono due volte", () => {
  const allegati = [{ id: "allegato-1" }];
  const aperte = [
    { id: "a", cartella: "C:\\Lavori\\Analisi", nomeSessione: "Prima", fileSessione: "C:\\archivio\\a.jsonl", bozza: "Bozza intatta", allegati },
    { id: "b", cartella: "D:/Clienti/Analisi", nomeSessione: "Seconda", inEsecuzione: true },
    { id: "c", senzaCartella: true, cartella: "C:/tecnica/nascosta", nomeSessione: "Libera" },
  ];
  const salvate = [
    { id: "pi-a", cwd: "c:/lavori/analisi/", percorso: "c:/ARCHIVIO/a.jsonl", nome: "Non duplicare", modificataIl: "2026-09-12T12:00:00Z" },
    { id: "s1", cwd: "C:/Lavori/Analisi", percorso: "C:/archivio/s1.jsonl", nome: "Più vecchia", modificataIl: "2026-09-10T12:00:00Z" },
    { id: "s2", cwd: "C:/Lavori/Analisi", percorso: "C:/archivio/s2.jsonl", nome: "Più recente", modificataIl: "2026-09-11T12:00:00Z" },
  ];
  const prima = structuredClone({ aperte, salvate });
  const gruppi = navigazione.raggruppaConversazioni({ aperte, salvate });
  assert.deepEqual(gruppi.map((gruppo) => gruppo.nome), ["Analisi", "Analisi", "Senza cartella"]);
  assert.deepEqual(gruppi.slice(0, 2).map((gruppo) => gruppo.percorsoVisibile), ["C:\\Lavori\\Analisi", "D:/Clienti/Analisi"]);
  assert.deepEqual(gruppi[0].voci.map((riga) => riga.titolo), ["Prima", "Più recente", "Più vecchia"]);
  assert.equal(righe(gruppi).length, 5);
  assert.equal(gruppi[2].cartella, null);
  assert.equal(gruppi[2].percorsoVisibile, null);
  assert.equal(gruppi[0].voci[0].sessione, aperte[0]);
  assert.equal(gruppi[0].voci[0].sessione.allegati, allegati);
  assert.deepEqual({ aperte, salvate }, prima);
  assert.equal(gruppi[0].voci[1].stato.testo, "chiusa");
});

test("i ruoli del consiglio restano raggruppati sotto il lavoro anche dopo il ripristino da snapshot", () => {
  const ruolo = (id, lavoroId, tipo, numero) => ({ id, cartella: "C:/Progetto", attiva: true,
    nomeSessione: tipo === "scrittore" ? "Scrittore, catalogo" : `Consigliere ${numero}, catalogo`,
    consiglio: { lavoroId, roleId: tipo === "scrittore" ? "scrittore" : `consigliere-${numero}`, ruolo: tipo } });
  const snapshot = [
    ruolo("w", "uno", "scrittore"), ruolo("c2", "uno", "consigliere", 2),
    { id: "normale", cartella: "C:/Progetto", nomeSessione: "Conversazione" },
    ruolo("altro", "due", "consigliere", 1), ruolo("c1", "uno", "consigliere", 1),
    { id: "consiglio:uno", cartella: "C:/Progetto", attiva: false, consiglio: { lavoroId: "uno", stato: "raccolta", preimpostazione: { nome: "Tre consiglieri" } } },
    { id: "consiglio:due", cartella: "C:/Progetto", attiva: false, consiglio: { lavoroId: "due", stato: "bozza_valida" } },
  ];
  const stato = consiglioCore.applicaSnapshotConsiglio(consiglioCore.statoIniziale(), snapshot, { sostituisci: true });
  const gruppi = navigazione.raggruppaConversazioni({ aperte: snapshot, consiglio: stato });
  const lavori = gruppi[0].voci.filter((voce) => voce.tipo === "consiglio");
  assert.equal(lavori.length, 2);
  assert.equal(lavori[0].titolo, "Tre consiglieri");
  assert.equal(lavori[1].titolo, "Lavoro degli agenti");
  assert.deepEqual(lavori[0].righe.map((riga) => riga.id), ["consiglio:uno", "c1", "c2", "w"]);
  assert.deepEqual(lavori[1].righe.map((riga) => riga.id), ["consiglio:due", "altro"]);
  assert.equal(lavori[0].righe[0].stato.testo, "al lavoro", "il risultato senza processo resta una riga aperta del lavoro");
  assert.equal(lavori[1].righe[0].stato.testo, "aperta");
  assert.equal(lavori[0].righe[1].sessione, snapshot[4]);
  const ripristinate = navigazione.raggruppaConversazioni({ aperte: structuredClone(snapshot).reverse(), consiglio: structuredClone(stato) });
  assert.deepEqual(ripristinate[0].voci.find((voce) => voce.lavoroId === "uno").righe.map((riga) => riga.id), ["consiglio:uno", "c1", "c2", "w"]);
});

test("lo stato di lavoro riusa statoAttivita e distingue attesa e chiusura", () => {
  const attiva = { id: "a", attiva: true };
  assert.equal(navigazione.statoConversazione(attiva).testo, "aperta");
  assert.equal(navigazione.statoConversazione({ ...attiva, inEsecuzione: true }).testo, "al lavoro");
  assert.equal(navigazione.statoConversazione({ ...attiva, avvioCompletato: false }).testo, "in attesa");
  assert.equal(navigazione.statoConversazione({ ...attiva, attiva: false }).testo, "chiusa");
  assert.equal(navigazione.statoConversazione(attiva, { aperta: false }).testo, "chiusa");
  assert.deepEqual(navigazione.statoConversazione({ ...attiva, inEsecuzione: true, tentativiFalliti: 2 }).attivita,
    vista.statoAttivita({ inCorso: true, finalizzato: false, tentativiFalliti: 2 }));
  const consiglio = { lavori: { uno: { ruoli: { "consigliere-1": { stato: "attesa_provider" } } } } };
  assert.equal(navigazione.statoConversazione({ ...attiva, inEsecuzione: true,
    consiglio: { lavoroId: "uno", roleId: "consigliere-1" } }, { consiglio }).testo, "in attesa");
});

test("la ricerca conserva il lavoro completo e non legge le directory tecniche senza cartella", () => {
  const aperte = [
    { id: "senza", senzaCartella: true, cartella: "C:/segreto-tecnico", nomeSessione: "Conversazione libera" },
    { id: "r", cartella: "/uno", consiglio: { lavoroId: "lavoro", roleId: "consigliere-1" }, nomeSessione: "Consigliere 1" },
    { id: "consiglio:lavoro", cartella: "/uno", consiglio: { lavoroId: "lavoro" }, nomeSessione: "Risultato speciale" },
  ];
  assert.equal(righe(navigazione.raggruppaConversazioni({ aperte, ricerca: "segreto-tecnico" })).length, 0);
  assert.deepEqual(righe(navigazione.raggruppaConversazioni({ aperte, ricerca: "SPECIALE" })).map((riga) => riga.id), ["consiglio:lavoro", "r"]);
});

test("due processi sullo stesso file restano distinti e la paginazione non duplica le salvate", () => {
  const aperte = [{ id: "uno", fileSessione: "/s/a.jsonl" }, { id: "due", fileSessione: "/s/a.jsonl" }];
  const salvate = [{ id: "a", percorso: "/s/a.jsonl" }, { id: "b", percorso: "/s/b.jsonl" }, { id: "b", percorso: "/s/b.jsonl" }];
  assert.deepEqual(righe(navigazione.raggruppaConversazioni({ aperte, salvate })).map((riga) => riga.id), ["uno", "due", "salvata:/s/b.jsonl"]);
  assert.equal(navigazione.chiavePercorso("C:\\Progetto\\"), "c:/progetto");
  assert.notEqual(navigazione.chiavePercorso("/Progetto"), navigazione.chiavePercorso("/progetto"));
});

test("il modulo browser e puro e usa il nucleo di vista caricato dall'host", async () => {
  const codice = await readFile(new URL("../app/public/navigazione-core.js", import.meta.url), "utf8");
  const chiamate = [];
  const contesto = vm.createContext({ PiGuiViewCore: { statoAttivita: (dati) => { chiamate.push(dati); return { testo: "dal nucleo", livello: "lavoro" }; } } });
  vm.runInContext(codice, contesto);
  const stato = contesto.PiGuiNavigazioneCore.statoConversazione({ id: "a", inEsecuzione: true });
  assert.equal(chiamate.length, 1);
  assert.equal(stato.attivita.testo, "dal nucleo");
  assert.equal(stato.testo, "al lavoro");
  assert.equal("document" in contesto, false);
});
