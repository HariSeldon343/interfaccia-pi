// Prova di integrazione del consiglio: nessun doppio sui punti di aggancio.
// La fusione, il parser dell'uscita, la guardia degli strumenti e i controlli
// sono i moduli veri; a essere finto resta soltanto pi, che qui risponde nel
// formato a cinque sezioni. Il percorso provato è quello intero: avvia,
// raccolta, fusione, verifica, bozza valida, approva.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { creaPonte } from "../app/server.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const FAKE_PI = join(QUI, "fake-pi.mjs");

function pausa(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

function improntaTesto(testo) {
  return createHash("sha256").update(String(testo ?? ""), "utf8").digest("hex");
}

async function avviaPonteIntegrazione(t, { cartella, maxSessioni = 4, ...opzioni } = {}) {
  const home = await mkdtemp(join(tmpdir(), "pi-gui-integrazione-"));
  const cartellaLavoro = join(home, cartella);
  await mkdir(cartellaLavoro, { recursive: true });
  const ponte = creaPonte({
    home,
    cliPi: FAKE_PI,
    maxSessioni,
    autoStopMs: 0,
    bloccaComandiEstensione: false,
    // Gli unici doppi restano quelli che ogni prova del ponte usa: la
    // cronologia, il supporto del runtime e l'albero dei processi di Windows,
    // che qui costerebbe secondi senza provare niente del consiglio.
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
    caricaCronologia: async ({ sessione }) => {
      const dati = await sessione.inviaEAttendi({ type: "get_messages" });
      return dati.messages || [];
    },
    caricaSupportoRuntime: async () => ({
      versione: "0.84.2",
      getAgentDir: () => join(home, ".pi", "agent"),
      getShareViewerUrl: () => "https://example.test/share",
      ProjectTrustStore: class { get() { return null; } set() {} },
      modelliPredefiniti: { fake: "modello-test" },
    }),
    ...opzioni,
  });
  await new Promise((risolvi) => ponte.server.listen(0, "127.0.0.1", risolvi));
  const base = `http://127.0.0.1:${ponte.server.address().port}`;
  const stato = await (await fetch(base + "/api/stato")).json();
  assert.equal(stato.tokenApi, ponte.tokenApi, JSON.stringify(stato));
  const post = async (via, corpo) => {
    const risposta = await fetch(base + via, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pi-gui-token": stato.tokenApi },
      body: JSON.stringify(corpo),
    });
    return { risposta, dati: await risposta.json() };
  };
  t.after(async () => {
    await ponte.chiudiTutto().catch(() => {});
    if (ponte.server.listening) await new Promise((risolvi) => ponte.server.close(() => risolvi()));
    await rm(home, { recursive: true, force: true }).catch(() => {});
  });
  const avvio = await post("/api/avvia", { cartella: cartellaLavoro });
  assert.equal(avvio.risposta.status, 200, JSON.stringify(avvio.dati));
  return { home, cartellaLavoro, ponte, base, stato, post, sorgenteId: avvio.dati.id };
}

async function attendiStato(ambiente, lavoroId, stati, timeout = 30_000) {
  const fine = Date.now() + timeout;
  let ultimo = null;
  while (Date.now() < fine) {
    const esito = await ambiente.post("/api/consiglio/stato", { lavoroId });
    if (esito.risposta.status === 200) {
      ultimo = esito.dati;
      if (stati.includes(ultimo.lavoro.stato)) return ultimo;
    }
    await pausa(25);
  }
  throw new Error(`Il lavoro non ha raggiunto ${stati.join(" o ")}: ${JSON.stringify(ultimo?.lavoro)}`);
}

// I prompt ricevuti dai ruoli sono tracciati dal pi finto nella cartella di
// lavoro: è il solo modo di leggere che cosa è arrivato davvero alla sessione.
async function promptDiRuolo(cartellaLavoro, frase) {
  const tracce = (await readdir(cartellaLavoro)).filter((nome) => nome.startsWith("consiglio-prompt-"));
  for (const nome of tracce) {
    const testo = await readFile(join(cartellaLavoro, nome), "utf8");
    if (testo.includes(frase)) return testo;
  }
  throw new Error(`Nessun prompt di ruolo contiene "${frase}": tracce ${JSON.stringify(tracce)}`);
}

