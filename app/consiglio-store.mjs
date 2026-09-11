// Persistenza dei lavori del consiglio a più modelli.
// Un solo file JSON per lavoro sotto ~/.pi/gui/consigli, scritto con la
// scrittura atomica già usata dalle impostazioni e serializzato per chiave.
// Il modulo non conosce né HTTP né le sessioni: riceve oggetti semplici.

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { creaSerializzatore, scriviFileAtomico } from "./persistenza-atomica.mjs";

export const RITENZIONE_LAVORI_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_LAVORI_CONSERVATI = 50;
export const LIMITE_LOG_TEST = 16 * 1024;
export const STATI_RITENZIONE = new Set(["approvato", "annullato"]);

const LAVORO_ID_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/u;

export function lavoroIdValido(valore) {
  return typeof valore === "string" && LAVORO_ID_VALIDO.test(valore) ? valore : null;
}

export function troncaLog(testo, limite = LIMITE_LOG_TEST) {
  const contenuto = String(testo ?? "");
  if (Buffer.byteLength(contenuto, "utf8") <= limite) return contenuto;
  return Buffer.from(contenuto, "utf8").subarray(0, limite).toString("utf8")
    + "\n[...] registro troncato a " + limite + " byte.";
}

export function improntaTesto(testo) {
  return createHash("sha256").update(String(testo ?? ""), "utf8").digest("hex");
}

// Gli allegati restano nel lavoro soltanto come riferimento: percorso, nome,
// dimensione e impronta. Il contenuto non viene mai copiato nel file.
export function allegatoPerRiferimento(allegato) {
  if (!allegato || typeof allegato !== "object") return null;
  const percorso = typeof allegato.percorso === "string" ? allegato.percorso : "";
  if (!percorso) return null;
  const contenuto = typeof allegato.contenuto === "string" ? allegato.contenuto : null;
  return {
    percorso,
    nome: typeof allegato.nome === "string" ? allegato.nome : null,
    dimensione: Number.isFinite(allegato.dimensione)
      ? allegato.dimensione
      : (contenuto === null ? null : Buffer.byteLength(contenuto, "utf8")),
    impronta: typeof allegato.impronta === "string"
      ? allegato.impronta
      : (contenuto === null ? null : improntaTesto(contenuto)),
  };
}

function revisionePerDisco(revisione) {
  if (!revisione || typeof revisione !== "object") return revisione;
  return {
    ...revisione,
    allegati: Array.isArray(revisione.allegati)
      ? revisione.allegati.map(allegatoPerRiferimento).filter(Boolean)
      : [],
  };
}

function controlloPerDisco(controllo, limiteLog) {
  if (!controllo || typeof controllo !== "object") return controllo;
  return {
    ...controllo,
    logTroncato: controllo.logTroncato == null
      ? null
      : troncaLog(controllo.logTroncato, limiteLog),
  };
}

// Prepara la copia da scrivere: allegati per riferimento e registro dei test
// troncato anche su disco, non soltanto a schermo.
export function lavoroPerDisco(lavoro, { limiteLog = LIMITE_LOG_TEST } = {}) {
  if (!lavoro || typeof lavoro !== "object") {
    throw new Error("Il lavoro del consiglio deve essere un oggetto");
  }
  const copia = { ...lavoro };
  if (Array.isArray(copia.revisioni)) copia.revisioni = copia.revisioni.map(revisionePerDisco);
  if (copia.revisioneCorrente) copia.revisioneCorrente = revisionePerDisco(copia.revisioneCorrente);
  if (copia.controllo) copia.controllo = controlloPerDisco(copia.controllo, limiteLog);
  if (Array.isArray(copia.controlli)) {
    copia.controlli = copia.controlli.map((voce) => controlloPerDisco(voce, limiteLog));
  }
  return copia;
}

export function creaArchivioConsigli({
  radice,
  serializza = creaSerializzatore(),
  scriviFile = scriviFileAtomico,
  limiteLog = LIMITE_LOG_TEST,
  adesso = () => Date.now(),
} = {}) {
  if (typeof radice !== "string" || !radice) {
    throw new Error("La cartella dei lavori del consiglio non è valida");
  }

  function percorso(lavoroId) {
    const id = lavoroIdValido(lavoroId);
    if (!id) throw new Error("L'identificativo del lavoro non è valido");
    return join(radice, id + ".json");
  }

  async function salva(lavoro) {
    const id = lavoroIdValido(lavoro?.lavoroId);
    if (!id) throw new Error("L'identificativo del lavoro non è valido");
    const daScrivere = lavoroPerDisco(lavoro, { limiteLog });
    await serializza(id, async () => {
      await mkdir(radice, { recursive: true });
      await scriviFile(percorso(id), JSON.stringify(daScrivere, null, 2) + "\n");
    });
    return daScrivere;
  }

  async function carica(lavoroId) {
    try {
      return JSON.parse(await readFile(percorso(lavoroId), "utf8"));
    } catch (errore) {
      if (errore?.code === "ENOENT") return null;
      throw errore;
    }
  }

  async function elenca() {
    let voci;
    try {
      voci = await readdir(radice, { withFileTypes: true });
    } catch (errore) {
      if (errore?.code === "ENOENT") return [];
      throw errore;
    }
    const lavori = [];
    for (const voce of voci) {
      if (!voce.isFile() || !voce.name.endsWith(".json")) continue;
      const id = lavoroIdValido(voce.name.slice(0, -".json".length));
      if (!id) continue;
      const lavoro = await carica(id).catch(() => null);
      if (lavoro && lavoro.lavoroId === id) lavori.push(lavoro);
    }
    return lavori;
  }

  function istante(lavoro) {
    const valore = Date.parse(lavoro?.aggiornatoIl || lavoro?.creatoIl || "");
    return Number.isFinite(valore) ? valore : 0;
  }

  // All'apertura del ponte: via i lavori conclusi oltre la ritenzione, poi si
  // tengono al massimo i più recenti. Un lavoro ancora aperto non si cancella
  // mai per anzianità.
  async function applicaRitenzione({
    ritenzioneMs = RITENZIONE_LAVORI_MS,
    massimo = MAX_LAVORI_CONSERVATI,
  } = {}) {
    const lavori = await elenca();
    const ora = adesso();
    const rimossi = [];
    const restanti = [];
    for (const lavoro of lavori) {
      const concluso = STATI_RITENZIONE.has(String(lavoro?.stato || ""));
      if (concluso && ora - istante(lavoro) > ritenzioneMs) rimossi.push(lavoro);
      else restanti.push(lavoro);
    }
    restanti.sort((a, b) => istante(b) - istante(a));
    for (const lavoro of restanti.slice(massimo)) rimossi.push(lavoro);
    for (const lavoro of rimossi) {
      await rm(percorso(lavoro.lavoroId), { force: true }).catch(() => {});
    }
    return {
      esaminati: lavori.length,
      rimossi: rimossi.map((lavoro) => lavoro.lavoroId),
      conservati: restanti.slice(0, massimo).map((lavoro) => lavoro.lavoroId),
    };
  }

  return { radice, percorso, salva, carica, elenca, applicaRitenzione };
}
