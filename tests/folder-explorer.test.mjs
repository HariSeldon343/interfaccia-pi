import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const [frontend, stile, server] = await Promise.all([
  readFile(join(RADICE, "app", "public", "app.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "stile.css"), "utf8"),
  readFile(join(RADICE, "app", "server.mjs"), "utf8"),
]);

test("l'explorer espone Desktop, Documenti, Download, Home e unita", () => {
  for (const nome of ["Desktop", "Documenti", "Download", "Home"]) {
    assert.match(frontend, new RegExp(`nome:\\s*["']${nome}["']`), `manca il punto rapido ${nome}`);
  }
  assert.match(frontend, /function puntiRapidiExplorer\(/);
  assert.match(frontend, /dati\?\.radici\s*\|\|\s*APP\.radici/);
  assert.match(frontend, /aggiungiGruppoPuntiExplorer\(stato,\s*["']Unita["']/);
  assert.match(frontend, /preferitaExplorer\(["']Desktop["'],\s*["']Scrivania["']\)/);
  assert.match(frontend, /OneDrive["'],\s*["']Desktop/,
    "Desktop deve avere anche un fallback per le cartelle reindirizzate in OneDrive");
});

test("tutta la navigazione riusa il solo endpoint locale sfoglia", () => {
  const chiamate = [...frontend.matchAll(/chiedi\(["']\/api\/sfoglia["']/g)];
  assert.equal(chiamate.length, 1, "l'explorer deve centralizzare le letture in disegnaSfoglia");
  assert.match(frontend, /async function disegnaSfoglia\(stato,\s*percorso/);
  assert.match(frontend, /corpo:\s*\{\s*percorso:\s*candidato\s*\|\|\s*["']["']\s*\}/);
  assert.match(frontend, /richiesta\s*!==\s*stato\.richiesta/,
    "le risposte lente non devono sovrascrivere una navigazione piu recente");
});

test("il rilevamento delle unita non blocca l'event loop del bridge", () => {
  const inizio = server.indexOf("async function aggiornaTipiUnitaWindows(");
  const fine = server.indexOf("async function radiciDisponibili(", inizio);
  assert.ok(inizio >= 0 && fine > inizio, "manca il rilevamento asincrono delle unita");
  assert.doesNotMatch(server.slice(inizio, fine), /spawnSync\(/,
    "l'explorer non deve fermare SSE e comandi mentre interroga Windows");
  assert.match(server.slice(inizio, fine), /const processo = spawn\(/);
  assert.match(server, /radici:\s*await radiciDisponibili\(home\)/);
});

test("breadcrumb, percorso manuale e cartella superiore sono navigabili", () => {
  assert.match(frontend, /crea\(["']nav["'],\s*["']esplora-breadcrumbs["']\)/);
  assert.match(frontend, /setAttribute\(["']aria-label["'],\s*["']Percorso corrente["']\)/);
  assert.match(frontend, /setAttribute\(["']aria-current["'],\s*["']location["']\)/);
  assert.match(frontend, /bottone\.onclick\s*=\s*\(\)\s*=>\s*disegnaSfoglia\(stato,\s*segmento\.percorso/);
  assert.match(frontend, /labelCampo\.htmlFor\s*=\s*["']esplora-percorso-manuale["']/);
  assert.match(frontend, /campo\.onkeydown[\s\S]*evento\.key\s*===\s*["']Enter["']/);
  assert.match(frontend, /Vai alla cartella superiore/);
});

test("selezionare, entrare e aprire una cartella restano azioni distinte", () => {
  assert.match(frontend, /seleziona\.onclick\s*=\s*\(\)\s*=>\s*aggiornaSelezioneExplorer\(stato,\s*cartella\)/);
  assert.match(frontend, /seleziona\.ondblclick\s*=\s*\(\)\s*=>\s*disegnaSfoglia\(stato,\s*cartella\.percorso/);
  assert.match(frontend, /crea\(["']button["'],\s*["']esplora-entra["'],\s*["']Entra["']\)/);
  assert.match(frontend, /crea\(["']button["'],\s*["']bottone primario["'],\s*["']Apri cartella selezionata["']\)/);
  assert.match(frontend, /entra\.onclick[\s\S]*disegnaSfoglia\(stato,\s*stato\.selezionata\.percorso/);
  assert.match(frontend, /apri\.onclick[\s\S]*avviaSessione\(stato\.selezionata\.percorso/);
  assert.match(frontend, /approvaProgetto:\s*fiducia\.checked/,
    "la scelta di fiducia deve sopravvivere durante la navigazione");
  assert.match(frontend, /if \(APP\.avvioSessioneInCorso\)/,
    "un doppio click non deve inviare due avvii concorrenti");
  assert.match(frontend, /const modaleOrigine = APP\.modale/);
  assert.match(frontend, /if \(APP\.modale === modaleOrigine\) chiudiModale/,
    "una risposta lenta non deve chiudere una modale aperta successivamente");
});

test("elenco e stato sono accessibili da tastiera e screen reader", () => {
  assert.match(frontend, /lista\.setAttribute\(["']role["'],\s*["']list["']\)/);
  assert.match(frontend, /riga\.setAttribute\(["']role["'],\s*["']listitem["']\)/);
  assert.match(frontend, /seleziona\.setAttribute\(["']aria-pressed["'],\s*["']false["']\)/);
  assert.match(frontend, /setAttribute\(["']aria-label["'],\s*`Seleziona la cartella/);
  for (const tasto of ["ArrowDown", "ArrowUp", "ArrowRight", "Home", "End"]) {
    assert.match(frontend, new RegExp(`["']${tasto}["']`), `manca la tastiera ${tasto}`);
  }
  assert.match(frontend, /annuncio\.setAttribute\(["']role["'],\s*["']status["']\)/);
  assert.match(frontend, /annuncio\.setAttribute\(["']aria-live["'],\s*["']polite["']\)/);
  assert.match(frontend, /errore\.setAttribute\(["']role["'],\s*["']alert["']\)/);
});

test("il layout explorer e responsivo e rende evidente la selezione", () => {
  for (const classe of [
    "esplora-cartelle",
    "esplora-laterale",
    "esplora-principale",
    "esplora-breadcrumbs",
    "esplora-lista",
    "esplora-riga",
    "esplora-selezione",
  ]) {
    assert.match(stile, new RegExp(`\\.${classe}(?:[^\\w-]|$)`), `manca lo stile .${classe}`);
  }
  assert.match(stile, /\.esplora-riga\.selezionata/);
  assert.match(stile, /@media\s*\(max-width:\s*720px\)/);
  assert.match(stile, /\.esplora-cartelle\s*\{[^}]*flex-direction:\s*column/s,
    "su schermi stretti il pannello laterale deve spostarsi sopra l'elenco");
});