test("un lavoro di testo arriva alla bozza valida e all'approvazione con i moduli veri", async (t) => {
  const ambiente = await avviaPonteIntegrazione(t, { cartella: "consiglio-uscita-valida-testo" });
  const segreto = "riga riservata del cliente";
  const improntaAllegato = improntaTesto(segreto);
  const avvio = await ambiente.post("/api/consiglio/avvia", {
    operationId: "op-" + randomUUID(),
    sourceSessionId: ambiente.sorgenteId,
    prompt: "Scrivi una nota breve sul rischio residuo.",
    tipo: "testo",
    allegati: [{ percorso: "C:/dati/perizia.md", nome: "perizia.md", contenuto: segreto }],
  });
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  assert.equal(avvio.dati.ruoli.length, 2, "un consigliere più lo scrittore");

  const finale = await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(finale.lavoro.stato, "bozza_valida", JSON.stringify(finale.lavoro));
  assert.equal(finale.contributi.length, 1);
  assert.equal(finale.contributi[0].incluso, true);
  assert.match(finale.contributi[0].testo, /ruolo consigliere/);

  // Il risultato viene dal parser vero, non da un doppio che rimanda il testo.
  assert.match(finale.risultato.testo, /^Sintesi del consiglio/);
  assert.equal(finale.risultato.testo.includes("### PROVENIENZA"), false, "il parser separa le sezioni");
  assert.deepEqual(finale.risultato.provenienza.map((voce) => voce.contributo), ["consigliere-1"]);
  assert.deepEqual(finale.risultato.scartati.map((voce) => voce.contributo), ["consigliere-1"]);
  assert.deepEqual(finale.risultato.fileModificati, [], "un lavoro di testo non dichiara file");
  assert.deepEqual(finale.risultato.eval.map((casella) => casella.codice), ["E1", "E2", "E3", "E4"]);
  assert.equal(finale.risultato.eval.every((casella) => casella.segnata === true), true);
  assert.equal(finale.risultato.risultatoHash, improntaTesto(finale.risultato.testo));

  // Il controllo è quello vero: caselle EVAL valutate da consiglio-controlli.
  assert.equal(finale.controllo.tipo, "eval");
  assert.equal(finale.controllo.esito, "pass");
  assert.deepEqual(finale.controllo.motivi, []);
  assert.deepEqual(finale.controllo.impronteFile, []);
  assert.deepEqual(finale.azioni, { approva: true, rifai: true, annulla: true });
  assert.deepEqual(finale.lavoro.problemi, []);

  // Il contratto dello scrittore e gli allegati per riferimento sono arrivati.
  const promptScrittore = await promptDiRuolo(ambiente.cartellaLavoro, "Sei lo scrittore di questo consiglio");
  assert.match(promptScrittore, /--- INIZIO CONTRIBUTO consigliere-1 ---/);
  assert.match(promptScrittore, /^## ISTRUZIONI AGGIUNTIVE$/mu, "il contratto vero di P2, non uno riscritto");
  assert.match(promptScrittore, /^### ALLEGATI$/mu, "gli allegati dello scrittore stanno nelle istruzioni");
  assert.match(promptScrittore, /C:\/dati\/perizia\.md/);
  assert.equal(promptScrittore.includes(improntaAllegato), true, "l'impronta arriva allo scrittore");
  assert.equal(promptScrittore.includes(segreto), false, "il contenuto non arriva mai al ruolo");
  const promptConsigliere = await promptDiRuolo(ambiente.cartellaLavoro, "### RICHIESTA");
  assert.match(promptConsigliere, /^### ALLEGATI$/mu, "la sezione degli allegati del consigliere");
  assert.equal(promptConsigliere.includes(segreto), false);

  const approvazione = await ambiente.post("/api/consiglio/approva", {
    operationId: "op-" + randomUUID(),
    lavoroId: avvio.dati.lavoroId,
    revisione: 1,
    risultatoHash: finale.risultato.risultatoHash,
  });
  assert.equal(approvazione.risposta.status, 200, JSON.stringify(approvazione.dati));
  assert.equal(approvazione.dati.stato, "approvato");
  assert.equal(approvazione.dati.testo, finale.risultato.testo);
  const dopo = await ambiente.post("/api/consiglio/stato", { lavoroId: avvio.dati.lavoroId });
  assert.equal(dopo.dati.lavoro.stato, "approvato");
  assert.equal(dopo.dati.azioni.approva, false);
  assert.equal(ambiente.ponte.sessioni.size, 1, "le sessioni di ruolo si chiudono all'approvazione");
});

test("un lavoro di codice esegue il piano indicato a mano e blocca Approva se il file dichiarato cambia", async (t) => {
  const ambiente = await avviaPonteIntegrazione(t, { cartella: "consiglio-uscita-valida-codice" });
  const avvio = await ambiente.post("/api/consiglio/avvia", {
    operationId: "op-" + randomUUID(),
    sourceSessionId: ambiente.sorgenteId,
    prompt: "Aggiungi una nota al progetto.",
    tipo: "codice",
    consenso: true,
    piano: { eseguibile: process.execPath, argomenti: ["-e", "process.exit(0)"] },
  });
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  assert.equal(avvio.dati.piano.origine, "manuale");

  const finale = await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(finale.lavoro.stato, "bozza_valida", JSON.stringify(finale.lavoro));
  assert.deepEqual(finale.risultato.fileModificati, ["nota-del-consiglio.md"]);
  assert.equal(finale.controllo.tipo, "test", "per un lavoro di codice il comando viene eseguito davvero");
  assert.equal(finale.controllo.esito, "pass", JSON.stringify(finale.controllo.motivi));
  assert.deepEqual(finale.controllo.motivi, []);

  const dichiarato = join(ambiente.cartellaLavoro, "nota-del-consiglio.md");
  const originale = await readFile(dichiarato, "utf8");
  assert.equal(finale.controllo.impronteFile.length, 1);
  assert.equal(finale.controllo.impronteFile[0].percorso, dichiarato);
  assert.equal(finale.controllo.impronteFile[0].impronta, improntaTesto(originale));

  // Qualcuno tocca il file dopo il controllo: l'approvazione non passa.
  await writeFile(dichiarato, originale + "riga aggiunta a mano\n", "utf8");
  const obsoleta = await ambiente.post("/api/consiglio/approva", {
    operationId: "op-" + randomUUID(),
    lavoroId: avvio.dati.lavoroId,
    revisione: 1,
    risultatoHash: finale.risultato.risultatoHash,
  });
  assert.equal(obsoleta.risposta.status, 409, JSON.stringify(obsoleta.dati));
  assert.equal(obsoleta.dati.codice, "controllo-obsoleto");

  // Rimesso com'era, il controllo torna valido e l'approvazione passa.
  await writeFile(dichiarato, originale, "utf8");
  const approvazione = await ambiente.post("/api/consiglio/approva", {
    operationId: "op-" + randomUUID(),
    lavoroId: avvio.dati.lavoroId,
    revisione: 1,
    risultatoHash: finale.risultato.risultatoHash,
  });
  assert.equal(approvazione.risposta.status, 200, JSON.stringify(approvazione.dati));
  assert.equal(approvazione.dati.stato, "approvato");
  assert.match(approvazione.dati.testo, /^Sintesi del consiglio/);
});

test("con il piano npm la guardia protegge il manifesto e un piano cambiato blocca Approva", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pi-gui-integrazione-npm-"));
  const npmCli = join(home, "npm-cli.js");
  await writeFile(npmCli, "process.exit(0);\n", "utf8");
  const ambiente = await avviaPonteIntegrazione(t, {
    cartella: "consiglio-uscita-valida-npm",
    percorsoNpmCli: npmCli,
  });
  t.after(() => rm(home, { recursive: true, force: true }).catch(() => {}));
  const manifesto = join(ambiente.cartellaLavoro, "package.json");
  await writeFile(manifesto, JSON.stringify({ name: "progetto", scripts: { test: "node --test" } }, null, 2), "utf8");

  const avvio = await ambiente.post("/api/consiglio/avvia", {
    operationId: "op-" + randomUUID(),
    sourceSessionId: ambiente.sorgenteId,
    prompt: "Aggiungi una nota al progetto.",
    tipo: "codice",
    consenso: true,
  });
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  assert.equal(avvio.dati.piano.origine, "npm");
  assert.equal(avvio.dati.piano.filePiano, manifesto);
  assert.match(avvio.dati.piano.comando, /npm-cli\.js run test$/);
  assert.deepEqual(
    avvio.dati.problemi,
    [],
    "con la guardia vera il file del piano risulta protetto in scrittura",
  );

  const finale = await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(finale.lavoro.stato, "bozza_valida", JSON.stringify(finale.lavoro));
  assert.equal(finale.controllo.esito, "pass", JSON.stringify(finale.controllo.motivi));
  assert.match(finale.lavoro.consenso.testo, /processore comandi di sistema/);

  // Il manifesto cambia dopo il consenso: l'approvazione si ferma prima di tutto.
  await writeFile(manifesto, JSON.stringify({ name: "progetto", scripts: { test: "node -e 0" } }, null, 2), "utf8");
  const esito = await ambiente.post("/api/consiglio/approva", {
    operationId: "op-" + randomUUID(),
    lavoroId: avvio.dati.lavoroId,
    revisione: 1,
    risultatoHash: finale.risultato.risultatoHash,
  });
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  assert.equal(esito.dati.codice, "piano-cambiato");
});
