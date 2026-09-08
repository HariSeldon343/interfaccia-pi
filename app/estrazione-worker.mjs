import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { estraiDocumento } from "./estrazione.mjs";

function risultatoErrore(motivo, annullata = false) {
  return {stato: "errore", pagine: 0, caratteri: 0, motivo, parser: "worker", testo: "", contenuto: null, ...(annullata ? {annullata: true} : {})};
}

export function creaGestoreEstrazione({timeoutMs = 60000, urlWorker = new URL(import.meta.url), guiDirectory} = {}) {
  const code = new Map();
  const generazioni = new Map();
  const attivi = new Set();
  const preparazioni = new Map();
  const attesePreparazioni = new Set();
  let generazioneGlobale = 0;

  const generazioneSessione = (sessionId) => generazioneGlobale + ":" + (generazioni.get(sessionId) || 0);

  function iniziaPreparazione(sessionId) {
    const generazione = generazioneSessione(sessionId);
    preparazioni.set(sessionId, (preparazioni.get(sessionId) || 0) + 1);
    let conclusa = false;
    return { generazione, termina() {
      if (conclusa) return;
      conclusa = true;
      const residue = preparazioni.get(sessionId) - 1;
      if (residue) preparazioni.set(sessionId, residue);
      else preparazioni.delete(sessionId);
      for (const controlla of attesePreparazioni) controlla();
    } };
  }

  function attendiPreparazioni(sessionId) {
    return new Promise((risolvi) => {
      const timer = setTimeout(concludi, 2000);
      function concludi() {
        clearTimeout(timer);
        attesePreparazioni.delete(controlla);
        risolvi();
      }
      function controlla() {
        if (sessionId === undefined ? !preparazioni.size : !preparazioni.has(sessionId)) concludi();
      }
      attesePreparazioni.add(controlla);
      controlla();
    });
  }

  function avvia(sessionId, documento) {
    return new Promise((risolvi) => {
      let lavoratore;
      try {
        lavoratore = new Worker(urlWorker, {
          workerData: {...documento, guiDirectory},
          resourceLimits: {maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 8},
        });
      } catch (errore) {
        risolvi(risultatoErrore("Avvio dell'estrazione non riuscito: " + errore.message));
        return;
      }
      let concluso = false;
      let timer;
      const record = {sessionId, termina};
      attivi.add(record);

      async function termina(risultato) {
        if (concluso) return;
        concluso = true;
        clearTimeout(timer);
        await lavoratore.terminate().catch(() => {});
        attivi.delete(record);
        risolvi(risultato);
      }

      lavoratore.once("message", (risultato) => void termina(risultato));
      lavoratore.once("error", (errore) => void termina(risultatoErrore("Errore nel worker: " + errore.message)));
      lavoratore.once("exit", () => void termina(risultatoErrore("Il worker è terminato senza risultato.")));
      timer = setTimeout(() => void termina(risultatoErrore("Estrazione interrotta: tempo massimo superato (" + timeoutMs + " ms).")), timeoutMs);
    });
  }

  function estrai(sessionId, documento) {
    const generazione = documento.generazione ?? generazioneSessione(sessionId);
    if (generazione !== generazioneSessione(sessionId)) return Promise.resolve(risultatoErrore("sessione chiusa", true));
    const precedente = code.get(sessionId) || Promise.resolve();
    const lavoro = precedente.catch(() => {}).then(() => {
      if (generazione !== generazioneSessione(sessionId)) return risultatoErrore("sessione chiusa", true);
      return avvia(sessionId, documento);
    });
    const coda = lavoro.finally(() => { if (code.get(sessionId) === coda) code.delete(sessionId); });
    code.set(sessionId, coda);
    return coda;
  }

  async function chiudiSessione(sessionId) {
    generazioni.set(sessionId, (generazioni.get(sessionId) || 0) + 1);
    const pendente = code.get(sessionId);
    const preparate = attendiPreparazioni(sessionId);
    await Promise.all([...attivi].filter((record) => record.sessionId === sessionId).map((record) => record.termina(risultatoErrore("Estrazione annullata per chiusura della sessione.", true))));
    await pendente?.catch(() => {});
    await preparate;
  }

  async function chiudi() {
    generazioneGlobale += 1;
    const pendenti = [...code.values()];
    const preparate = attendiPreparazioni();
    await Promise.all([...attivi].map((record) => record.termina(risultatoErrore("Estrazione annullata per chiusura del ponte.", true))));
    await Promise.allSettled(pendenti);
    await preparate;
  }

  return {estrai, iniziaPreparazione, chiudiSessione, chiudi, get attivi() { return attivi.size; }};
}

if (!isMainThread) {
  try {
    parentPort.postMessage(await estraiDocumento(workerData));
  } catch (errore) {
    parentPort.postMessage(risultatoErrore("Estrazione non riuscita: " + errore.message));
  }
}
