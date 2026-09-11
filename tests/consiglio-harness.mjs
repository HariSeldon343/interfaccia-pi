// Banco di prova a mano per il consiglio a più modelli.
// Avvia un ponte isolato con home temporanea e il Pi finto di questi test,
// stampa l'indirizzo da aprire nel browser e lascia il ponte in ascolto.
//
//   node tests/consiglio-harness.mjs --scenario=pass
//   node tests/consiglio-harness.mjs --scenario=fail
//   node tests/consiglio-harness.mjs --scenario=429-esaurisce-ritentativi
//   node tests/consiglio-harness.mjs --scenario=pass --prova    (esegue e esce)
//
// Limite dichiarato: qui il provider non esiste, il modello è il Pi finto di
// tests/fake-pi.mjs. Lo scenario del 429 riproduce un provider che resta in
// errore oltre i ritentativi interni di pi, non una vera chiamata HTTP.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { creaPonte } from "../app/server.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const FAKE_PI = join(QUI, "fake-pi.mjs");

const SCENARI = new Map([
  ["pass", { cartella: "consiglio-harness-pass", esito: "pass" }],
  ["fail", { cartella: "consiglio-harness-fail", esito: "fail" }],
  ["429-esaurisce-ritentativi", { cartella: "consiglio-429-sempre-harness", esito: "pass" }],
]);

function argomento(nome, predefinito = null) {
  const trovato = process.argv.slice(2).find((voce) => voce.startsWith(`--${nome}=`));
  return trovato ? trovato.slice(nome.length + 3) : predefinito;
}

const nomeScenario = argomento("scenario", "pass");
const scenario = SCENARI.get(nomeScenario);
if (!scenario) {
  console.error(`Scenario non riconosciuto: ${nomeScenario}. Scegli fra ${[...SCENARI.keys()].join(", ")}.`);
  process.exit(2);
}
const porta = Number(argomento("porta", "0"));
const soloProva = process.argv.includes("--prova");

const home = await mkdtemp(join(tmpdir(), "pi-gui-harness-"));
const cartellaLavoro = join(home, scenario.cartella);
await mkdir(cartellaLavoro, { recursive: true });
await writeFile(
  join(cartellaLavoro, "nota.md"),
  "File di prova del banco del consiglio.\n",
  "utf8",
);

const ponte = creaPonte({
  home,
  cliPi: FAKE_PI,
  maxSessioni: 6,
  bloccaComandiEstensione: false,
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
  // L'attesa del limite di richieste resta reale ma corta: il banco serve a
  // guardare la scheda, non a fare venti secondi di silenzio.
  attendi: (ms) => new Promise((risolvi) => setTimeout(risolvi, Math.min(ms, 1500))),
  fondiRisultato: {
    componiPrompt: ({ prompt, contributi }) =>
      `Sei lo scrittore di prova.\n### INPUT\n${prompt}\n${contributi.map((voce) => `- ${voce.roleId}: ${voce.testo}`).join("\n")}`,
    analizzaUscita: (testo, contributi) => ({
      ok: true,
      motivi: [],
      risultato: {
        testo,
        provenienza: contributi.map((voce) => ({ parte: "tutta", contributo: voce.roleId })),
        scartati: [],
        fileModificati: [],
        eval: [],
      },
    }),
  },
  verificaControlli: async () => (scenario.esito === "pass"
    ? { tipo: "eval", esito: "pass", motivi: [] }
    : { tipo: "eval", esito: "fail", motivi: ["Banco di prova: controllo forzato a fail."] }),
  guardStrumenti: async () => ({ consentito: false, motivo: "Banco di prova: strumenti negati." }),
});

await new Promise((risolvi) => ponte.server.listen(porta, "127.0.0.1", risolvi));
const base = `http://127.0.0.1:${ponte.server.address().port}`;
const stato = await (await fetch(base + "/api/stato")).json();

async function post(via, corpo) {
  const risposta = await fetch(base + via, {
    method: "POST",
    headers: { "content-type": "application/json", "x-pi-gui-token": stato.tokenApi },
    body: JSON.stringify(corpo),
  });
  return { stato: risposta.status, dati: await risposta.json() };
}

const avvioSessione = await post("/api/avvia", { cartella: cartellaLavoro });
if (avvioSessione.stato !== 200) {
  console.error("Non sono riuscito ad aprire la conversazione sorgente:", avvioSessione.dati);
  process.exit(3);
}

const avvio = await post("/api/consiglio/avvia", {
  operationId: "harness-" + randomUUID(),
  sourceSessionId: avvioSessione.dati.id,
  prompt: "Spiega in dieci righe che cosa cambia con il consiglio a più modelli.",
  tipo: "testo",
});

console.log("");
console.log("  Banco del consiglio pronto su   " + base);
console.log("  Scenario                        " + nomeScenario);
console.log("  Cartella di lavoro              " + cartellaLavoro);
console.log("  Token per le chiamate POST      " + stato.tokenApi);
console.log("  Lavoro avviato                  " + JSON.stringify(avvio.dati.lavoroId || avvio.dati));
console.log("  Per chiudere: Ctrl+C");
console.log("");

if (soloProva) {
  const lavoroId = avvio.dati.lavoroId;
  const fine = Date.now() + 30_000;
  let ultimo = null;
  while (Date.now() < fine) {
    const esito = await post("/api/consiglio/stato", { lavoroId });
    ultimo = esito.dati;
    if (["bozza_valida", "bozza_bloccata", "annullato"].includes(ultimo?.lavoro?.stato)) break;
    await new Promise((risolvi) => setTimeout(risolvi, 50));
  }
  console.log("  Esito della prova:", JSON.stringify({
    stato: ultimo?.lavoro?.stato,
    motivo: ultimo?.lavoro?.motivo,
    controllo: ultimo?.controllo?.esito,
    contributi: ultimo?.contributi?.map((voce) => ({ roleId: voce.roleId, incluso: voce.incluso })),
    ruoli: ultimo?.ruoli?.map((voce) => ({ roleId: voce.roleId, stato: voce.stato, tentativo: voce.tentativo })),
  }, null, 2));
  await ponte.chiudiTutto().catch(() => {});
  await new Promise((risolvi) => ponte.server.close(() => risolvi()));
  await rm(home, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}

for (const segnale of ["SIGINT", "SIGTERM"]) {
  process.on(segnale, async () => {
    await ponte.chiudiTutto().catch(() => {});
    ponte.server.close(async () => {
      await rm(home, { recursive: true, force: true }).catch(() => {});
      process.exit(0);
    });
  });
}
