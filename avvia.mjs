// Lanciatore dell'interfaccia grafica di pi.
// Avvia il ponte, attende che risponda, apre la finestra dell'applicazione.
// Usa solo Node, che serve comunque per far funzionare l'interfaccia.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as attendi } from "node:timers/promises";
import { createInterface } from "node:readline";

const QUI = dirname(fileURLToPath(import.meta.url));
const SERVER = join(QUI, "app", "server.mjs");
const VERSIONE_NODE_MINIMA = [22, 19, 0];
const LIMITE_RISPOSTA_SALUTE = 64 * 1024;

function versioneNodeSupportata(versione, minima = VERSIONE_NODE_MINIMA) {
  const parti = String(versione).split(".").map((voce) => Number.parseInt(voce, 10) || 0);
  for (let indice = 0; indice < minima.length; indice += 1) {
    if ((parti[indice] || 0) > minima[indice]) return true;
    if ((parti[indice] || 0) < minima[indice]) return false;
  }
  return true;
}

if (!versioneNodeSupportata(process.versions.node)) {
  console.error(`Interfaccia pi richiede Node.js ${VERSIONE_NODE_MINIMA.join(".")} o successivo (trovato ${process.versions.node}).`);
  process.exit(1);
}

function portaConfigurata(valore, predefinita = 4666) {
  const numero = Number(String(valore ?? "").trim() || predefinita);
  if (!Number.isInteger(numero) || numero < 1 || numero > 65535) {
    throw new Error("PI_GUI_PORT deve essere un numero intero fra 1 e 65535");
  }
  return numero;
}

// Le porte alternative sono riservate al collaudo esplicito: il launcher
// normale usa sempre 4666, che funge anche da mutex contro la vecchia versione.
const PORTA = portaConfigurata(process.env.PI_GUI_DEV_PORT);
const INDIRIZZO = "http://localhost:" + PORTA;

const colora = (testo, codice) => "\u001b[" + codice + "m" + testo + "\u001b[0m";
const scrivi = (testo) => console.log("  " + testo);
const buono = (testo) => scrivi(colora(testo, "32"));
const male = (testo) => scrivi(colora(testo, "31"));
const tenue = (testo) => scrivi(colora(testo, "90"));

async function leggiJsonLimitato(risposta, limite = LIMITE_RISPOSTA_SALUTE) {
  const dichiarata = Number(risposta.headers.get("content-length"));
  if (Number.isFinite(dichiarata) && dichiarata > limite) {
    throw new Error("risposta del ponte troppo grande");
  }
  const lettore = risposta.body?.getReader();
  if (!lettore) throw new Error("risposta del ponte vuota");
  const pezzi = [];
  let totale = 0;
  try {
    while (true) {
      const { value, done } = await lettore.read();
      if (done) break;
      totale += value.byteLength;
      if (totale > limite) {
        void lettore.cancel().catch(() => {});
        throw new Error("risposta del ponte troppo grande");
      }
      pezzi.push(value);
    }
  } finally {
    lettore.releaseLock();
  }
  const uniti = new Uint8Array(totale);
  let posizione = 0;
  for (const pezzo of pezzi) {
    uniti.set(pezzo, posizione);
    posizione += pezzo.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(uniti));
}

async function ponteRisponde(timeoutMs = 1500) {
  try {
    const controllo = AbortSignal.timeout(Math.max(50, Math.min(1500, timeoutMs)));
    const r = await fetch(INDIRIZZO + "/api/salute", {
      signal: controllo,
      headers: { "x-pi-gui-client": "launcher-node" },
    });
    if (!r.ok) return false;
    const dati = await leggiJsonLimitato(r);
    return dati.servizio === "pi-gui-bridge" && dati.versione === 7;
  } catch {
    return false;
  }
}

function processoTerminato(processo) {
  return !processo || processo.exitCode !== null || processo.signalCode !== null;
}

async function arrestaFiglioNonPronto(processo) {
  if (processoTerminato(processo)) return;
  const terminato = new Promise((risolvi) => processo.once("exit", risolvi));
  try {
    processo.kill();
  } catch {
    return;
  }
  await Promise.race([terminato, attendi(1500)]);
}

function avviaProcesso(comando, argomenti, opzioni, { staccato = false } = {}) {
  return new Promise((risolvi) => {
    let processo;
    try {
      processo = spawn(comando, argomenti, opzioni);
    } catch {
      risolvi(false);
      return;
    }
    let concluso = false;
    const termina = (esito) => {
      if (concluso) return;
      concluso = true;
      risolvi(esito);
    };
    processo.once("error", () => termina(false));
    processo.once("spawn", () => {
      // Un errore successivo allo spawn non deve diventare un evento non gestito.
      processo.on("error", () => {});
      if (staccato) processo.unref();
      termina(true);
    });
  });
}

async function aspettaInvio(messaggio) {
  const lettore = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((ok) => lettore.question("\n  " + messaggio + " ", ok));
  lettore.close();
}

function trovaBrowser() {
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidati = [
    join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
  ];
  return candidati.find((c) => existsSync(c)) || null;
}

function trovaLms() {
  const nome = process.platform === "win32" ? "lms.exe" : "lms";
  const esplicito = process.env.PI_GUI_LMS;
  const candidati = [
    esplicito && isAbsolute(esplicito) ? esplicito : null,
    join(homedir(), ".lmstudio", "bin", nome),
    ...String(process.env.PATH || "")
      .split(delimiter)
      .filter((cartella) => cartella && isAbsolute(cartella))
      .map((cartella) => join(cartella, nome)),
  ];
  return candidati.find((candidato) => candidato && existsSync(candidato)) || null;
}

function cmdDiSistema() {
  const candidato = join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
  return existsSync(candidato) ? candidato : null;
}

// ---------------------------------------------------------------------------

console.log("");
scrivi(colora("Interfaccia pi", "36"));
console.log("");

if (!existsSync(SERVER)) {
  male("File mancante: " + SERVER);
  await aspettaInvio("Premi Invio per chiudere.");
  process.exit(1);
}

// Il ponte potrebbe già essere acceso da un avvio precedente: in quel caso
// lo riusiamo, invece di scontrarci sulla stessa porta.
let ponte = null;
let ponteFallito = false;
let ponteLegacyBloccante = false;
let ultimoErrore = "";
let pronto = await ponteRisponde();

if (pronto) {
  tenue("Il ponte era già attivo, lo riuso.");
} else {
  scrivi("Avvio del ponte verso pi...");
  let prossimoAvvio = 0;
  const scadenza = Date.now() + 30_000;
  // Trenta secondi coprono anche una porta che si sta liberando. Una versione
  // 1.x riconosciuta non viene terminata: il launcher mostra subito cosa fare.
  while (!pronto && Date.now() < scadenza) {
    // Due launcher simultanei, o un ponte che sta finendo di chiudersi,
    // possono far terminare un figlio con EADDRINUSE. Continuiamo a sondare
    // e ritentiamo: chi vince la porta verra riusato da entrambe le finestre.
    pronto = await ponteRisponde(scadenza - Date.now());
    if (pronto) break;
    if (ponte?.exitCode === 2) {
      ponteLegacyBloccante = true;
      break;
    }
    const terminato = !ponte || ponteFallito || processoTerminato(ponte);
    if (terminato && Date.now() >= prossimoAvvio) {
      ponteFallito = false;
      const avviato = spawn(process.execPath, [SERVER], {
        cwd: QUI,
        env: { ...process.env, PI_GUI_PORT: String(PORTA) },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      ponte = avviato;
      prossimoAvvio = Date.now() + 1200;
      avviato.on("error", (errore) => {
        ponteFallito = true;
        ultimoErrore = String(errore.message || errore);
      });
      avviato.stderr.on("data", (pezzo) => {
        ultimoErrore = (ultimoErrore + pezzo.toString("utf8")).slice(-12000);
      });
    }
    const residuo = scadenza - Date.now();
    if (residuo > 0) await attendi(Math.min(300, residuo));
  }
  if (!pronto && !ponteLegacyBloccante) pronto = await ponteRisponde(500);

  if (!pronto) {
    await arrestaFiglioNonPronto(ponte);
    if (ponteLegacyBloccante) {
      male("La vecchia Interfaccia pi sta ancora usando la porta " + PORTA + ".");
      scrivi("Chiudi la vecchia finestra e la sua conversazione, poi riprova.");
    } else {
      male("Il ponte non risponde sulla porta " + PORTA + ".");
    }
    if (ultimoErrore.trim()) {
      console.log("");
      tenue("Errore riportato dal ponte:");
      console.log(ultimoErrore.trim());
    }
    await aspettaInvio("Premi Invio per chiudere.");
    process.exit(1);
  }
  buono("Ponte attivo.");
}

// Server dei modelli locali: parte in parallelo, non deve far attendere.
try {
  const lms = trovaLms();
  if (lms) {
    tenue("Provo ad avviare in parallelo il server dei modelli locali.");
    spawn(lms, ["server", "start"], {
      cwd: QUI,
      stdio: "ignore",
      windowsHide: true,
      detached: false,
    }).on("error", () => {
      // LM Studio non disponibile: non è un problema, restano i modelli in rete
    });
  }
} catch {
  // ignorato di proposito
}

// Apertura in finestra dedicata, senza barra degli indirizzi.
const browser = trovaBrowser();
if (browser) {
  const aperto = await avviaProcesso(browser, ["--app=" + INDIRIZZO, "--window-size=1400,900"], {
    stdio: "ignore",
    detached: true,
  }, { staccato: true });
  if (aperto) buono("Apro la finestra.");
  else tenue("Il browser dedicato non parte: provo quello predefinito.");
  if (!aperto) {
    const cmd = cmdDiSistema();
    if (cmd) {
      const fallback = await avviaProcesso(cmd, ["/d", "/c", "start", "", INDIRIZZO], {
        cwd: QUI,
        stdio: "ignore",
        windowsHide: true,
      });
      if (!fallback) male("Non riesco ad aprire il browser. Usa " + INDIRIZZO);
    } else {
      male("Non trovo un browser da aprire automaticamente. Usa " + INDIRIZZO);
    }
  }
} else {
  scrivi("Nessun browser compatibile trovato: apro con quello predefinito.");
  const cmd = cmdDiSistema();
  if (cmd) {
    const aperto = await avviaProcesso(cmd, ["/d", "/c", "start", "", INDIRIZZO], {
      cwd: QUI,
      stdio: "ignore",
      windowsHide: true,
    });
    if (!aperto) male("Non riesco ad aprire il browser. Usa " + INDIRIZZO);
  } else {
    male("Non trovo un browser da aprire automaticamente. Usa " + INDIRIZZO);
  }
}

console.log("");
scrivi(colora("Interfaccia aperta su " + INDIRIZZO, "36"));
tenue("Puoi chiudere questa finestra: l'interfaccia continuera a funzionare.");

await aspettaInvio("Premi Invio per chiudere il lanciatore.");

// Il ponte e condivisibile fra piu finestre e si spegne da solo poco dopo che
// l'ultima interfaccia viene chiusa. Non lo uccidiamo da qui: potremmo
// interrompere un'altra finestra ancora aperta.
process.exit(0);
