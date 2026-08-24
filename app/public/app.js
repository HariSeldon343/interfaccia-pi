/* Interfaccia per pi.
   Il browser parla con il ponte locale; ogni scheda corrisponde a un processo
   pi RPC indipendente e conserva il proprio stato. */

"use strict";

const $ = (selettore) => document.querySelector(selettore);
const crea = (tag, classe, testo) => {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (testo != null) elemento.textContent = testo;
  return elemento;
};
const PALETTE_CORE = globalThis.PiGuiPaletteCore;
if (!PALETTE_CORE) throw new Error("Il modulo della palette comandi non e stato caricato");
const AUTH_FLOW = globalThis.PiGuiAuthFlowCore;
if (!AUTH_FLOW) throw new Error("Il modulo del flusso di autenticazione non e stato caricato");

const DOM = {
  schede: $("#schede"),
  conversazione: $("#conversazione"),
  annuncioRisposta: $("#annuncio-risposta"),
  input: $("#input"),
  btnInvia: $("#btn-invia"),
  btnAllega: $("#btn-allega"),
  scegliImmagini: $("#scegli-immagini"),
  allegati: $("#allegati"),
  menuAzioniComposer: $("#menu-azioni-composer"),
  azioneAllegaImmagine: $("#azione-allega-immagine"),
  azioneRichiamaSkill: $("#azione-richiama-skill"),
  azioneComandiEstensioni: $("#azione-comandi-estensioni"),
  azioneRicaricaRisorse: $("#azione-ricarica-risorse"),
  inviiVerifica: $("#invii-verifica"),
  avvisi: $("#avvisi"),
  coda: $("#coda"),
  modoCoda: $("#modo-coda"),
  invioOccupato: $("#invio-occupato"),
  spia: $("#spia"),
  etiStato: $("#eti-stato"),
  etiCartella: $("#eti-cartella"),
  etiPercorso: $("#eti-percorso"),
  etiModello: $("#eti-modello"),
  etiRagionamento: $("#eti-ragionamento"),
  contestoInfo: $("#contesto-info"),
  statoSessioneTui: $("#stato-sessione-tui"),
  statoCwd: $("#stato-cwd"),
  statoUso: $("#stato-uso"),
  statoModelloTui: $("#stato-modello-tui"),
  composerShell: $("#composer-shell"),
  paletteComandi: $("#palette-comandi"),
  listaPaletteComandi: $("#lista-palette-comandi"),
  statoPaletteComandi: $("#stato-palette-comandi"),
  suggerimento: $("#suggerimento"),
  listaComandi: $("#lista-comandi"),
  notaComandi: $("#nota-comandi"),
  btnRicaricaRisorse: $("#btn-ricarica-risorse"),
  btnCercaComandi: $("#btn-cerca-comandi"),
  btnModello: $("#btn-modello"),
  btnRagionamento: $("#btn-ragionamento"),
  btnAlbero: $("#btn-albero"),
  btnControlli: $("#btn-controlli"),
  btnFermaTop: $("#btn-ferma-top"),
  statiEstensioni: $("#stati-estensioni"),
  widgetSopra: $("#widget-sopra"),
  widgetSotto: $("#widget-sotto"),
  velo: $("#velo"),
  modale: $("#modale"),
  modaleTitolo: $("#modale-titolo"),
  modaleCorpo: $("#modale-corpo"),
  modalePiede: $("#modale-piede"),
  modaleChiudi: $("#modale-chiudi"),
  toastArea: $("#toast-area"),
};

const CHIAVE_BOZZE = "pi-gui-bozze-v1";
const PREFISSO_BOZZA = CHIAVE_BOZZE + ":";
const PREFISSO_BOZZA_DOCUMENTO = "pi-gui-bozze-v2:";
const PREFISSO_BOZZE_RISOLTE = "pi-gui-bozze-risolte-v1:";
const PREFISSO_INVII = "pi-gui-invii-v1:";
const PREFISSO_INVII_RISOLTI = "pi-gui-invii-risolti-v1:";
const PREFISSO_RISULTATI_OPERAZIONI = "pi-gui-risultati-operazioni-v1:";
const DURATA_BOZZE_MS = 30 * 24 * 60 * 60 * 1000;
const DURATA_GRAZIA_BUNDLE_MS = 5 * 60 * 1000;
const LIMITE_IMMAGINI_RICHIESTA = 4 * 1024 * 1024;
const LIMITE_IMMAGINI_CRONOLOGIA_BASE64 = 16 * 1024 * 1024;
const LIMITE_TESTO_RICHIESTA = 2 * 1024 * 1024;
const LIMITE_RECORD_CRONOLOGIA = 22 * 1024 * 1024;
const DATABASE_INVII = "pi-gui-invii-v1";
const ARCHIVIO_ALLEGATI_INVII = "allegati-pendenti";
let promessaDatabaseInvii = null;

function chiaveLineageRisolta(lineageId) {
  return PREFISSO_BOZZE_RISOLTE + encodeURIComponent(String(lineageId || ""));
}

function lineageRecordBozza(record) {
  if (!record) return null;
  return record.lineageId
    || (record.versione ? "legacy:" + record.versione : null);
}

function lineageRisolta(recordOId) {
  const lineageId = typeof recordOId === "string"
    ? recordOId
    : lineageRecordBozza(recordOId);
  if (!lineageId) return false;
  try {
    const record = JSON.parse(localStorage.getItem(chiaveLineageRisolta(lineageId)) || "null");
    return record?.lineageId === lineageId
      && Number.isFinite(Number(record.risoltaIl))
      && Date.now() - Number(record.risoltaIl) <= DURATA_BOZZE_MS;
  } catch {
    return false;
  }
}

function bundleBozzaReferenziato(bundleId) {
  if (!bundleId) return false;
  try {
    for (let indice = 0; indice < localStorage.length; indice += 1) {
      const chiave = localStorage.key(indice);
      if (
        !chiave?.startsWith(PREFISSO_BOZZA)
        && !chiave?.startsWith(PREFISSO_BOZZA_DOCUMENTO)
      ) continue;
      const record = JSON.parse(localStorage.getItem(chiave) || "null");
      if (!lineageRisolta(record) && record?.allegatiBundleId === bundleId) return true;
    }
  } catch {
    // In dubbio non eliminiamo dati utente.
    return true;
  }
  return false;
}

function databaseInvii() {
  if (promessaDatabaseInvii) return promessaDatabaseInvii;
  promessaDatabaseInvii = new Promise((risolvi, rifiuta) => {
    if (!globalThis.indexedDB) {
      rifiuta(new Error("Archivio immagini non disponibile"));
      return;
    }
    const richiesta = indexedDB.open(DATABASE_INVII, 1);
    richiesta.onupgradeneeded = () => {
      if (!richiesta.result.objectStoreNames.contains(ARCHIVIO_ALLEGATI_INVII)) {
        richiesta.result.createObjectStore(ARCHIVIO_ALLEGATI_INVII, { keyPath: "id" });
      }
    };
    richiesta.onsuccess = () => {
      risolvi(richiesta.result);
      setTimeout(() => pulisciArchivioAllegati(richiesta.result), 0);
    };
    richiesta.onerror = () => rifiuta(richiesta.error || new Error("Archivio immagini non disponibile"));
  }).catch((errore) => {
    promessaDatabaseInvii = null;
    throw errore;
  });
  return promessaDatabaseInvii;
}

function pulisciArchivioAllegati(db) {
  try {
    const transazione = db.transaction(ARCHIVIO_ALLEGATI_INVII, "readwrite");
    const richiesta = transazione.objectStore(ARCHIVIO_ALLEGATI_INVII).openCursor();
    richiesta.onsuccess = () => {
      const cursore = richiesta.result;
      if (!cursore) return;
      const record = cursore.value;
      let haMarker = false;
      try {
        if (record.tipo === "bozza") {
          haMarker = bundleBozzaReferenziato(record.id);
        } else {
          const suffisso = ":" + encodeURIComponent(record.id);
          for (let indice = 0; indice < localStorage.length; indice += 1) {
            const chiave = localStorage.key(indice);
            if (chiave?.startsWith(PREFISSO_INVII) && chiave.endsWith(suffisso)) {
              haMarker = true;
              break;
            }
          }
        }
      } catch {
        haMarker = true;
      }
      // Un bundle ancora puntato da una bozza valida non scade in autonomia:
      // modificare il testo rinnova il record, non il blob immagine. L'eta del
      // bundle serve soltanto a ripulire record realmente orfani.
      if (
        !haMarker
        && Number.isFinite(Number(record.creataIl))
        && Date.now() - Number(record.creataIl) > DURATA_GRAZIA_BUNDLE_MS
      ) {
        cursore.delete();
      }
      cursore.continue();
    };
  } catch {
    // Pulizia opportunistica: gli invii correnti non devono dipenderne.
  }
}

async function scriviAllegatiInvio(
  id,
  chiaveBozza,
  allegati,
  tipo = "invio",
  markerKey = null,
) {
  if (!allegati.length) return true;
  try {
    const db = await databaseInvii();
    await new Promise((risolvi, rifiuta) => {
      const transazione = db.transaction(ARCHIVIO_ALLEGATI_INVII, "readwrite");
      transazione.objectStore(ARCHIVIO_ALLEGATI_INVII).put({
        id,
        chiaveBozza,
        tipo,
        markerKey,
        creataIl: Date.now(),
        allegati: allegati.map(({ id: allegatoId, nome, mimeType, data, dimensione }) => ({
          id: allegatoId,
          nome,
          mimeType,
          data,
          dimensione,
        })),
      });
      transazione.oncomplete = () => risolvi();
      transazione.onerror = () => rifiuta(transazione.error || new Error("Salvataggio immagini fallito"));
      transazione.onabort = () => rifiuta(transazione.error || new Error("Salvataggio immagini annullato"));
    });
    return true;
  } catch {
    return false;
  }
}

async function leggiStatoAllegatiInvio(id) {
  try {
    const db = await databaseInvii();
    return await new Promise((risolvi, rifiuta) => {
      const richiesta = db
        .transaction(ARCHIVIO_ALLEGATI_INVII, "readonly")
        .objectStore(ARCHIVIO_ALLEGATI_INVII)
        .get(id);
      richiesta.onsuccess = () => risolvi(richiesta.result
        ? { trovato: true, allegati: richiesta.result.allegati || [], errore: null }
        : { trovato: false, allegati: [], errore: null });
      richiesta.onerror = () => rifiuta(richiesta.error);
    });
  } catch (errore) {
    return { trovato: false, allegati: [], errore };
  }
}

async function leggiAllegatiInvio(id) {
  return (await leggiStatoAllegatiInvio(id)).allegati;
}

async function eliminaAllegatiInvio(id) {
  if (!id) return;
  try {
    const db = await databaseInvii();
    await new Promise((risolvi, rifiuta) => {
      const transazione = db.transaction(ARCHIVIO_ALLEGATI_INVII, "readwrite");
      transazione.objectStore(ARCHIVIO_ALLEGATI_INVII).delete(id);
      transazione.oncomplete = () => risolvi();
      transazione.onerror = () => rifiuta(transazione.error);
      transazione.onabort = () => rifiuta(transazione.error);
    });
  } catch {
    // Il record scadra insieme al marker; non blocca il lavoro corrente.
  }
}

async function conservaFotografiaAllegati(
  sessione,
  chiaveBozza,
  allegati,
  lineageAttesa = sessione?.lineageId || null,
) {
  if (!sessione || !chiaveBozza) return false;
  if (
    sessione.chiaveBozza !== chiaveBozza
    || sessione.lineageId !== lineageAttesa
  ) return false;
  const precedenteBundle = sessione.allegatiBundleId || null;
  const nuovoBundle = allegati.length ? "bozza:" + globalThis.crypto.randomUUID() : null;
  let salvato = true;
  if (nuovoBundle) {
    salvato = await scriviAllegatiInvio(
      nuovoBundle,
      chiaveBozza,
      allegati,
      "bozza",
    );
  }
  if (
    sessione.chiaveBozza !== chiaveBozza
    || sessione.lineageId !== lineageAttesa
  ) {
    if (nuovoBundle) await eliminaAllegatiInvio(nuovoBundle);
    return false;
  }
  if (salvato) {
    const scritto = scriviRecordBozzaSessione(sessione, {
      testo: sessione.bozza,
      allegatiBundleId: nuovoBundle,
    });
    salvato = Boolean(scritto);
  }
  if (!salvato && nuovoBundle) await eliminaAllegatiInvio(nuovoBundle);
  if (
    salvato
    && precedenteBundle
    && precedenteBundle !== nuovoBundle
    && !bundleBozzaReferenziato(precedenteBundle)
  ) {
    await eliminaAllegatiInvio(precedenteBundle);
  }
  sessione.allegatiNonPersistiti = !salvato;
  if (!salvato && sessione.id === APP.attivaId) {
    toast(
      "Un'altra finestra ha modificato questa bozza, oppure lo spazio locale non e disponibile. Copia il testo e non chiudere finche non hai risolto il conflitto.",
      "errore",
    );
  }
  return salvato;
}

function conservaAllegatiBozza(sessione) {
  const chiaveBozza = sessione.chiaveBozza;
  const lineageAttesa = sessione.lineageId || null;
  const fotografia = sessione.allegati.map((allegato) => ({ ...allegato }));
  sessione.allegatiNonPersistiti = true;
  const precedente = sessione.codaAllegatiBozza || Promise.resolve();
  sessione.codaAllegatiBozza = precedente
    .catch(() => {})
    .then(() => conservaFotografiaAllegati(
      sessione,
      chiaveBozza,
      fotografia,
      lineageAttesa,
    ));
  return sessione.codaAllegatiBozza;
}

async function ripristinaFotografiaAllegatiBozza(sessione, chiaveAttesa) {
  const record = leggiRecordBozza(chiaveAttesa);
  const lineageAttesa = lineageRecordBozza(record) || sessione.lineageId || null;
  const bundleId = record?.allegatiBundleId || null;
  const statoBundle = bundleId
    ? await leggiStatoAllegatiInvio(bundleId)
    : { trovato: true, allegati: [], errore: null };
  const raccolti = statoBundle.allegati;
  if (
    APP.sessioni.get(sessione.id) !== sessione
    || sessione.chiaveBozza !== chiaveAttesa
    || sessione.lineageId !== lineageAttesa
    || lineageRisolta(record)
  ) return;
  if (bundleId && (!statoBundle.trovato || statoBundle.errore || !raccolti.length)) {
    sessione.erroreAllegatiBozza =
      "La bozza indica immagini non inviate, ma il loro archivio non e leggibile. Riprova oppure scarta esplicitamente solo il riferimento alle immagini mancanti.";
    sessione.allegatiNonPersistiti = true;
    if (sessione.id === APP.attivaId) {
      toast("Non invio una bozza senza le immagini che le appartenevano.", "errore");
      aggiornaInterfacciaAttiva();
    }
    return;
  }
  const dimensione = raccolti.reduce((totale, allegato) => totale + Number(allegato.dimensione || 0), 0);
  if (raccolti.length > 4 || dimensione > LIMITE_IMMAGINI_RICHIESTA) {
    sessione.allegatiNonPersistiti = true;
    if (sessione.id === APP.attivaId) {
      toast("Le immagini conservate superano i limiti sicuri e non sono state caricate. Apri la bozza in una sola finestra e rimuovile.", "errore");
    }
    return;
  }
  sessione.versioneBozza = versioneRecordBozza(leggiRecordBozzaProprio(chiaveAttesa));
  sessione.allegatiBundleId = bundleId;
  sessione.lineageId = record?.cancellata
    ? null
    : lineageRecordBozza(record) || sessione.lineageId || globalThis.crypto.randomUUID();
  sessione.lineageModificataLocalmente = false;
  sessione.allegati = raccolti.map((allegato) => ({
    ...allegato,
    url: `data:${allegato.mimeType};base64,${allegato.data}`,
  }));
  sessione.erroreAllegatiBozza = null;
  if (!sessione.bozzaSporca && typeof record?.testo === "string") {
    sessione.bozza = record.testo;
  }
  // Un nuovo documento non usa direttamente il bundle di un'altra finestra:
  // ne crea una copia propria prima di abilitare l'editor. Cosi una modifica o
  // chiusura dell'altra pagina non puo far sparire immagini gia mostrate qui.
  if (record && record.documentoId !== APP.clientId && !record.cancellata) {
    const adottato = raccolti.length
      ? await conservaFotografiaAllegati(
        sessione,
        chiaveAttesa,
        sessione.allegati.map((allegato) => ({ ...allegato })),
        sessione.lineageId,
      )
      : scriviRecordBozzaSessione(sessione, {
        testo: sessione.bozza,
        allegatiBundleId: null,
      });
    if (!adottato) {
      sessione.allegatiNonPersistiti = true;
      sessione.erroreAllegatiBozza =
        "Non riesco a creare una copia locale coerente di questa bozza. Ricarica la finestra prima di inviare.";
      return;
    }
  }
  sessione.allegatiNonPersistiti = false;
  if (sessione.id === APP.attivaId) {
    if (!sessione.bozzaSporca) DOM.input.value = sessione.bozza;
    disegnaAllegati();
    aggiornaInterfacciaAttiva();
  }
}

function ripristinaAllegatiBozza(sessione) {
  const chiaveAttesa = sessione.chiaveBozza;
  const generazione = Number(sessione.generazioneRipristinoAllegati || 0) + 1;
  sessione.generazioneRipristinoAllegati = generazione;
  sessione.ripristinoAllegatiInCorso = true;
  const precedente = sessione.codaAllegatiBozza || Promise.resolve();
  const finale = precedente
    .catch(() => {})
    .then(() => ripristinaFotografiaAllegatiBozza(sessione, chiaveAttesa))
    .finally(() => {
      if (sessione.generazioneRipristinoAllegati === generazione) {
        sessione.ripristinoAllegatiInCorso = false;
        if (sessione.id === APP.attivaId) aggiornaInterfacciaAttiva();
      }
    });
  sessione.codaAllegatiBozza = finale;
  return finale;
}

async function dimenticaAllegatiBozza(sessione, bundleId = sessione?.allegatiBundleId) {
  if (bundleId) await eliminaAllegatiInvio(bundleId);
  if (!sessione) return;
  sessione.allegatiBundleId = null;
  sessione.allegatiNonPersistiti = false;
}

function clientIdPagina() {
  try {
    const esistente = sessionStorage.getItem("pi-gui-client-id-v1");
    if (esistente) return esistente;
    const nuovo = globalThis.crypto.randomUUID();
    sessionStorage.setItem("pi-gui-client-id-v1", nuovo);
    return nuovo;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

function identitaDocumento() {
  try {
    const precedente = sessionStorage.getItem("pi-gui-page-id-v1");
    const navigazione = globalThis.performance
      ?.getEntriesByType?.("navigation")?.[0]?.type;
    // Un vero F5 mantiene l'ownership della pagina; una scheda duplicata
    // eredita sessionStorage ma ha navigation.type="navigate" e riceve quindi
    // un id nuovo. Non serve un handoff ambiguo fra due possibili successori.
    if (precedente && navigazione === "reload") return { id: precedente };
    const id = globalThis.crypto.randomUUID();
    sessionStorage.setItem("pi-gui-page-id-v1", id);
    return { id };
  } catch {
    return { id: globalThis.crypto.randomUUID() };
  }
}

function chiaveArchivioBozzaLegacy(chiave) {
  return PREFISSO_BOZZA + encodeURIComponent(chiave);
}

function chiaveArchivioBozza(chiave, documentoId = IDENTITA_DOCUMENTO.id) {
  return PREFISSO_BOZZA_DOCUMENTO
    + encodeURIComponent(chiave)
    + ":"
    + encodeURIComponent(documentoId);
}

function caricaBozze() {
  try {
    const precedente = JSON.parse(localStorage.getItem(CHIAVE_BOZZE) || "{}");
    if (precedente && typeof precedente === "object" && !Array.isArray(precedente)) {
      for (const [chiave, record] of Object.entries(precedente)) {
        const archivio = chiaveArchivioBozza(chiave);
        const corrente = JSON.parse(localStorage.getItem(archivio) || "null");
        if (Number(corrente?.aggiornata || 0) <= Number(record?.aggiornata || 0)) {
          localStorage.setItem(archivio, JSON.stringify({
            ...record,
            chiaveBozza: chiave,
            documentoId: IDENTITA_DOCUMENTO.id,
            versione: record?.versione || globalThis.crypto.randomUUID(),
          }));
        }
      }
    }
    localStorage.removeItem(CHIAVE_BOZZE);
    const raccolte = {};
    const fotografie = new Map();
    for (let indice = 0; indice < localStorage.length; indice += 1) {
      const chiaveStorage = localStorage.key(indice);
      if (
        !chiaveStorage?.startsWith(PREFISSO_BOZZA)
        && !chiaveStorage?.startsWith(PREFISSO_BOZZA_DOCUMENTO)
      ) continue;
      try {
        const grezzo = localStorage.getItem(chiaveStorage);
        fotografie.set(chiaveStorage, grezzo);
        const record = JSON.parse(grezzo || "null");
        const chiave = chiaveStorage.startsWith(PREFISSO_BOZZA_DOCUMENTO)
          ? String(record?.chiaveBozza || "")
          : decodeURIComponent(chiaveStorage.slice(PREFISSO_BOZZA.length));
        if (
          chiave
          && !record?.cancellata
          && !lineageRisolta(record)
          && (record?.testo || record?.allegatiBundleId)
          && Number(record?.aggiornata || 0) >= Number(raccolte[chiave]?.aggiornata || 0)
        ) raccolte[chiave] = record;
      } catch {
        // Record isolato non leggibile: resta fuori dalla memoria corrente.
      }
    }
    const adesso = Date.now();
    const valide = Object.fromEntries(
      Object.entries(raccolte)
        .filter(([id, record]) => {
          const aggiornata = Number(record?.aggiornata);
          return Boolean(
            id
            && typeof record?.testo === "string"
            && Number.isFinite(aggiornata)
            && aggiornata <= adesso
            && adesso - aggiornata <= DURATA_BOZZE_MS,
          );
        })
        .sort((a, b) => Number(b[1].aggiornata) - Number(a[1].aggiornata)),
    );
    // Eliminiamo record scaduti/eccedenti solo se non sono cambiati da quando
    // li abbiamo letti: una seconda finestra puo salvare nello stesso istante.
    for (const [chiaveStorage, fotografia] of fotografie) {
      try {
        const record = JSON.parse(fotografia || "null");
        const aggiornata = Number(record?.aggiornata);
        const scaduta = !Number.isFinite(aggiornata)
          || aggiornata > adesso
          || adesso - aggiornata > DURATA_BOZZE_MS;
        if (scaduta && localStorage.getItem(chiaveStorage) === fotografia) {
          localStorage.removeItem(chiaveStorage);
        }
      } catch {
        if (localStorage.getItem(chiaveStorage) === fotografia) {
          localStorage.removeItem(chiaveStorage);
        }
      }
    }
    return valide;
  } catch {
    return {};
  }
}

const IDENTITA_DOCUMENTO = identitaDocumento();
const APP = {
  // Una scheda duplicata eredita sessionStorage: l'id per ownership deve quindi
  // essere nuovo per documento. replayId resta stabile solo per recuperare gli
  // ack persi durante un vero reload della stessa scheda.
  clientId: IDENTITA_DOCUMENTO.id,
  replayId: clientIdPagina(),
  // Il clientId resta stabile durante un reload per ricevere gli ack persi,
  // mentre il nonce cambia per ogni documento: una risposta conservata dal
  // documento precedente non puo quindi completare una nuova richiesta che
  // riutilizzi lo stesso contatore.
  nonceRpc: globalThis.crypto.randomUUID(),
  tokenApi: null,
  modelliPredefiniti: {},
  sessioni: new Map(),
  attivaId: null,
  preferite: [],
  recenti: [],
  radici: [],
  bridgeOnline: false,
  primaConnessione: true,
  eventi: null,
  contatoreRpc: 0,
  attese: new Map(),
  bozzeSalvate: caricaBozze(),
  modale: null,
  dialoghiEstensione: [],
  dialoghiEstensioneVisti: new Set(),
  dialogoEstensioneAttivo: null,
  loginProviderAnnullati: new Set(),
  riconnessioneInCorso: false,
  timerRiconnessione: null,
  tentativoRiconnessione: 0,
  avvioSessioneInCorso: false,
  paletteComandi: {
    aperta: false,
    sessionId: null,
    query: "",
    risultati: [],
    indiceAttivo: 0,
    revision: null,
    soppressa: null,
  },
  menuAzioniComposer: {
    aperto: false,
    indiceAttivo: 0,
  },
};
const COMANDI_CAMBIO_SESSIONE = new Set([
  "new_session",
  "switch_session",
  "clone",
  "fork",
  "import_jsonl",
  "navigate_tree",
]);
const timerSalvaBozza = new Map();
const SUGGERIMENTO_PREDEFINITO = "Invio per inviare · Maiusc+Invio per andare a capo";
let contatoreOpzioniPalette = 0;
let composizioneInputInCorso = false;

function ramificaLineageBozza(sessione) {
  if (!sessione || sessione.lineageModificataLocalmente) return;
  sessione.lineageId = globalThis.crypto.randomUUID();
  sessione.lineageModificataLocalmente = true;
}

function applicaLineageRisolta(lineageId) {
  if (!lineageId) return;
  for (const sessione of APP.sessioni.values()) {
    if (sessione.lineageId !== lineageId) continue;
    clearTimeout(timerSalvaBozza.get(sessione.id));
    timerSalvaBozza.delete(sessione.id);
    sessione.bozza = "";
    sessione.bozzaSporca = false;
    sessione.bozzaNonPersistita = false;
    sessione.allegati = [];
    sessione.allegatiBundleId = null;
    sessione.lineageId = null;
    sessione.lineageModificataLocalmente = false;
    sessione.generazioneRipristinoAllegati = Number(
      sessione.generazioneRipristinoAllegati || 0,
    ) + 1;
    sessione.ripristinoAllegatiInCorso = false;
    if (sessione.id === APP.attivaId) {
      DOM.input.value = "";
      disegnaAllegati();
      adattaAltezza();
      toast("Questa bozza e stata completata o scartata in un'altra finestra.", "avviso");
    }
  }
  aggiornaInterfacciaAttiva();
}

function segnaLineageRisolta(lineageId) {
  if (!lineageId) return false;
  try {
    localStorage.setItem(
      chiaveLineageRisolta(lineageId),
      JSON.stringify({ lineageId, risoltaIl: Date.now() }),
    );
  } catch {
    return false;
  }
  applicaLineageRisolta(lineageId);
  return true;
}

// ---------------------------------------------------------------------------
// Utilita generali
// ---------------------------------------------------------------------------

function testoErrore(errore) {
  return String(errore?.message || errore || "Errore sconosciuto");
}

function erroreConEsitoIgnoto(messaggio) {
  const errore = new Error(messaggio);
  errore.esitoIgnoto = true;
  return errore;
}

function chiaveBozzaPer(meta) {
  const file = String(meta?.fileSessione || "").trim();
  if (file) return "file:" + file.replace(/\//g, "\\").toLocaleLowerCase("en-US");
  return "runtime:" + String(meta?.id || "");
}

function leggiRecordBozzaProprio(chiave) {
  if (!chiave) return null;
  try {
    return JSON.parse(localStorage.getItem(chiaveArchivioBozza(chiave)) || "null");
  } catch {
    return null;
  }
}

function leggiRecordBozza(chiave) {
  const proprio = leggiRecordBozzaProprio(chiave);
  if (proprio) {
    return lineageRisolta(proprio)
      ? { ...proprio, testo: "", allegatiBundleId: null, cancellata: true }
      : proprio;
  }
  const condiviso = APP.bozzeSalvate[chiave] || null;
  if (condiviso) return lineageRisolta(condiviso) ? null : condiviso;
  return (() => {
      try {
        const legacy = JSON.parse(
          localStorage.getItem(chiaveArchivioBozzaLegacy(chiave)) || "null",
        );
        return lineageRisolta(legacy) ? null : legacy;
      } catch {
        return null;
      }
    })();
}

function trovaRecordBozzaPiuRecente(chiave) {
  let migliore = null;
  try {
    for (let indice = 0; indice < localStorage.length; indice += 1) {
      const storageKey = localStorage.key(indice);
      if (
        !storageKey?.startsWith(PREFISSO_BOZZA_DOCUMENTO)
        && storageKey !== chiaveArchivioBozzaLegacy(chiave)
      ) continue;
      const record = JSON.parse(localStorage.getItem(storageKey) || "null");
      const appartiene = storageKey.startsWith(PREFISSO_BOZZA_DOCUMENTO)
        ? record?.chiaveBozza === chiave
        : true;
      if (
        appartiene
        && !record?.cancellata
        && !lineageRisolta(record)
        && (record?.testo || record?.allegatiBundleId)
        && Number(record?.aggiornata || 0) >= Number(migliore?.aggiornata || 0)
      ) migliore = record;
    }
  } catch {
    const condiviso = APP.bozzeSalvate[chiave] || null;
    return lineageRisolta(condiviso) ? null : condiviso;
  }
  return migliore;
}

function versioneRecordBozza(record) {
  if (!record) return null;
  if (typeof record.versione === "string" && record.versione) return record.versione;
  return `legacy:${Number(record.aggiornata || 0)}:${String(record.testo || "")}`;
}

function scriviRecordBozza(chiave, record, versioneAttesa = undefined) {
  if (!chiave) return false;
  try {
    const archivio = chiaveArchivioBozza(chiave);
    const corrente = JSON.parse(localStorage.getItem(archivio) || "null");
    if (
      versioneAttesa !== undefined
      && versioneRecordBozza(corrente) !== versioneAttesa
    ) return false;
    if (Number(corrente?.aggiornata || 0) > Number(record.aggiornata || 0)) {
      // Un'altra finestra ha una versione pi recente: non la sovrascriviamo,
      // ma questa pagina deve sapere che il proprio testo e soltanto in RAM.
      return false;
    }
    const pronto = {
      ...record,
      chiaveBozza: chiave,
      versione: record.versione || globalThis.crypto.randomUUID(),
      documentoId: APP.clientId,
      lineageId: record.lineageId || globalThis.crypto.randomUUID(),
    };
    localStorage.setItem(archivio, JSON.stringify(pronto));
    if (pronto.cancellata) {
      const ripiego = trovaRecordBozzaPiuRecente(chiave);
      if (ripiego) APP.bozzeSalvate[chiave] = ripiego;
      else delete APP.bozzeSalvate[chiave];
    } else if (Number(pronto.aggiornata || 0) >= Number(APP.bozzeSalvate[chiave]?.aggiornata || 0)) {
      APP.bozzeSalvate[chiave] = pronto;
    }
    return pronto;
  } catch {
    // Se lo spazio locale e pieno, la bozza resta comunque in memoria.
    return false;
  }
}

function scriviRecordBozzaSessione(sessione, {
  testo = sessione?.bozza || "",
  allegatiBundleId = sessione?.allegatiBundleId || null,
} = {}) {
  if (!sessione?.chiaveBozza) return false;
  const record = scriviRecordBozza(
    sessione.chiaveBozza,
    {
      testo: String(testo || ""),
      aggiornata: Date.now(),
      allegatiBundleId: allegatiBundleId || null,
      cancellata: !String(testo || "") && !allegatiBundleId,
      lineageId: sessione.lineageId || globalThis.crypto.randomUUID(),
    },
    sessione.versioneBozza,
  );
  if (!record) return false;
  sessione.versioneBozza = versioneRecordBozza(record);
  sessione.allegatiBundleId = record.allegatiBundleId || null;
  sessione.lineageId = record.lineageId;
  // Da questo momento la revisione e osservabile da altre finestre: la prossima
  // modifica deve creare una lineage distinta, cosi una risoluzione concorrente
  // non puo cancellare il nuovo contenuto.
  sessione.lineageModificataLocalmente = false;
  return record;
}

function eliminaRecordBozza(chiave, atteso = APP.bozzeSalvate[chiave]) {
  if (!chiave) return false;
  try {
    const archivio = chiaveArchivioBozza(chiave);
    const grezzo = localStorage.getItem(archivio);
    const corrente = JSON.parse(grezzo || "null");
    const coincide = !corrente || (
      corrente.testo === atteso?.testo
      && Number(corrente.aggiornata || 0) === Number(atteso?.aggiornata || 0)
      && (!atteso?.versione || corrente.versione === atteso.versione)
    );
    if (!coincide) {
      return false;
    }
    localStorage.removeItem(archivio);
    const ripiego = trovaRecordBozzaPiuRecente(chiave);
    if (ripiego) APP.bozzeSalvate[chiave] = ripiego;
    else delete APP.bozzeSalvate[chiave];
    return true;
  } catch {
    // Preferenza non essenziale.
    return false;
  }
}

function chiaveArchivioInvii(chiaveBozza, id = null) {
  const base = PREFISSO_INVII + encodeURIComponent(chiaveBozza || "");
  return id == null ? base : base + ":" + encodeURIComponent(id);
}

function chiaveInvioRisolto(id) {
  return PREFISSO_INVII_RISOLTI + encodeURIComponent(String(id || ""));
}

function invioGiaRisolto(invio) {
  if (!invio?.id) return false;
  try {
    const record = JSON.parse(localStorage.getItem(chiaveInvioRisolto(invio.id)) || "null");
    return record?.id === invio.id
      && Number(record.creatoIl) === Number(invio.creatoIl)
      && Number.isFinite(Number(record.risoltoIl));
  } catch {
    return false;
  }
}

function segnaInvioRisolto(invio) {
  if (!invio?.id) return false;
  try {
    localStorage.setItem(chiaveInvioRisolto(invio.id), JSON.stringify({
      id: invio.id,
      creatoIl: Number(invio.creatoIl),
      risoltoIl: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

function persistiInvioPendente(sessione, invio) {
  if (!sessione?.chiaveBozza || !invio?.id) return false;
  try {
    if (invioGiaRisolto(invio)) return true;
    const chiave = chiaveArchivioInvii(sessione.chiaveBozza, invio.id);
    const { allegatiDati: _datiVolatili, ...recordPersistibile } = invio;
    const serializzato = JSON.stringify(recordPersistibile);
    localStorage.setItem(chiave, serializzato);
    // Le operazioni localStorage sono serializzate ma non transazionali. Un'altra
    // finestra puo aver risolto l'invio fra il primo controllo e la write: il
    // secondo controllo elimina l'eventuale marker resuscitato.
    if (invioGiaRisolto(invio) && localStorage.getItem(chiave) === serializzato) {
      localStorage.removeItem(chiave);
    }
    return true;
  } catch {
    return false;
  }
}

function caricaInviiPendenti(chiaveBozza) {
  if (!chiaveBozza) return [];
  try {
    const archivioVecchio = chiaveArchivioInvii(chiaveBozza);
    const grezzoVecchio = localStorage.getItem(archivioVecchio);
    const recordVecchio = JSON.parse(grezzoVecchio || "null");
    // Migrazione dal vecchio array condiviso. Da ora ogni richiesta ha una
    // chiave isolata: due finestre non possono sovrascriversi o cancellarsi.
    if (Array.isArray(recordVecchio?.invii)) {
      for (const invio of recordVecchio.invii) {
        if (!invio?.id) continue;
        const archivio = chiaveArchivioInvii(chiaveBozza, invio.id);
        if (!localStorage.getItem(archivio)) localStorage.setItem(archivio, JSON.stringify(invio));
      }
      if (localStorage.getItem(archivioVecchio) === grezzoVecchio) {
        localStorage.removeItem(archivioVecchio);
      }
    }

    const prefisso = archivioVecchio + ":";
    const fotografie = [];
    for (let indice = 0; indice < localStorage.length; indice += 1) {
      const chiave = localStorage.key(indice);
      if (chiave?.startsWith(prefisso)) fotografie.push([chiave, localStorage.getItem(chiave)]);
    }
    const soglia = Date.now() - DURATA_BOZZE_MS;
    const invii = [];
    for (const [chiave, grezzo] of fotografie) {
      try {
        const invio = JSON.parse(grezzo || "null");
        if (
          invio
          && typeof invio.id === "string"
          && typeof invio.testo === "string"
          && Number(invio.creatoIl) >= soglia
          && !invioGiaRisolto(invio)
        ) {
          invii.push(invio);
        } else if (localStorage.getItem(chiave) === grezzo) {
          localStorage.removeItem(chiave);
          if (typeof invio?.id === "string") void eliminaAllegatiInvio(invio.id);
        }
      } catch {
        // Un record corrotto resta isolato dagli altri invii.
      }
    }
    return invii.sort((a, b) => Number(a.creatoIl) - Number(b.creatoIl));
  } catch {
    return [];
  }
}

function persistiInviiPendenti(sessione) {
  if (!sessione?.chiaveBozza) return false;
  sessione.inviiPendenti = sessione.inviiPendenti.filter((invio) => !invioGiaRisolto(invio));
  return sessione.inviiPendenti.every((invio) => persistiInvioPendente(sessione, invio));
}

function registraInvioPendente(sessione, invio) {
  sessione.inviiPendenti = sessione.inviiPendenti.filter((voce) => voce.id !== invio.id);
  sessione.inviiPendenti.push(invio);
  const prima = Boolean(sessione.invioNonPersistito);
  // Scriviamo soltanto il record nuovo: riscrivere l'intera snapshot RAM di una
  // seconda finestra potrebbe far ricomparire un invio gia verificato altrove.
  const persistito = persistiInvioPendente(sessione, invio);
  sessione.invioNonPersistito = prima || !persistito;
  if (sessione.invioNonPersistito && !prima && sessione.id === APP.attivaId) {
    toast(
      "Non riesco a conservare la copia di sicurezza dell'invio: non chiudere la finestra finche pi non lo mostra nella cronologia.",
      "errore",
    );
  }
  if (sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
  return persistito;
}

function aggiornaStatoOperazionePendente(sessione, id, modifiche) {
  const indice = sessione?.inviiPendenti.findIndex((invio) => invio.id === id) ?? -1;
  if (indice < 0) return null;
  const corrente = sessione.inviiPendenti[indice];
  if (!["builtin", "shell"].includes(corrente.origine)) return corrente;
  const aggiornato = {
    ...corrente,
    statoComando: modifiche?.statoComando || corrente.statoComando || "esito_ignoto",
    erroreComando: String(modifiche?.erroreComando || corrente.erroreComando || ""),
    motivoComando: String(modifiche?.motivoComando || corrente.motivoComando || ""),
    statusHttpComando: Number.isInteger(Number(modifiche?.statusHttpComando))
      ? Number(modifiche.statusHttpComando)
      : corrente.statusHttpComando || null,
    codiceErroreComando: String(
      modifiche?.codiceErroreComando || corrente.codiceErroreComando || "",
    ),
    statoAggiornatoIl: Date.now(),
  };
  sessione.inviiPendenti[indice] = aggiornato;
  const persistito = persistiInvioPendente(sessione, aggiornato);
  if (!persistito) sessione.invioNonPersistito = true;
  if (invioGiaRisolto(aggiornato)) {
    sessione.inviiPendenti = sessione.inviiPendenti.filter((invio) => invio.id !== id);
    if (sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
    return null;
  }
  if (!persistito && sessione.id === APP.attivaId) {
    toast(
      "Non riesco ad aggiornare lo stato locale del comando: la copia resta visibile, ma non chiudere questa finestra.",
      "errore",
    );
  }
  if (sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
  return aggiornato;
}

function conservaIdCanonicoOperazione(sessione, operationId, canonicalId) {
  if (!sessione || !operationId || !canonicalId) return false;
  const indice = sessione.inviiPendenti.findIndex((invio) => (
    invio.operationId === operationId || invio.workflowOperationId === operationId
  ));
  if (indice < 0) return false;
  const corrente = sessione.inviiPendenti[indice];
  const campo = corrente.workflowOperationId === operationId
    ? "workflowCanonicalId"
    : "operationCanonicalId";
  if (corrente[campo] === canonicalId) return true;
  const aggiornato = { ...corrente, [campo]: canonicalId, statoAggiornatoIl: Date.now() };
  sessione.inviiPendenti[indice] = aggiornato;
  const persistito = persistiInvioPendente(sessione, aggiornato);
  if (!persistito) sessione.invioNonPersistito = true;
  return persistito;
}

function dimenticaInvioPendente(sessione, id = null) {
  if (!sessione) return;
  const rimossi = id
    ? sessione.inviiPendenti.filter((voce) => voce.id === id)
    : [...sessione.inviiPendenti];
  sessione.inviiPendenti = id
    ? sessione.inviiPendenti.filter((voce) => voce.id !== id)
    : [];
  if (id) sessione.inviiNascosti?.delete(id);
  else sessione.inviiNascosti?.clear();
  try {
    for (const invio of rimossi) {
      const chiave = chiaveArchivioInvii(sessione.chiaveBozza, invio.id);
      let segnato = segnaInvioRisolto(invio);
      localStorage.removeItem(chiave);
      // Se la quota era piena, la cancellazione del marker puo aver liberato lo
      // spazio necessario al tombstone che impedisce la resurrezione cross-window.
      if (!segnato) segnato = segnaInvioRisolto(invio);
      if (!segnato) sessione.invioNonPersistito = true;
      void eliminaAllegatiInvio(invio.id);
    }
  } catch {
    // Il record verra comunque ignorato nella memoria di questa pagina.
  }
  if (!sessione.inviiPendenti.length && rimossi.every(invioGiaRisolto)) {
    sessione.invioNonPersistito = false;
  }
  if (sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
}

function dimenticaCopiaSicurezzaVerificata(sessione, invio) {
  if (invio.lineageId && !segnaLineageRisolta(invio.lineageId)) {
    sessione.invioNonPersistito = true;
    toast(
      "Non riesco a registrare la verifica sul computer: la copia resta intatta. Libera spazio e riprova.",
      "errore",
    );
    return false;
  }
  // Un altro invio identico puo essere ancora in attesa: in quel caso la
  // bozza resta la sua rete di sicurezza.
  if (sessione.inviiPendenti.some((voce) => voce.id !== invio.id && voce.testo === invio.testo)) {
    dimenticaInvioPendente(sessione, invio.id);
    return true;
  }

  clearTimeout(timerSalvaBozza.get(sessione.id));
  timerSalvaBozza.delete(sessione.id);
  if (sessione.id === APP.attivaId && sessione.bozza !== DOM.input.value) {
    sessione.bozza = DOM.input.value;
    sessione.bozzaSporca = true;
  }

  // Il record puo essere la safety-copy di questo invio anche quando, dopo un
  // reload, la bozza RAM viene lasciata intenzionalmente vuota in attesa della
  // verifica manuale. Lo eliminiamo con CAS sul record osservato: una bozza
  // diversa o pi recente salvata da un'altra finestra non viene toccata.
  const recordSicurezza = leggiRecordBozzaProprio(sessione.chiaveBozza);
  if (
    recordSicurezza?.testo === invio.testo
    && (
      !invio.lineageId
      || lineageRecordBozza(recordSicurezza) === invio.lineageId
    )
  ) {
    const bundlePrecedente = sessione.allegatiBundleId;
    if (scriviRecordBozzaSessione(sessione, { testo: "", allegatiBundleId: null })) {
      if (bundlePrecedente && !bundleBozzaReferenziato(bundlePrecedente)) {
        void eliminaAllegatiInvio(bundlePrecedente);
      }
    }
  }

  dimenticaInvioPendente(sessione, invio.id);
  if (sessione.bozza === invio.testo) {
    sessione.bozza = "";
    sessione.bozzaSporca = false;
    sessione.bozzaNonPersistita = false;
    if (sessione.id === APP.attivaId && DOM.input.value === invio.testo) {
      DOM.input.value = "";
      adattaAltezza();
    }
  } else if (sessione.bozzaSporca) {
    // Se nel frattempo l'utente ha scritto altro, salviamo quella versione e
    // il confronto CAS impedisce di cancellare una bozza concorrente pi nuova.
    salvaBozza(sessione);
  }
  if (sessione.id === APP.attivaId) aggiornaInterfacciaAttiva();
  return true;
}

async function ripristinaAllegatiInvii(sessione) {
  let cambiata = false;
  for (const invio of sessione.inviiPendenti) {
    if (!invio.allegati?.length || invio.allegatiDati?.length) continue;
    const allegati = await leggiAllegatiInvio(invio.id);
    if (APP.sessioni.get(sessione.id) !== sessione) return;
    if (allegati.length === invio.allegati.length) {
      invio.allegatiDati = allegati.map((allegato) => ({
        ...allegato,
        url: `data:${allegato.mimeType};base64,${allegato.data}`,
      }));
      cambiata = true;
    } else {
      sessione.invioNonPersistito = true;
    }
  }
  if (cambiata && sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
}

function disegnaInviiDaVerificare(sessione = sessioneAttiva()) {
  DOM.inviiVerifica.replaceChildren();
  // Ogni prompt viene conservato subito come safety-copy, ma non e un errore:
  // durante la normale elaborazione resta invisibile. Diventa un avviso solo
  // dopo un reload oppure se il trasporto lascia davvero l'esito incerto.
  const invii = PALETTE_CORE.inviiVisibiliDaVerificare(
    sessione?.inviiPendenti,
    sessione?.inviiNascosti,
  );
  const erroreAllegati = sessione?.erroreAllegatiBozza;
  DOM.inviiVerifica.hidden = !invii.length && !erroreAllegati;
  if (erroreAllegati) {
    DOM.inviiVerifica.append(
      crea("strong", null, "Immagini della bozza da recuperare"),
      crea("p", "nota", erroreAllegati),
    );
    const azioni = crea("div", "barra-modale");
    const riprova = crea("button", null, "Riprova");
    riprova.type = "button";
    riprova.onclick = () => void ripristinaAllegatiBozza(sessione);
    const scarta = crea("button", null, "Scarta immagini mancanti");
    scarta.type = "button";
    scarta.onclick = async () => {
      const confermato = await conferma(
        "Scartare il riferimento alle immagini?",
        "Il testo resta nella bozza. Fallo solo se le immagini non sono recuperabili: non potranno essere aggiunte automaticamente al messaggio.",
        "Scarta riferimento",
      );
      if (!confermato) return;
      await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
      const lineagePrecedente = sessione.lineageId;
      ramificaLineageBozza(sessione);
      const bundlePrecedente = sessione.allegatiBundleId;
      if (!scriviRecordBozzaSessione(sessione, {
        testo: sessione.bozza,
        allegatiBundleId: null,
      })) {
        toast("Non riesco ad aggiornare questa bozza. Ricarica la finestra e riprova.", "errore");
        return;
      }
      sessione.erroreAllegatiBozza = null;
      sessione.allegatiNonPersistiti = false;
      if (lineagePrecedente && !segnaLineageRisolta(lineagePrecedente)) {
        sessione.bozzaNonPersistita = true;
        toast(
          "Il testo e salvo, ma non riesco a registrare lo scarto nelle altre finestre. Libera spazio prima di chiudere.",
          "errore",
        );
      }
      if (bundlePrecedente && !bundleBozzaReferenziato(bundlePrecedente)) {
        await eliminaAllegatiInvio(bundlePrecedente);
      }
      aggiornaInterfacciaAttiva();
    };
    azioni.append(riprova, scarta);
    DOM.inviiVerifica.appendChild(azioni);
  }
  if (!invii.length) return;
  DOM.inviiVerifica.appendChild(
    crea("strong", null, invii.length === 1
      ? "1 invio da verificare nella cronologia"
      : `${invii.length} invii da verificare nella cronologia`),
  );
  if (invii.some((invio) => ["skill", "prompt"].includes(invio.origine))) {
    DOM.inviiVerifica.appendChild(
      crea(
        "p",
        "nota",
        "Le skill e i modelli di richiesta vengono salvati da Pi con testo diverso dall'originale: non li considero verificati automaticamente. Controlla il risultato e usa “Gia verificato”; non reinviarli alla cieca.",
      ),
    );
  }
  if (invii.some((invio) => invio.origine === "builtin")) {
    DOM.inviiVerifica.appendChild(
      crea(
        "p",
        "nota",
        "I comandi built-in non diventano messaggi nella cronologia. La copia resta bloccata finche l'ack correlato di Pi non ne prova l'esito: non reinviarla; usa Ripristina solo dopo una verifica esplicita.",
      ),
    );
  }
  if (invii.some((invio) => invio.origine === "shell")) {
    DOM.inviiVerifica.appendChild(
      crea(
        "p",
        "nota",
        "I comandi ! e !! possono modificare il computer senza creare un messaggio. Restano bloccati fino all'ack correlato: non ripeterli alla cieca, soprattutto dopo un aggiornamento della pagina.",
      ),
    );
  }
  for (const invio of invii) {
    const riga = crea("div", "invio-verifica");
    const allegati = Number(invio.allegati?.length || 0);
    const manuale = PALETTE_CORE.invioRichiedeVerificaManuale(invio);
    const operazioneDiretta = ["builtin", "shell"].includes(invio.origine);
    const statoBuiltin = operazioneDiretta
      ? invio.motivoComando === "catalogo_obsoleto"
        ? "Catalogo aggiornato; ripristina e riprova manualmente una sola volta"
        : invio.statoComando === "confermato"
          ? "Pi ha confermato; pulizia locale non riuscita, non reinviare"
        : invio.statoComando === "errore"
        ? "Errore confermato; verifica prima di riprovare"
        : invio.statoComando === "esito_ignoto"
          ? "Esito non verificabile; non reinviare"
          : "Conferma di Pi non ancora ricevuta; non reinviare"
      : "";
    const testo = crea(
      "span",
      null,
      (statoBuiltin ? statoBuiltin + " · " : manuale ? "Da verificare manualmente · " : "")
        + invio.testo
        + (allegati ? ` · ${allegati} immagin${allegati === 1 ? "e" : "i"}` : ""),
    );
    testo.title = invio.erroreComando
      ? `${invio.testo}\n${invio.erroreComando}`
      : invio.testo;
    const copia = crea("button", null, "Copia");
    copia.type = "button";
    copia.onclick = () => copiaTesto(invio.testo);
    const ripristina = crea("button", null, "Ripristina");
    ripristina.type = "button";
    ripristina.title = "Rimette la copia nella casella senza inviarla";
    ripristina.onclick = () => {
      ramificaLineageBozza(sessione);
      sessione.bozza = invio.testo;
      sessione.bozzaSporca = true;
      if (invio.allegatiDati?.length) {
        sessione.allegati = invio.allegatiDati.map((allegato) => ({ ...allegato }));
        void conservaAllegatiBozza(sessione);
      }
      salvaBozza(sessione);
      if (sessione.id === APP.attivaId) {
        DOM.input.value = sessione.bozza;
        disegnaAllegati();
        adattaAltezza();
        aggiornaInterfacciaAttiva();
      }
      toast("La copia e di nuovo nella casella. Verifica la cronologia prima di inviare.", "avviso");
    };
    riga.append(testo, copia, ripristina);
    const risolto = crea("button", null, "Gia verificato");
    risolto.type = "button";
    risolto.onclick = async () => {
      const confermato = await conferma(
        "Segnare l'invio come verificato?",
        "Fallo solo dopo aver controllato la cronologia: la copia di sicurezza non verra proposta di nuovo.",
        "Segna verificato",
      );
      if (confermato) dimenticaCopiaSicurezzaVerificata(sessione, invio);
    };
    riga.appendChild(risolto);
    DOM.inviiVerifica.appendChild(riga);
  }
}

function bozzaSalvataDaChiave(chiave) {
  const record = APP.bozzeSalvate[chiave];
  return !lineageRisolta(record) && typeof record?.testo === "string" ? record.testo : "";
}

function preparaBozza(meta) {
  const chiave = chiaveBozzaPer(meta);
  const alternative = [chiave, String(meta?.id || ""), "runtime:" + String(meta?.id || "")];
  const recordProprioDestinazione = leggiRecordBozzaProprio(chiave);
  if (recordProprioDestinazione) {
    const risolto = recordProprioDestinazione.cancellata
      || lineageRisolta(recordProprioDestinazione);
    return {
      chiave,
      testo: risolto
        ? ""
        : String(recordProprioDestinazione.testo || ""),
      record: risolto
        ? { ...recordProprioDestinazione, testo: "", allegatiBundleId: null, cancellata: true }
        : recordProprioDestinazione,
      nonPersistita: false,
    };
  }

  // Se questa stessa pagina aveva una bozza sotto l'identita runtime, essa ha
  // precedenza sul record globale di un'altra finestra. È il caso del primo
  // messaggio, quando PI materializza il JSONL solo dopo che la bozza esiste.
  const proprie = alternative
    .filter(Boolean)
    .map((candidata) => ({ chiave: candidata, record: leggiRecordBozzaProprio(candidata) }))
    .filter(({ record }) => (
      record
      && !record.cancellata
      && !lineageRisolta(record)
      && (record.testo || record.allegatiBundleId)
    ))
    .sort((a, b) => Number(b.record.aggiornata || 0) - Number(a.record.aggiornata || 0));
  const propria = proprie[0] || null;
  if (propria && propria.chiave !== chiave) {
    const scritto = scriviRecordBozza(chiave, {
      ...propria.record,
      aggiornata: Date.now(),
      versione: undefined,
      documentoId: undefined,
    }, null);
    if (scritto) {
      eliminaRecordBozza(propria.chiave, propria.record);
      return { chiave, testo: String(scritto.testo || ""), record: scritto, nonPersistita: false };
    }
    const memoria = { ...propria.record, chiaveBozza: chiave };
    APP.bozzeSalvate[chiave] = memoria;
    return { chiave, testo: String(memoria.testo || ""), record: memoria, nonPersistita: true };
  }

  const recordCached = APP.bozzeSalvate[chiave] || null;
  const record = lineageRisolta(recordCached) ? null : recordCached;
  return { chiave, testo: String(record?.testo || ""), record, nonPersistita: false };
}

function salvaBozza(sessione) {
  if (!sessione?.id || !sessione.chiaveBozza) return;
  const testo = String(sessione.bozza || "");
  const prima = Boolean(sessione.bozzaNonPersistita);
  sessione.bozzaNonPersistita = !scriviRecordBozzaSessione(sessione, { testo });
  sessione.bozzaSporca = sessione.bozzaNonPersistita;
  if (sessione.bozzaNonPersistita && !prima && sessione.id === APP.attivaId) {
    toast("Non riesco a salvare la bozza sul computer: non chiudere la finestra finche non l'hai copiata o inviata.", "errore");
  }
}

function programmaSalvaBozza(sessione) {
  clearTimeout(timerSalvaBozza.get(sessione.id));
  timerSalvaBozza.set(sessione.id, setTimeout(() => {
    timerSalvaBozza.delete(sessione.id);
    salvaBozza(sessione);
  }, 180));
}

async function dimenticaBozza(sessione) {
  const id = sessione?.id;
  clearTimeout(timerSalvaBozza.get(id));
  timerSalvaBozza.delete(id);
  if (!id) return;
  await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
  if (sessione.inviiPendenti.length) {
    // Un follow-up puo essere stato soltanto accodato in RAM da PI. Chiudere la
    // scheda non deve eliminare testo/immagini ancora da riconciliare: la chiave
    // stabile del JSONL li rendera visibili alla prossima apertura.
    if (sessione.bozzaSporca) salvaBozza(sessione);
    return;
  }
  const bundlePrecedente = sessione.allegatiBundleId;
  const lineagePrecedente = sessione.lineageId;
  if (lineagePrecedente && !segnaLineageRisolta(lineagePrecedente)) {
    // La sessione server e gia chiusa, ma la bozza resta recuperabile invece
    // di rischiare che una sua copia ricompaia senza relazione fra finestre.
    return;
  }
  const eliminato = scriviRecordBozzaSessione(sessione, {
    testo: "",
    allegatiBundleId: null,
  });
  if (eliminato && bundlePrecedente && !bundleBozzaReferenziato(bundlePrecedente)) {
    await dimenticaAllegatiBozza(sessione, bundlePrecedente);
  }
  eliminaRecordBozza(id);
  eliminaRecordBozza("runtime:" + id);
  try {
    localStorage.removeItem(chiaveArchivioInvii(sessione.chiaveBozza));
    localStorage.removeItem(chiaveArchivioInvii("runtime:" + id));
    for (const invio of sessione.inviiPendenti) {
      localStorage.removeItem(chiaveArchivioInvii(sessione.chiaveBozza, invio.id));
      localStorage.removeItem(chiaveArchivioInvii("runtime:" + id, invio.id));
    }
  } catch {
    // Preferenza non essenziale.
  }
  sessione.inviiPendenti = [];
  sessione.invioNonPersistito = false;
}

function aggiornaIdentitaBozza(sessione, fileSessione) {
  const nuovoFile = fileSessione || null;
  const nuovaChiave = chiaveBozzaPer({ id: sessione.id, fileSessione: nuovoFile });
  if (sessione.chiaveBozza === nuovaChiave) {
    sessione.fileSessione = nuovoFile;
    return;
  }
  if (sessione.bozzaSporca) salvaBozza(sessione);
  const vecchiaChiave = sessione.chiaveBozza;
  const recordProprioVecchioLetto = leggiRecordBozzaProprio(vecchiaChiave);
  const recordProprioVecchio = recordProprioVecchioLetto
    && !recordProprioVecchioLetto.cancellata
    && !lineageRisolta(recordProprioVecchioLetto)
    ? recordProprioVecchioLetto
    : null;
  const testoRuntime = typeof recordProprioVecchio?.testo === "string"
    ? recordProprioVecchio.testo
    : sessione.bozza;
  const bundleRuntime = recordProprioVecchio?.allegatiBundleId
    || sessione.allegatiBundleId
    || null;
  const lineageRuntime = lineageRecordBozza(recordProprioVecchio)
    || sessione.lineageId
    || globalThis.crypto.randomUUID();
  const inviiPrecedenti = sessione.inviiPendenti;
  const migrazioneRuntime = vecchiaChiave?.startsWith("runtime:") && Boolean(nuovoFile);
  const haBozzaRuntimePropria = Boolean(
    migrazioneRuntime
    && (
      (recordProprioVecchio && (recordProprioVecchio.testo || recordProprioVecchio.allegatiBundleId))
      || sessione.bozzaSporca
      || sessione.allegati.length
    ),
  );
  sessione.fileSessione = nuovoFile;
  sessione.chiaveBozza = nuovaChiave;
  const recordProprioNuovoLetto = leggiRecordBozzaProprio(nuovaChiave);
  const recordProprioNuovo = recordProprioNuovoLetto
    && !recordProprioNuovoLetto.cancellata
    && !lineageRisolta(recordProprioNuovoLetto)
    ? recordProprioNuovoLetto
    : null;
  const recordGlobaleNuovo = APP.bozzeSalvate[nuovaChiave] || null;
  const recordNuovo = recordProprioNuovo
    || (recordGlobaleNuovo && !lineageRisolta(recordGlobaleNuovo) ? recordGlobaleNuovo : null);
  // Conserviamo la versione raw del record proprio anche quando e risolto: la
  // prossima bozza nuova potra sostituire il tombstone con un CAS corretto.
  sessione.versioneBozza = versioneRecordBozza(recordProprioNuovoLetto);
  sessione.allegatiBundleId = recordNuovo?.allegatiBundleId || null;
  sessione.lineageId = recordNuovo?.cancellata
    ? null
    : lineageRecordBozza(recordNuovo) || globalThis.crypto.randomUUID();
  sessione.lineageModificataLocalmente = false;
  sessione.inviiPendenti = caricaInviiPendenti(nuovaChiave);
  sessione.invioNonPersistito = false;
  if (migrazioneRuntime) {
    if (haBozzaRuntimePropria) {
      sessione.bozza = testoRuntime || "";
      sessione.allegatiBundleId = bundleRuntime;
      const scritto = scriviRecordBozza(nuovaChiave, {
        testo: sessione.bozza,
        allegatiBundleId: bundleRuntime,
        lineageId: lineageRuntime,
        aggiornata: Date.now(),
        cancellata: false,
      }, sessione.versioneBozza);
      if (scritto) {
        sessione.versioneBozza = versioneRecordBozza(scritto);
        sessione.allegatiBundleId = scritto.allegatiBundleId || null;
        sessione.lineageId = scritto.lineageId;
        if (recordProprioVecchio) eliminaRecordBozza(vecchiaChiave, recordProprioVecchio);
      } else sessione.bozzaNonPersistita = true;
    } else if (!recordNuovo?.cancellata && recordNuovo?.testo) {
      sessione.bozza = recordNuovo.testo;
    }

    const uniti = new Map(sessione.inviiPendenti.map((invio) => [invio.id, invio]));
    for (const invio of inviiPrecedenti) uniti.set(invio.id, invio);
    sessione.inviiPendenti = [...uniti.values()]
      .sort((a, b) => Number(a.creatoIl) - Number(b.creatoIl));
    if (inviiPrecedenti.length) {
      sessione.invioNonPersistito = !persistiInviiPendenti(sessione);
      if (!sessione.invioNonPersistito) {
        try {
          localStorage.removeItem(chiaveArchivioInvii(vecchiaChiave));
          for (const invio of inviiPrecedenti) {
            localStorage.removeItem(chiaveArchivioInvii(vecchiaChiave, invio.id));
          }
        } catch {
          // Le copie duplicate scadranno comunque dopo trenta giorni.
        }
      }
    }
    if (sessione.inviiPendenti.some((invio) => (
      PALETTE_CORE.invioRichiedeVerificaManuale(invio)
      && invio.testo.trim() === sessione.bozza.trim()
    ))) {
      // La copia raw e gia stata migrata nella nuova chiave; nell'editor non
      // rimettiamo automaticamente un comando che potrebbe essere stato eseguito.
      sessione.bozza = "";
    }
  } else {
    const testoCandidato = (!recordNuovo?.cancellata ? recordNuovo?.testo : "")
      || sessione.inviiPendenti.at(-1)?.testo
      || "";
    sessione.bozza = sessione.inviiPendenti.some((invio) => (
      PALETTE_CORE.invioRichiedeVerificaManuale(invio)
      && invio.testo.trim() === String(testoCandidato).trim()
    )) ? "" : testoCandidato;
  }
  if (haBozzaRuntimePropria && sessione.allegati.length) {
    void conservaAllegatiBozza(sessione);
  } else {
    sessione.allegati = [];
    void ripristinaAllegatiBozza(sessione);
  }
  if (sessione.id === APP.attivaId) {
    DOM.input.value = sessione.bozza;
    disegnaAllegati();
    adattaAltezza();
  }
}

function accorcia(percorso, quanti = 34) {
  if (!percorso) return "nessuna";
  const parti = percorso.split(/[\\/]/).filter(Boolean);
  const nome = parti.at(-1) || percorso;
  return nome.length > quanti ? nome.slice(0, quanti - 1) + "…" : nome;
}

function numero(valore) {
  return Number.isFinite(Number(valore)) ? Number(valore).toLocaleString("it-IT") : "—";
}

function percorsoCompatto(percorso) {
  const valore = String(percorso || "").trim();
  if (!valore) return "—";
  const homeWindows = valore.match(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i)?.[0];
  if (homeWindows) return "~" + valore.slice(homeWindows.length);
  const homePosix = valore.match(/^\/home\/[^/]+(?=\/|$)/)?.[0];
  if (homePosix) return "~" + valore.slice(homePosix.length);
  return valore;
}

function percentualeContesto(usati, finestra) {
  const tokenUsati = usati == null ? NaN : Number(usati);
  const tokenFinestra = finestra == null ? NaN : Number(finestra);
  if (!Number.isFinite(tokenUsati) || !Number.isFinite(tokenFinestra) || tokenFinestra <= 0) return null;
  return Math.max(0, Math.min(100, tokenUsati / tokenFinestra * 100));
}

function finestraModelloSessione(sessione) {
  const valoreStato = sessione?.statoRpc?.model?.contextWindow;
  const dalloStato = valoreStato == null ? NaN : Number(valoreStato);
  if (Number.isFinite(dalloStato) && dalloStato > 0) return dalloStato;
  const modello = sessione?.modelli?.find((voce) =>
    voce?.provider === sessione.provider && voce?.id === sessione.modello);
  const dalCatalogo = modello?.contextWindow == null ? NaN : Number(modello.contextWindow);
  return Number.isFinite(dalCatalogo) && dalCatalogo > 0 ? dalCatalogo : null;
}

function pressioneContestoCambioModello(sessione, modello) {
  const finestra = Number(modello?.contextWindow);
  const usatiLive = Number(sessione?.ultimoUso?.totalTokens);
  const usatiStatistici = Number(sessione?.statisticheSessione?.contextUsage?.tokens);
  const usati = Number.isFinite(usatiLive) && usatiLive > 0
    ? usatiLive
    : usatiStatistici;
  if (!Number.isFinite(finestra) || finestra <= 0 || !Number.isFinite(usati) || usati <= finestra) {
    return null;
  }
  return {
    usati,
    finestra,
    testo: `Il contesto corrente (${numero(usati)} token) supera quello del modello (${numero(finestra)}): al prossimo invio Pi lo riassumera prima di rispondere.`,
  };
}

function testoContestoSessione(sessione) {
  if (sessione?.compattazioneInCorso) return "Contesto · riassunto in corso…";
  if (sessione?.contestoDaRicalcolare) return "Contesto · ricalcolo dopo il riassunto…";
  const contesto = sessione?.statisticheSessione?.contextUsage || null;
  const finestraStatistica = contesto?.contextWindow == null ? NaN : Number(contesto.contextWindow);
  const finestra = Number.isFinite(finestraStatistica) && finestraStatistica > 0
    ? finestraStatistica
    : finestraModelloSessione(sessione);
  // Durante lo streaming Pi espone gia la fotografia di contesto corrente.
  // Alla fine del turno get_session_stats torna a essere la fonte autorevole.
  const usatiLive = sessione?.ultimoUso?.totalTokens == null
    ? NaN
    : Number(sessione.ultimoUso.totalTokens);
  const usatiStatistici = contesto?.tokens == null ? NaN : Number(contesto.tokens);
  const usati = Number.isFinite(usatiLive) ? usatiLive : usatiStatistici;
  const automatico = sessione?.statoRpc?.autoCompactionEnabled === true ? " (auto)" : "";
  if (!Number.isFinite(usati) || !Number.isFinite(finestra) || finestra <= 0) {
    return Number.isFinite(finestra)
      ? `Contesto — / ${numero(finestra)}${automatico}`
      : "Contesto —";
  }
  const percentuale = percentualeContesto(usati, finestra);
  const rimasti = Math.max(0, finestra - usati);
  const percentualeTesto = percentuale.toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `Contesto ${percentualeTesto}% · ${numero(usati)} / ${numero(finestra)} · ${numero(rimasti)} rimasti${automatico}`;
}

function testoUsoSessione(sessione) {
  const statistiche = sessione?.statisticheSessione || null;
  const usoLive = sessione?.ultimoUso || null;
  const valoreCumulativo = (chiave) => {
    const base = statistiche?.tokens?.[chiave] == null ? NaN : Number(statistiche.tokens[chiave]);
    const live = usoLive?.[chiave] == null ? NaN : Number(usoLive[chiave]);
    if (Number.isFinite(base) && Number.isFinite(live)) return base + live;
    return Number.isFinite(base) ? base : Number.isFinite(live) ? live : null;
  };
  const input = valoreCumulativo("input");
  const output = valoreCumulativo("output");
  const cacheRead = valoreCumulativo("cacheRead");
  const cacheWrite = valoreCumulativo("cacheWrite");
  const costoStatistico = statistiche?.cost == null ? NaN : Number(statistiche.cost);
  const ultimoCosto = usoLive?.cost?.total == null
    ? NaN
    : Number(usoLive.cost.total);
  const costo = Number.isFinite(costoStatistico) && Number.isFinite(ultimoCosto)
    ? costoStatistico + ultimoCosto
    : Number.isFinite(costoStatistico) ? costoStatistico : Number.isFinite(ultimoCosto) ? ultimoCosto : null;
  const parti = [];
  if (Number.isFinite(input) && input > 0) parti.push(`↑${numero(input)}`);
  if (Number.isFinite(output) && output > 0) parti.push(`↓${numero(output)}`);
  if (Number.isFinite(cacheRead) && cacheRead > 0) parti.push(`R${numero(cacheRead)}`);
  if (Number.isFinite(cacheWrite) && cacheWrite > 0) parti.push(`W${numero(cacheWrite)}`);
  if (
    (Number(cacheRead) > 0 || Number(cacheWrite) > 0)
    && Number.isFinite(sessione?.ultimoCacheHitPercento)
  ) {
    parti.push(`CH${sessione.ultimoCacheHitPercento.toLocaleString("it-IT", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`);
  }
  if (Number.isFinite(costo) && costo > 0) {
    parti.push(`${costo.toLocaleString("it-IT", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} $`);
  }
  return parti.join(" · ") || "statistiche in attesa";
}

function disegnaBarraStatoSessione(sessione) {
  if (!sessione) {
    DOM.statoCwd.textContent = "—";
    DOM.statoCwd.title = "";
    DOM.statoUso.textContent = "statistiche in attesa";
    DOM.contestoInfo.textContent = "Contesto —";
    DOM.statoModelloTui.textContent = "modello —";
    DOM.statoSessioneTui.setAttribute("aria-label", "Nessuna sessione pi attiva");
    return;
  }
  const cwd = sessione.senzaCartella
    ? "Senza cartella"
    : sessione.statoRpc?.cwd || sessione.cartella || "";
  const provider = sessione.provider || sessione.statoRpc?.model?.provider || "—";
  const modello = sessione.modello || sessione.statoRpc?.model?.id || "—";
  const ragionamento = sessione.ragionamento || sessione.statoRpc?.thinkingLevel || "—";
  DOM.statoCwd.textContent = percorsoCompatto(cwd);
  DOM.statoCwd.title = cwd;
  DOM.statoUso.textContent = testoUsoSessione(sessione);
  DOM.contestoInfo.textContent = testoContestoSessione(sessione);
  DOM.statoModelloTui.textContent = `(${provider}) ${modello} • ${ragionamento}`;
  DOM.statoSessioneTui.setAttribute(
    "aria-label",
    [cwd || "Percorso non disponibile", DOM.contestoInfo.textContent,
      DOM.statoModelloTui.textContent, DOM.statoUso.textContent].join(". "),
  );
}

function dataBreve(valore) {
  if (!valore) return "data sconosciuta";
  const data = new Date(valore);
  if (Number.isNaN(data.getTime())) return "data sconosciuta";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
}

function traduciLivello(livello) {
  const livelli = {
    off: "spento",
    minimal: "minimo",
    low: "basso",
    medium: "medio",
    high: "alto",
    xhigh: "molto alto",
    max: "massimo",
  };
  return livelli[livello] || livello || "—";
}

function toast(messaggio, tipo = "") {
  const elemento = crea("div", "toast" + (tipo ? " " + tipo : ""), messaggio);
  DOM.toastArea.appendChild(elemento);
  setTimeout(() => elemento.remove(), 6000);
}

function avvisa(messaggio) {
  DOM.avvisi.textContent = messaggio || "";
}

async function copiaTesto(testo) {
  try {
    await navigator.clipboard.writeText(testo);
    toast("Copiato negli appunti.");
  } catch {
    const area = crea("textarea");
    area.value = testo;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast("Copiato negli appunti.");
  }
}

function adattaAltezza() {
  DOM.input.style.height = "auto";
  DOM.input.style.height = Math.min(DOM.input.scrollHeight, 190) + "px";
}

function inFondo(sessione, { forza = false } = {}) {
  if (sessione.id !== APP.attivaId) return;
  if (forza) sessione.seguiFondo = true;
  if (sessione.seguiFondo === false) return;
  requestAnimationFrame(() => {
    DOM.conversazione.scrollTop = DOM.conversazione.scrollHeight;
  });
}

// ---------------------------------------------------------------------------
// Chiamate HTTP e correlazione RPC
// ---------------------------------------------------------------------------

async function chiedi(via, { corpo, signal } = {}) {
  const opzioni = {
    signal,
    headers: {
      "x-pi-gui-client": APP.clientId,
      "x-pi-gui-replay": APP.replayId,
    },
  };
  if (corpo !== undefined) {
    opzioni.method = "POST";
    opzioni.headers = {
      "content-type": "application/json",
      "x-pi-gui-token": APP.tokenApi || "",
      "x-pi-gui-client": APP.clientId,
      "x-pi-gui-replay": APP.replayId,
    };
    opzioni.body = JSON.stringify(corpo);
  }

  let risposta;
  try {
    risposta = await fetch(via, opzioni);
  } catch (errore) {
    ponteNonRaggiungibile();
    if (corpo) {
      throw erroreConEsitoIgnoto(
        "Il collegamento si e interrotto: non posso verificare se pi abbia gia ricevuto la richiesta.",
      );
    }
    throw new Error("Il ponte locale non risponde.");
  }

  let dati;
  try {
    dati = await risposta.json();
  } catch {
    if (corpo) {
      ponteNonRaggiungibile();
      throw erroreConEsitoIgnoto(
        "Il ponte ha interrotto la conferma: non posso verificare se pi abbia gia ricevuto la richiesta.",
      );
    }
    throw new Error("Il ponte ha restituito una risposta non leggibile.");
  }
  if (!risposta.ok || dati.errore) {
    const errore = new Error(dati.errore || `Errore HTTP ${risposta.status}`);
    errore.statusHttp = risposta.status;
    const codice = typeof dati.code === "string"
      ? dati.code
      : typeof dati.codice === "string"
        ? dati.codice
        : null;
    if (codice) {
      errore.code = codice;
      errore.codice = codice;
    }
    if (dati.operation && typeof dati.operation === "object") {
      errore.operation = dati.operation;
    }
    if (typeof dati.blocker === "string") errore.blocker = dati.blocker;
    if (typeof dati.retryable === "boolean") errore.retryable = dati.retryable;
    if (Number.isFinite(Number(dati.retryAfterMs))) {
      errore.retryAfterMs = Math.max(0, Number(dati.retryAfterMs));
    }
    throw errore;
  }
  return dati;
}

function erroreDaRisultatoOperazione(risultato, ripiego = "Operazione rifiutata dal ponte") {
  const errore = new Error(String(risultato?.error || ripiego));
  if (risultato?.ambiguous) errore.esitoIgnoto = true;
  return errore;
}

function datiDaOperazioneCompletata(operation) {
  const risultato = operation?.result;
  if (!risultato || typeof risultato !== "object") {
    throw erroreConEsitoIgnoto("Il ponte dichiara conclusa l'operazione senza un esito verificabile.");
  }
  if (risultato.success !== true) throw erroreDaRisultatoOperazione(risultato);
  return risultato.data && typeof risultato.data === "object" ? risultato.data : {};
}

function attendiBrevemente(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

async function attendiOperazioneServer(
  sessionId,
  operationId,
  { timeout = 5 * 60 * 1000, intervallo = 350 } = {},
) {
  const scadenza = Date.now() + timeout;
  let pausa = Math.max(200, intervallo);
  while (Date.now() < scadenza) {
    const dati = await chiedi("/api/stato-operazione", {
      corpo: { sessionId, operationId },
    });
    const operation = dati.operation;
    if (!operation || typeof operation !== "object") {
      throw erroreConEsitoIgnoto("Il ponte non ha restituito lo stato verificabile dell'operazione.");
    }
    if (operation.status === "completed") return operation;
    if (operation.status === "routed") return operation;
    await attendiBrevemente(pausa);
    pausa = Math.min(1200, Math.round(pausa * 1.35));
  }
  throw erroreConEsitoIgnoto("L'operazione risulta ancora in corso: non verra ripetuta automaticamente.");
}

async function completaRispostaOperazione(
  dati,
  { sessionId, operationId, timeout = 5 * 60 * 1000 } = {},
) {
  let operation = dati?.operation;
  if (!operation || typeof operation !== "object") return dati;
  if (operation.status === "pending") {
    operation = await attendiOperazioneServer(sessionId, operationId, { timeout });
  }
  if (operation.status === "completed") {
    return { ...dati, ...datiDaOperazioneCompletata(operation), operation };
  }
  return { ...dati, operation };
}

async function chiediOperazioneIdempotente(
  via,
  corpo,
  { sessionId, operationId, timeout = 5 * 60 * 1000 } = {},
) {
  try {
    const iniziale = await chiedi(via, { corpo });
    return await completaRispostaOperazione(iniziale, { sessionId, operationId, timeout });
  } catch (errore) {
    if (errore.operation?.status === "completed") {
      return datiDaOperazioneCompletata(errore.operation);
    }
    if (!errore.esitoIgnoto || !sessionId || !operationId) throw errore;
    // Polling read-only: recupera l'esito dell'intento gia registrato senza
    // ripetere il POST che potrebbe avere perso soltanto la risposta.
    const operation = await attendiOperazioneServer(sessionId, operationId, { timeout });
    return { ...datiDaOperazioneCompletata(operation), operation };
  }
}

async function caricaCronologiaSessione(
  sessione,
  { timeout = 60000, consentiParziale = false } = {},
) {
  if (!sessione?.attiva) return [];
  sessione.richiestaCronologia = Number(sessione.richiestaCronologia || 0) + 1;
  const richiestaCorrente = sessione.richiestaCronologia;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let risposta;
  try {
    risposta = await fetch("/api/cronologia", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-pi-gui-token": APP.tokenApi || "",
        "x-pi-gui-client": APP.clientId,
        "x-pi-gui-replay": APP.replayId,
      },
      body: JSON.stringify({
        sessionId: sessione.id,
        ...(consentiParziale ? { consentiParziale: true } : {}),
      }),
    });
    if (!risposta.ok) {
      let errore = `Errore HTTP ${risposta.status}`;
      try {
        errore = (await risposta.json()).errore || errore;
      } catch {
        // Il messaggio HTTP e gia sufficiente.
      }
      const eccezione = new Error(errore);
      eccezione.statusHttp = risposta.status;
      throw eccezione;
    }
    if (!risposta.body) throw new Error("Il ponte non ha aperto il flusso della cronologia");

    const lettore = risposta.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const messaggi = [];
    let buffer = "";
    let completata = false;
    let obsoleta = false;
    let parziale = false;
    const consuma = (finale = false) => {
      let fine;
      while ((fine = buffer.indexOf("\n")) >= 0) {
        const riga = buffer.slice(0, fine);
        buffer = buffer.slice(fine + 1);
        if (!riga) continue;
        const record = JSON.parse(riga);
        if (record.tipo === "inizio") parziale = record.parziale === true;
        else if (record.tipo === "messaggio") messaggi.push(record.messaggio);
        else if (record.tipo === "fine") {
          completata = Number(record.conteggio) === messaggi.length;
          parziale = parziale || record.parziale === true;
        }
        else if (record.tipo === "obsoleta") obsoleta = true;
      }
      if (buffer.length > LIMITE_RECORD_CRONOLOGIA) {
        throw new Error("Un singolo messaggio della cronologia supera il limite di visualizzazione");
      }
      if (finale && buffer.trim()) {
        const record = JSON.parse(buffer);
        buffer = "";
        if (record.tipo === "fine") {
          completata = Number(record.conteggio) === messaggi.length;
          parziale = parziale || record.parziale === true;
        }
        else if (record.tipo === "obsoleta") obsoleta = true;
        else if (record.tipo === "messaggio") messaggi.push(record.messaggio);
      }
    };
    while (true) {
      const { value, done } = await lettore.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consuma(false);
    }
    buffer += decoder.decode();
    consuma(true);
    if (obsoleta) throw new Error("La conversazione e cambiata durante la sincronizzazione");
    if (!completata) throw new Error("La cronologia ricevuta e incompleta");
    if (
      APP.sessioni.get(sessione.id) === sessione
      && sessione.richiestaCronologia === richiestaCorrente
    ) {
      renderCronologia(sessione, messaggi);
      sessione.erroreCronologia = null;
      // Durante lo streaming mostriamo un prefisso stabile del JSONL ma non
      // mescoliamo i delta successivi con quella fotografia: agent_settled
      // rileggera la cronologia completa e autorevole senza duplicazioni.
      sessione.messaggiSincronizzati = !parziale;
      sessione.cronologiaParziale = parziale;
      if (parziale) mostraCronologiaParziale(sessione);
    }
    return messaggi;
  } catch (errore) {
    if (errore?.name === "AbortError") throw new Error("La cronologia ha impiegato troppo tempo");
    throw errore;
  } finally {
    clearTimeout(timer);
  }
}

function mostraCronologiaParziale(sessione) {
  if (!sessione?.vista) return;
  let box = sessione.vista.querySelector("[data-cronologia-in-attesa]");
  if (!box) {
    box = crea("section", "cronologia-in-attesa");
    box.dataset.cronologiaInAttesa = "true";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    sessione.vista.prepend(box);
  }
  box.replaceChildren(
    crea("strong", null, "Cronologia salvata visibile"),
    crea(
      "p",
      null,
      "Questa vista mostra il prefisso gia scritto nel file di sessione. La risposta in corso verra ricostruita integralmente appena Pi termina.",
    ),
    crea("p", "nota", "Non reinviare il messaggio e non aprire una seconda copia della conversazione."),
  );
}

function rimuoviErroreCronologia(sessione) {
  sessione.erroreCronologia = null;
  sessione.vista?.querySelector("[data-errore-cronologia]")?.remove();
}

function mostraCronologiaInAttesa(sessione) {
  if (
    !sessione?.vista
    || sessione.messaggiSincronizzati
    || sessione.haMessaggi
  ) return;
  let box = sessione.vista.querySelector("[data-cronologia-in-attesa]");
  if (!box) {
    sessione.vista.querySelector("[data-benvenuto]")?.remove();
    box = crea("section", "cronologia-in-attesa");
    box.dataset.cronologiaInAttesa = "true";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.append(
      crea("strong", null, "Pi sta lavorando: la conversazione non e vuota"),
      crea(
        "p",
        null,
        "I dati gia salvati restano nel file di sessione. Per evitare di mostrare una cronologia parziale, la GUI la ricostruira automaticamente appena termina la risposta in corso.",
      ),
      crea("p", "nota", "Non reinviare il messaggio e non aprire una seconda copia della stessa conversazione."),
    );
    sessione.vista.prepend(box);
  }
}

function mostraErroreCronologia(sessione, errore) {
  if (!sessione?.vista) return;
  sessione.vista.querySelector("[data-cronologia-in-attesa]")?.remove();
  const messaggio = testoErrore(errore);
  const precedente = sessione.erroreCronologia;
  sessione.erroreCronologia = messaggio;
  let box = sessione.vista.querySelector("[data-errore-cronologia]");
  if (!box) {
    box = crea("section", "errore-cronologia");
    box.dataset.erroreCronologia = "true";
    box.setAttribute("role", "alert");
    sessione.vista.prepend(box);
  }
  box.replaceChildren();
  box.appendChild(crea("strong", null, "Cronologia non verificabile"));
  box.appendChild(crea("p", null, messaggio));
  box.appendChild(
    crea(
      "p",
      "nota",
      errore?.statusHttp === 413
        ? "La vista precedente resta intatta e l'invio e bloccato. Per file cosi grandi usa Pi completo nel terminale: Libera spazio riduce il contesto del modello, non il file append-only."
        : "La vista precedente resta intatta e l'invio e bloccato per evitare di lavorare su una conversazione nascosta. Riprova oppure usa Libera spazio / Pi completo nel terminale.",
    ),
  );
  const azioni = crea("div", "barra-modale");
  const riprova = crea("button", "bottone", "Riprova");
  riprova.type = "button";
  riprova.onclick = () => sincronizzaSessione(sessione, { silenzioso: false });
  const terminale = crea("button", "bottone", "Continua nel terminale");
  terminale.type = "button";
  terminale.onclick = () => passaConversazioneAlTerminale(sessione);
  azioni.append(riprova, terminale);
  box.appendChild(azioni);
  if (precedente !== messaggio && sessione.id === APP.attivaId) {
    toast("Non mostro una cronologia incompleta: " + messaggio, "errore");
  }
}

function chiaveAttesa(sessionId, id) {
  return sessionId + ":" + id;
}

function idRpc() {
  APP.contatoreRpc += 1;
  return "ui-" + APP.replayId + "-" + APP.nonceRpc + "-" + APP.contatoreRpc.toString(36);
}

function programmaTimeoutAttesa(chiave, pendente, durata = pendente.timeoutMs) {
  if (!pendente || !APP.attese.has(chiave)) return;
  if (pendente.timer) clearTimeout(pendente.timer);
  pendente.timer = setTimeout(() => {
    if (APP.attese.get(chiave) !== pendente) return;
    APP.attese.delete(chiave);
    const errore = new Error("Pi non ha risposto in tempo al comando " + pendente.tipoComando);
    if (pendente.mutante) errore.esitoIgnoto = true;
    pendente.rifiuta(errore);
  }, durata);
}

function sospendiTimeoutPromptPerCompattazione(sessionId) {
  const prefisso = sessionId + ":";
  for (const [chiave, pendente] of APP.attese) {
    if (!chiave.startsWith(prefisso) || pendente.tipoComando !== "prompt") continue;
    pendente.inCompattazione = true;
    // La compattazione puo durare diversi minuti e precede l'ack del prompt.
    // Conserviamo un limite di sicurezza ampio per non lasciare attese eterne.
    programmaTimeoutAttesa(chiave, pendente, 15 * 60 * 1000);
  }
}

function riprendiTimeoutPromptDopoCompattazione(sessionId) {
  const prefisso = sessionId + ":";
  for (const [chiave, pendente] of APP.attese) {
    if (!chiave.startsWith(prefisso) || !pendente.inCompattazione) continue;
    pendente.inCompattazione = false;
    programmaTimeoutAttesa(chiave, pendente);
  }
}

function preparaAttesaRpcEsterna(sessionId, id, { timeout = 5 * 60 * 1000, nome = "comando" } = {}) {
  const chiave = chiaveAttesa(sessionId, id);
  if (APP.attese.has(chiave)) throw new Error("Identificatore RPC gia in uso");
  let completaPromessa;
  let rifiutaPromessa;
  const stato = { conclusa: false, riuscita: false, valore: null, errore: null };
  const promessa = new Promise((ok, ko) => {
    completaPromessa = ok;
    rifiutaPromessa = ko;
  });
  const risolvi = (valore) => {
    stato.conclusa = true;
    stato.riuscita = true;
    stato.valore = valore;
    completaPromessa(valore);
  };
  const rifiuta = (errore) => {
    stato.conclusa = true;
    stato.riuscita = false;
    stato.errore = errore;
    rifiutaPromessa(errore);
  };
  // Il listener SSE puo ricevere una risposta prima che il POST abbia finito:
  // il gestore e registrato prima della fetch e ha subito un rejection handler.
  promessa.catch(() => {});
  const timer = setTimeout(() => {
    APP.attese.delete(chiave);
    const errore = new Error(`Pi non ha risposto in tempo al comando ${nome}`);
    errore.esitoIgnoto = true;
    rifiuta(errore);
  }, timeout);
  APP.attese.set(chiave, { risolvi, rifiuta, timer, mutante: true });
  return {
    promessa,
    stato,
    annulla() {
      const pendente = APP.attese.get(chiave);
      if (!pendente) return;
      clearTimeout(pendente.timer);
      APP.attese.delete(chiave);
      if (!stato.conclusa) pendente.risolvi(null);
    },
  };
}

async function rpc(comando, { sessionId = APP.attivaId, timeout = 30000 } = {}) {
  if (!sessionId || !APP.sessioni.has(sessionId)) throw new Error("Nessuna sessione attiva");
  const sessione = APP.sessioni.get(sessionId);
  if (COMANDI_CAMBIO_SESSIONE.has(comando.type)) {
    await (sessione.codaAllegatiBozza || Promise.resolve());
    if (sessione.erroreAllegatiBozza) {
      throw new Error("Prima recupera o scarta esplicitamente le immagini mancanti della bozza.");
    }
    if (sessione.id === APP.attivaId && sessione.bozza !== DOM.input.value) {
      ramificaLineageBozza(sessione);
      sessione.bozza = DOM.input.value;
      sessione.bozzaSporca = true;
      salvaBozza(sessione);
    }
    if (sessione.bozza.length || sessione.allegati.length) {
      throw new Error(
        "Prima invia, copia o cancella la bozza e rimuovi le immagini: appartengono alla conversazione corrente.",
      );
    }
  }
  const id = comando.id || idRpc();
  const chiave = chiaveAttesa(sessionId, id);

  let risolvi;
  let rifiuta;
  const attesa = new Promise((ok, ko) => {
    risolvi = ok;
    rifiuta = ko;
  });
  const pendente = {
    risolvi,
    rifiuta,
    timer: null,
    timeoutMs: timeout,
    tipoComando: String(comando.type || "comando"),
    inCompattazione: false,
    mutante: !String(comando.type).startsWith("get_"),
  };
  APP.attese.set(chiave, pendente);
  programmaTimeoutAttesa(chiave, pendente);

  try {
    const conferma = await chiedi("/api/comando", { corpo: { ...comando, id, sessionId } });
    const operation = conferma?.operation;
    if (operation?.canonicalId && comando.operationId) {
      conservaIdCanonicoOperazione(sessione, comando.operationId, operation.canonicalId);
    }
    if (operation?.status === "completed") {
      const pendente = APP.attese.get(chiave);
      if (pendente) {
        clearTimeout(pendente.timer);
        APP.attese.delete(chiave);
        try {
          pendente.risolvi(datiDaOperazioneCompletata(operation));
        } catch (errore) {
          pendente.rifiuta(errore);
        }
      }
    } else if (
      operation?.status === "pending"
      && operation.canonicalId
      && operation.canonicalId !== id
      && comando.operationId
    ) {
      // Il server ha riconosciuto un retry/reload dello stesso intento. L'ack
      // SSE conserva l'id canonico originale, quindi questa attesa usa lo stato
      // durevole invece di inviare una seconda mutazione a Pi.
      const pendente = APP.attese.get(chiave);
      if (pendente) {
        clearTimeout(pendente.timer);
        APP.attese.delete(chiave);
        void attendiOperazioneServer(sessionId, comando.operationId, { timeout })
          .then((stato) => pendente.risolvi(datiDaOperazioneCompletata(stato)))
          .catch((errore) => pendente.rifiuta(errore));
      }
    }
  } catch (errore) {
    const pendente = APP.attese.get(chiave);
    if (pendente) {
      clearTimeout(pendente.timer);
      APP.attese.delete(chiave);
      if (errore.operation?.status === "completed") {
        try {
          pendente.risolvi(datiDaOperazioneCompletata(errore.operation));
        } catch (erroreOperazione) {
          pendente.rifiuta(erroreOperazione);
        }
      } else pendente.rifiuta(errore);
    }
  }
  return attesa;
}

async function inviaSenzaAttesa(comando, sessionId = APP.attivaId) {
  if (!sessionId) return;
  await chiedi("/api/comando", { corpo: { ...comando, sessionId } });
}

function completaAttesa(evento) {
  if (!evento.id || !evento.guiSessionId) return false;
  const chiave = chiaveAttesa(evento.guiSessionId, evento.id);
  const pendente = APP.attese.get(chiave);
  if (!pendente) return false;
  clearTimeout(pendente.timer);
  APP.attese.delete(chiave);
  if (evento.guiObsoleta) {
    pendente.rifiuta(erroreConEsitoIgnoto("La risposta appartiene alla conversazione precedente"));
  }
  else if (evento.success) pendente.risolvi(evento.data || {});
  else pendente.rifiuta(new Error(evento.error || "Comando rifiutato da pi"));
  return true;
}

function rifiutaAtteseSessione(sessionId, motivo, { esitoIgnoto = false } = {}) {
  const prefisso = sessionId ? sessionId + ":" : null;
  for (const [chiave, pendente] of APP.attese) {
    if (prefisso && !chiave.startsWith(prefisso)) continue;
    clearTimeout(pendente.timer);
    APP.attese.delete(chiave);
    const errore = new Error(motivo);
    if (esitoIgnoto && pendente.mutante) errore.esitoIgnoto = true;
    pendente.rifiuta(errore);
  }
}

// ---------------------------------------------------------------------------
// Sessioni e schede
// ---------------------------------------------------------------------------

function benvenuto(sessione) {
  const box = crea("div", "benvenuto");
  box.dataset.benvenuto = "true";
  box.appendChild(crea("div", "benvenuto-simbolo", "π"));
  box.appendChild(crea("h1", null, sessione.cartella ? "Pronto a lavorare" : "Pronto, anche senza cartella"));
  box.appendChild(
    crea(
      "p",
      null,
      sessione.cartella
        ? "1. Controlla cartella e modello · 2. Scrivi il risultato che vuoi · 3. Pi ti mostra cosa sta facendo."
        : "1. Scrivi la tua richiesta · 2. Usa un percorso assoluto se vuoi lavorare su un file · 3. Pi ti mostra cosa sta facendo.",
    ),
  );
  box.appendChild(
    crea(
      "p",
      "benvenuto-sotto",
      sessione.cartella
        ? "La cartella e il punto di partenza del lavoro. Pi usa i permessi del tuo account: non e una sandbox."
        : "La chat e i comandi funzionano subito. Per leggere o modificare file indica o seleziona un percorso assoluto.",
    ),
  );
  return box;
}

function creaSessione(meta) {
  const vista = crea("div", "vista-sessione");
  const bozza = preparaBozza(meta);
  const inviiPendenti = caricaInviiPendenti(bozza.chiave);
  const bozzaDaVerificareManualmente = inviiPendenti.some((invio) =>
    PALETTE_CORE.invioRichiedeVerificaManuale(invio)
    && invio.testo.trim() === bozza.testo.trim());
  const sessione = {
    id: meta.id,
    cartella: meta.cartella || null,
    nomeCartella: meta.nomeCartella || (meta.senzaCartella ? "Senza cartella" : accorcia(meta.cartella)),
    senzaCartella: Boolean(meta.senzaCartella),
    provider: meta.provider || null,
    modello: meta.modello || null,
    nomeModello: meta.nomeModello || null,
    ragionamento: meta.ragionamento || "medium",
    nomeSessione: meta.nomeSessione || null,
    titoloEstensione: null,
    fileSessione: meta.fileSessione || null,
    chiaveBozza: bozza.chiave,
    versioneBozza: versioneRecordBozza(leggiRecordBozzaProprio(bozza.chiave)),
    allegatiBundleId: bozza.record?.allegatiBundleId || null,
    lineageId: bozza.record?.cancellata
      ? null
      : lineageRecordBozza(bozza.record) || globalThis.crypto.randomUUID(),
    lineageModificataLocalmente: false,
    inviiPendenti,
    // Solo RAM: dopo un reload l'insieme riparte vuoto e le safety-copy non
    // riconciliate tornano visibili, che e proprio il caso di recupero reale.
    inviiNascosti: new Set(),
    bozzaNonPersistita: Boolean(bozza.nonPersistita),
    bozzaSporca: false,
    handoffInCorso: false,
    chiusuraInCorso: false,
    invioInCorso: false,
    invioNonPersistito: false,
    richiestaCronologia: 0,
    attiva: meta.attiva !== false,
    riservata: Boolean(meta.riservata),
    inEsecuzione: Boolean(meta.inEsecuzione),
    compattazioneInCorso: false,
    contestoDaRicalcolare: false,
    sincronizzazione: true,
    messaggiSincronizzati: false,
    haMessaggi: false,
    errore: false,
    ultimoErrorePi: null,
    ultimoErrorePiIl: 0,
    erroreCronologia: null,
    modelli: [],
    livelli: [],
    comandi: [],
    comandiPi: [],
    revisioneCapacita: null,
    versionePiCapacita: null,
    capacitaComplete: false,
    richiestaCapacita: 0,
    capacitaInCaricamento: false,
    coda: { steering: [], followUp: [] },
    statoRpc: {},
    statisticheSessione: null,
    statisticheInCaricamento: false,
    ripetiStatistiche: false,
    ultimoUso: null,
    ultimoCacheHitPercento: null,
    vista,
    msgCorrente: null,
    bloccoTesto: null,
    bloccoRagionamento: null,
    ragionamentiAperti: new Set(),
    gruppoAttivita: null,
    gruppiAttivitaAperti: new Set(),
    frameDelta: null,
    deltaTestoInAttesa: "",
    deltaRagionamentoInAttesa: "",
    strumenti: new Map(),
    turnoHaRisposto: false,
    turnoAspettaTesto: true,
    statiEstensioni: new Map(),
    widgetSopra: new Map(),
    widgetSotto: new Map(),
    // Se un ack aveva soltanto accodato il prompt (tipico follow-up), il marker
    // isolato e anche una safety-copy leggibile dopo crash/reload.
    // Skill, template e comandi diretti restano come safety-copy, ma non vengono
    // rimessi automaticamente nell'editor al reload: sarebbe troppo facile
    // eseguirli due volte. Il pannello offre Ripristina esplicito.
    bozza: bozzaDaVerificareManualmente
      ? ""
      : bozza.testo || (
        PALETTE_CORE.invioRichiedeVerificaManuale(inviiPendenti.at(-1))
          ? ""
          : inviiPendenti.at(-1)?.testo || ""
    ),
    allegati: [],
    codaAllegatiBozza: Promise.resolve(),
    allegatiNonPersistiti: false,
    erroreAllegatiBozza: null,
    ripristinoAllegatiInCorso: false,
    generazioneRipristinoAllegati: 0,
    byteImmaginiCronologia: 0,
    bashCorrenteId: null,
    bashOutput: "",
    bashUi: null,
    seguiFondo: true,
    sincronizzazioneMessaggiFinali: false,
    ripetiSincronizzazioneMessaggi: false,
  };
  vista.appendChild(benvenuto(sessione));
  APP.sessioni.set(sessione.id, sessione);
  void ripristinaAllegatiBozza(sessione);
  void ripristinaAllegatiInvii(sessione);
  setTimeout(() => void riconciliaOperazioniPersistite(sessione), 0);
  return sessione;
}

function unisciSessione(meta) {
  let sessione = APP.sessioni.get(meta.id);
  if (!sessione) sessione = creaSessione(meta);
  const campi = [
    "cartella",
    "nomeCartella",
    "senzaCartella",
    "provider",
    "modello",
    "nomeModello",
    "ragionamento",
    "nomeSessione",
    "inEsecuzione",
    "attiva",
    "riservata",
  ];
  for (const campo of campi) {
    if (Object.hasOwn(meta, campo) && meta[campo] !== undefined) sessione[campo] = meta[campo];
  }
  if (Object.hasOwn(meta, "fileSessione") && meta.fileSessione !== undefined) {
    aggiornaIdentitaBozza(sessione, meta.fileSessione);
  }
  return sessione;
}

function applicaSnapshot(sessioni, { sostituisci = false } = {}) {
  const presenti = new Set();
  for (const meta of sessioni || []) {
    presenti.add(meta.id);
    unisciSessione(meta);
  }
  if (sostituisci) {
    for (const id of [...APP.sessioni.keys()]) {
      if (!presenti.has(id)) {
        const sessione = APP.sessioni.get(id);
        preparaRimozioneSessione(sessione, "La sessione non esiste pi nel ponte locale.");
        APP.sessioni.delete(id);
      }
    }
  }
  if (APP.attivaId && !APP.sessioni.has(APP.attivaId)) APP.attivaId = null;
  disegnaSchede();
  if (!APP.attivaId) {
    const ripiego = idSessioneDiRipiego();
    if (ripiego) attivaSessione(ripiego);
    else mostraNessunaSessione();
  }
}

function sessioneAttiva() {
  return APP.attivaId ? APP.sessioni.get(APP.attivaId) || null : null;
}

function idSessioneDiRipiego() {
  const sessioni = [...APP.sessioni.values()];
  return sessioni.slice().reverse().find((sessione) => sessione.attiva)?.id
    || sessioni.at(-1)?.id
    || null;
}

function azzeraUiEstensioni(sessione) {
  sessione.statiEstensioni.clear();
  sessione.widgetSopra.clear();
  sessione.widgetSotto.clear();
  sessione.titoloEstensione = null;
  APP.dialoghiEstensione = APP.dialoghiEstensione.filter((voce) => voce.sessione !== sessione);
  for (const chiave of [...APP.dialoghiEstensioneVisti]) {
    if (chiave.startsWith(sessione.id + ":")) APP.dialoghiEstensioneVisti.delete(chiave);
  }
  if (APP.dialogoEstensioneAttivo?.sessione === sessione) {
    chiudiModale({ annulla: false });
  }
  if (sessione.id === APP.attivaId) {
    document.title = "Interfaccia pi";
    disegnaEstensioni(sessione);
  }
}

function preparaRimozioneSessione(sessione, motivo) {
  if (!sessione) return;
  rifiutaAtteseSessione(sessione.id, motivo);
  if (sessione.frameDelta != null) cancelAnimationFrame(sessione.frameDelta);
  sessione.frameDelta = null;
  sessione.deltaTestoInAttesa = "";
  sessione.deltaRagionamentoInAttesa = "";
  azzeraUiEstensioni(sessione);
}

function attivaSessione(id) {
  const sessione = APP.sessioni.get(id);
  if (!sessione) return;
  const precedente = sessioneAttiva();
  if (precedente && (precedente.bozzaSporca || precedente.bozza !== DOM.input.value)) {
    if (precedente.bozza !== DOM.input.value) ramificaLineageBozza(precedente);
    precedente.bozza = DOM.input.value;
    precedente.bozzaSporca = true;
    salvaBozza(precedente);
  }
  chiudiPaletteComandi();
  APP.attivaId = id;
  try {
    localStorage.setItem("pi-gui-sessione-attiva", id);
  } catch {
    // Preferenza non essenziale.
  }
  DOM.conversazione.replaceChildren(sessione.vista);
  DOM.input.value = sessione.bozza;
  document.title = sessione.titoloEstensione || "Interfaccia pi";
  disegnaAllegati();
  adattaAltezza();
  disegnaSchede();
  aggiornaInterfacciaAttiva();
  aggiornaPaletteComandi({ forza: true });
  inFondo(sessione);
}

function disegnaSchede() {
  DOM.schede.replaceChildren();
  for (const sessione of APP.sessioni.values()) {
    const gruppo = crea("div", "scheda-gruppo");
    if (sessione.id === APP.attivaId) gruppo.classList.add("attiva");
    if (sessione.inEsecuzione) gruppo.classList.add("lavora");
    if (sessione.errore || !sessione.attiva) gruppo.classList.add("errore");

    const apri = crea("button", "scheda");
    apri.type = "button";
    apri.title = sessione.cartella || "Sessione pi";
    const statoAccessibile = [
      sessione.id === APP.attivaId ? "attiva" : null,
      sessione.inEsecuzione ? "pi sta lavorando" : null,
      sessione.errore ? "errore" : !sessione.attiva ? "sessione chiusa" : null,
    ].filter(Boolean).join(", ");
    apri.setAttribute(
      "aria-label",
      "Passa a " + (sessione.nomeSessione || sessione.nomeCartella) + (statoAccessibile ? ", " + statoAccessibile : ""),
    );
    if (sessione.id === APP.attivaId) apri.setAttribute("aria-current", "page");
    const spiaScheda = crea("span", "scheda-spia");
    spiaScheda.setAttribute("aria-hidden", "true");
    apri.appendChild(spiaScheda);
    apri.appendChild(
      crea("span", "scheda-nome", sessione.nomeSessione || sessione.nomeCartella || "Sessione"),
    );
    apri.onclick = () => attivaSessione(sessione.id);

    const chiudi = crea("button", "scheda-chiudi", "×");
    chiudi.type = "button";
    chiudi.title = "Chiudi questa sessione";
    chiudi.setAttribute("aria-label", "Chiudi " + (sessione.nomeSessione || sessione.nomeCartella));
    chiudi.onclick = () => chiudiSessione(sessione.id);
    gruppo.append(apri, chiudi);
    DOM.schede.appendChild(gruppo);
  }
}

async function chiudiSessione(id, operazione = null) {
  const sessione = APP.sessioni.get(id);
  if (!sessione) return;
  await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
  if (APP.sessioni.get(id) !== sessione) return;
  if (sessione.erroreAllegatiBozza) {
    operazione?.annulla();
    toast("Prima usa Riprova o Scarta immagini mancanti: chiudere ora potrebbe perdere una parte della bozza.", "errore");
    return;
  }
  if (sessione.id === APP.attivaId && sessione.bozza !== DOM.input.value) {
    ramificaLineageBozza(sessione);
    sessione.bozza = DOM.input.value;
    sessione.bozzaSporca = true;
  }
  const testoConfermato = sessione.bozza;
  const allegatiConfermati = sessione.allegati.map((allegato) => allegato.id).join("\u0000");
  const nonInviati = [
    testoConfermato.length ? "la bozza" : null,
    sessione.allegati.length
      ? `${sessione.allegati.length} immagin${sessione.allegati.length === 1 ? "e" : "i"}`
      : null,
  ].filter(Boolean).join(" e ");
  const dettaglio = [
    sessione.inEsecuzione
      ? "Pi sta ancora lavorando: chiudendo la scheda interromperai il lavoro."
      : null,
    nonInviati
      ? `Contenuto non inviato: ${nonInviati}. Se chiudi verra eliminato.`
      : null,
    "La conversazione gia salvata e le copie degli invii da verificare restano recuperabili.",
  ].filter(Boolean).join(" ");
  const confermato = await conferma("Chiudere " + (sessione.nomeCartella || "la sessione") + "?", dettaglio, "Chiudi sessione");
  if (!confermato) {
    operazione?.annulla();
    return;
  }
  sessione.chiusuraInCorso = true;
  aggiornaInterfacciaAttiva();
  await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
  if (
    (sessione.id === APP.attivaId && DOM.input.value !== testoConfermato)
    || sessione.bozza !== testoConfermato
    || sessione.allegati.map((allegato) => allegato.id).join("\u0000") !== allegatiConfermati
  ) {
    sessione.chiusuraInCorso = false;
    aggiornaInterfacciaAttiva();
    toast("La bozza e cambiata: la chiusura e stata annullata.", "avviso");
    return;
  }
  try {
    const operationId = operazione
      ? operazione.preparaPasso("quit").operationId
      : null;
    const corpoChiusura = {
        sessionId: id,
        ...(operationId ? { operationId } : {}),
    };
    if (operationId) {
      await chiediOperazioneIdempotente("/api/chiudi", corpoChiusura, {
        sessionId: id,
        operationId,
        timeout: 60000,
      });
    } else await chiedi("/api/chiudi", { corpo: corpoChiusura });
    operazione?.completa();
    preparaRimozioneSessione(sessione, "La sessione e stata chiusa.");
    await dimenticaBozza(sessione);
    APP.sessioni.delete(id);
    if (APP.attivaId === id) {
      const ripiego = idSessioneDiRipiego();
      if (ripiego) attivaSessione(ripiego);
      else mostraNessunaSessione();
    }
    disegnaSchede();
  } catch (errore) {
    operazione?.fallisce(errore);
    sessione.chiusuraInCorso = false;
    aggiornaInterfacciaAttiva();
    toast(testoErrore(errore), "errore");
  }
}

function mostraNessunaSessione() {
  chiudiPaletteComandi();
  APP.attivaId = null;
  const vista = crea("div", "vista-sessione");
  vista.appendChild(benvenuto({ cartella: null }));
  DOM.conversazione.replaceChildren(vista);
  DOM.input.value = "";
  disegnaAllegati();
  adattaAltezza();
  aggiornaInterfacciaAttiva();
}

// ---------------------------------------------------------------------------
// Markdown sicuro e messaggi
// ---------------------------------------------------------------------------

function aggiungiInline(contenitore, testo) {
  const espressione = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\)\n]+\))/g;
  let ultimo = 0;
  for (const corrispondenza of testo.matchAll(espressione)) {
    const indice = corrispondenza.index;
    if (indice > ultimo) aggiungiTestoConACapo(contenitore, testo.slice(ultimo, indice));
    const token = corrispondenza[0];
    if (token.startsWith("`")) {
      contenitore.appendChild(crea("code", null, token.slice(1, -1)));
    } else if (token.startsWith("**")) {
      contenitore.appendChild(crea("strong", null, token.slice(2, -2)));
    } else if (token.startsWith("*")) {
      contenitore.appendChild(crea("em", null, token.slice(1, -1)));
    } else {
      const parti = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const collegamento = crea("a", null, parti[1]);
      try {
        const destinazione = new URL(parti[2], window.location.href);
        if (["http:", "https:", "mailto:"].includes(destinazione.protocol)) {
          collegaBrowserSistema(collegamento, destinazione.href);
        }
      } catch {
        // Un collegamento non valido resta testo senza href.
      }
      contenitore.appendChild(collegamento);
    }
    ultimo = indice + token.length;
  }
  if (ultimo < testo.length) aggiungiTestoConACapo(contenitore, testo.slice(ultimo));
}

function aggiungiTestoConACapo(contenitore, testo) {
  const righe = testo.split("\n");
  righe.forEach((riga, indice) => {
    if (indice) contenitore.appendChild(document.createElement("br"));
    contenitore.appendChild(document.createTextNode(riga));
  });
}

function renderMarkdown(contenitore, testo) {
  contenitore.replaceChildren();
  contenitore.classList.add("markdown");
  const righe = String(testo || "").replace(/\r\n/g, "\n").split("\n");
  let indice = 0;
  while (indice < righe.length) {
    const riga = righe[indice];
    if (!riga.trim()) {
      indice += 1;
      continue;
    }
    if (/^```/.test(riga.trim())) {
      indice += 1;
      const codice = [];
      while (indice < righe.length && !/^```/.test(righe[indice].trim())) {
        codice.push(righe[indice]);
        indice += 1;
      }
      if (indice < righe.length) indice += 1;
      const pre = crea("pre");
      pre.appendChild(crea("code", null, codice.join("\n")));
      contenitore.appendChild(pre);
      continue;
    }
    const titolo = riga.match(/^(#{1,3})\s+(.+)$/);
    if (titolo) {
      const elemento = crea("h" + titolo[1].length);
      aggiungiInline(elemento, titolo[2]);
      contenitore.appendChild(elemento);
      indice += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(riga) || /^\s*\d+[.)]\s+/.test(riga)) {
      const ordinata = /^\s*\d+[.)]\s+/.test(riga);
      const lista = crea(ordinata ? "ol" : "ul");
      const regola = ordinata ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      while (indice < righe.length && regola.test(righe[indice])) {
        const voce = crea("li");
        aggiungiInline(voce, righe[indice].replace(regola, ""));
        lista.appendChild(voce);
        indice += 1;
      }
      contenitore.appendChild(lista);
      continue;
    }
    if (/^>\s?/.test(riga)) {
      const citazione = [];
      while (indice < righe.length && /^>\s?/.test(righe[indice])) {
        citazione.push(righe[indice].replace(/^>\s?/, ""));
        indice += 1;
      }
      const blocco = crea("blockquote");
      aggiungiInline(blocco, citazione.join("\n"));
      contenitore.appendChild(blocco);
      continue;
    }
    const paragrafo = [];
    while (
      indice < righe.length &&
      righe[indice].trim() &&
      !/^```/.test(righe[indice].trim()) &&
      !/^(#{1,3})\s+/.test(righe[indice]) &&
      !/^\s*[-*+]\s+/.test(righe[indice]) &&
      !/^\s*\d+[.)]\s+/.test(righe[indice]) &&
      !/^>\s?/.test(righe[indice])
    ) {
      paragrafo.push(righe[indice]);
      indice += 1;
    }
    const p = crea("p");
    aggiungiInline(p, paragrafo.join("\n"));
    contenitore.appendChild(p);
  }
}

function viaBenvenuto(sessione) {
  sessione.vista.querySelector("[data-benvenuto]")?.remove();
}

function aggiungiMessaggio(sessione, chi, testo, classe, { immagini = [], markdown = true } = {}) {
  viaBenvenuto(sessione);
  // Un messaggio visibile interrompe la sequenza di attivita interne. Gli
  // strumenti successivi formeranno un nuovo gruppo nel punto cronologico
  // corretto, senza inglobare la risposta testuale.
  sessione.gruppoAttivita = null;
  sessione.haMessaggi = true;
  const msg = crea("article", "msg " + classe);
  const autore = crea("div", "msg-chi", chi);
  const corpo = crea("div", "msg-corpo");
  if (markdown) renderMarkdown(corpo, testo);
  else corpo.textContent = testo;
  msg.append(autore, corpo);

  if (immagini.length) {
    const galleria = crea("div", "messaggio-immagini");
    for (const immagine of immagini) {
      const img = document.createElement("img");
      img.alt = immagine.nome || "Immagine allegata";
      img.src = immagine.url || `data:${immagine.mimeType};base64,${immagine.data}`;
      galleria.appendChild(img);
    }
    corpo.appendChild(galleria);
  }

  if (testo) {
    const azioni = crea("div", "msg-azioni");
    const copia = crea("button", "mini-azione", "Copia");
    copia.type = "button";
    copia.onclick = () => copiaTesto(testo);
    azioni.appendChild(copia);
    msg.appendChild(azioni);
  }
  sessione.vista.appendChild(msg);
  inFondo(sessione);
  return { msg, autore, corpo, raw: testo || "" };
}

function testoDaContenuto(contenuto) {
  if (!contenuto) return "";
  if (typeof contenuto === "string") return contenuto;
  if (!Array.isArray(contenuto)) return "";
  return contenuto
    .filter((parte) => parte?.type === "text")
    .map((parte) => parte.text || "")
    .filter(Boolean)
    .join("\n");
}

function immaginiDaContenuto(contenuto) {
  if (!Array.isArray(contenuto)) return [];
  return contenuto
    .filter((parte) => parte?.type === "image" && parte.data && parte.mimeType)
    .map((parte) => ({ data: parte.data, mimeType: parte.mimeType, nome: "Immagine allegata" }));
}

function firmaImmagine(immagine) {
  const dati = String(immagine?.data || "");
  return [
    String(immagine?.mimeType || ""),
    dati.length,
    dati.slice(0, 32),
    dati.slice(-32),
  ].join(":");
}

function riconciliaInviiPendenti(sessione, messaggi) {
  if (!sessione.inviiPendenti.length) return;
  const utenti = (messaggi || []).filter((messaggio) => messaggio?.role === "user");
  const messaggiUsati = new Set();
  const consegnati = [];
  for (const invio of [...sessione.inviiPendenti].sort(
    (a, b) => Number(a.creatoIl) - Number(b.creatoIl),
  )) {
    // Skill e prompt template trasformano il testo prima di persisterlo. Senza
    // un correlation ID nel JSONL non possiamo provare quale user message li
    // rappresenti: restano da verificare manualmente. Un'associazione per sola
    // posizione potrebbe cancellare proprio la copia di una richiesta persa.
    if (PALETTE_CORE.invioRichiedeVerificaManuale(invio)) continue;
    const indice = utenti.findIndex((messaggio, posizione) => (
      !messaggiUsati.has(posizione)
      && testoDaContenuto(messaggio.content).trim() === invio.testo.trim()
      && (() => {
        const attese = invio.allegati || [];
        const presenti = immaginiDaContenuto(messaggio.content);
        return attese.length === presenti.length
          && attese.every((allegato, indiceAllegato) => (
            allegato.firma === firmaImmagine(presenti[indiceAllegato])
          ));
      })()
      && Number(messaggio.timestamp || 0) >= Number(invio.creatoIl || 0)
    ));
    if (indice >= 0) {
      messaggiUsati.add(indice);
      consegnati.push(invio);
    }
  }
  // Un retry della stessa bozza conserva la lineage. Se una delle copie e
  // provata dal JSONL, tutte le safety-copy equivalenti della medesima lineage
  // descrivono lo stesso intento e possono essere chiuse insieme.
  for (const provato of [...consegnati]) {
    const firmeAllegati = (provato.allegati || []).map((allegato) => allegato.firma);
    for (const candidato of sessione.inviiPendenti) {
      if (
        consegnati.some((invio) => invio.id === candidato.id)
        || PALETTE_CORE.invioRichiedeVerificaManuale(candidato)
      ) continue;
      const equivalente = PALETTE_CORE.trovaInvioPendenteDuplicato(
        [candidato],
        {
          lineageId: provato.lineageId,
          testo: provato.testo,
          firmeAllegati,
        },
      );
      if (equivalente) consegnati.push(candidato);
    }
  }
  if (consegnati.length) {
    const testoBozzaArchiviata = String(
      leggiRecordBozzaProprio(sessione.chiaveBozza)?.testo || "",
    ).trim();
    const risolti = [];
    for (const invio of consegnati) {
      if (invio.lineageId && !segnaLineageRisolta(invio.lineageId)) {
        sessione.invioNonPersistito = true;
        continue;
      }
      dimenticaInvioPendente(sessione, invio.id);
      risolti.push(invio);
    }
    if (risolti.length !== consegnati.length && sessione.id === APP.attivaId) {
      toast(
        "La cronologia conferma l'invio, ma non riesco a salvare la verifica locale. La copia resta visibile finche non liberi spazio.",
        "errore",
      );
    }
    if (!risolti.length) return;
    const testiConsegnati = risolti.map((invio) => invio.testo.trim());
    if (testiConsegnati.some((testo) => sessione.bozza.trim() === testo)) {
      sessione.bozza = "";
      salvaBozza(sessione);
      if (sessione.id === APP.attivaId) DOM.input.value = "";
    } else if (!sessione.bozza && testiConsegnati.includes(testoBozzaArchiviata)) {
      // Dopo l'ack la casella viene svuotata, ma la copia su disco resta finche
      // il messaggio non compare davvero nel JSONL. Ora puo essere eliminata.
      const bundlePrecedente = sessione.allegatiBundleId;
      if (scriviRecordBozzaSessione(sessione, { testo: "", allegatiBundleId: null })) {
        if (bundlePrecedente && !bundleBozzaReferenziato(bundlePrecedente)) {
          void eliminaAllegatiInvio(bundlePrecedente);
        }
      }
    }
    sessione.avvisoInvioPendente = false;
    if (sessione.id === APP.attivaId) {
      toast("La richiesta precedente risulta presente nella cronologia: non verra reinviata.");
    }
  } else if (
    PALETTE_CORE.inviiVisibiliDaVerificare(
      sessione.inviiPendenti,
      sessione.inviiNascosti,
    ).length
    && !sessione.avvisoInvioPendente
    && sessione.id === APP.attivaId
  ) {
    sessione.avvisoInvioPendente = true;
    toast(
      "Un invio precedente non e stato confermato. Controlla la cronologia prima di reinviare la bozza.",
      "avviso",
    );
  }
}

function aggiornaGruppoAttivita(gruppo) {
  if (!gruppo?.box?.isConnected) return;
  const strumenti = [...gruppo.corpo.querySelectorAll(":scope > details.strumento")];
  const ragionamenti = [...gruppo.corpo.querySelectorAll(":scope > details.ragionamento")];
  const errori = strumenti.filter((box) => box.classList.contains("fallito")).length;
  const strumentiInCorso = strumenti.some((box) => (
    box.querySelector(".esito")?.textContent === "in corso…"
  ));
  const inCorso = strumentiInCorso || gruppo.ragionamentiInCorso.size > 0;
  const parti = [];
  if (strumenti.length) {
    parti.push(`${strumenti.length} operazion${strumenti.length === 1 ? "e" : "i"}`);
  }
  if (ragionamenti.length) {
    parti.push(`${ragionamenti.length} ragionament${ragionamenti.length === 1 ? "o" : "i"}`);
  }
  gruppo.conteggio.textContent = parti.length ? " · " + parti.join(" · ") : "";
  gruppo.stato.textContent = errori
    ? `${errori} error${errori === 1 ? "e" : "i"}${inCorso ? " · in corso…" : ""}`
    : inCorso
      ? "in corso…"
      : "completate";
  gruppo.box.classList.toggle("in-corso", inCorso);
  gruppo.box.classList.toggle("con-errori", errori > 0);
}

function ottieniGruppoAttivita(sessione) {
  if (sessione.gruppoAttivita?.box?.isConnected) return sessione.gruppoAttivita;
  viaBenvenuto(sessione);
  sessione.haMessaggi = true;
  const box = crea("details", "gruppo-attivita");
  const summary = crea("summary");
  const titolo = crea("span", "titolo", "Attività tecniche");
  const conteggio = crea("span", "conteggio", "");
  const stato = crea("span", "stato", "in corso…");
  summary.append(titolo, conteggio, stato);
  const corpo = crea("div", "attivita-corpo");
  box.append(summary, corpo);
  sessione.vista.appendChild(box);
  sessione.gruppoAttivita = {
    box,
    corpo,
    conteggio,
    stato,
    ragionamentiInCorso: new Set(),
  };
  aggiornaGruppoAttivita(sessione.gruppoAttivita);
  return sessione.gruppoAttivita;
}

function aggiornaGruppoDiStrumento(riferimento) {
  aggiornaGruppoAttivita(riferimento?.gruppo);
}

function apriRagionamento(sessione, testo = "") {
  viaBenvenuto(sessione);
  const gruppo = ottieniGruppoAttivita(sessione);
  const box = crea("details", "ragionamento");
  const testa = crea(
    "summary",
    null,
    testo ? "Ragionamento (apri per leggere)" : "Sta ragionando… (apri per leggere)",
  );
  const dentro = crea("div", "contenuto", testo);
  box.append(testa, dentro);
  // Il contenuto del ragionamento non occupa la conversazione per impostazione
  // predefinita. L'utente puo aprirlo anche mentre Pi sta lavorando.
  box.open = Boolean(testo && sessione.ragionamentiAperti?.has(testo));
  gruppo.corpo.appendChild(box);
  if (!testo) gruppo.ragionamentiInCorso.add(box);
  sessione.bloccoRagionamento = { box, testa, dentro, gruppo };
  aggiornaGruppoAttivita(gruppo);
  inFondo(sessione);
  return sessione.bloccoRagionamento;
}

function chiudiRagionamento(sessione) {
  scaricaDeltaAccodati(sessione);
  if (!sessione.bloccoRagionamento) return;
  const blocco = sessione.bloccoRagionamento;
  blocco.testa.textContent = "Ragionamento (apri per leggere)";
  blocco.gruppo?.ragionamentiInCorso.delete(blocco.box);
  aggiornaGruppoAttivita(blocco.gruppo);
  // Se l'utente lo ha aperto esplicitamente, non richiuderlo a fine streaming.
  sessione.bloccoRagionamento = null;
}

function breve(valore) {
  const testo = typeof valore === "string" ? valore : JSON.stringify(valore);
  return testo && testo.length > 80 ? testo.slice(0, 79) + "…" : testo || "";
}

function riassumiArgomenti(argomenti) {
  if (!argomenti || typeof argomenti !== "object") return "";
  if (argomenti.command) return String(argomenti.command);
  if (argomenti.path || argomenti.file_path) return String(argomenti.path || argomenti.file_path);
  if (argomenti.pattern) return String(argomenti.pattern);
  return Object.entries(argomenti)
    .slice(0, 4)
    .map(([chiave, valore]) => chiave + ": " + breve(valore))
    .join(" · ");
}

function apriStrumento(sessione, id, nome, argomenti, output = "", finito = false, errore = false) {
  viaBenvenuto(sessione);
  let riferimento = sessione.strumenti.get(id);
  if (riferimento) return riferimento;
  const gruppo = ottieniGruppoAttivita(sessione);
  const box = crea("details", "strumento" + (errore ? " fallito" : ""));
  box.dataset.toolId = String(id || "");
  const testa = crea("summary");
  testa.appendChild(crea("span", "ico", "⌁"));
  testa.appendChild(crea("span", "nome", nome || "strumento"));
  testa.appendChild(crea("span", "arg", riassumiArgomenti(argomenti)));
  const esito = crea("span", "esito", finito ? (errore ? "errore" : "fatto") : "in corso…");
  testa.appendChild(esito);
  const pre = crea("pre", null, output);
  box.append(testa, pre);
  gruppo.corpo.appendChild(box);
  if (sessione.gruppiAttivitaAperti?.has(String(id || ""))) gruppo.box.open = true;
  riferimento = { box, esito, pre, nome, argomenti, gruppo };
  sessione.strumenti.set(id, riferimento);
  aggiornaGruppoAttivita(gruppo);
  inFondo(sessione);
  return riferimento;
}

function renderCronologia(sessione, messaggi) {
  rimuoviErroreCronologia(sessione);
  if (sessione.frameDelta != null) cancelAnimationFrame(sessione.frameDelta);
  sessione.frameDelta = null;
  sessione.deltaTestoInAttesa = "";
  sessione.deltaRagionamentoInAttesa = "";
  // La sincronizzazione ricostruisce il DOM a risposta conclusa. Conserva la
  // scelta esplicita dell'utente per i blocchi che aveva aperto, usando il testo
  // completo come identita locale; i blocchi mai aperti restano compatti.
  sessione.ragionamentiAperti = new Set(
    [...sessione.vista.querySelectorAll("details.ragionamento[open] .contenuto")]
      .map((elemento) => elemento.textContent || "")
      .filter(Boolean),
  );
  sessione.gruppiAttivitaAperti = new Set(
    [...sessione.vista.querySelectorAll("details.gruppo-attivita[open] details.strumento[data-tool-id]")]
      .map((elemento) => elemento.dataset.toolId)
      .filter(Boolean),
  );
  sessione.vista.replaceChildren();
  sessione.haMessaggi = false;
  sessione.strumenti = new Map();
  sessione.msgCorrente = null;
  sessione.bloccoTesto = null;
  sessione.bloccoRagionamento = null;
  sessione.gruppoAttivita = null;
  sessione.ultimoErrorePi = null;
  sessione.ultimoErrorePiIl = 0;
  sessione.byteImmaginiCronologia = (messaggi || []).reduce(
    (totale, messaggio) => totale + (Array.isArray(messaggio?.content)
      ? messaggio.content
          .filter((parte) => parte?.type === "image")
          .reduce((somma, parte) => somma + String(parte.data || "").length, 0)
      : 0),
    0,
  );

  for (const messaggio of messaggi || []) {
    if (!messaggio) continue;
    if (messaggio.role === "user") {
      aggiungiMessaggio(sessione, "tu", testoDaContenuto(messaggio.content), "utente", {
        immagini: immaginiDaContenuto(messaggio.content),
      });
      continue;
    }
    if (messaggio.role === "assistant") {
      const parti = Array.isArray(messaggio.content) ? messaggio.content : [];
      const testo = testoDaContenuto(parti);
      const pensieri = parti
        .filter((parte) => parte?.type === "thinking")
        .map((parte) => parte.thinking || "")
        .join("\n");
      if (pensieri) apriRagionamento(sessione, pensieri);
      if (testo) aggiungiMessaggio(sessione, "pi", testo, "agente");
      for (const parte of parti.filter((voce) => voce?.type === "toolCall")) {
        apriStrumento(sessione, parte.id, parte.name, parte.arguments || parte.args);
      }
      if (messaggio.errorMessage && !testo) {
        mostraErrorePi(sessione, messaggio.errorMessage);
      }
      continue;
    }
    if (messaggio.role === "toolResult") {
      const riferimento =
        sessione.strumenti.get(messaggio.toolCallId) ||
        apriStrumento(sessione, messaggio.toolCallId, messaggio.toolName, null);
      riferimento.pre.textContent = testoDaContenuto(messaggio.content) || "(nessun output)";
      riferimento.esito.textContent = messaggio.isError ? "errore" : "fatto";
      if (messaggio.isError) riferimento.box.classList.add("fallito");
      aggiornaGruppoDiStrumento(riferimento);
      continue;
    }
    if (messaggio.role === "bashExecution") {
      apriStrumento(
        sessione,
        "bash-" + (messaggio.timestamp || Math.random()),
        "shell",
        { command: messaggio.command },
        messaggio.output || "",
        true,
        Boolean(messaggio.cancelled || (messaggio.exitCode && messaggio.exitCode !== 0)),
      );
      continue;
    }
    if (messaggio.role === "custom" && messaggio.display !== false) {
      aggiungiMessaggio(sessione, "estensione", testoDaContenuto(messaggio.content), "sistema");
      continue;
    }
    if (messaggio.role === "compactionSummary") {
      aggiungiMessaggio(sessione, "sistema", "Contesto precedente riassunto:\n" + messaggio.summary, "sistema");
      continue;
    }
    if (messaggio.role === "branchSummary") {
      aggiungiMessaggio(sessione, "sistema", "Riepilogo del ramo precedente:\n" + messaggio.summary, "sistema");
    }
  }
  riconciliaInviiPendenti(sessione, messaggi || []);
  if (!sessione.haMessaggi) sessione.vista.appendChild(benvenuto(sessione));
  inFondo(sessione);
}

// ---------------------------------------------------------------------------
// Eventi RPC
// ---------------------------------------------------------------------------

function scaricaDeltaAccodati(sessione, { markdownFinale = false } = {}) {
  if (sessione.frameDelta != null) cancelAnimationFrame(sessione.frameDelta);
  sessione.frameDelta = null;
  if (sessione.deltaTestoInAttesa && sessione.bloccoTesto) {
    sessione.bloccoTesto.corpo.appendChild(document.createTextNode(sessione.deltaTestoInAttesa));
  }
  if (sessione.deltaRagionamentoInAttesa && sessione.bloccoRagionamento) {
    sessione.bloccoRagionamento.dentro.appendChild(
      document.createTextNode(sessione.deltaRagionamentoInAttesa),
    );
  }
  sessione.deltaTestoInAttesa = "";
  sessione.deltaRagionamentoInAttesa = "";
  if (markdownFinale && sessione.bloccoTesto) {
    sessione.bloccoTesto.corpo.classList.remove("in-streaming");
    renderMarkdown(sessione.bloccoTesto.corpo, sessione.bloccoTesto.raw);
  }
  inFondo(sessione);
}

function pianificaDelta(sessione) {
  if (sessione.frameDelta != null) return;
  sessione.frameDelta = requestAnimationFrame(() => scaricaDeltaAccodati(sessione));
}

function gestisciDelta(sessione, evento) {
  const aggiornamento = evento.assistantMessageEvent;
  if (!aggiornamento) return;
  switch (aggiornamento.type) {
    case "text_delta":
      if (!aggiornamento.delta) break;
      {
        const primoDelta = !sessione.bloccoTesto;
      if (!sessione.bloccoTesto) {
        sessione.msgCorrente = aggiungiMessaggio(sessione, "pi", "", "agente");
        sessione.bloccoTesto = sessione.msgCorrente;
        sessione.bloccoTesto.corpo.classList.add("in-streaming");
      }
      sessione.bloccoTesto.raw += aggiornamento.delta;
      if (primoDelta) {
        // Il primo token non aspetta il prossimo frame grafico: rende la
        // latenza percepita equivalente al terminale. I delta successivi
        // restano raggruppati a un frame per evitare reflow inutili.
        sessione.bloccoTesto.corpo.appendChild(document.createTextNode(aggiornamento.delta));
        inFondo(sessione);
      } else {
        sessione.deltaTestoInAttesa += aggiornamento.delta;
        pianificaDelta(sessione);
      }
      sessione.turnoHaRisposto = true;
      }
      break;
    case "thinking_start":
      apriRagionamento(sessione);
      break;
    case "thinking_delta":
      {
        const primoDelta = !sessione.bloccoRagionamento;
        if (!sessione.bloccoRagionamento) apriRagionamento(sessione);
        const delta = aggiornamento.delta || "";
        if (primoDelta && delta) {
          sessione.bloccoRagionamento.dentro.appendChild(document.createTextNode(delta));
          inFondo(sessione);
        } else if (delta) {
          sessione.deltaRagionamentoInAttesa += delta;
          pianificaDelta(sessione);
        }
      }
      break;
    case "thinking_end":
      chiudiRagionamento(sessione);
      break;
  }
}

function spiegaErrorePi(errore, sessione = sessioneAttiva()) {
  const testo = String(errore || "Errore sconosciuto");
  if (/LM Studio non risponde|Ollama non risponde|provider locale.+non risponde/i.test(testo)) {
    return testo;
  }
  if (/connection error|econnrefused|fetch failed|failed to connect|network error/i.test(testo)) {
    if (sessione?.provider === "ollama") {
      return "Ollama non risponde sulla porta locale 11434. LM Studio e Ollama sono servizi diversi: apri Modello e scegli un modello LM Studio, oppure avvia Ollama.";
    }
    if (sessione?.provider === "lmstudio") {
      return "LM Studio non risponde sulla porta locale 1234. In LM Studio avvia Local Server e carica il modello, poi riprova.";
    }
    if (sessione?.provider === "llama.cpp") {
      return "llama.cpp non risponde sulla porta locale 8080. Avvia il server oppure scegli un altro modello.";
    }
  }
  const regole = [
    [/nothing to export/i, "Non c'e ancora niente da esportare: scrivi almeno un messaggio."],
    [/nothing to compact|too small/i, "La conversazione e ancora troppo breve per essere riassunta."],
    [/no active|not streaming|nothing to abort/i, "Non c'e nulla da interrompere in questo momento."],
    [/model not found/i, "Quel modello non e disponibile. Scegline un altro dal menu Modello."],
    [/no credentials|unauthorized|api key/i, "Mancano le credenziali del modello cloud. Scegli un modello gia collegato o locale."],
  ];
  return regole.find(([regola]) => regola.test(testo))?.[1] || testo;
}

function mostraErrorePi(sessione, errore) {
  const messaggio = spiegaErrorePi(errore, sessione);
  const firma = messaggio.trim().toLowerCase();
  const adesso = Date.now();
  if (sessione.ultimoErrorePi === firma && adesso - sessione.ultimoErrorePiIl < 45_000) {
    return false;
  }
  sessione.ultimoErrorePi = firma;
  sessione.ultimoErrorePiIl = adesso;
  aggiungiMessaggio(sessione, "errore", messaggio, "errore", { markdown: false });
  return true;
}

function gestisciAckComandoBuiltinSenzaAttesa(sessione, invio, evento) {
  const transizione = PALETTE_CORE.transizioneEsitoOperazione(invio, evento);
  if (!transizione) return false;
  if (transizione.azione === "risolvi") {
    if (!dimenticaCopiaSicurezzaVerificata(sessione, invio)) return true;
    toast(
      evento.guiReplay
        ? `Pi aveva gia completato /${invio.comandoBuiltin} prima della riconnessione: non verra reinviato.`
        : `Pi ha confermato /${invio.comandoBuiltin}: non verra reinviato.`,
    );
    Promise.resolve(
      gestisciEsitoRpcBuiltin(
        sessione,
        invio.comandoBuiltin,
        invio.argomentiBuiltin || "",
        evento.data || {},
      ),
    ).catch((errore) => {
      toast(
        `/${invio.comandoBuiltin} e completato, ma l'interfaccia non ha aggiornato tutti i dati: ${testoErrore(errore)} Non reinviarlo.`,
        "errore",
      );
    });
    return true;
  }
  aggiornaStatoOperazionePendente(sessione, invio.id, transizione.modifiche);
  toast(
    `${transizione.modifiche.erroreComando} La copia resta nel pannello “invii da verificare”; non reinviare /${invio.comandoBuiltin} senza controllo.`,
    transizione.modifiche.statoComando === "errore" ? "errore" : "avviso",
  );
  return true;
}

function gestisciAckShellSenzaAttesa(sessione, invio, evento) {
  const transizione = PALETTE_CORE.transizioneEsitoOperazione(invio, evento);
  if (!transizione) return false;
  if (transizione.azione === "risolvi") {
    if (!dimenticaCopiaSicurezzaVerificata(sessione, invio)) return true;
    const dati = evento.data || {};
    const finale = String(dati.output || "(nessun output conservato)");
    const fallito = Boolean(dati.cancelled || (dati.exitCode && dati.exitCode !== 0));
    apriStrumento(
      sessione,
      "diretto-" + invio.id,
      invio.excludeFromContext ? "shell fuori contesto" : "shell diretta",
      { command: invio.comandoShell },
      finale,
      true,
      fallito,
    );
    toast(
      evento.guiReplay
        ? "Pi aveva gia concluso il comando shell prima della riconnessione: non verra rieseguito."
        : "Pi ha confermato il comando shell: non verra rieseguito.",
      fallito ? "avviso" : undefined,
    );
    return true;
  }
  aggiornaStatoOperazionePendente(sessione, invio.id, transizione.modifiche);
  toast(
    `${transizione.modifiche.erroreComando} Il comando shell resta negli invii da verificare e non e pronto al reinvio.`,
    transizione.modifiche.statoComando === "errore" ? "errore" : "avviso",
  );
  return true;
}

async function riconciliaOperazioniPersistite(sessione) {
  if (!sessione?.attiva || !APP.sessioni.has(sessione.id)) return;
  const candidati = sessione.inviiPendenti.filter((invio) => {
    if (!["builtin", "shell"].includes(invio.origine)) return false;
    if (invio.workflowOperationId) return true;
    if (invio.origine === "builtin" && invio.motivoComando === "workflow_in_attesa_scelta") {
      return false;
    }
    return Boolean(invio.operationId);
  });
  for (const fotografia of candidati) {
    const corrente = sessione.inviiPendenti.find((invio) => invio.id === fotografia.id);
    if (!corrente) continue;
    const operationId = corrente.workflowOperationId || corrente.operationId;
    try {
      const operation = await attendiOperazioneServer(sessione.id, operationId, {
        timeout: 2 * 60 * 1000,
      });
      if (operation.status === "routed") {
        aggiornaStatoOperazionePendente(sessione, corrente.id, {
          statoComando: "esito_ignoto",
          motivoComando: "workflow_in_attesa_scelta",
          erroreComando: "Il comando era stato instradato alla GUI, ma la scelta finale non risulta completata.",
        });
        continue;
      }
      if (operation.canonicalId) {
        conservaIdCanonicoOperazione(sessione, operationId, operation.canonicalId);
      }
      const risultato = operation.result || {};
      aggiornaDaRisposta(sessione, {
        type: "response",
        id: operation.canonicalId
          || corrente.workflowRpcId
          || corrente.operationCanonicalId
          || corrente.id,
        guiSessionId: sessione.id,
        guiReplay: true,
        success: risultato.success === true,
        esitoIgnoto: Boolean(risultato.ambiguous),
        error: risultato.error,
        command: risultato.command,
        data: risultato.data || {},
      });
    } catch (errore) {
      if (!sessione.inviiPendenti.some((invio) => invio.id === corrente.id)) continue;
      aggiornaStatoOperazionePendente(sessione, corrente.id, {
        statoComando: "esito_ignoto",
        motivoComando: "riconciliazione_non_conclusa",
        erroreComando: testoErrore(errore),
      });
    }
  }
}

function aggiornaDaRisposta(sessione, evento) {
  if (evento.command === "login_provider") {
    chiudiInterfacciaLoginProvider(sessione, evento.id);
  }
  const avevaAttesa = completaAttesa(evento);
  const invioCorrelato = evento.id
    ? sessione.inviiPendenti.find((voce) => (
        voce.id === evento.id
        || voce.operationCanonicalId === evento.id
        || voce.workflowRpcId === evento.id
        || voce.workflowCanonicalId === evento.id
      ))
    : null;
  // Un ack puo arrivare live dopo che la risposta HTTP e andata persa, oppure
  // come guiReplay dopo un reload. In entrambi i casi l'ID persistito e la
  // prova autorevole: i built-in non vanno cercati fra i messaggi user.
  if (!avevaAttesa && invioCorrelato?.origine === "builtin") {
    if (evento.success && invioCorrelato.workflowOperationId && invioCorrelato.workflowRisolviSuAck === false) {
      aggiornaStatoOperazionePendente(sessione, invioCorrelato.id, {
        statoComando: "esito_ignoto",
        erroreComando: "Pi ha confermato un passo intermedio, ma il workflow non risulta completato.",
        motivoComando: "workflow_parziale",
      });
      toast(
        `/${invioCorrelato.comandoBuiltin} ha completato un passo intermedio prima della riconnessione. Verifica lo stato prima di continuare; non reinviare automaticamente.`,
        "avviso",
      );
      return;
    }
    gestisciAckComandoBuiltinSenzaAttesa(sessione, invioCorrelato, evento);
    return;
  }
  if (!avevaAttesa && invioCorrelato?.origine === "shell") {
    gestisciAckShellSenzaAttesa(sessione, invioCorrelato, evento);
    return;
  }
  if (evento.guiReplay && !avevaAttesa) {
    const invio = invioCorrelato;
    if (invio) {
      if (evento.success) {
        if (invio.origine === "extension") {
          if (invio.lineageId && !segnaLineageRisolta(invio.lineageId)) {
            sessione.invioNonPersistito = true;
            toast(
              "Il comando e completato, ma non riesco a salvare la verifica locale. La copia resta disponibile.",
              "errore",
            );
            return;
          }
          dimenticaInvioPendente(sessione, invio.id);
          if (sessione.bozza.trim() === invio.testo.trim()) {
            sessione.bozza = "";
            salvaBozza(sessione);
            if (sessione.id === APP.attivaId) DOM.input.value = "";
          }
          toast("Il comando dell'estensione era gia stato completato prima della riconnessione.");
        } else {
          setTimeout(() => sincronizzaSessione(sessione, { silenzioso: true }), 0);
          toast("Pi aveva accettato la richiesta prima della riconnessione; verifico ora la cronologia.");
        }
      } else {
        dimenticaInvioPendente(sessione, evento.id);
        toast(evento.error || "Pi ha rifiutato la richiesta precedente.", "errore");
      }
    }
    return;
  }
  if (evento.guiObsoleta) return;
  if (!evento.success) {
    if (evento.error && !["builtin", "shell"].includes(invioCorrelato?.origine)) {
      toast(spiegaErrorePi(evento.error, sessione), "errore");
    }
    return;
  }
  const dati = evento.data || {};
  if (evento.command === "get_state") {
    sessione.statoRpc = { ...sessione.statoRpc, ...dati };
    if (dati.model) {
      sessione.provider = dati.model.provider;
      sessione.modello = dati.model.id;
      sessione.nomeModello = dati.model.name || dati.model.id;
    }
    sessione.ragionamento = dati.thinkingLevel || sessione.ragionamento;
    sessione.nomeSessione = dati.sessionName || null;
    aggiornaIdentitaBozza(sessione, dati.sessionFile || null);
    sessione.inEsecuzione = Boolean(dati.isStreaming);
    sessione.compattazioneInCorso = Boolean(dati.isCompacting);
  }
  if (evento.command === "get_messages") {
    renderCronologia(sessione, dati.messages || []);
    sessione.messaggiSincronizzati = true;
  }
  if (evento.command === "get_session_stats") {
    sessione.statisticheSessione = dati;
    sessione.contestoDaRicalcolare = false;
    // I cumulativi includono ormai l'ultimo messaggio: non sommarlo due volte.
    sessione.ultimoUso = null;
  }
  if (evento.command === "get_available_models") sessione.modelli = dati.models || [];
  if (evento.command === "get_available_thinking_levels") sessione.livelli = dati.levels || [];
  if (evento.command === "get_commands") {
    sessione.comandiPi = PALETTE_CORE.normalizzaCatalogoComandi(dati.commands || []);
    if (!sessione.capacitaComplete) sessione.comandi = sessione.comandiPi;
  }
  if (evento.command === "set_model" && dati.id) {
    sessione.provider = dati.provider;
    sessione.modello = dati.id;
    sessione.nomeModello = dati.name || dati.id;
  }
  if (evento.command === "cycle_model" && dati.model) {
    sessione.provider = dati.model.provider;
    sessione.modello = dati.model.id;
    sessione.nomeModello = dati.model.name || dati.model.id;
    if (dati.thinkingLevel) sessione.ragionamento = dati.thinkingLevel;
  }
  if (evento.command === "cycle_thinking_level" && dati.level) sessione.ragionamento = dati.level;
  if (COMANDI_CAMBIO_SESSIONE.has(evento.command)) {
    azzeraUiEstensioni(sessione);
    sessione.fileSessione = null;
    sessione.statisticheSessione = null;
    sessione.ultimoUso = null;
    sessione.ultimoCacheHitPercento = null;
    sessione.messaggiSincronizzati = false;
    setTimeout(() => sincronizzaSessione(sessione, { silenzioso: false }), 0);
  }
  disegnaSchede();
  if (sessione.id === APP.attivaId) aggiornaInterfacciaAttiva();
}

function segnalaTurnoVuoto(sessione) {
  if (sessione.turnoHaRisposto || !sessione.turnoAspettaTesto) return;
  aggiungiMessaggio(
    sessione,
    "sistema",
    "Pi ha terminato senza produrre una risposta testuale. Controlla gli strumenti qui sopra; se il contesto e pieno usa “Libera spazio” o scegli un modello con piu contesto.",
    "sistema",
  );
}

function gestisciEvento(evento) {
  if (evento.type === "gui_snapshot") {
    applicaSnapshot(evento.sessioni, { sostituisci: true });
    if (!APP.attivaId && APP.sessioni.size) attivaSessione(idSessioneDiRipiego());
    return;
  }

  const id = evento.guiSessionId;
  let sessione = id ? APP.sessioni.get(id) : null;
  if (!sessione && id && evento.type === "gui_sessione_avviata") {
    sessione = creaSessione({ ...evento, id, attiva: true });
    disegnaSchede();
  }
  if (!sessione) return;

  if (evento.type === "response") {
    aggiornaDaRisposta(sessione, evento);
    return;
  }
  if (evento.type === "gui_sessione_avviata") {
    sessione.attiva = true;
    sessione.cartella = evento.cartella;
    sessione.nomeCartella = evento.nomeCartella;
    sessione.senzaCartella = Boolean(evento.senzaCartella);
    if (Object.hasOwn(evento, "fileSessione")) aggiornaIdentitaBozza(sessione, evento.fileSessione);
  } else if (evento.type === "gui_sessione_chiusa") {
    preparaRimozioneSessione(sessione, "La sessione e stata chiusa prima di completare il comando.");
    // L'evento e globale: un'altra finestra puo avere una bozza diversa. Solo
    // il documento che ha confermato una chiusura esplicita la elimina nel
    // proprio flusso `chiudiSessione`; gli altri preservano il record stabile.
    APP.sessioni.delete(sessione.id);
    if (APP.attivaId === sessione.id) {
      const ripiego = idSessioneDiRipiego();
      if (ripiego) attivaSessione(ripiego);
      else mostraNessunaSessione();
    }
  } else if (evento.type === "gui_processo_finito") {
    rifiutaAtteseSessione(sessione.id, "Pi si e chiuso prima di completare il comando.");
    azzeraUiEstensioni(sessione);
    sessione.attiva = false;
    sessione.inEsecuzione = false;
    sessione.errore = evento.codice !== 0 && evento.codice !== null;
    if (sessione.id === APP.attivaId) toast("La sessione pi si e chiusa.", sessione.errore ? "errore" : "avviso");
  } else if (evento.type === "gui_errore") {
    if (/error|failed|exception|epipe/i.test(evento.messaggio || "")) {
      sessione.errore = true;
      mostraErrorePi(sessione, evento.messaggio);
    }
  } else if (evento.type === "agent_start") {
    sessione.inEsecuzione = true;
    sessione.turnoHaRisposto = false;
  } else if (evento.type === "agent_end") {
    if (evento.willRetry && sessione.id === APP.attivaId) {
      avvisa("Il tentativo e terminato; pi riprovera automaticamente…");
    }
  } else if (evento.type === "agent_settled") {
    sessione.inEsecuzione = false;
    sessione.turnoAperto = false;
    if (sessione.id === APP.attivaId) avvisa("");
    scaricaDeltaAccodati(sessione, { markdownFinale: true });
    chiudiRagionamento(sessione);
    if (sessione.messaggiSincronizzati) segnalaTurnoVuoto(sessione);
    // message_end precede agent_settled e il ponte rifiuta correttamente una
    // lettura del JSONL mentre PI sta ancora persistendo. Il coalescer ritenta
    // sempre qui, quando la snapshot su disco e finalmente autorevole.
    sincronizzaMessaggiFinali(sessione);
    setTimeout(() => void aggiornaStatisticheSessione(sessione), 0);
  } else if (evento.type === "turn_start") {
    sessione.turnoAperto = true;
  } else if (evento.type === "turn_end") {
    sessione.turnoAperto = false;
  } else if (evento.type === "message_start") {
    if (evento.message?.role === "assistant" || !evento.message) {
      scaricaDeltaAccodati(sessione, { markdownFinale: true });
      sessione.msgCorrente = null;
      sessione.bloccoTesto = null;
    }
  } else if (evento.type === "message_update") {
    if (sessione.messaggiSincronizzati) gestisciDelta(sessione, evento);
    if (evento.usage?.totalTokens) mostraUsoBreve(sessione, evento.usage);
  } else if (evento.type === "message_end") {
    scaricaDeltaAccodati(sessione, { markdownFinale: true });
    chiudiRagionamento(sessione);
    sessione.bloccoTesto = null;
    const messaggio = evento.message;
    if (messaggio?.role === "assistant" && sessione.id === APP.attivaId) {
      const risposta = testoDaContenuto(messaggio.content).trim();
      if (risposta) {
        DOM.annuncioRisposta.textContent = "";
        requestAnimationFrame(() => {
          DOM.annuncioRisposta.textContent = "Risposta di pi: " + risposta;
        });
      }
    }
    if (messaggio?.role === "assistant" && messaggio.errorMessage && !sessione.turnoHaRisposto) {
      mostraErrorePi(sessione, messaggio.errorMessage);
      sessione.turnoHaRisposto = true;
    }
    // L'evento finale contiene il messaggio completo, ma non sempre tutti gli
    // strumenti. Una rilettura coalescata rende la vista esatta anche se il
    // browser si e ricollegato mentre arrivavano i delta dello streaming.
    sincronizzaMessaggiFinali(sessione);
  } else if (evento.type === "tool_execution_start") {
    if (sessione.messaggiSincronizzati) apriStrumento(sessione, evento.toolCallId, evento.toolName, evento.args);
  } else if (evento.type === "tool_execution_update") {
    const riferimento = sessione.strumenti.get(evento.toolCallId);
    if (riferimento && evento.partialResult) {
      riferimento.pre.textContent = testoDaContenuto(evento.partialResult.content);
    }
  } else if (evento.type === "tool_execution_end") {
    const riferimento =
      sessione.strumenti.get(evento.toolCallId) ||
      (sessione.messaggiSincronizzati
        ? apriStrumento(sessione, evento.toolCallId, evento.toolName, evento.args)
        : null);
    if (riferimento) {
      riferimento.pre.textContent = testoDaContenuto(evento.result?.content) || "(nessun output)";
      riferimento.esito.textContent = evento.isError ? "errore" : "fatto";
      if (evento.isError) riferimento.box.classList.add("fallito");
      aggiornaGruppoDiStrumento(riferimento);
    }
  } else if (evento.type === "queue_update") {
    sessione.coda = {
      steering: evento.steering || [],
      followUp: evento.followUp || evento.follow_up || [],
    };
  } else if (evento.type === "compaction_start") {
    sessione.compattazioneInCorso = true;
    sessione.contestoDaRicalcolare = false;
    sospendiTimeoutPromptPerCompattazione(sessione.id);
    aggiungiMessaggio(sessione, "sistema", "Sto riassumendo la conversazione per liberare spazio…", "sistema");
  } else if (evento.type === "compaction_end") {
    sessione.compattazioneInCorso = false;
    riprendiTimeoutPromptDopoCompattazione(sessione.id);
    if (evento.aborted || evento.errorMessage) {
      aggiungiMessaggio(sessione, "errore", evento.errorMessage || "Riassunto annullato.", "errore");
    } else {
      sessione.statisticheSessione = null;
      sessione.ultimoUso = null;
      sessione.contestoDaRicalcolare = true;
      aggiungiMessaggio(sessione, "sistema", "Spazio liberato: il contesto precedente e stato riassunto.", "sistema");
      // /compact manuale non apre un turno agente e quindi non emette
      // agent_settled: aggiorniamo qui le statistiche quando non c'e un prompt
      // in preflight. Nel caso automatico se ne occupa agent_settled.
      setTimeout(() => {
        if (
          APP.sessioni.get(sessione.id) === sessione
          && !sessione.invioInCorso
          && !sessione.inEsecuzione
          && !sessione.compattazioneInCorso
        ) void aggiornaStatisticheSessione(sessione);
      }, 250);
    }
  } else if (evento.type === "auto_retry_start") {
    if (sessione.id === APP.attivaId) avvisa(`Errore temporaneo: nuovo tentativo ${evento.attempt || ""}…`);
  } else if (evento.type === "auto_retry_end") {
    if (sessione.id === APP.attivaId) avvisa("");
    if (evento.success === false && evento.finalError) {
      mostraErrorePi(sessione, evento.finalError);
    }
  } else if (evento.type === "summarization_retry_scheduled") {
    if (sessione.id === APP.attivaId) avvisa("Il riassunto non e riuscito; pi riprovera automaticamente.");
  } else if (evento.type === "summarization_retry_attempt_start") {
    if (sessione.id === APP.attivaId) avvisa("Nuovo tentativo di riassunto in corso…");
  } else if (evento.type === "summarization_retry_finished") {
    if (sessione.id === APP.attivaId) avvisa("");
  } else if (evento.type === "extension_error") {
    const percorso = evento.extensionPath ? `\nEstensione: ${evento.extensionPath}` : "";
    const dettaglio = (evento.error || "Errore di un'estensione pi") + percorso;
    aggiungiMessaggio(sessione, "estensione", dettaglio, "errore", { markdown: false });
  } else if (evento.type === "extension_ui_request") {
    gestisciInterfacciaEstensione(sessione, evento);
  } else if (evento.type === "bash_execution_update") {
    gestisciAggiornamentoBash(sessione, evento);
  }

  if (["message_update", "tool_execution_update", "bash_execution_update"].includes(evento.type)) {
    return;
  }
  disegnaSchede();
  if (sessione.id === APP.attivaId) aggiornaInterfacciaAttiva();
}

function mostraUsoBreve(sessione, uso) {
  sessione.ultimoUso = uso;
  const inputPrompt = Number(uso?.input || 0)
    + Number(uso?.cacheRead || 0)
    + Number(uso?.cacheWrite || 0);
  if (inputPrompt > 0) {
    sessione.ultimoCacheHitPercento = Number(uso?.cacheRead || 0) / inputPrompt * 100;
  }
  if (sessione.id !== APP.attivaId) return;
  disegnaBarraStatoSessione(sessione);
}

// ---------------------------------------------------------------------------
// Stato visibile e sincronizzazione
// ---------------------------------------------------------------------------

function segnaStato(tipo, testo) {
  DOM.spia.className = "spia" + (tipo ? " " + tipo : "");
  DOM.etiStato.textContent = testo;
}

function abilitaAzioni(attiva) {
  document.querySelectorAll("[data-azione]").forEach((bottone) => {
    const sempre = APP.bridgeOnline
      && ["nuova", "cartella", "conversazioni"].includes(bottone.dataset.azione);
    bottone.disabled = !attiva && !sempre;
  });
  document.querySelectorAll("#lista-esempi button").forEach((bottone) => {
    bottone.disabled = !attiva;
  });
}

function aggiornaInterfacciaAttiva() {
  const sessione = sessioneAttiva();
  disegnaInviiDaVerificare(sessione);
  const utilizzabile = Boolean(
    APP.bridgeOnline
      && sessione?.attiva
      && !sessione.sincronizzazione
      && !sessione.handoffInCorso
      && !sessione.chiusuraInCorso
      && !sessione.invioInCorso
      && !sessione.compattazioneInCorso
      && !sessione.ripristinoAllegatiInCorso
      && !sessione.erroreAllegatiBozza,
  );
  if (!utilizzabile) {
    chiudiPaletteComandi();
    chiudiMenuAzioniComposer();
  }
  DOM.input.disabled = !utilizzabile;
  const cronologiaVerificata = !sessione?.erroreCronologia;
  DOM.btnAllega.disabled = !utilizzabile;
  DOM.btnInvia.disabled = !utilizzabile
    || !cronologiaVerificata
    || (!DOM.input.value.trim() && !(sessione?.allegati.length));
  DOM.btnModello.disabled = !utilizzabile;
  DOM.btnRagionamento.disabled = !utilizzabile;
  DOM.btnControlli.disabled = !utilizzabile;
  DOM.conversazione.setAttribute(
    "aria-busy",
    String(Boolean(sessione?.inEsecuzione || sessione?.compattazioneInCorso)),
  );
  abilitaAzioni(utilizzabile);
  const ricaricaRisorseInCorso = Boolean(sessione?.ricaricaRisorseInCorso);
  DOM.btnRicaricaRisorse.disabled = !utilizzabile
    || Boolean(sessione?.inEsecuzione)
    || Boolean(sessione?.compattazioneInCorso)
    || ricaricaRisorseInCorso;
  DOM.btnRicaricaRisorse.setAttribute("aria-busy", String(ricaricaRisorseInCorso));
  DOM.btnRicaricaRisorse.querySelector("strong").textContent = ricaricaRisorseInCorso
    ? "Ricaricamento…"
    : "Ricarica estensioni";
  DOM.azioneAllegaImmagine.disabled = !utilizzabile || !cronologiaVerificata;
  DOM.azioneRichiamaSkill.disabled = !utilizzabile || !cronologiaVerificata;
  DOM.azioneComandiEstensioni.disabled = !utilizzabile || !cronologiaVerificata;
  DOM.azioneRicaricaRisorse.disabled = DOM.btnRicaricaRisorse.disabled;
  DOM.btnAlbero.disabled = !utilizzabile
    || !sessione
    || Boolean(sessione.inEsecuzione)
    || Boolean(sessione.compattazioneInCorso);
  const fermaLaterale = document.querySelector("[data-azione='interrompi']");
  if (fermaLaterale) fermaLaterale.disabled = !utilizzabile || !sessione?.inEsecuzione;

  if (!sessione) {
    DOM.etiCartella.textContent = "nessuna cartella";
    DOM.etiPercorso.textContent = "Puoi iniziare comunque";
    DOM.etiModello.textContent = "nessuno";
    DOM.etiRagionamento.textContent = "—";
    DOM.listaComandi.replaceChildren();
    DOM.notaComandi.textContent = "Si caricano quando avvii una conversazione.";
    DOM.btnRicaricaRisorse.disabled = true;
    DOM.btnRicaricaRisorse.setAttribute("aria-busy", "false");
    DOM.btnRicaricaRisorse.querySelector("strong").textContent = "Ricarica estensioni";
    DOM.btnCercaComandi.hidden = true;
    disegnaBarraStatoSessione(null);
    DOM.invioOccupato.hidden = true;
    DOM.btnFermaTop.hidden = true;
    disegnaEstensioni(null);
    segnaStato(APP.bridgeOnline ? "" : "errore", APP.bridgeOnline ? "nuova chat" : "ponte non raggiungibile");
    return;
  }

  DOM.etiCartella.textContent = sessione.nomeSessione || sessione.nomeCartella || accorcia(sessione.cartella);
  DOM.etiPercorso.textContent = sessione.senzaCartella
    ? "File solo tramite percorso assoluto"
    : sessione.cartella || "";
  DOM.etiPercorso.title = sessione.senzaCartella ? "" : sessione.cartella || "";
  const nomeCorrente = sessione.nomeModello || sessione.modello || "caricamento…";
  DOM.etiModello.textContent = sessione.provider
    ? `${nomeCorrente} · ${nomeProviderVisuale(sessione.provider)}`
    : nomeCorrente;
  DOM.btnModello.title = sessione.provider && sessione.modello ? `${sessione.provider} / ${sessione.modello}` : "Scegli il modello";
  DOM.etiRagionamento.textContent = traduciLivello(sessione.ragionamento);
  disegnaBarraStatoSessione(sessione);
  DOM.invioOccupato.hidden = !(sessione.inEsecuzione || sessione.compattazioneInCorso);
  DOM.btnFermaTop.hidden = !sessione.inEsecuzione;
  disegnaComandi(sessione);
  disegnaCoda(sessione);
  disegnaEstensioni(sessione);

  if (!APP.bridgeOnline) segnaStato("errore", "ponte non raggiungibile");
  else if (sessione.sincronizzazione) segnaStato("lavora", "sincronizzo…");
  else if (sessione.erroreCronologia) segnaStato("errore", "cronologia non disponibile");
  else if (sessione.riservata) segnaStato("errore", "chiusura da completare");
  else if (!sessione.attiva) segnaStato("errore", "sessione chiusa");
  else if (sessione.compattazioneInCorso) segnaStato("lavora", "sta liberando spazio…");
  else if (sessione.inEsecuzione) segnaStato("lavora", "sta lavorando…");
  else segnaStato("pronto", "pronto");
}

function disegnaCoda(sessione) {
  const correggi = sessione.coda?.steering?.length || 0;
  const dopo = sessione.coda?.followUp?.length || 0;
  DOM.coda.hidden = correggi + dopo === 0;
  DOM.coda.textContent = correggi + dopo
    ? `Ricevuto da Pi: ${correggi} correzion${correggi === 1 ? "e" : "i"} da applicare al lavoro in corso; ${dopo} richiest${dopo === 1 ? "a" : "e"} per il turno successivo.`
    : "";
}

function disegnaEstensioni(sessione) {
  if (!sessione) {
    DOM.statiEstensioni.hidden = true;
    DOM.widgetSopra.hidden = true;
    DOM.widgetSotto.hidden = true;
    return;
  }
  const stati = [...sessione.statiEstensioni.values()].filter(Boolean);
  DOM.statiEstensioni.hidden = !stati.length;
  DOM.statiEstensioni.textContent = stati.join(" · ");
  const sopra = [...sessione.widgetSopra.values()].flat().filter(Boolean);
  const sotto = [...sessione.widgetSotto.values()].flat().filter(Boolean);
  DOM.widgetSopra.hidden = !sopra.length;
  DOM.widgetSopra.textContent = sopra.join("\n");
  DOM.widgetSotto.hidden = !sotto.length;
  DOM.widgetSotto.textContent = sotto.join("\n");
}

async function sincronizzaMessaggiFinali(sessione) {
  if (!sessione?.attiva) return;
  if (sessione.sincronizzazioneMessaggiFinali) {
    sessione.ripetiSincronizzazioneMessaggi = true;
    return;
  }
  sessione.sincronizzazioneMessaggiFinali = true;
  try {
    do {
      sessione.ripetiSincronizzazioneMessaggi = false;
      try {
        await caricaCronologiaSessione(sessione);
      } catch (errore) {
        // 423 e la normale finestra fra message_end e agent_settled. Gli altri
        // errori non devono trasformarsi in una falsa conversazione vuota.
        if (errore?.statusHttp !== 423) mostraErroreCronologia(sessione, errore);
      }
    } while (sessione.ripetiSincronizzazioneMessaggi && sessione.attiva);
  } finally {
    sessione.sincronizzazioneMessaggiFinali = false;
  }
}

async function caricaCapacita(sessione, { refresh = false } = {}) {
  if (!sessione?.id || APP.sessioni.get(sessione.id) !== sessione) return false;
  const richiesta = Number(sessione.richiestaCapacita || 0) + 1;
  sessione.richiestaCapacita = richiesta;
  sessione.capacitaInCaricamento = true;
  try {
    const dati = await chiedi("/api/capacita", {
      corpo: { sessionId: sessione.id, ...(refresh ? { refresh: true } : {}) },
    });
    if (
      APP.sessioni.get(sessione.id) !== sessione
      || sessione.richiestaCapacita !== richiesta
    ) return false;
    sessione.comandi = PALETTE_CORE.normalizzaCatalogoComandi(dati.commands || []);
    sessione.revisioneCapacita = dati.revision ?? dati.catalogRevision ?? null;
    sessione.versionePiCapacita = dati.piVersion || null;
    // Una risposta valida del ponte e un catalogo completo anche nelle build
    // precedenti all'aggiunta esplicita del flag `complete`.
    sessione.capacitaComplete = dati.complete !== false;
    if (sessione.id === APP.attivaId) {
      disegnaComandi(sessione);
      aggiornaPaletteComandi({ forza: true });
    }
    return true;
  } catch {
    if (
      APP.sessioni.get(sessione.id) === sessione
      && sessione.richiestaCapacita === richiesta
    ) {
      sessione.capacitaComplete = false;
      if (!sessione.comandi.length && sessione.comandiPi.length) {
        sessione.comandi = [...sessione.comandiPi];
      }
    }
    return false;
  } finally {
    if (sessione.richiestaCapacita === richiesta) sessione.capacitaInCaricamento = false;
  }
}

async function sincronizzaSessione(sessione, { silenzioso = true } = {}) {
  if (!sessione?.attiva) {
    sessione.sincronizzazione = false;
    return;
  }
  sessione.sincronizzazione = true;
  sessione.messaggiSincronizzati = false;
  if (sessione.id === APP.attivaId) aggiornaInterfacciaAttiva();
  // Prima apprendiamo isStreaming e l'identita corrente; la cronologia su
  // disco e autorevole soltanto a turno concluso e non va mescolata con il
  // JSONL precedente durante switch/fork.
  const esitiStato = await Promise.allSettled([
    rpc({ type: "get_state" }, { sessionId: sessione.id, timeout: 25000 }),
  ]);
  const comandi = [
    { type: "get_available_models" },
    { type: "get_available_thinking_levels" },
    { type: "get_commands" },
  ];
  const operazioni = comandi.map(
    (comando) => rpc(comando, { sessionId: sessione.id, timeout: 25000 }),
  );
  const leggiCronologiaCompleta = !sessione.inEsecuzione;
  operazioni.unshift(
    caricaCronologiaSessione(sessione, {
      consentiParziale: !leggiCronologiaCompleta,
    }),
  );
  const esiti = [...esitiStato, ...await Promise.allSettled(operazioni)];
  await caricaCapacita(sessione);
  sessione.sincronizzazione = false;
  const esitoCronologia = esiti[esitiStato.length];
  if (esitoCronologia?.status === "rejected") {
    if (
      sessione.inEsecuzione
      && [409, 423].includes(esitoCronologia.reason?.statusHttp)
    ) {
      mostraCronologiaInAttesa(sessione);
    } else if (esitoCronologia.reason?.statusHttp !== 423) {
      mostraErroreCronologia(sessione, esitoCronologia.reason);
    }
  }
  if (!silenzioso && esiti.every((esito) => esito.status === "rejected")) {
    toast("Non riesco a sincronizzare la sessione.", "errore");
  }
  disegnaSchede();
  if (sessione.id === APP.attivaId) aggiornaInterfacciaAttiva();
  void aggiornaStatisticheSessione(sessione);
}

async function aggiornaStatisticheSessione(sessione) {
  if (!sessione?.attiva || APP.sessioni.get(sessione.id) !== sessione) return false;
  if (sessione.statisticheInCaricamento) {
    sessione.ripetiStatistiche = true;
    return false;
  }
  sessione.statisticheInCaricamento = true;
  let aggiornata = false;
  try {
    do {
      sessione.ripetiStatistiche = false;
      try {
        await rpc({ type: "get_session_stats" }, { sessionId: sessione.id, timeout: 12000 });
        aggiornata = true;
      } catch {
        // Le statistiche sono accessorie: conserva l'ultima fotografia valida.
      }
    } while (
      sessione.ripetiStatistiche
      && sessione.attiva
      && APP.sessioni.get(sessione.id) === sessione
    );
  } finally {
    sessione.statisticheInCaricamento = false;
  }
  return aggiornata;
}

async function aggiornaDalPonte({ sostituisci = false } = {}) {
  const stato = await chiedi("/api/stato");
  if (stato.servizio !== "pi-gui-bridge") throw new Error("La porta locale e occupata da un servizio diverso.");
  if (stato.versione !== 6) {
    throw new Error("E attiva una versione non compatibile del ponte. Chiudila e riapri l'interfaccia.");
  }
  if (APP.tokenApi && APP.tokenApi !== stato.tokenApi) {
    rifiutaAtteseSessione(
      null,
      "Il ponte e stato riavviato prima di confermare il comando.",
      { esitoIgnoto: true },
    );
  }
  APP.tokenApi = stato.tokenApi;
  APP.modelliPredefiniti = stato.modelliPredefiniti || {};
  APP.preferite = stato.preferite || [];
  APP.recenti = stato.recenti || [];
  APP.radici = stato.radici || [];
  applicaSnapshot(stato.sessioni || [], { sostituisci });
  return stato;
}

function ponteNonRaggiungibile() {
  // Una caduta del solo SSE non dimostra che PI non abbia ricevuto il comando.
  // Le attese restano vive: il ponte riproduce gli ack recenti al reconnect e il
  // timeout segnala esplicitamente l'eventuale esito non verificabile.
  APP.bridgeOnline = false;
  aggiornaInterfacciaAttiva();
}

async function risincronizzaDopoRiconnessione() {
  if (APP.riconnessioneInCorso) return false;
  APP.riconnessioneInCorso = true;
  try {
    APP.eventi?.close();
    APP.eventi = null;
    await aggiornaDalPonte({ sostituisci: true });
    const connesso = await collegaEventi({ programmaSuErrore: false });
    if (!connesso) throw new Error("Il flusso eventi non e ancora disponibile");
    APP.bridgeOnline = true;
    const sessioni = [...APP.sessioni.values()];
    await Promise.all(sessioni.map((sessione) => sincronizzaSessione(sessione)));
    if (!APP.attivaId && sessioni.length) attivaSessione(idSessioneDiRipiego());
    aggiornaInterfacciaAttiva();
    APP.tentativoRiconnessione = 0;
    return true;
  } catch {
    ponteNonRaggiungibile();
    return false;
  } finally {
    APP.riconnessioneInCorso = false;
  }
}

function programmaRiconnessione() {
  if (APP.timerRiconnessione || APP.riconnessioneInCorso) return;
  const ritardo = Math.min(1000 * 2 ** APP.tentativoRiconnessione, 10000);
  APP.timerRiconnessione = setTimeout(async () => {
    APP.timerRiconnessione = null;
    const riuscita = await risincronizzaDopoRiconnessione();
    if (!riuscita) {
      APP.tentativoRiconnessione += 1;
      programmaRiconnessione();
    }
  }, ritardo);
}

function collegaEventi({ programmaSuErrore = true } = {}) {
  return new Promise((risolvi) => {
    const eventi = new EventSource(
      "/api/eventi?token=" + encodeURIComponent(APP.tokenApi)
      + "&clientId=" + encodeURIComponent(APP.clientId)
      + "&replayId=" + encodeURIComponent(APP.replayId),
    );
    APP.eventi = eventi;
    let aperto = false;
    let conclusa = false;
    const limite = setTimeout(() => {
      if (!aperto && !conclusa) {
        conclusa = true;
        eventi.close();
        if (APP.eventi === eventi) APP.eventi = null;
        risolvi(false);
        if (programmaSuErrore) programmaRiconnessione();
      }
    }, 4000);
    eventi.onopen = () => {
      if (APP.eventi !== eventi) return;
      aperto = true;
      clearTimeout(limite);
      APP.bridgeOnline = true;
      aggiornaInterfacciaAttiva();
      if (!conclusa) {
        conclusa = true;
        risolvi(true);
      }
      APP.primaConnessione = false;
    };
    eventi.onmessage = (messaggio) => {
      if (APP.eventi !== eventi) return;
      try {
        gestisciEvento(JSON.parse(messaggio.data));
      } catch (errore) {
        console.error("Evento pi non interpretabile", errore);
      }
    };
    eventi.onerror = () => {
      if (APP.eventi !== eventi) return;
      clearTimeout(limite);
      eventi.close();
      APP.eventi = null;
      ponteNonRaggiungibile();
      if (!conclusa) {
        conclusa = true;
        risolvi(false);
      }
      if (programmaSuErrore) programmaRiconnessione();
    };
  });
}

// ---------------------------------------------------------------------------
// Modali accessibili
// ---------------------------------------------------------------------------

function elementiFocusabili() {
  return [...DOM.modale.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")]
    .filter((elemento) => !elemento.hidden && elemento.offsetParent !== null);
}

function apriModale(titolo, {
  larga = false,
  onCancel = null,
  chiudibile = true,
  contesto = null,
} = {}) {
  chiudiPaletteComandi();
  if (!DOM.velo.hidden) chiudiModale({ annulla: true, continuaCoda: false });
  const attivo = document.activeElement;
  // I comandi slash partono dal composer, ma il latch di invio disabilita la
  // textarea prima che il workflow apra la propria finestra. In quel momento
  // il browser sposta spesso il focus su BODY: conserviamo esplicitamente il
  // composer così Esc può riportare l'utente al punto di lavoro.
  const composerDaRipristinare = sessioneAttiva()?.invioInCorso
    && DOM.input?.isConnected
    ? DOM.input
    : null;
  const precedente = composerDaRipristinare || (attivo
    && attivo !== document.body
    && attivo !== document.documentElement
    && !attivo.disabled
    ? attivo
    : document.querySelector(".scheda[aria-current='page']") || $("#btn-menu") || $("#btn-apri-cartella"));
  APP.modale = {
    precedente,
    onCancel,
    chiudibile,
    contesto,
    timer: null,
    sfondo: [...document.body.children]
      .filter((elemento) => elemento !== DOM.velo && elemento !== DOM.toastArea)
      .map((elemento) => ({
        elemento,
        inert: elemento.inert,
        ariaHidden: elemento.getAttribute("aria-hidden"),
      })),
  };
  DOM.modaleTitolo.textContent = titolo;
  DOM.modaleCorpo.replaceChildren();
  DOM.modalePiede.replaceChildren();
  DOM.modalePiede.hidden = true;
  DOM.modale.removeAttribute("aria-describedby");
  DOM.modale.classList.remove("modale-esplora-cartelle");
  DOM.modale.classList.toggle("larga", larga);
  DOM.modaleChiudi.hidden = !chiudibile;
  for (const voce of APP.modale.sfondo) {
    voce.elemento.inert = true;
    voce.elemento.setAttribute("aria-hidden", "true");
  }
  DOM.velo.hidden = false;
  // Il contenuto di alcuni workflow arriva dopo una RPC. Il dialogo stesso è
  // sempre un bersaglio valido e impedisce che il focus resti sul BODY mentre
  // attendiamo il primo controllo interattivo.
  DOM.modale.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    const primo = elementiFocusabili()[0];
    (primo || DOM.modale).focus();
  });
  return DOM.modaleCorpo;
}

function chiudiModale({ annulla = true, continuaCoda = true } = {}) {
  if (DOM.velo.hidden) return;
  const stato = APP.modale;
  if (annulla && stato?.onCancel) stato.onCancel();
  if (stato?.timer) clearTimeout(stato.timer);
  DOM.velo.hidden = true;
  DOM.modaleCorpo.replaceChildren();
  DOM.modalePiede.replaceChildren();
  DOM.modalePiede.hidden = true;
  DOM.modale.removeAttribute("aria-describedby");
  for (const voce of stato?.sfondo || []) {
    voce.elemento.inert = voce.inert;
    if (voce.ariaHidden == null) voce.elemento.removeAttribute("aria-hidden");
    else voce.elemento.setAttribute("aria-hidden", voce.ariaHidden);
  }
  aggiornaAccessibilitaMenu();
  APP.modale = null;
  APP.dialogoEstensioneAttivo = null;
  if (stato?.precedente?.isConnected && !stato.precedente.disabled) stato.precedente.focus();
  if (continuaCoda) setTimeout(mostraProssimoDialogoEstensione, 0);
}

DOM.modaleChiudi.onclick = () => {
  if (APP.modale?.chiudibile) chiudiModale();
};
DOM.velo.onclick = (evento) => {
  if (evento.target === DOM.velo && APP.modale?.chiudibile) chiudiModale();
};
document.addEventListener("keydown", (evento) => {
  if (DOM.velo.hidden) return;
  if (evento.key === "Escape" && APP.modale?.chiudibile) {
    evento.preventDefault();
    chiudiModale();
    return;
  }
  if (evento.key !== "Tab") return;
  const focusabili = elementiFocusabili();
  if (!focusabili.length) {
    evento.preventDefault();
    DOM.modale.focus();
    return;
  }
  const primo = focusabili[0];
  const ultimo = focusabili.at(-1);
  if (evento.shiftKey && document.activeElement === primo) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && document.activeElement === ultimo) {
    evento.preventDefault();
    primo.focus();
  }
});

function conferma(titolo, messaggio, etichetta = "Conferma") {
  return new Promise((risolvi) => {
    const corpo = apriModale(titolo, { onCancel: () => risolvi(false) });
    const descrizione = crea("p", "nota", messaggio);
    descrizione.id = "modale-descrizione";
    DOM.modale.setAttribute("aria-describedby", descrizione.id);
    corpo.appendChild(descrizione);
    DOM.modalePiede.hidden = false;
    const annulla = crea("button", "bottone", "Annulla");
    const confermaBtn = crea("button", "bottone primario", etichetta);
    annulla.onclick = () => chiudiModale();
    confermaBtn.onclick = () => {
      chiudiModale({ annulla: false });
      risolvi(true);
    };
    DOM.modalePiede.append(annulla, confermaBtn);
  });
}

function chiediTesto(titolo, etichetta, valore = "", multilinea = false) {
  return new Promise((risolvi) => {
    const corpo = apriModale(titolo, { onCancel: () => risolvi(null) });
    const label = crea("label", "campo-etichetta", etichetta);
    const campo = crea(multilinea ? "textarea" : "input", multilinea ? "area-testo" : "campo");
    campo.value = valore;
    label.appendChild(campo);
    corpo.appendChild(label);
    DOM.modalePiede.hidden = false;
    const annulla = crea("button", "bottone", "Annulla");
    const ok = crea("button", "bottone primario", "Continua");
    annulla.onclick = () => chiudiModale();
    ok.onclick = () => {
      const risultato = campo.value;
      chiudiModale({ annulla: false });
      risolvi(risultato);
    };
    DOM.modalePiede.append(annulla, ok);
    requestAnimationFrame(() => campo.focus());
  });
}

// ---------------------------------------------------------------------------
// Explorer delle cartelle e sessioni salvate
// ---------------------------------------------------------------------------

function percorsoExplorerNormalizzato(percorso) {
  return String(percorso || "")
    .replace(/[\\/]+$/, "")
    .replaceAll("/", "\\")
    .toLocaleLowerCase();
}

function stessoPercorsoExplorer(primo, secondo) {
  return percorsoExplorerNormalizzato(primo) === percorsoExplorerNormalizzato(secondo);
}

function unisciPercorsoExplorer(base, ...parti) {
  const separatore = String(base).includes("\\") ? "\\" : "/";
  return [String(base).replace(/[\\/]+$/, ""), ...parti]
    .filter(Boolean)
    .join(separatore);
}

function percorsiExplorerUnici(percorsi) {
  const visti = new Set();
  return percorsi.filter((percorso) => {
    if (!percorso) return false;
    const chiave = percorsoExplorerNormalizzato(percorso);
    if (visti.has(chiave)) return false;
    visti.add(chiave);
    return true;
  });
}

function cartellaPersonaleExplorer(radici = APP.radici) {
  const esplicita = radici.find((radice) => /personale|\bhome\b/i.test(radice.nome));
  if (esplicita?.percorso) return esplicita.percorso;
  for (const voce of APP.preferite) {
    const windows = String(voce.percorso || "").match(/^([a-z]:\\users\\[^\\]+)/i);
    if (windows) return windows[1];
    const posix = String(voce.percorso || "").match(/^(\/home\/[^/]+)/);
    if (posix) return posix[1];
  }
  return null;
}

function preferitaExplorer(...nomi) {
  const cercati = nomi.map((nome) => nome.toLocaleLowerCase());
  return APP.preferite.find((voce) => cercati.includes(String(voce.nome).toLocaleLowerCase()))?.percorso;
}

function puntiRapidiExplorer(dati) {
  const radici = dati?.radici || APP.radici;
  const home = cartellaPersonaleExplorer(radici);
  const desktopPreferito = preferitaExplorer("Desktop", "Scrivania");
  const documentiPreferiti = preferitaExplorer("Documenti", "Documents");
  const downloadPreferito = preferitaExplorer("Download", "Downloads", "Scaricati");
  const standard = [desktopPreferito, documentiPreferiti, downloadPreferito, home].filter(Boolean);
  const rapidi = [
    {
      nome: "Desktop",
      icona: "🖥️",
      percorsi: percorsiExplorerUnici([
        desktopPreferito,
        home && unisciPercorsoExplorer(home, "OneDrive", "Desktop"),
        home && unisciPercorsoExplorer(home, "Desktop"),
      ]),
    },
    {
      nome: "Documenti",
      icona: "📄",
      percorsi: percorsiExplorerUnici([
        home && unisciPercorsoExplorer(home, "OneDrive", "Documenti"),
        home && unisciPercorsoExplorer(home, "OneDrive", "Documents"),
        documentiPreferiti,
        home && unisciPercorsoExplorer(home, "Documents"),
        home && unisciPercorsoExplorer(home, "Documenti"),
      ]),
    },
    {
      nome: "Download",
      icona: "↓",
      percorsi: percorsiExplorerUnici([
        downloadPreferito,
        home && unisciPercorsoExplorer(home, "Downloads"),
        home && unisciPercorsoExplorer(home, "Scaricati"),
      ]),
    },
    { nome: "Home", icona: "⌂", percorsi: home ? [home] : [] },
  ].filter((voce) => voce.percorsi.length);
  const unita = radici
    .filter((radice) => radice.percorso && !stessoPercorsoExplorer(radice.percorso, home))
    .map((radice) => ({ nome: radice.nome, icona: "💽", percorsi: [radice.percorso] }));
  const preferite = APP.preferite
    .filter((voce) => voce.percorso && !standard.some((percorso) => stessoPercorsoExplorer(percorso, voce.percorso)))
    .slice(0, 6)
    .map((voce) => ({ nome: voce.nome, icona: "☆", percorsi: [voce.percorso] }));
  return { rapidi, unita, preferite };
}

function segmentiPercorsoExplorer(percorso) {
  const testo = String(percorso || "");
  const windows = testo.match(/^([a-z]:)[\\/](.*)$/i);
  if (windows) {
    const radice = windows[1] + "\\";
    let accumulato = radice;
    const risultato = [{ nome: windows[1], percorso: radice }];
    for (const parte of windows[2].split(/[\\/]+/).filter(Boolean)) {
      accumulato = unisciPercorsoExplorer(accumulato, parte);
      risultato.push({ nome: parte, percorso: accumulato });
    }
    return risultato;
  }
  if (testo.startsWith("/")) {
    let accumulato = "/";
    const risultato = [{ nome: "/", percorso: "/" }];
    for (const parte of testo.split("/").filter(Boolean)) {
      accumulato = accumulato === "/" ? "/" + parte : accumulato + "/" + parte;
      risultato.push({ nome: parte, percorso: accumulato });
    }
    return risultato;
  }
  return [{ nome: testo || "Home", percorso: testo }];
}

function aggiornaSelezioneExplorer(stato, cartella) {
  if (!cartella?.percorso) return;
  stato.selezionata = cartella;
  for (const bottone of stato.lista.querySelectorAll(".esplora-cartella")) {
    const selezionata = stessoPercorsoExplorer(bottone.dataset.percorso, cartella.percorso);
    bottone.setAttribute("aria-pressed", String(selezionata));
    bottone.closest(".esplora-riga")?.classList.toggle("selezionata", selezionata);
  }
  stato.nomeSelezione.textContent = cartella.nome || cartella.percorso;
  stato.percorsoSelezione.textContent = cartella.percorso;
  const nellaCorrente = stessoPercorsoExplorer(cartella.percorso, stato.dati?.percorso);
  stato.entra.disabled = nellaCorrente;
  stato.entra.title = nellaCorrente
    ? "Sei gia dentro questa cartella"
    : `Mostra il contenuto di ${cartella.nome || cartella.percorso}`;
  stato.apri.disabled = false;
  stato.apri.title = `Apri ${cartella.percorso} in una nuova scheda`;
  stato.annuncio.textContent = `Cartella selezionata: ${cartella.nome || cartella.percorso}`;
}

function aggiornaBreadcrumbExplorer(stato) {
  const elenco = crea("ol");
  const segmenti = segmentiPercorsoExplorer(stato.dati.percorso);
  for (const [indice, segmento] of segmenti.entries()) {
    const voce = crea("li");
    if (indice) voce.appendChild(crea("span", "esplora-separatore", "›"));
    if (indice === segmenti.length - 1) {
      const corrente = crea("span", "esplora-breadcrumb-corrente", segmento.nome);
      corrente.setAttribute("aria-current", "location");
      voce.appendChild(corrente);
    } else {
      const bottone = crea("button", "esplora-breadcrumb", segmento.nome);
      bottone.type = "button";
      bottone.dataset.navigaCartella = "true";
      bottone.setAttribute("aria-label", `Vai a ${segmento.percorso}`);
      bottone.onclick = () => disegnaSfoglia(stato, segmento.percorso, { focusElenco: true });
      voce.appendChild(bottone);
    }
    elenco.appendChild(voce);
  }
  stato.breadcrumb.replaceChildren(elenco);
}

function aggiungiGruppoPuntiExplorer(stato, titolo, voci) {
  if (!voci.length) return;
  const gruppo = crea("section", "esplora-gruppo-rapido");
  gruppo.appendChild(crea("h4", null, titolo));
  const elenco = crea("div", "esplora-scorciatoie");
  for (const voce of voci) {
    const bottone = crea("button", "esplora-scorciatoia");
    bottone.type = "button";
    bottone.dataset.navigaCartella = "true";
    bottone.title = voce.percorsi[0];
    bottone.setAttribute("aria-label", `Vai a ${voce.nome}`);
    if (voce.percorsi.some((percorso) => stessoPercorsoExplorer(percorso, stato.dati?.percorso))) {
      bottone.setAttribute("aria-current", "location");
    }
    const icona = crea("span", "esplora-scorciatoia-icona", voce.icona);
    icona.setAttribute("aria-hidden", "true");
    bottone.append(icona, crea("span", null, voce.nome));
    bottone.onclick = () => disegnaSfoglia(stato, voce.percorsi, { focusElenco: true });
    elenco.appendChild(bottone);
  }
  gruppo.appendChild(elenco);
  stato.punti.appendChild(gruppo);
}

function aggiornaPuntiExplorer(stato) {
  stato.punti.replaceChildren();
  const gruppi = puntiRapidiExplorer(stato.dati);
  aggiungiGruppoPuntiExplorer(stato, "Punti rapidi", gruppi.rapidi);
  aggiungiGruppoPuntiExplorer(stato, "Unita", gruppi.unita);
  aggiungiGruppoPuntiExplorer(stato, "Preferite", gruppi.preferite);
}

function spostaFocusExplorer(stato, bottone, spostamento) {
  const cartelle = [...stato.lista.querySelectorAll(".esplora-cartella")];
  const indice = cartelle.indexOf(bottone);
  if (indice < 0 || !cartelle.length) return;
  const prossimo = spostamento === "inizio"
    ? 0
    : spostamento === "fine"
      ? cartelle.length - 1
      : Math.max(0, Math.min(cartelle.length - 1, indice + spostamento));
  cartelle[prossimo].focus();
}

function aggiornaListaExplorer(stato) {
  stato.lista.replaceChildren();
  const cartelle = stato.dati.cartelle || [];
  for (const cartella of cartelle) {
    const riga = crea("div", "esplora-riga");
    riga.setAttribute("role", "listitem");
    const seleziona = crea("button", "esplora-cartella");
    seleziona.type = "button";
    seleziona.dataset.percorso = cartella.percorso;
    seleziona.setAttribute("aria-pressed", "false");
    seleziona.setAttribute("aria-label", `Seleziona la cartella ${cartella.nome}`);
    const icona = crea("span", "esplora-cartella-icona", "📁");
    icona.setAttribute("aria-hidden", "true");
    const testo = crea("span", "esplora-cartella-testo");
    testo.append(crea("strong", null, cartella.nome), crea("small", null, cartella.percorso));
    seleziona.append(icona, testo);
    seleziona.onclick = () => aggiornaSelezioneExplorer(stato, cartella);
    seleziona.ondblclick = () => disegnaSfoglia(stato, cartella.percorso, { focusElenco: true });
    seleziona.onkeydown = (evento) => {
      if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
        evento.preventDefault();
        spostaFocusExplorer(stato, seleziona, evento.key === "ArrowDown" ? 1 : -1);
      } else if (evento.key === "Home" || evento.key === "End") {
        evento.preventDefault();
        spostaFocusExplorer(stato, seleziona, evento.key === "Home" ? "inizio" : "fine");
      } else if (evento.key === "ArrowRight") {
        evento.preventDefault();
        disegnaSfoglia(stato, cartella.percorso, { focusElenco: true });
      }
    };
    const entra = crea("button", "esplora-entra", "Entra");
    entra.type = "button";
    entra.dataset.navigaCartella = "true";
    entra.setAttribute("aria-label", `Entra nella cartella ${cartella.nome}`);
    entra.onclick = () => disegnaSfoglia(stato, cartella.percorso, { focusElenco: true });
    riga.append(seleziona, entra);
    stato.lista.appendChild(riga);
  }
  if (!cartelle.length) {
    const vuota = crea("div", "esplora-vuota");
    vuota.append(crea("span", null, "📂"), crea("p", null, "Questa cartella non contiene sottocartelle."));
    stato.lista.appendChild(vuota);
  }
}

function impostaCaricamentoExplorer(stato, caricamento) {
  stato.caricamento = caricamento;
  stato.principale.setAttribute("aria-busy", String(caricamento));
  stato.esploratore.classList.toggle("caricamento", caricamento);
  for (const controllo of stato.esploratore.querySelectorAll("[data-naviga-cartella]")) {
    controllo.disabled = caricamento;
  }
  stato.vai.disabled = caricamento;
  stato.su.disabled = caricamento || !stato.dati?.genitore;
  stato.aggiorna.disabled = caricamento || !stato.dati?.percorso;
  stato.entra.disabled = caricamento
    || !stato.selezionata?.percorso
    || stessoPercorsoExplorer(stato.selezionata.percorso, stato.dati?.percorso);
  stato.apri.disabled = caricamento || !stato.selezionata?.percorso;
  if (caricamento) stato.annuncio.textContent = "Carico le cartelle…";
}

function applicaCartellaExplorer(stato, dati, { focusElenco = false } = {}) {
  stato.dati = dati;
  stato.campo.value = dati.percorso;
  stato.errore.hidden = true;
  stato.errore.textContent = "";
  stato.titoloCorrente.textContent = dati.nome || dati.percorso;
  stato.titoloCorrente.title = dati.percorso;
  stato.su.title = dati.genitore ? `Vai alla cartella superiore: ${dati.genitore}` : "Nessuna cartella superiore";
  aggiornaBreadcrumbExplorer(stato);
  aggiornaPuntiExplorer(stato);
  aggiornaListaExplorer(stato);
  aggiornaSelezioneExplorer(stato, { nome: dati.nome, percorso: dati.percorso });
  impostaCaricamentoExplorer(stato, false);
  stato.annuncio.textContent = `${dati.cartelle?.length || 0} sottocartelle in ${dati.nome || dati.percorso}.`;
  if (focusElenco) {
    requestAnimationFrame(() => (stato.lista.querySelector(".esplora-cartella") || stato.titoloCorrente).focus());
  }
}

async function disegnaSfoglia(stato, percorso, { focusElenco = false } = {}) {
  const richiesta = ++stato.richiesta;
  const candidati = Array.isArray(percorso) ? percorso : [percorso];
  const percorsiValidi = percorsiExplorerUnici(candidati);
  const tentativi = percorsiValidi.length ? percorsiValidi : [""];
  impostaCaricamentoExplorer(stato, true);
  let ultimoErrore = null;
  for (const candidato of tentativi) {
    try {
      const dati = await chiedi("/api/sfoglia", { corpo: { percorso: candidato || "" } });
      if (richiesta !== stato.richiesta || APP.modale !== stato.modale) return;
      applicaCartellaExplorer(stato, dati, { focusElenco });
      return;
    } catch (errore) {
      ultimoErrore = errore;
      if (richiesta !== stato.richiesta || APP.modale !== stato.modale) return;
    }
  }
  impostaCaricamentoExplorer(stato, false);
  stato.errore.hidden = false;
  stato.errore.textContent = testoErrore(ultimoErrore);
  stato.annuncio.textContent = "Non riesco ad aprire il percorso indicato.";
  stato.campo.focus();
  stato.campo.select();
}

async function apriSceltaCartella(percorsoIniziale) {
  const corpo = apriModale("Apri una cartella in una nuova scheda", { larga: true });
  DOM.modale.classList.add("modale-esplora-cartelle");
  const introduzione = crea(
    "p",
    "nota esplora-introduzione",
    "Esplora le cartelle, selezionane una e aprila senza chiudere il lavoro attuale.",
  );
  introduzione.id = "esplora-descrizione";
  DOM.modale.setAttribute("aria-describedby", introduzione.id);

  const esploratore = crea("div", "esplora-cartelle");
  const laterale = crea("aside", "esplora-laterale");
  laterale.setAttribute("aria-label", "Posizioni disponibili");
  const punti = crea("div", "esplora-punti");
  laterale.appendChild(punti);

  const principale = crea("section", "esplora-principale");
  principale.setAttribute("aria-label", "Esplora cartelle");
  const barraPercorso = crea("div", "esplora-barra-percorso");
  const su = crea("button", "esplora-su", "↑");
  su.type = "button";
  su.dataset.navigaCartella = "true";
  su.setAttribute("aria-label", "Vai alla cartella superiore");
  const aggiorna = crea("button", "esplora-su", "↻");
  aggiorna.type = "button";
  aggiorna.dataset.navigaCartella = "true";
  aggiorna.setAttribute("aria-label", "Aggiorna elenco cartelle");
  const labelCampo = crea("label", "solo-lettori", "Percorso manuale della cartella");
  labelCampo.htmlFor = "esplora-percorso-manuale";
  const campo = crea("input", "campo esplora-percorso");
  campo.id = "esplora-percorso-manuale";
  campo.autocomplete = "off";
  campo.spellcheck = false;
  const vai = crea("button", "bottone", "Vai");
  vai.type = "button";
  vai.dataset.navigaCartella = "true";
  barraPercorso.append(su, aggiorna, labelCampo, campo, vai);

  const breadcrumb = crea("nav", "esplora-breadcrumbs");
  breadcrumb.setAttribute("aria-label", "Percorso corrente");
  const testaLista = crea("div", "esplora-testa-lista");
  const titoloCorrente = crea("h4", null, "Cartelle");
  titoloCorrente.tabIndex = -1;
  testaLista.append(
    titoloCorrente,
    crea("small", null, "Un clic seleziona · doppio clic o Entra naviga"),
  );
  const errore = crea("p", "esplora-errore");
  errore.setAttribute("role", "alert");
  errore.hidden = true;
  const lista = crea("div", "esplora-lista");
  lista.setAttribute("role", "list");
  lista.setAttribute("aria-label", "Sottocartelle");
  const annuncio = crea("div", "solo-lettori");
  annuncio.setAttribute("role", "status");
  annuncio.setAttribute("aria-live", "polite");
  annuncio.setAttribute("aria-atomic", "true");

  const selezione = crea("div", "esplora-selezione");
  const riepilogo = crea("div", "esplora-riepilogo");
  riepilogo.appendChild(crea("small", null, "Cartella selezionata"));
  const nomeSelezione = crea("strong", null, "Nessuna");
  const percorsoSelezione = crea("span", null, "");
  riepilogo.append(nomeSelezione, percorsoSelezione);
  const azioni = crea("div", "esplora-azioni");
  const entra = crea("button", "bottone", "Entra nella cartella");
  entra.type = "button";
  entra.dataset.navigaCartella = "true";
  entra.disabled = true;
  const apri = crea("button", "bottone primario", "Apri cartella selezionata");
  apri.type = "button";
  apri.disabled = true;
  azioni.append(entra, apri);
  selezione.append(riepilogo, azioni);

  const fiducia = crea("input");
  fiducia.type = "checkbox";
  fiducia.id = "esplora-fiducia-cartella";
  fiducia.checked = false;
  const rigaFiducia = crea("label", "riga-impostazione esplora-fiducia");
  rigaFiducia.htmlFor = fiducia.id;
  rigaFiducia.append(
    crea("span", null, "Usa anche istruzioni, skill e risorse contenute nella cartella"),
    fiducia,
  );
  rigaFiducia.title = "Attiva solo per cartelle di cui ti fidi";
  const notaFiducia = crea(
    "p",
    "nota esplora-nota-fiducia",
    "Attiva l'opzione solo per cartelle fidate: le istruzioni locali possono guidare PI a usare strumenti con i tuoi permessi.",
  );

  principale.append(
    barraPercorso,
    breadcrumb,
    testaLista,
    errore,
    lista,
    annuncio,
    selezione,
    rigaFiducia,
    notaFiducia,
  );
  esploratore.append(laterale, principale);
  corpo.append(introduzione, esploratore);

  const stato = {
    modale: APP.modale,
    richiesta: 0,
    caricamento: false,
    dati: null,
    selezionata: null,
    esploratore,
    punti,
    principale,
    campo,
    vai,
    su,
    aggiorna,
    breadcrumb,
    titoloCorrente,
    errore,
    lista,
    annuncio,
    nomeSelezione,
    percorsoSelezione,
    entra,
    apri,
    fiducia,
  };
  const navigaManuale = () => disegnaSfoglia(stato, campo.value.trim(), { focusElenco: true });
  vai.onclick = navigaManuale;
  campo.onkeydown = (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      navigaManuale();
    }
  };
  su.onclick = () => stato.dati?.genitore
    && disegnaSfoglia(stato, stato.dati.genitore, { focusElenco: true });
  aggiorna.onclick = () => stato.dati?.percorso
    && disegnaSfoglia(stato, stato.dati.percorso, { focusElenco: true });
  entra.onclick = () => stato.selezionata?.percorso
    && disegnaSfoglia(stato, stato.selezionata.percorso, { focusElenco: true });
  apri.onclick = () => stato.selezionata?.percorso
    && avviaSessione(stato.selezionata.percorso, { approvaProgetto: fiducia.checked });
  principale.onkeydown = (evento) => {
    if (evento.altKey && evento.key === "ArrowUp" && stato.dati?.genitore) {
      evento.preventDefault();
      disegnaSfoglia(stato, stato.dati.genitore, { focusElenco: true });
    }
  };

  const partenza = percorsoIniziale
    || sessioneAttiva()?.cartella
    || APP.preferite[0]?.percorso
    || cartellaPersonaleExplorer()
    || APP.radici[0]?.percorso
    || "";
  await disegnaSfoglia(stato, partenza);
}

async function avviaSessione(
  percorso,
  {
    sessionPath = null,
    forzaNuova = false,
    approvaProgetto = false,
    senzaCartella = false,
  } = {},
) {
  if (APP.avvioSessioneInCorso) {
    toast("Sto gia aprendo una conversazione. Attendi il completamento.", "avviso");
    return;
  }
  APP.avvioSessioneInCorso = true;
  const modaleOrigine = APP.modale;
  const precedente = sessioneAttiva();
  let providerNonDisponibile = null;
  const providerPrecedente = precedente?.provider
    && !["unknown", "—"].includes(String(precedente.provider).toLowerCase())
    ? precedente.provider
    : null;
  const modelloPrecedente = precedente?.modello
    && !["unknown", "—"].includes(String(precedente.modello).toLowerCase())
    ? precedente.modello
    : null;
  let preferenza = sessionPath
    ? {}
    : {
        provider: providerPrecedente && modelloPrecedente ? providerPrecedente : undefined,
        modello: providerPrecedente && modelloPrecedente ? modelloPrecedente : undefined,
        ragionamento: precedente?.ragionamento || undefined,
      };
  if (!sessionPath && providerPrecedente && providerLocale(providerPrecedente)) {
    try {
      const controllo = await chiedi("/api/provider-locali", {
        corpo: { providers: [providerPrecedente] },
      });
      const stato = controllo.providers?.[providerPrecedente];
      if (stato?.controllato && !stato.disponibile) {
        providerNonDisponibile = stato.nome || nomeProviderVisuale(providerPrecedente);
        preferenza = { ragionamento: precedente?.ragionamento || undefined };
      }
    } catch {
      // Il controllo preventivo e un aiuto: il ponte valida comunque il prompt.
    }
  }
  avvisa(senzaCartella
    ? "Avvio una conversazione senza cartella…"
    : "Apro la cartella senza chiudere il lavoro attuale…");
  try {
    const esito = await chiedi("/api/avvia", {
      corpo: {
        cartella: percorso,
        sessionPath,
        forzaNuova,
        approvaProgetto,
        senzaCartella,
        ...preferenza,
      },
    });
    if (APP.modale === modaleOrigine) chiudiModale({ annulla: false });
    await aggiornaDalPonte();
    const sessione = APP.sessioni.get(esito.id);
    if (!sessione) throw new Error("La nuova sessione non compare nel ponte");
    attivaSessione(sessione.id);
    await sincronizzaSessione(sessione, { silenzioso: false });
    if (providerNonDisponibile) {
      toast(`${providerNonDisponibile} non e in esecuzione: la nuova conversazione usa il modello predefinito.`, "avviso");
    } else if (esito.esistente && sessionPath) {
      toast(
        "Questa conversazione e gia aperta: sono passato alla sua scheda."
          + (sessione.inEsecuzione && !sessione.messaggiSincronizzati
            ? " Pi sta lavorando: la cronologia riapparira automaticamente appena termina."
            : ""),
        "avviso",
      );
    } else if (senzaCartella) {
      toast(esito.esistente
        ? "La conversazione senza cartella era gia aperta."
        : "Nuova conversazione pronta, senza cartella obbligatoria.");
    } else {
      toast(esito.esistente ? "Questa cartella era gia aperta: sono passato alla sua scheda." : "Cartella aperta in una nuova scheda.");
    }
  } catch (errore) {
    toast(testoErrore(errore), "errore");
  } finally {
    APP.avvioSessioneInCorso = false;
    avvisa("");
  }
}

async function apriConversazioniSalvate() {
  const corpo = apriModale("Conversazioni salvate", { larga: true });
  corpo.appendChild(crea(
    "p",
    "nota",
    "Una conversazione non ancora aperta crea una nuova scheda. Se e gia aperta, la GUI passa alla scheda esistente senza duplicare il file.",
  ));
  const ricerca = crea("input", "campo");
  ricerca.placeholder = "Cerca per titolo, cartella o primo messaggio";
  ricerca.setAttribute("aria-label", "Cerca conversazioni salvate");
  corpo.appendChild(ricerca);
  const fiducia = crea("label", "riga-impostazione");
  const checkboxFiducia = crea("input");
  checkboxFiducia.type = "checkbox";
  fiducia.appendChild(
    crea("span", null, "Carica istruzioni, skill e risorse locali quando riapro la conversazione"),
  );
  fiducia.appendChild(checkboxFiducia);
  corpo.appendChild(fiducia);
  corpo.appendChild(
    crea("p", "nota", "Lascia disattivato se non conosci o non consideri affidabile la cartella."),
  );
  const lista = crea("div", "lista");
  lista.appendChild(crea("p", "nota", "Cerco le conversazioni…"));
  corpo.appendChild(lista);

  let salvate = [];
  try {
    salvate = (await chiedi("/api/sessioni-salvate", { corpo: {} })).sessioni || [];
  } catch (errore) {
    lista.replaceChildren(crea("p", "nota", testoErrore(errore)));
    return;
  }

  const disegna = () => {
    const filtro = ricerca.value.trim().toLowerCase();
    lista.replaceChildren();
    const visibili = salvate.filter((sessione) =>
      [sessione.nome, sessione.cwd, sessione.primoMessaggio]
        .filter(Boolean)
        .some((valore) => String(valore).toLowerCase().includes(filtro)),
    );
    for (const sessione of visibili) {
      if (!sessione.cwd && !sessione.senzaCartella) continue;
      const bottone = crea("button", "voce sessione-salvata");
      bottone.type = "button";
      bottone.appendChild(crea("span", "ico", "🕘"));
      const testo = crea("span", "voce-testo");
      testo.appendChild(
        crea("strong", null, sessione.nome || sessione.primoMessaggio || "Conversazione senza titolo"),
      );
      const contesto = sessione.senzaCartella ? "Senza cartella" : sessione.cwd;
      testo.appendChild(crea("small", null, `${contesto} · ${dataBreve(sessione.modificataIl)}`));
      const giaAperta = [...APP.sessioni.values()].find((aperta) =>
        aperta.fileSessione
        && stessoPercorsoExplorer(aperta.fileSessione, sessione.percorso)
      );
      if (giaAperta) {
        testo.appendChild(crea(
          "small",
          "sessione-gia-aperta",
          giaAperta.inEsecuzione ? "Gia aperta · Pi sta lavorando" : "Gia aperta",
        ));
      }
      bottone.appendChild(testo);
      bottone.onclick = () => {
        if (giaAperta) {
          chiudiModale({ annulla: false });
          attivaSessione(giaAperta.id);
          void sincronizzaSessione(giaAperta, { silenzioso: false });
          toast(
            "Questa conversazione e gia aperta: sono passato alla sua scheda."
              + (giaAperta.inEsecuzione && !giaAperta.messaggiSincronizzati
                ? " La cronologia riapparira automaticamente appena Pi termina."
                : ""),
            "avviso",
          );
          return;
        }
        void avviaSessione(sessione.cwd, {
          sessionPath: sessione.percorso,
          forzaNuova: true,
          approvaProgetto: checkboxFiducia.checked,
          senzaCartella: Boolean(sessione.senzaCartella),
        });
      };
      lista.appendChild(bottone);
    }
    if (!lista.children.length) lista.appendChild(crea("p", "vuoto", "Nessuna conversazione corrisponde alla ricerca."));
  };
  ricerca.oninput = disegna;
  disegna();
  requestAnimationFrame(() => ricerca.focus());
}

async function apriRipresaConversazione(sessioneCorrente, operazione, filtroIniziale = "") {
  const mostraElenco = async () => {
    const corpo = apriModale("Riprendi una conversazione", {
      larga: true,
      onCancel: () => operazione?.annulla(),
    });
    corpo.appendChild(crea(
      "p",
      "nota",
      "Scegli prima la conversazione. Nel passaggio successivo decidi esplicitamente se usare una nuova scheda o sostituire questa.",
    ));
    const ricerca = crea("input", "campo");
    ricerca.placeholder = "Cerca per titolo, cartella o primo messaggio";
    ricerca.setAttribute("aria-label", "Cerca una conversazione da riprendere");
    ricerca.value = String(filtroIniziale || "");
    const lista = crea("div", "lista");
    lista.appendChild(crea("p", "nota", "Cerco le conversazioni…"));
    corpo.append(ricerca, lista);
    let salvate;
    try {
      salvate = (await chiedi("/api/sessioni-salvate", { corpo: {} })).sessioni || [];
    } catch (errore) {
      operazione?.fallisce(errore);
      lista.replaceChildren(crea("p", "avviso-sicurezza", testoErrore(errore)));
      return;
    }
    const scegliModalita = (salvata) => {
      chiudiModale({ annulla: false, continuaCoda: false });
      const scelta = apriModale("Come vuoi riprendere la conversazione?", {
        onCancel: () => operazione?.annulla(),
      });
      scelta.append(
        crea("div", "percorso-attuale", salvata.percorso || salvata.cwd),
        crea("p", "nota", "Nessuna scelta viene fatta automaticamente, anche se tutte le schede disponibili sono gia occupate."),
      );
      const azioni = crea("div", "lista");
      const nuova = crea("button", "voce");
      nuova.type = "button";
      nuova.append(crea("span", "ico", "+"));
      const testoNuova = crea("span", "voce-testo");
      testoNuova.append(
        crea("strong", null, "Apri in una nuova scheda"),
        crea("small", null, "Mantiene intatta la conversazione di questa scheda; richiede uno slot libero."),
      );
      nuova.appendChild(testoNuova);
      const questa = crea("button", "voce");
      questa.type = "button";
      questa.append(crea("span", "ico", "↺"));
      const testoQuesta = crea("span", "voce-testo");
      testoQuesta.append(
        crea("strong", null, "Riprendi in questa scheda"),
        crea("small", null, "Pi sostituisce qui la cronologia corrente, come /resume nel terminale."),
      );
      questa.appendChild(testoQuesta);
      const modalitaCompatibile = !salvata.senzaCartella
        && !sessioneCorrente.senzaCartella
        && salvata.cwd === sessioneCorrente.cartella;
      questa.disabled = !modalitaCompatibile;
      if (!modalitaCompatibile) {
        questa.title = "Un contesto di lavoro diverso si apre in una nuova scheda.";
        testoQuesta.querySelector("small").textContent =
          "Non disponibile per un contesto diverso: usa una nuova scheda.";
      }
      const indietro = bottoneAzione("Torna all'elenco", () => {
        chiudiModale({ annulla: false, continuaCoda: false });
        void mostraElenco();
      });
      const eseguiScelta = async (modalita) => {
        nuova.disabled = true;
        questa.disabled = true;
        try {
          if (modalita === "questa") {
            let esito;
            if (operazione) {
              esito = await operazione.rpc(
                { type: "switch_session", sessionPath: salvata.percorso },
                { timeout: 60000, step: "resume:switch" },
              );
            } else {
              esito = await rpc(
                { type: "switch_session", sessionPath: salvata.percorso },
                { sessionId: sessioneCorrente.id, timeout: 60000 },
              );
            }
            if (esito?.cancelled || esito?.aborted) {
              operazione?.annullaConfermato();
              toast("Ripresa annullata da Pi.", "avviso");
              return;
            }
            operazione?.completa();
            chiudiModale({ annulla: false });
            await sincronizzaSessione(sessioneCorrente, { silenzioso: false });
            toast("Conversazione ripresa in questa scheda.");
          } else {
            const operationId = operazione
              ? operazione.preparaPasso("resume:new-tab").operationId
              : null;
            const corpoAvvio = {
                sessionId: sessioneCorrente.id,
                cartella: salvata.cwd,
                sessionPath: salvata.percorso,
                forzaNuova: true,
                senzaCartella: Boolean(salvata.senzaCartella),
                ...(operationId ? { operationId } : {}),
            };
            const esito = operationId
              ? await chiediOperazioneIdempotente("/api/avvia", corpoAvvio, {
                  sessionId: sessioneCorrente.id,
                  operationId,
                  timeout: 60000,
                })
              : await chiedi("/api/avvia", { corpo: corpoAvvio });
            operazione?.completa();
            chiudiModale({ annulla: false });
            await aggiornaDalPonte();
            if (APP.sessioni.has(esito.id)) attivaSessione(esito.id);
            toast("Conversazione aperta in una nuova scheda.");
          }
        } catch (errore) {
          operazione?.fallisce(errore);
          nuova.disabled = false;
          questa.disabled = false;
          toast(testoErrore(errore), "errore");
        }
      };
      nuova.onclick = () => eseguiScelta("nuova");
      questa.onclick = () => eseguiScelta("questa");
      azioni.append(nuova, questa);
      scelta.append(azioni, indietro);
    };
    const disegna = () => {
      const filtro = ricerca.value.trim().toLowerCase();
      lista.replaceChildren();
      for (const salvata of salvate.filter((voce) =>
        [voce.nome, voce.cwd, voce.primoMessaggio]
          .filter(Boolean)
          .some((valore) => String(valore).toLowerCase().includes(filtro)))) {
        if ((!salvata.cwd && !salvata.senzaCartella) || !salvata.percorso) continue;
        const bottone = crea("button", "voce sessione-salvata");
        bottone.type = "button";
        bottone.append(crea("span", "ico", "🕘"));
        const testo = crea("span", "voce-testo");
        testo.append(
          crea("strong", null, salvata.nome || salvata.primoMessaggio || "Conversazione senza titolo"),
          crea(
            "small",
            null,
            `${salvata.senzaCartella ? "Senza cartella" : salvata.cwd} · ${dataBreve(salvata.modificataIl)}`,
          ),
        );
        bottone.appendChild(testo);
        bottone.onclick = () => scegliModalita(salvata);
        lista.appendChild(bottone);
      }
      if (!lista.children.length) lista.appendChild(crea("p", "vuoto", "Nessuna conversazione corrisponde alla ricerca."));
    };
    ricerca.oninput = disegna;
    disegna();
    requestAnimationFrame(() => ricerca.focus());
  };
  await mostraElenco();
}

// ---------------------------------------------------------------------------
// Modello, ragionamento e comandi/skill
// ---------------------------------------------------------------------------

function providerLocale(provider) {
  return ["lmstudio", "ollama", "llama.cpp"].includes(provider);
}

function modelloLocale(modello) {
  return providerLocale(modello.provider);
}

function nomeProviderVisuale(provider) {
  if (provider === "lmstudio") return "LM Studio";
  if (provider === "ollama") return "Ollama";
  if (provider === "llama.cpp") return "llama.cpp";
  return provider;
}

function nomeModello(modello) {
  return modello.name || modello.id;
}

function dettaglioModello(modello, statoProvider = null) {
  const parti = [nomeProviderVisuale(modello.provider)];
  if (statoProvider?.controllato) {
    parti.push(statoProvider.disponibile ? "pronto" : "non in esecuzione");
  }
  if (modello.contextWindow) parti.push(Math.round(modello.contextWindow / 1000) + "k contesto");
  if (modello.reasoning) parti.push("ragionamento");
  if (Array.isArray(modello.input) && modello.input.includes("image")) parti.push("immagini");
  if (modelloLocale(modello)) parti.push("dati sul PC");
  else parti.push("dati inviati in rete");
  return parti.join(" · ");
}

function ricordaModello(modello) {
  try {
    const chiave = modello.provider + "/" + modello.id;
    const correnti = JSON.parse(localStorage.getItem("pi-gui-modelli-recenti") || "[]");
    localStorage.setItem("pi-gui-modelli-recenti", JSON.stringify([chiave, ...correnti.filter((voce) => voce !== chiave)].slice(0, 6)));
  } catch {
    // Preferenza non essenziale.
  }
}

function preparaCatalogoModelliDinamico(sessione, titolo, { onCancel = null } = {}) {
  const snapshot = sessione.modelli.map((modello) => ({ ...modello }));
  const corpo = apriModale(titolo, { larga: true, onCancel });
  const modaleRichiesta = APP.modale;
  const stato = crea("div", "stato-caricamento-modelli");
  stato.setAttribute("role", "status");
  stato.setAttribute("aria-live", "polite");
  stato.append(
    crea("span", "spinner", ""),
    crea("p", "nota", "Aggiorno modelli e fornitori disponibili…"),
  );
  corpo.appendChild(stato);
  const risultato = {
    corpo,
    statiProvider: {},
    erroreAggiornamento: null,
    onAggiorna: null,
    aggiornamento: null,
  };
  risultato.aggiornamento = (async () => {
    let avvisi = [];
    try {
      const aggiornamento = await rpc(
        { type: "refresh_models" },
        { sessionId: sessione.id, timeout: 20_000 },
      );
      if (aggiornamento.timedOut || aggiornamento.aborted) {
        throw new Error(aggiornamento.timedOut
          ? "L'aggiornamento dei modelli ha superato 15 secondi"
          : "L'aggiornamento dei modelli e stato annullato");
      }
      avvisi = Array.isArray(aggiornamento.errors) ? aggiornamento.errors : [];
      const [catalogo] = await Promise.all([
        rpc({ type: "get_available_models" }, { sessionId: sessione.id }),
        rpc({ type: "get_state" }, { sessionId: sessione.id }),
        rpc({ type: "get_available_thinking_levels" }, { sessionId: sessione.id }),
      ]);
      if (Array.isArray(catalogo.models)) sessione.modelli = catalogo.models;
    } catch (errore) {
      sessione.modelli = snapshot;
      risultato.erroreAggiornamento = testoErrore(errore);
    }
    const providerDaControllare = [...new Set(
      sessione.modelli.filter(modelloLocale).map((modello) => modello.provider),
    )];
    if (providerDaControllare.length) {
      try {
        Object.assign(risultato.statiProvider, (await chiedi("/api/provider-locali", {
          corpo: { providers: providerDaControllare },
        })).providers || {});
      } catch {
        // La fotografia dei modelli resta valida; il ponte ricontrolla al prompt.
      }
    }
    if (APP.modale !== modaleRichiesta || APP.sessioni.get(sessione.id) !== sessione) return;
    stato.className = risultato.erroreAggiornamento ? "avviso-sicurezza" : "nota";
    stato.replaceChildren();
    stato.textContent = risultato.erroreAggiornamento
      ? `Aggiornamento non riuscito: ${risultato.erroreAggiornamento}. Mantengo la fotografia precedente senza cambiare la selezione.`
      : avvisi.length
        ? `${avvisi.length} fornitor${avvisi.length === 1 ? "e non ha" : "i non hanno"} risposto; gli altri modelli sono aggiornati.`
        : `Catalogo aggiornato: ${sessione.modelli.length} modelli disponibili.`;
    risultato.onAggiorna?.();
  })();
  return risultato;
}

async function apriSceltaModello(
  filtroIniziale = "",
  operazione = null,
  sessioneRichiesta = null,
) {
  const sessione = sessioneRichiesta || sessioneAttiva();
  if (!sessione) return;
  const preparazione = preparaCatalogoModelliDinamico(sessione, "Scegli il modello", {
    onCancel: () => operazione?.annulla(),
  });
  if (!preparazione) return;
  const { corpo } = preparazione;
  const involucroRicerca = crea("div", "ricerca-modelli");
  const ricerca = crea("input", "campo");
  ricerca.placeholder = "Cerca per nome o fornitore";
  ricerca.setAttribute("aria-label", "Cerca un modello");
  ricerca.value = String(filtroIniziale || "").trim();
  involucroRicerca.appendChild(ricerca);
  corpo.appendChild(involucroRicerca);
  const risultati = crea("div");
  corpo.appendChild(risultati);
  const statiProvider = preparazione.statiProvider;

  let recenti = [];
  try {
    recenti = JSON.parse(localStorage.getItem("pi-gui-modelli-recenti") || "[]");
  } catch {
    recenti = [];
  }

  const disegna = () => {
    risultati.replaceChildren();
    const filtro = ricerca.value.trim().toLowerCase();
    const modelli = sessione.modelli.filter((modello) =>
      [modello.name, modello.id, modello.provider].some((valore) => String(valore || "").toLowerCase().includes(filtro)),
    );
    const recente = (modello) => recenti.indexOf(modello.provider + "/" + modello.id);
    modelli.sort((a, b) => {
      const indiceA = recente(a);
      const indiceB = recente(b);
      const ar = a.provider === sessione.provider && a.id === sessione.modello ? -1 : indiceA >= 0 ? indiceA : 99;
      const br = b.provider === sessione.provider && b.id === sessione.modello ? -1 : indiceB >= 0 ? indiceB : 99;
      if (ar !== br) return ar - br;
      if (modelloLocale(a) !== modelloLocale(b)) return modelloLocale(a) ? -1 : 1;
      return nomeModello(a).localeCompare(nomeModello(b), "it");
    });
    if (!modelli.length) {
      risultati.appendChild(crea("p", "vuoto", sessione.modelli.length ? "Nessun modello trovato." : "Pi non ha restituito modelli disponibili."));
      return;
    }
    const lista = crea("div", "lista");
    for (const modello of modelli) {
      const bottone = crea("button", "voce");
      bottone.type = "button";
      const corrente = modello.provider === sessione.provider && modello.id === sessione.modello;
      const statoProvider = statiProvider[modello.provider] || null;
      const nonDisponibile = Boolean(
        modelloLocale(modello) && statoProvider?.controllato && !statoProvider.disponibile,
      );
      if (corrente) bottone.classList.add("attiva");
      bottone.setAttribute("aria-pressed", String(corrente));
      bottone.disabled = nonDisponibile;
      if (nonDisponibile) {
        bottone.classList.add("provider-offline");
        bottone.title = `${nomeProviderVisuale(modello.provider)} non e in esecuzione`;
      }
      bottone.appendChild(crea("span", "ico", modelloLocale(modello) ? "▣" : "☁"));
      const testo = crea("span", "voce-testo");
      testo.appendChild(crea("strong", null, nomeModello(modello)));
      testo.appendChild(crea("small", null, dettaglioModello(modello, statoProvider)));
      const pressioneContesto = pressioneContestoCambioModello(sessione, modello);
      if (pressioneContesto) {
        testo.appendChild(crea("small", "avviso-modello", pressioneContesto.testo));
      }
      bottone.appendChild(testo);
      const classeStato = nonDisponibile ? "offline" : modelloLocale(modello) ? "locale" : "cloud";
      const testoStato = nonDisponibile
        ? "non attivo"
        : statoProvider?.disponibile
          ? "pronto"
          : modelloLocale(modello)
            ? "locale"
            : "cloud";
      bottone.appendChild(crea("span", "etichetta " + classeStato, testoStato));
      bottone.onclick = async () => {
        bottone.disabled = true;
        avvisa("Cambio modello…");
        try {
          if (operazione) {
            await operazione.rpc(
              { type: "set_model", provider: modello.provider, modelId: modello.id },
            );
          } else {
            await rpc({ type: "set_model", provider: modello.provider, modelId: modello.id }, { sessionId: sessione.id });
          }
          ricordaModello(modello);
          await Promise.allSettled([
            rpc({ type: "get_state" }, { sessionId: sessione.id }),
            rpc({ type: "get_available_thinking_levels" }, { sessionId: sessione.id }),
          ]);
          operazione?.completa();
          chiudiModale({ annulla: false });
          toast(
            pressioneContesto
              ? `Modello cambiato: ${nomeModello(modello)}. Al prossimo invio Pi liberera spazio prima di rispondere; puo richiedere qualche minuto.`
              : "Modello cambiato: " + nomeModello(modello),
            pressioneContesto ? "avviso" : undefined,
          );
        } catch (errore) {
          operazione?.fallisce(errore);
          bottone.disabled = false;
          toast(spiegaErrorePi(testoErrore(errore), sessione), "errore");
        } finally {
          avvisa("");
        }
      };
      lista.appendChild(bottone);
    }
    risultati.appendChild(lista);
  };
  ricerca.oninput = disegna;
  preparazione.onAggiorna = disegna;
  disegna();
  requestAnimationFrame(() => ricerca.focus());
}

function apriSceltaRagionamento() {
  const sessione = sessioneAttiva();
  if (!sessione) return;
  const corpo = apriModale("Quanto deve ragionare");
  corpo.appendChild(crea("p", "nota", "Un livello piu alto puo migliorare i problemi complessi, ma richiede piu tempo e token."));
  const lista = crea("div", "lista");
  for (const livello of sessione.livelli.length ? sessione.livelli : ["off", "low", "medium", "high"]) {
    const bottone = crea("button", "voce");
    bottone.type = "button";
    const corrente = livello === sessione.ragionamento;
    if (corrente) bottone.classList.add("attiva");
    bottone.setAttribute("aria-pressed", String(corrente));
    bottone.appendChild(crea("span", "ico", "◉"));
    const testo = crea("span", "voce-testo");
    testo.appendChild(crea("strong", null, traduciLivello(livello)));
    bottone.appendChild(testo);
    bottone.onclick = async () => {
      bottone.disabled = true;
      try {
        await rpc({ type: "set_thinking_level", level: livello }, { sessionId: sessione.id });
        sessione.ragionamento = livello;
        chiudiModale({ annulla: false });
        aggiornaInterfacciaAttiva();
      } catch (errore) {
        bottone.disabled = false;
        toast(testoErrore(errore), "errore");
      }
    };
    lista.appendChild(bottone);
  }
  corpo.appendChild(lista);
}

function nomeComandoLeggibile(nome) {
  const pulito = String(nome || "comando").replace(/^skill:/, "").replace(/[-_]+/g, " ");
  return pulito.charAt(0).toUpperCase() + pulito.slice(1);
}

// Il catalogo e l'instradamento restano autorevoli nel ponte. Questa tabella
// traduce soltanto il testo mostrato per i built-in che pi espone davvero.
const TESTI_BUILTIN = Object.freeze({
  settings: ["Impostazioni", "Configura comportamento automatico, coda e altre preferenze di pi."],
  model: ["Modello", "Scegli il modello e il fornitore da usare."],
  "scoped-models": ["Modelli rapidi", "Configura i modelli disponibili nella selezione rapida."],
  export: ["Esporta", "Salva la conversazione in un file."],
  import: ["Importa", "Importa e riprendi una conversazione da un file JSONL."],
  share: ["Condividi", "Crea un collegamento condivisibile alla conversazione."],
  copy: ["Copia risposta", "Copia negli appunti l'ultima risposta di pi."],
  name: ["Rinomina", "Assegna un nome facile da riconoscere alla conversazione."],
  session: ["Dettagli sessione", "Mostra informazioni, utilizzo e statistiche della sessione."],
  changelog: ["Novita", "Mostra le novita della versione di pi installata."],
  hotkeys: ["Scorciatoie", "Mostra tutte le scorciatoie da tastiera di pi."],
  fork: ["Crea versione", "Riparti da un messaggio precedente mantenendo il lavoro corrente."],
  clone: ["Duplica", "Crea una copia della conversazione corrente."],
  tree: ["Albero", "Mostra i rami e il punto attuale della conversazione."],
  trust: ["Fiducia cartella", "Gestisci la fiducia per istruzioni, skill e risorse della cartella."],
  login: ["Accedi", "Accedi a un fornitore di modelli."],
  logout: ["Esci dall'account", "Disconnetti un fornitore di modelli."],
  new: ["Nuova conversazione", "Inizia una conversazione nuova nello stesso contesto di lavoro."],
  compact: ["Libera spazio", "Riassume la conversazione per liberare spazio nel contesto."],
  resume: ["Conversazioni salvate", "Scegli una conversazione precedente da riprendere."],
  reload: ["Ricarica", "Ricarica estensioni, skill, prompt, temi e configurazioni di pi."],
  quit: ["Chiudi sessione", "Chiudi questa sessione di pi."],
});

function descrizioneComando(comando) {
  if (comando.source === "builtin" && TESTI_BUILTIN[comando.name]) {
    return TESTI_BUILTIN[comando.name][1];
  }
  if (comando.description) return comando.description;
  if (comando.source === "skill") return "Usa questa competenza specializzata di pi.";
  if (comando.source === "prompt") return "Avvia questa procedura guidata.";
  if (comando.source === "extension") return "Comando fornito da un'estensione di pi.";
  return "Comando di pi.";
}

function titoloComando(comando) {
  return comando.source === "builtin" && TESTI_BUILTIN[comando.name]
    ? TESTI_BUILTIN[comando.name][0]
    : nomeComandoLeggibile(comando.name);
}

function impostaBozzaComposer(sessione, valore, { salvaSubito = false } = {}) {
  if (!sessione || APP.sessioni.get(sessione.id) !== sessione) return false;
  ramificaLineageBozza(sessione);
  sessione.bozza = String(valore ?? "");
  sessione.bozzaSporca = true;
  if (salvaSubito) salvaBozza(sessione);
  else programmaSalvaBozza(sessione);
  if (sessione.id === APP.attivaId) {
    DOM.input.value = sessione.bozza;
    adattaAltezza();
    aggiornaInterfacciaAttiva();
  }
  return true;
}

function trovaComandoPerChiave(sessione, chiave) {
  return sessione?.comandi.find((comando) => PALETTE_CORE.chiaveComando(comando) === chiave) || null;
}

function inserisciComandoNelComposer(
  sessionId,
  chiave,
  richiamo = null,
  { conservaBozzaComeArgomenti = false } = {},
) {
  const sessione = APP.sessioni.get(sessionId);
  if (!sessione || sessione.id !== APP.attivaId) return false;
  const comando = trovaComandoPerChiave(sessione, chiave);
  if (!comando) return false;
  const argomentiEsistenti = conservaBozzaComeArgomenti ? DOM.input.value.trim() : "";
  const completato = richiamo
    ? PALETTE_CORE.completaRichiamoComando(DOM.input.value, richiamo, comando)
    : {
        value: `/${comando.name}${argomentiEsistenti ? ` ${argomentiEsistenti}` : " "}`,
        caret: comando.name.length + 2 + argomentiEsistenti.length,
      };
  if (!completato || !impostaBozzaComposer(sessione, completato.value, { salvaSubito: true })) return false;
  DOM.input.focus();
  DOM.input.setSelectionRange(completato.caret, completato.caret);
  chiudiPaletteComandi();
  return true;
}

function bottoneComando(
  comando,
  sessioneRiferimento = sessioneAttiva(),
  { mostraDisponibilita = false, conservaBozzaComeArgomenti = false } = {},
) {
  const bottone = crea("button", "voce");
  bottone.type = "button";
  bottone.dataset.sorgenteComando = comando.source;
  bottone.dataset.disponibilitaComando = comando.availability || "gui";
  const icone = { skill: "◇", prompt: "▤", extension: "⚙" };
  bottone.appendChild(crea("span", "ico", icone[comando.source] || "›"));
  const testo = crea("span", "voce-testo");
  testo.appendChild(crea("strong", null, titoloComando(comando)));
  testo.appendChild(crea("small", null, `/${comando.name} · ${descrizioneComando(comando)}`));
  if (mostraDisponibilita) {
    const disponibilita = comando.availability === "terminal"
      ? "Richiede Pi completo nel terminale"
      : comando.availability === "unavailable"
        ? "Non disponibile in questa sessione"
        : "Disponibile nella GUI";
    testo.appendChild(crea(
      "small",
      `disponibilita-comando ${comando.availability || "gui"}`,
      disponibilita,
    ));
  }
  bottone.appendChild(testo);
  bottone.disabled = comando.availability === "unavailable";
  bottone.onclick = () => {
    if (!sessioneRiferimento) return;
    inserisciComandoNelComposer(
      sessioneRiferimento.id,
      PALETTE_CORE.chiaveComando(comando),
      null,
      { conservaBozzaComeArgomenti },
    );
    if (!DOM.velo.hidden) chiudiModale({ annulla: false });
    chiudiMenuLaterale();
  };
  return bottone;
}

function disegnaComandi(sessione) {
  DOM.listaComandi.replaceChildren();
  const utilizzabili = sessione.comandi.filter((comando) => ["skill", "prompt"].includes(comando.source));
  if (!utilizzabili.length) {
    DOM.notaComandi.textContent = sessione.ricaricaRisorseInCorso
      ? "Ricarico estensioni, skill, prompt, temi e configurazioni…"
      : sessione.sincronizzazione
        ? "Carico i comandi…"
        : "Nessun comando aggiuntivo in questa conversazione.";
    DOM.btnCercaComandi.hidden = true;
    return;
  }
  DOM.notaComandi.textContent = sessione.ricaricaRisorseInCorso
    ? "Ricarico le risorse di Pi; l'elenco corrente resta disponibile."
    : "Scegli una skill o procedura descritta in linguaggio naturale.";
  for (const comando of utilizzabili.slice(0, 8)) DOM.listaComandi.appendChild(bottoneComando(comando, sessione));
  DOM.btnCercaComandi.hidden = utilizzabili.length <= 8;
  DOM.btnCercaComandi.textContent = `Cerca (${utilizzabili.length})`;
}

async function ricaricaRisorsePi() {
  const sessione = sessioneAttiva();
  if (!sessione?.attiva || sessione.ricaricaRisorseInCorso) return false;
  if (
    sessione.inEsecuzione
    || sessione.invioInCorso
    || sessione.compattazioneInCorso
    || sessione.sincronizzazione
    || sessione.handoffInCorso
    || sessione.chiusuraInCorso
  ) {
    toast("Attendi che Pi sia pronto prima di ricaricare le risorse.", "avviso");
    return false;
  }
  const comando = trovaComandoCatalogo(sessione, "reload");
  if (!comando || comando.source !== "builtin") {
    toast("Questa versione di Pi non supporta il ricaricamento sicuro delle risorse.", "errore");
    return false;
  }

  // Il solo get_commands rilegge il catalogo gia in memoria. Il builtin reload
  // conserva la conversazione e ordina invece a Pi di riscoprire le risorse su
  // disco. Conserviamo lo snapshot visuale: un rifiuto non deve svuotare la UI.
  const snapshot = {
    comandi: sessione.comandi,
    revisioneCapacita: sessione.revisioneCapacita,
    capacitaComplete: sessione.capacitaComplete,
  };
  sessione.ricaricaRisorseInCorso = true;
  aggiornaInterfacciaAttiva();
  toast("Ricarico estensioni, skill, prompt, temi e configurazioni. La conversazione resta aperta.");
  try {
    await invocaComandoBuiltin(sessione, comando, "", "/reload");
    return true;
  } catch (errore) {
    sessione.comandi = snapshot.comandi;
    sessione.revisioneCapacita = snapshot.revisioneCapacita;
    sessione.capacitaComplete = snapshot.capacitaComplete;
    toast("Non sono riuscito a ricaricare le risorse di Pi: " + testoErrore(errore), "errore");
    return false;
  } finally {
    if (APP.sessioni.get(sessione.id) === sessione) {
      sessione.ricaricaRisorseInCorso = false;
      if (sessione.id === APP.attivaId) aggiornaInterfacciaAttiva();
    }
  }
}

function vociMenuAzioniComposer({ includiDisabilitate = false } = {}) {
  const voci = [...DOM.menuAzioniComposer.querySelectorAll("[role='menuitem']")];
  return includiDisabilitate ? voci : voci.filter((voce) => !voce.disabled);
}

function aggiornaFocusMenuAzioniComposer() {
  const voci = vociMenuAzioniComposer();
  APP.menuAzioniComposer.indiceAttivo = Math.max(
    0,
    Math.min(APP.menuAzioniComposer.indiceAttivo, Math.max(0, voci.length - 1)),
  );
  for (const voce of vociMenuAzioniComposer({ includiDisabilitate: true })) voce.tabIndex = -1;
  const attiva = voci[APP.menuAzioniComposer.indiceAttivo];
  if (attiva) attiva.tabIndex = 0;
  return attiva || null;
}

function chiudiMenuAzioniComposer({ ripristinaFocus = false } = {}) {
  if (!DOM.menuAzioniComposer) return;
  APP.menuAzioniComposer.aperto = false;
  DOM.menuAzioniComposer.hidden = true;
  DOM.btnAllega.setAttribute("aria-expanded", "false");
  for (const voce of vociMenuAzioniComposer({ includiDisabilitate: true })) voce.tabIndex = -1;
  if (ripristinaFocus && !DOM.btnAllega.disabled) DOM.btnAllega.focus();
}

function apriMenuAzioniComposer() {
  if (DOM.btnAllega.disabled || APP.menuAzioniComposer.aperto) return false;
  chiudiPaletteComandi();
  APP.menuAzioniComposer.aperto = true;
  APP.menuAzioniComposer.indiceAttivo = 0;
  DOM.menuAzioniComposer.hidden = false;
  DOM.btnAllega.setAttribute("aria-expanded", "true");
  const attiva = aggiornaFocusMenuAzioniComposer();
  requestAnimationFrame(() => attiva?.focus());
  return true;
}

function spostaFocusMenuAzioniComposer(movimento) {
  const voci = vociMenuAzioniComposer();
  if (!APP.menuAzioniComposer.aperto || !voci.length) return false;
  if (movimento === "inizio") APP.menuAzioniComposer.indiceAttivo = 0;
  else if (movimento === "fine") APP.menuAzioniComposer.indiceAttivo = voci.length - 1;
  else {
    APP.menuAzioniComposer.indiceAttivo = (
      APP.menuAzioniComposer.indiceAttivo + movimento + voci.length
    ) % voci.length;
  }
  aggiornaFocusMenuAzioniComposer()?.focus();
  return true;
}

async function eseguiAzioneMenuComposer(azione) {
  chiudiMenuAzioniComposer();
  if (azione === "allega-immagine") {
    DOM.scegliImmagini.click();
    return;
  }
  if (azione === "skill") {
    DOM.input.focus({ preventScroll: true });
    apriRicercaComandi({
      titolo: "Richiama una skill o procedura",
      etichettaRicerca: "Cerca skill e procedure",
      fonti: ["skill", "prompt"],
      conservaBozzaComeArgomenti: true,
      testoVuoto: "Nessuna skill o procedura disponibile in questa conversazione.",
    });
    return;
  }
  if (azione === "estensioni") {
    DOM.input.focus({ preventScroll: true });
    apriRicercaComandi({
      titolo: "Comandi delle estensioni",
      etichettaRicerca: "Cerca comandi delle estensioni",
      fonti: ["extension"],
      mostraDisponibilita: true,
      conservaBozzaComeArgomenti: true,
      testoVuoto: "Nessun comando estensione caricato. Dopo avere installato o configurato una risorsa, usa Ricarica dopo installazione.",
    });
    return;
  }
  if (azione === "ricarica") {
    DOM.btnAllega.focus({ preventScroll: true });
    await ricaricaRisorsePi();
  }
}

function apriRicercaComandi({
  titolo = "Comandi e skill di questa conversazione",
  etichettaRicerca = "Cerca comandi e skill",
  fonti = ["skill", "prompt"],
  mostraDisponibilita = false,
  conservaBozzaComeArgomenti = false,
  testoVuoto = "Nessun comando trovato.",
} = {}) {
  const sessione = sessioneAttiva();
  if (!sessione) return;
  const fontiConsentite = new Set(fonti);
  const corpo = apriModale(titolo);
  const ricerca = crea("input", "campo");
  ricerca.placeholder = "Cerca per nome o scopo";
  ricerca.setAttribute("aria-label", etichettaRicerca);
  corpo.appendChild(ricerca);
  const lista = crea("div", "lista");
  corpo.appendChild(lista);
  const disegna = () => {
    lista.replaceChildren();
    const risultati = PALETTE_CORE.filtraCatalogoComandi(
      sessione.comandi.filter((comando) => fontiConsentite.has(comando.source)),
      ricerca.value,
    );
    for (const comando of risultati) {
      lista.appendChild(bottoneComando(comando, sessione, {
        mostraDisponibilita,
        conservaBozzaComeArgomenti,
      }));
    }
    if (!risultati.length) lista.appendChild(crea("p", "vuoto", testoVuoto));
  };
  ricerca.oninput = disegna;
  disegna();
  requestAnimationFrame(() => ricerca.focus());
}

function chiudiPaletteComandi({ sopprimi = false } = {}) {
  const stato = APP.paletteComandi;
  if (sopprimi && stato.sessionId) {
    stato.soppressa = `${stato.sessionId}\u0000${DOM.input.value}\u0000${DOM.input.selectionStart}`;
  } else if (!sopprimi) {
    stato.soppressa = null;
  }
  stato.aperta = false;
  stato.sessionId = null;
  stato.query = "";
  stato.risultati = [];
  stato.indiceAttivo = 0;
  stato.revision = null;
  DOM.paletteComandi.hidden = true;
  DOM.listaPaletteComandi.replaceChildren();
  DOM.input.setAttribute("aria-expanded", "false");
  DOM.input.removeAttribute("aria-activedescendant");
  DOM.suggerimento.textContent = SUGGERIMENTO_PREDEFINITO;
}

function etichettaFonteComando(comando) {
  if (comando.availability === "terminal") return "terminale";
  if (comando.availability === "unavailable") return "non disponibile";
  return ({ builtin: "pi", skill: "skill", prompt: "procedura", extension: "estensione" })[comando.source]
    || comando.source;
}

function disegnaPaletteComandi(sessione, richiamo, risultati) {
  const stato = APP.paletteComandi;
  DOM.listaPaletteComandi.replaceChildren();
  const limitati = risultati.slice(0, 12);
  stato.risultati = limitati.map((comando) => PALETTE_CORE.chiaveComando(comando));
  stato.indiceAttivo = Math.max(0, Math.min(stato.indiceAttivo, Math.max(0, limitati.length - 1)));
  if (!limitati.length) {
    const testo = sessione.capacitaInCaricamento
      ? "Carico i comandi di pi…"
      : "Nessun comando corrispondente. Invio lo trattera come una normale richiesta.";
    DOM.listaPaletteComandi.appendChild(crea("p", "palette-vuota", testo));
  }
  limitati.forEach((comando, indice) => {
    const chiave = PALETTE_CORE.chiaveComando(comando);
    const opzione = crea("button", "palette-opzione");
    opzione.type = "button";
    opzione.id = `opzione-comando-${++contatoreOpzioniPalette}`;
    opzione.setAttribute("role", "option");
    opzione.setAttribute("aria-selected", String(indice === stato.indiceAttivo));
    opzione.dataset.chiaveComando = encodeURIComponent(chiave);
    if (comando.availability !== "gui") opzione.classList.add(comando.availability);
    const riga = crea("span", "palette-comando");
    riga.appendChild(crea("strong", null, `/${comando.name}`));
    if (comando.argumentHint) riga.appendChild(crea("span", null, comando.argumentHint));
    opzione.append(
      riga,
      crea("span", "palette-descrizione", descrizioneComando(comando)),
      crea("small", "palette-categoria", etichettaFonteComando(comando)),
    );
    opzione.onpointerdown = (evento) => evento.preventDefault();
    opzione.onclick = () => inserisciComandoNelComposer(sessione.id, chiave, richiamo);
    opzione.onmousemove = () => {
      if (stato.indiceAttivo === indice) return;
      stato.indiceAttivo = indice;
      aggiornaSelezionePalette();
    };
    DOM.listaPaletteComandi.appendChild(opzione);
  });
  DOM.statoPaletteComandi.textContent = `${risultati.length} ${risultati.length === 1 ? "risultato" : "risultati"}`;
  aggiornaSelezionePalette();
}

function aggiornaSelezionePalette() {
  const stato = APP.paletteComandi;
  const opzioni = [...DOM.listaPaletteComandi.querySelectorAll("[role='option']")];
  opzioni.forEach((opzione, indice) => opzione.setAttribute("aria-selected", String(indice === stato.indiceAttivo)));
  const attiva = opzioni[stato.indiceAttivo];
  if (attiva) {
    DOM.input.setAttribute("aria-activedescendant", attiva.id);
    attiva.scrollIntoView({ block: "nearest" });
  } else {
    DOM.input.removeAttribute("aria-activedescendant");
  }
}

function aggiornaPaletteComandi({ forza = false } = {}) {
  const sessione = sessioneAttiva();
  const richiamo = !DOM.input.disabled
    ? PALETTE_CORE.analizzaRichiamoComando(DOM.input.value, DOM.input.selectionStart, DOM.input.selectionEnd)
    : null;
  if (!sessione || !richiamo || !DOM.velo.hidden) {
    chiudiPaletteComandi();
    return false;
  }
  const firma = `${sessione.id}\u0000${DOM.input.value}\u0000${DOM.input.selectionStart}`;
  if (!forza && APP.paletteComandi.soppressa === firma) return false;
  chiudiMenuAzioniComposer();
  APP.paletteComandi.soppressa = null;
  const risultati = PALETTE_CORE.filtraCatalogoComandi(sessione.comandi, richiamo.query);
  const stessaRicerca = APP.paletteComandi.aperta
    && APP.paletteComandi.sessionId === sessione.id
    && APP.paletteComandi.query === richiamo.query
    && APP.paletteComandi.revision === sessione.revisioneCapacita;
  if (!stessaRicerca) APP.paletteComandi.indiceAttivo = 0;
  APP.paletteComandi.aperta = true;
  APP.paletteComandi.sessionId = sessione.id;
  APP.paletteComandi.query = richiamo.query;
  APP.paletteComandi.revision = sessione.revisioneCapacita;
  APP.paletteComandi.richiamo = richiamo;
  DOM.paletteComandi.hidden = false;
  DOM.input.setAttribute("aria-expanded", "true");
  DOM.suggerimento.textContent = "Frecce per scegliere · Tab o Invio per completare · Esc per chiudere";
  disegnaPaletteComandi(sessione, richiamo, risultati);
  return true;
}

function spostaSelezionePalette(movimento) {
  const stato = APP.paletteComandi;
  if (!stato.aperta || !stato.risultati.length) return false;
  if (movimento === "inizio") stato.indiceAttivo = 0;
  else if (movimento === "fine") stato.indiceAttivo = stato.risultati.length - 1;
  else stato.indiceAttivo = (stato.indiceAttivo + movimento + stato.risultati.length) % stato.risultati.length;
  aggiornaSelezionePalette();
  return true;
}

function completaSelezionePalette() {
  const stato = APP.paletteComandi;
  if (!stato.aperta || !stato.risultati.length) return false;
  return inserisciComandoNelComposer(stato.sessionId, stato.risultati[stato.indiceAttivo], stato.richiamo);
}

// ---------------------------------------------------------------------------
// Immagini e invio
// ---------------------------------------------------------------------------

function leggiImmagine(file) {
  return new Promise((risolvi, rifiuta) => {
    const lettore = new FileReader();
    lettore.onload = () => {
      const url = String(lettore.result);
      risolvi({
        id: globalThis.crypto.randomUUID(),
        nome: file.name,
        mimeType: file.type,
        data: url.slice(url.indexOf(",") + 1),
        url,
        dimensione: file.size,
      });
    };
    lettore.onerror = () => rifiuta(new Error("Non riesco a leggere " + file.name));
    lettore.readAsDataURL(file);
  });
}

async function aggiungiImmagini(file) {
  const sessione = sessioneAttiva();
  if (!sessione || sessione.handoffInCorso || sessione.chiusuraInCorso) return;
  const chiaveAttesa = sessione.chiaveBozza;
  await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
  if (
    sessioneAttiva() !== sessione
    || sessione.chiaveBozza !== chiaveAttesa
    || sessione.handoffInCorso
    || sessione.chiusuraInCorso
  ) return;
  const accettati = [...file].filter((voce) => /^image\/(png|jpeg|webp|gif)$/.test(voce.type));
  const dimensioneNuova = accettati.reduce((somma, voce) => somma + voce.size, 0);
  const totale = sessione.allegati.reduce((somma, voce) => somma + voce.dimensione, 0) + dimensioneNuova;
  if (sessione.allegati.length + accettati.length > 4) {
    toast("Puoi allegare al massimo quattro immagini per richiesta.", "avviso");
    return;
  }
  if (totale > LIMITE_IMMAGINI_RICHIESTA) {
    toast("Le immagini superano 4 MB complessivi. Riducile prima di inviarle.", "avviso");
    return;
  }
  const base64Prevista = Math.ceil(totale * 4 / 3);
  if (
    Number(sessione.byteImmaginiCronologia || 0) + base64Prevista
      > LIMITE_IMMAGINI_CRONOLOGIA_BASE64
  ) {
    toast(
      "La cronologia contiene gia molte immagini. Usa “Libera spazio”, poi allega la nuova immagine.",
      "avviso",
    );
    return;
  }
  try {
    const immagini = await Promise.all(accettati.map(leggiImmagine));
    if (
      APP.sessioni.get(sessione.id) !== sessione
      || sessione.chiaveBozza !== chiaveAttesa
    ) {
      toast("Nel frattempo e cambiata la conversazione: le immagini non sono state aggiunte.", "avviso");
      return;
    }
    if (sessione.handoffInCorso || sessione.chiusuraInCorso) {
      toast("La sessione si sta chiudendo: le immagini non sono state aggiunte.", "avviso");
      return;
    }
    const totaleAggiornato = sessione.allegati.reduce((somma, voce) => somma + voce.dimensione, 0) + dimensioneNuova;
    if (
      sessione.allegati.length + immagini.length > 4
      || totaleAggiornato > LIMITE_IMMAGINI_RICHIESTA
    ) {
      toast("Nel frattempo sono state aggiunte altre immagini: il limite e stato raggiunto.", "avviso");
      return;
    }
    ramificaLineageBozza(sessione);
    sessione.allegati.push(...immagini);
    void conservaAllegatiBozza(sessione);
    if (sessione.id === APP.attivaId) {
      disegnaAllegati();
      aggiornaInterfacciaAttiva();
    }
  } catch (errore) {
    toast(testoErrore(errore), "errore");
  }
}

function disegnaAllegati() {
  const sessione = sessioneAttiva();
  const allegati = sessione?.allegati || [];
  DOM.allegati.replaceChildren();
  DOM.allegati.hidden = !allegati.length;
  allegati.forEach((allegato, indice) => {
    const box = crea("div", "allegato");
    const img = document.createElement("img");
    img.src = allegato.url;
    img.alt = allegato.nome;
    const rimuovi = crea("button", null, "×");
    rimuovi.type = "button";
    rimuovi.setAttribute("aria-label", "Rimuovi " + allegato.nome);
    rimuovi.onclick = () => {
      ramificaLineageBozza(sessione);
      sessione.allegati.splice(indice, 1);
      void conservaAllegatiBozza(sessione);
      disegnaAllegati();
      aggiornaInterfacciaAttiva();
    };
    box.append(img, rimuovi);
    DOM.allegati.appendChild(box);
  });
}

function trovaComandoCatalogo(sessione, nome) {
  const corrispondenze = sessione?.comandi.filter((comando) => comando.name === nome) || [];
  return corrispondenze.find((comando) => comando.source === "builtin") || corrispondenze[0] || null;
}

function pulisciBozzaComando(sessione, fotografia) {
  if (
    APP.sessioni.get(sessione.id) !== sessione
    || sessione.bozza !== fotografia
    || (sessione.id === APP.attivaId && DOM.input.value !== fotografia)
  ) return false;
  clearTimeout(timerSalvaBozza.get(sessione.id));
  timerSalvaBozza.delete(sessione.id);
  sessione.bozza = "";
  sessione.bozzaSporca = true;
  sessione.lineageId = null;
  sessione.lineageModificataLocalmente = false;
  salvaBozza(sessione);
  if (sessione.id === APP.attivaId) {
    DOM.input.value = "";
    adattaAltezza();
    chiudiPaletteComandi();
  }
  return true;
}

function nascondiBozzaComandoDaVerificare(sessione, fotografia) {
  if (
    APP.sessioni.get(sessione.id) !== sessione
    || sessione.bozza !== fotografia
    || (sessione.id === APP.attivaId && DOM.input.value !== fotografia)
  ) return false;
  clearTimeout(timerSalvaBozza.get(sessione.id));
  timerSalvaBozza.delete(sessione.id);
  // Non tocchiamo il record su disco: resta la safety-copy associata al marker.
  // L'editor viene svuotato solo in RAM per impedire un nuovo Enter accidentale.
  sessione.bozza = "";
  sessione.bozzaSporca = false;
  if (sessione.id === APP.attivaId) {
    DOM.input.value = "";
    adattaAltezza();
    chiudiPaletteComandi();
  }
  return true;
}

function mostraPercorsoCreato(titolo, dati) {
  const corpo = apriModale(titolo);
  corpo.appendChild(crea("p", "nota", "Il file e pronto in:"));
  corpo.appendChild(crea("div", "percorso-attuale", dati.path || "percorso non comunicato"));
  corpo.appendChild(bottoneAzione("Copia percorso", () => copiaTesto(dati.path || "")));
}

async function apriEsportazionePi(sessione, percorsoRichiesto = "", operazione = null) {
  const esporta = async (type, etichetta, outputPath = "") => {
    if (!DOM.velo.hidden) chiudiModale({ annulla: false });
    try {
      const comando = { type, ...(outputPath ? { outputPath } : {}) };
      const dati = operazione
        ? await operazione.rpc(comando, { timeout: 60000 })
        : await rpc(comando, { sessionId: sessione.id, timeout: 60000 });
      if (dati.cancelled || dati.aborted) {
        operazione?.annullaConfermato();
        toast("Esportazione annullata da Pi.", "avviso");
        return;
      }
      operazione?.completa();
      mostraPercorsoCreato(`Conversazione esportata in ${etichetta}`, dati);
    } catch (errore) {
      operazione?.fallisce(errore);
      toast(testoErrore(errore), "errore");
    }
  };
  const percorso = percorsoRichiesto.trim();
  if (percorso) {
    if (/\.jsonl$/i.test(percorso)) return esporta("export_jsonl", "Sessione JSONL", percorso);
    if (/\.html?$/i.test(percorso)) return esporta("export_html", "Pagina HTML", percorso);
    toast("Il percorso di /export deve terminare con .html oppure .jsonl.", "errore");
    operazione?.annulla();
    return;
  }
  const corpo = apriModale("Esporta conversazione", {
    onCancel: () => operazione?.annulla(),
  });
  corpo.appendChild(crea("p", "nota", "Scegli il formato. HTML e leggibile nel browser; JSONL conserva la sessione per reimportarla in pi."));
  const lista = crea("div", "lista");
  for (const [type, nome, nota] of [
    ["export_html", "Pagina HTML", "Per leggere e archiviare la conversazione"],
    ["export_jsonl", "Sessione JSONL", "Per importarla e continuarla in pi"],
  ]) {
    const bottone = crea("button", "voce");
    bottone.type = "button";
    bottone.append(crea("span", "ico", "⇩"));
    const testo = crea("span", "voce-testo");
    testo.append(crea("strong", null, nome), crea("small", null, nota));
    bottone.appendChild(testo);
    bottone.onclick = () => esporta(type, nome);
    lista.appendChild(bottone);
  }
  corpo.appendChild(lista);
}

async function importaSessioneJsonl(sessione, argomenti = "", operazione = null) {
  const percorso = argomenti.trim() || await chiediTesto(
    "Importa una sessione JSONL",
    "Percorso completo del file .jsonl",
    "",
  );
  if (!percorso) {
    operazione?.annulla();
    return;
  }
  const confermato = await conferma(
    "Importare questa sessione?",
    "La cronologia del file sostituira quella visibile in questa scheda e verra aperta nella cartella di lavoro corrente. La conversazione attuale resta salvata.",
    "Importa sessione",
  );
  if (!confermato) {
    operazione?.annulla();
    return;
  }
  try {
    const comando = { type: "import_jsonl", inputPath: percorso.trim(), cwdOverride: sessione.cartella };
    const dati = operazione
      ? await operazione.rpc(comando, { timeout: 60000 })
      : await rpc(comando, { sessionId: sessione.id, timeout: 60000 });
    if (!dati.cancelled) {
      operazione?.completa();
      await sincronizzaSessione(sessione, { silenzioso: false });
      toast("Sessione importata.");
    } else operazione?.annullaConfermato();
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function apriModelliRapidi(sessione, operazione = null) {
  const preparazione = preparaCatalogoModelliDinamico(sessione, "Modelli rapidi", {
    onCancel: () => operazione?.annulla(),
  });
  if (!preparazione) return;
  const { corpo } = preparazione;
  corpo.appendChild(crea("p", "nota", "Seleziona i modelli da includere nel ciclo rapido. Nessuna selezione ripristina tutti i modelli disponibili."));
  const ricerca = crea("input", "campo");
  ricerca.placeholder = "Cerca modello o fornitore";
  ricerca.setAttribute("aria-label", "Cerca fra i modelli rapidi");
  const lista = crea("div", "lista");
  const configurazioneCorrente = Array.isArray(sessione.statoRpc.scopedModels)
    ? sessione.statoRpc.scopedModels
    : [];
  const selezionati = new Set(configurazioneCorrente.map((voce) => `${voce.provider}/${voce.modelId}`));
  const ragionamentoPerModello = new Map(
    configurazioneCorrente
      .filter((voce) => typeof voce.thinkingLevel === "string")
      .map((voce) => [`${voce.provider}/${voce.modelId}`, voce.thinkingLevel]),
  );
  const disegna = () => {
    lista.replaceChildren();
    const filtro = ricerca.value.trim().toLowerCase();
    for (const modello of sessione.modelli.filter((voce) =>
      [voce.name, voce.id, voce.provider].some((valore) => String(valore || "").toLowerCase().includes(filtro)))) {
      const chiave = `${modello.provider}/${modello.id}`;
      const riga = crea("label", "riga-impostazione");
      const checkbox = crea("input");
      checkbox.type = "checkbox";
      checkbox.checked = selezionati.has(chiave);
      checkbox.onchange = () => checkbox.checked ? selezionati.add(chiave) : selezionati.delete(chiave);
      riga.append(checkbox, crea("span", null, `${nomeModello(modello)} · ${nomeProviderVisuale(modello.provider)}`));
      lista.appendChild(riga);
    }
  };
  ricerca.oninput = disegna;
  preparazione.onAggiorna = disegna;
  corpo.append(ricerca, lista);
  DOM.modalePiede.hidden = false;
  DOM.modalePiede.append(
    bottoneAzione("Annulla", () => chiudiModale()),
    bottoneAzione("Salva", async () => {
      const chiaviDisponibili = new Set(
        sessione.modelli.map((modello) => `${modello.provider}/${modello.id}`),
      );
      const selezioneCompleta = chiaviDisponibili.size > 0
        && [...chiaviDisponibili].every((chiave) => selezionati.has(chiave));
      // Pi rappresenta “tutti i modelli” rimuovendo il filtro globale: sia zero
      // selezioni sia l'intero catalogo vanno quindi inviati come lista vuota.
      const modelli = (selezioneCompleta ? [] : [...selezionati]).map((chiave) => {
        const separatore = chiave.indexOf("/");
        return {
          provider: chiave.slice(0, separatore),
          modelId: chiave.slice(separatore + 1),
          ...(ragionamentoPerModello.has(chiave)
            ? { thinkingLevel: ragionamentoPerModello.get(chiave) }
            : {}),
        };
      });
      chiudiModale({ annulla: false });
      try {
        if (operazione) await operazione.rpc({ type: "set_scoped_models", models: modelli });
        else await rpc({ type: "set_scoped_models", models: modelli }, { sessionId: sessione.id });
        sessione.statoRpc.scopedModels = modelli;
        operazione?.completa();
        toast(modelli.length ? `${modelli.length} modelli rapidi salvati.` : "Ciclo rapido ripristinato su tutti i modelli.");
      } catch (errore) {
        operazione?.fallisce(errore);
        toast(testoErrore(errore), "errore");
      }
    }, "bottone primario"),
  );
  disegna();
  requestAnimationFrame(() => ricerca.focus());
}

async function mostraChangelogPi(operazione = null) {
  try {
    const dati = await chiedi("/api/changelog", { corpo: {} });
    const corpo = apriModale(`Novita di pi ${dati.piVersion || ""}`, { larga: true });
    const contenuto = crea("div", "msg-corpo markdown");
    renderMarkdown(contenuto, dati.markdown || "Nessuna novita disponibile.");
    corpo.appendChild(contenuto);
    operazione?.completa();
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

function mostraScorciatoiePi(operazione = null) {
  const corpo = apriModale("Scorciatoie della GUI");
  const voci = [
    ["Invio", "Invia la richiesta"],
    ["Maiusc + Invio", "Inserisce una nuova riga"],
    ["/", "Apre tutti i comandi di pi"],
    ["↑ / ↓", "Sposta la selezione nella palette"],
    ["Tab o Invio", "Completa il comando selezionato"],
    ["Esc", "Chiude palette, finestra o menu"],
    ["! comando", "Esegue una shell e aggiunge il risultato al contesto"],
    ["!! comando", "Esegue una shell fuori dal contesto"],
  ];
  const griglia = crea("div", "stat-grid");
  for (const [tasto, azione] of voci) {
    const voce = crea("div", "stat");
    voce.append(crea("strong", null, tasto), crea("small", null, azione));
    griglia.appendChild(voce);
  }
  corpo.appendChild(griglia);
  operazione?.completa();
}

async function gestisciFiduciaProgetto(sessione, operazione = null) {
  try {
    const dati = await chiedi("/api/fiducia-progetto", { corpo: { sessionId: sessione.id } });
    const corpo = apriModale("Fiducia della cartella", {
      onCancel: () => operazione?.annulla(),
    });
    corpo.appendChild(crea("div", "percorso-attuale", dati.cwd || sessione.cartella));
    corpo.appendChild(crea("p", "nota", dati.decision === true
      ? "La cartella e considerata attendibile: pi puo usare istruzioni, skill e risorse locali."
      : dati.decision === false
        ? "La cartella non e attendibile: le risorse locali restano disattivate."
        : "Non hai ancora scelto se usare istruzioni, skill e risorse locali."));
    DOM.modalePiede.hidden = false;
    const salva = async (decision) => {
      chiudiModale({ annulla: false });
      try {
        const operationId = operazione
          ? operazione.preparaPasso("trust").operationId
          : null;
        const corpoFiducia = {
            sessionId: sessione.id,
            decision,
            ...(operationId ? { operationId } : {}),
        };
        if (operationId) {
          await chiediOperazioneIdempotente("/api/fiducia-progetto", corpoFiducia, {
            sessionId: sessione.id,
            operationId,
            timeout: 60000,
          });
        } else await chiedi("/api/fiducia-progetto", { corpo: corpoFiducia });
        operazione?.completa();
        toast("Decisione salvata. Ricarica la sessione per applicarla.");
      } catch (errore) {
        operazione?.fallisce(errore);
        toast(testoErrore(errore), "errore");
      }
    };
    DOM.modalePiede.append(
      bottoneAzione("Non fidarti", () => salva(false)),
      bottoneAzione("Considera attendibile", () => salva(true), "bottone primario"),
    );
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function condividiSessione(sessione, operazione = null) {
  const confermato = await conferma(
    "Condividere questa conversazione?",
    "Viene creato un gist segreto tramite GitHub CLI. Chi possiede il collegamento potra leggere il contenuto esportato.",
    "Crea collegamento",
  );
  if (!confermato) {
    operazione?.annulla();
    return;
  }
  try {
    const operationId = operazione
      ? operazione.preparaPasso("share").operationId
      : `gui-share-${globalThis.crypto.randomUUID()}`;
    const dati = await chiediOperazioneIdempotente(
      "/api/condividi",
      { sessionId: sessione.id, confirmed: true, operationId },
      {
      sessionId: sessione.id,
      operationId,
      timeout: 5 * 60 * 1000,
      },
    );
    const href = urlAutenticazioneSicuro(dati.previewUrl || dati.gistUrl);
    if (!href) throw new Error("Il ponte non ha restituito un collegamento web valido");
    try {
      localStorage.setItem(
        PREFISSO_RISULTATI_OPERAZIONI + encodeURIComponent(operationId),
        JSON.stringify({ operationId, href, salvatoIl: Date.now() }),
      );
    } catch {
      toast("Il collegamento e pronto, ma non riesco a conservarlo sul computer: copialo prima di chiudere.", "avviso");
    }
    operazione?.completa();
    const corpo = apriModale("Conversazione condivisa");
    corpo.appendChild(crea("p", "nota", "Il collegamento di anteprima e pronto:"));
    const collegamento = crea("a", "percorso-attuale", href);
    collegaBrowserSistema(collegamento, href);
    corpo.appendChild(collegamento);
    corpo.appendChild(bottoneAzione("Copia collegamento", () => copiaTesto(collegamento.href)));
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

function modelloSessioneSconosciuto(sessione) {
  return !sessione?.provider
    || !sessione?.modello
    || [sessione.provider, sessione.modello]
      .some((valore) => ["unknown", "—"].includes(String(valore).toLowerCase()));
}

async function completaAutenticazioneProvider(sessione, provider, authType, operazione = null) {
  const esegui = (comando, opzioni = {}) => operazione
    ? operazione.rpc(comando, { mutating: false, ...opzioni })
    : rpc(comando, { sessionId: sessione.id, ...opzioni });
  const aggiornamento = await esegui({ type: "refresh_models" }, { timeout: 25000 });
  const catalogo = await esegui({ type: "get_available_models" });
  sessione.modelli = Array.isArray(catalogo.models) ? catalogo.models : [];

  let modelloSelezionato = null;
  let avviso = null;
  if (modelloSessioneSconosciuto(sessione)) {
    const modelId = APP.modelliPredefiniti[provider.id];
    const modello = sessione.modelli.find((voce) => voce.provider === provider.id && voce.id === modelId);
    if (modello) {
      const comando = { type: "set_model", provider: provider.id, modelId: modello.id };
      if (operazione) {
        await operazione.rpc(comando, {
          step: `modello-predefinito:${provider.id}`,
          finalStep: true,
        });
      } else {
        await rpc(comando, { sessionId: sessione.id });
      }
      sessione.provider = provider.id;
      sessione.modello = modello.id;
      modelloSelezionato = modello.id;
    } else {
      avviso = `Accesso completato, ma Pi non ha trovato il modello predefinito per ${AUTH_FLOW.nomeProvider(provider, authType)}. Usa /model per sceglierlo.`;
    }
  }
  if (aggiornamento?.timedOut || aggiornamento?.aborted || aggiornamento?.errors?.length) {
    avviso ||= "Accesso completato; il catalogo modelli non si e aggiornato completamente e usa i dati disponibili.";
  }
  await esegui({ type: "get_state" });
  return { modelloSelezionato, avviso };
}

async function gestisciProvider(
  sessione,
  { logout = false, filtro = "" } = {},
  operazione = null,
) {
  try {
    const dati = await rpc({ type: "get_auth_providers" }, { sessionId: sessione.id });
    const providers = Array.isArray(dati.providers) ? dati.providers : [];
    const providerEsatto = logout ? null : AUTH_FLOW.trovaProviderEsatto(providers, filtro);
    const corpo = apriModale(logout ? "Disconnetti fornitore" : "Scegli come accedere", {
      onCancel: () => operazione?.annulla(),
    });

    const avvia = async (provider, metodo) => {
      chiudiModale({ annulla: false });
      const loginCommandId = logout ? null : (operazione?.nuovoIdRpc() || idRpc());
      try {
        const comando = logout
          ? { type: "logout_provider", providerId: provider.id }
          : {
              type: "login_provider",
              id: loginCommandId,
              providerId: provider.id,
              authType: metodo,
            };
        let esito;
        if (operazione) {
          esito = await operazione.rpc(comando, {
            timeout: logout ? 60000 : 10 * 60 * 1000,
            rpcId: loginCommandId || operazione.nuovoIdRpc(),
            step: `${logout ? "logout" : "login"}:${provider.id}:${metodo}`,
            finalStep: logout,
          });
        } else {
          esito = await rpc(comando, { sessionId: sessione.id, timeout: logout ? 60000 : 10 * 60 * 1000 });
        }
        if (esito?.cancelled || esito?.aborted) {
          operazione?.annullaConfermato();
          toast(logout ? "Disconnessione annullata." : "Accesso annullato.", "avviso");
          return;
        }
        if (logout) {
          operazione?.completa();
          toast("Fornitore disconnesso.");
          await rpc({ type: "get_available_models" }, { sessionId: sessione.id });
          return;
        }
        const completamento = await completaAutenticazioneProvider(sessione, provider, metodo, operazione);
        operazione?.completa();
        toast(completamento.modelloSelezionato
          ? `Accesso completato. Modello selezionato: ${completamento.modelloSelezionato}.`
          : "Accesso completato.");
        if (completamento.avviso) toast(completamento.avviso, "avviso");
        aggiornaInterfacciaAttiva();
      } catch (errore) {
        if (!logout && loginCommandId && errore?.esitoIgnoto) {
          await annullaLoginProvider(sessione.id, loginCommandId, {
            motivo: "Il tempo disponibile per l'accesso e terminato.",
          });
        }
        operazione?.fallisce(errore);
        toast(testoErrore(errore), "errore");
      }
    };

    const aggiungiProvider = (lista, provider, metodo) => {
      const bottone = crea("button", "voce");
      bottone.type = "button";
      bottone.appendChild(crea("span", "ico", logout ? "↪" : metodo === "oauth" ? "◎" : "⌁"));
      const testo = crea("span", "voce-testo");
      testo.append(
        crea("strong", null, AUTH_FLOW.nomeProvider(provider, metodo)),
        crea("small", null, logout
          ? `Connesso con ${provider.credentialType}`
          : AUTH_FLOW.notaProvider(provider, metodo)),
      );
      bottone.appendChild(testo);
      bottone.onclick = () => void avvia(provider, metodo);
      lista.appendChild(bottone);
    };

    const disegnaMetodi = (provider = null) => {
      DOM.modaleTitolo.textContent = provider
        ? `Come vuoi accedere a ${AUTH_FLOW.nomeProvider(provider)}?`
        : "Scegli come accedere";
      corpo.replaceChildren();
      corpo.appendChild(crea(
        "p",
        "nota",
        "Come in Pi da terminale, account e chiave API sono due percorsi separati.",
      ));
      const lista = crea("div", "lista accesso-metodi");
      for (const scelta of AUTH_FLOW.scelteMetodo(provider)) {
        const bottone = crea("button", "voce accesso-metodo");
        bottone.type = "button";
        bottone.appendChild(crea("span", "ico", scelta.id === "oauth" ? "◎" : "⌁"));
        const testo = crea("span", "voce-testo");
        testo.append(crea("strong", null, scelta.titolo), crea("small", null, scelta.descrizione));
        bottone.appendChild(testo);
        bottone.onclick = () => disegnaFornitori(scelta.id, provider);
        lista.appendChild(bottone);
      }
      corpo.appendChild(lista);
    };

    const disegnaFornitori = (metodo, provider = null) => {
      const scelta = AUTH_FLOW.scelteMetodo().find((voce) => voce.id === metodo);
      DOM.modaleTitolo.textContent = scelta?.titolo || "Scegli un fornitore";
      corpo.replaceChildren();
      const barra = crea("div", "barra-modale accesso-indietro");
      barra.appendChild(bottoneAzione("← Metodo di accesso", () => disegnaMetodi(provider)));
      corpo.appendChild(barra);
      const lista = crea("div", "lista");
      const fornitori = provider
        ? [provider].filter((voce) => AUTH_FLOW.metodiProvider(voce).includes(metodo))
        : AUTH_FLOW.filtraProvider(providers, { authType: metodo, filtro });
      for (const voce of fornitori) aggiungiProvider(lista, voce, metodo);
      if (!lista.children.length) {
        lista.appendChild(crea("p", "vuoto", metodo === "oauth"
          ? "Nessun account corrispondente. Prova /login senza filtro."
          : "Nessun fornitore di chiavi API corrispondente. Prova /login senza filtro."));
      }
      corpo.appendChild(lista);
    };

    if (logout) {
      const lista = crea("div", "lista");
      for (const provider of AUTH_FLOW.filtraProvider(providers, { filtro, soloConnessi: true })) {
        aggiungiProvider(lista, provider, "logout");
      }
      if (!lista.children.length) lista.appendChild(crea("p", "vuoto", "Nessun fornitore connesso."));
      corpo.appendChild(lista);
    } else {
      disegnaMetodi(providerEsatto);
    }
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function eseguiWorkflowComando(
  sessione,
  azioneOriginale,
  argomenti,
  dati = {},
  operazione = null,
) {
  if (APP.sessioni.get(sessione.id) !== sessione) return;
  const azione = String(azioneOriginale || "").trim().toLowerCase().replace(/_/g, "-");
  if (["settings", "impostazioni"].includes(azione)) {
    await apriImpostazioniPi(sessione, operazione);
  } else if (["advanced", "avanzate"].includes(azione)) {
    apriControlliAvanzati(sessione);
    operazione?.completa();
  } else if (["model", "modello", "model-picker"].includes(azione)) {
    await apriSceltaModello(argomenti, operazione, sessione);
  } else if (["scoped-models", "scoped-models-picker"].includes(azione)) {
    await apriModelliRapidi(sessione, operazione);
  } else if (["export", "esporta", "export-picker"].includes(azione)) {
    await apriEsportazionePi(sessione, argomenti, operazione);
  } else if (["import", "import-picker"].includes(azione)) {
    await importaSessioneJsonl(sessione, argomenti, operazione);
  } else if (["share", "share-session"].includes(azione)) {
    await condividiSessione(sessione, operazione);
  } else if (["copy", "copia", "copy-last-response"].includes(azione)) {
    await copiaUltimaRisposta(sessione, operazione);
  } else if (["name", "rinomina", "name-input"].includes(azione)) {
    if (argomenti.trim()) {
      try {
        if (operazione) await operazione.rpc({ type: "set_session_name", name: argomenti.trim() });
        else await rpc({ type: "set_session_name", name: argomenti.trim() }, { sessionId: sessione.id });
        sessione.nomeSessione = argomenti.trim();
        disegnaSchede();
        operazione?.completa();
      } catch (errore) {
        operazione?.fallisce(errore);
        toast(testoErrore(errore), "errore");
      }
    } else await rinominaSessione(sessione, operazione);
  } else if (["session", "statistiche"].includes(azione)) {
    try {
      const statistiche = dati.stats || dati.result || (operazione
        ? await operazione.rpc({ type: "get_session_stats" })
        : await rpc({ type: "get_session_stats" }, { sessionId: sessione.id }));
      mostraStatistiche(statistiche);
      operazione?.completa();
    } catch (errore) {
      operazione?.fallisce(errore);
      toast(testoErrore(errore), "errore");
    }
  } else if (["changelog", "show-changelog"].includes(azione)) {
    await mostraChangelogPi(operazione);
  } else if (["hotkeys", "show-hotkeys"].includes(azione)) {
    mostraScorciatoiePi(operazione);
  } else if (["fork", "fork-picker"].includes(azione)) {
    await scegliFork(sessione, operazione);
  } else if (azione === "clone") {
    await clonaSessione(sessione, operazione);
  } else if (["tree", "tree-picker"].includes(azione)) {
    await mostraAlberoSessione(sessione, { operazione });
  } else if (["trust", "project-trust"].includes(azione)) {
    await gestisciFiduciaProgetto(sessione, operazione);
  } else if (["login", "provider-login"].includes(azione)) {
    await gestisciProvider(sessione, { filtro: argomenti }, operazione);
  } else if (["logout", "provider-logout"].includes(azione)) {
    await gestisciProvider(sessione, { logout: true, filtro: argomenti }, operazione);
  } else if (["new", "new-session", "nuova"].includes(azione)) {
    await nuovaConversazione(operazione);
  } else if (["compact", "comprimi"].includes(azione)) {
    try {
      if (operazione) await operazione.rpc({ type: "compact" }, { timeout: 5 * 60 * 1000 });
      else await rpc({ type: "compact" }, { sessionId: sessione.id, timeout: 5 * 60 * 1000 });
      operazione?.completa();
      toast("Spazio della conversazione liberato.");
    } catch (errore) {
      operazione?.fallisce(errore);
      toast(testoErrore(errore), "errore");
    }
  } else if (["resume", "conversazioni", "resume-picker"].includes(azione)) {
    await apriRipresaConversazione(sessione, operazione, argomenti);
  } else if (["quit", "chiudi", "close-session"].includes(azione)) {
    await chiudiSessione(sessione.id, operazione);
  } else if (["terminal", "terminale", "pi-completo", "open-full-pi"].includes(azione)) {
    await apriPiCompleto(sessione);
  } else {
    apriControlliAvanzati(sessione);
    operazione?.completa();
    toast("Questa funzione di pi e disponibile nei controlli avanzati.", "avviso");
  }
}

async function gestisciEsitoRpcBuiltin(sessione, nome, argomenti, risultato) {
  if (APP.sessioni.get(sessione.id) !== sessione) return;
  if (nome === "session") {
    mostraStatistiche(risultato);
    return;
  }
  if (nome === "name") {
    sessione.nomeSessione = argomenti.trim() || risultato.name || null;
    disegnaSchede();
    aggiornaInterfacciaAttiva();
    toast("Conversazione rinominata.");
    return;
  }
  if (nome === "new") renderCronologia(sessione, []);
  if (nome === "reload") {
    await caricaCapacita(sessione, { refresh: true });
    toast("Estensioni, skill, prompt, temi e configurazioni ricaricati. La conversazione e rimasta aperta.");
  } else if (nome === "compact") {
    toast("Spazio della conversazione liberato.");
  } else if (nome === "clone") {
    toast("Copia della conversazione creata.");
  } else if (nome === "model") {
    toast("Modello cambiato.");
  } else if (nome === "new") {
    toast("Nuova conversazione pronta.");
  }
  await sincronizzaSessione(sessione, { silenzioso: true });
}

function creaOperazioneWorkflow(sessione, registro, fotografia) {
  let conclusa = false;
  aggiornaStatoOperazionePendente(sessione, registro.id, {
    statoComando: "in_attesa",
    motivoComando: "workflow_in_attesa_scelta",
    erroreComando: "La funzione e aperta nella GUI e attende la tua scelta finale.",
  });
  nascondiBozzaComandoDaVerificare(sessione, fotografia);
  const corrente = () => sessione.inviiPendenti.find((invio) => invio.id === registro.id);
  const completa = ({ annullata = false } = {}) => {
    if (conclusa) return true;
    const invio = corrente();
    if (!invio) {
      conclusa = true;
      return true;
    }
    const salvata = dimenticaCopiaSicurezzaVerificata(sessione, invio);
    if (salvata) {
      conclusa = true;
      if (annullata) {
        const avevaPassi = Object.keys(invio.workflowStepCounts || {}).length > 0;
        toast(avevaPassi
          ? `/${registro.comandoBuiltin} chiuso: i passi gia confermati restano applicati.`
          : `/${registro.comandoBuiltin} annullato senza eseguire modifiche.`);
      }
    }
    return salvata;
  };
  const fallisce = (errore) => {
    const invio = corrente();
    if (!invio) return;
    const transizione = PALETTE_CORE.transizioneEsitoOperazione(
      invio,
      errore?.esitoIgnoto
        ? { esitoIgnoto: true, error: testoErrore(errore) }
        : { success: false, error: testoErrore(errore) },
    );
    if (transizione?.modifiche) {
      aggiornaStatoOperazionePendente(sessione, invio.id, {
        ...transizione.modifiche,
        statusHttpComando: errore?.statusHttp,
        codiceErroreComando: errore?.code || errore?.codice,
      });
    }
  };
  const operationIdPasso = (passo) => {
    const suffisso = String(passo || "azione")
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._:-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "azione";
    return `${registro.operationId}.${suffisso}`.slice(0, 128);
  };
  const preparaPasso = (passo, { rpcId = null, finalStep = true } = {}) => {
    const indice = sessione.inviiPendenti.findIndex((invio) => invio.id === registro.id);
    if (indice < 0) throw new Error("Il registro di sicurezza del comando non e piu disponibile");
    const precedente = sessione.inviiPendenti[indice];
    if (precedente.statoComando === "esito_ignoto" && precedente.workflowOperationId) {
      throw new Error(
        "Il passo precedente ha un esito non verificabile. Controllalo nel pannello prima di eseguire un'altra modifica.",
      );
    }
    const conteggi = { ...(precedente.workflowStepCounts || {}) };
    const chiavePasso = String(passo || "azione");
    const sequenza = Math.max(0, Number(conteggi[chiavePasso]) || 0) + 1;
    conteggi[chiavePasso] = sequenza;
    const operationId = operationIdPasso(`${chiavePasso}:${sequenza}`);
    const aggiornato = {
      ...precedente,
      statoComando: "in_corso",
      erroreComando: "",
      motivoComando: "",
      workflowStep: String(passo || "azione"),
      workflowStepCounts: conteggi,
      workflowOperationId: operationId,
      workflowRpcId: rpcId || null,
      workflowRisolviSuAck: Boolean(finalStep),
      statoAggiornatoIl: Date.now(),
    };
    sessione.inviiPendenti[indice] = aggiornato;
    if (!persistiInvioPendente(sessione, aggiornato)) {
      sessione.inviiPendenti[indice] = precedente;
      sessione.invioNonPersistito = true;
      if (sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
      throw new Error(
        "Il passo non e stato inviato: non riesco a registrare l'operationId che impedisce una doppia esecuzione.",
      );
    }
    if (sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
    return { operationId, rpcId };
  };
  return Object.freeze({
    id: registro.id,
    operationId: registro.operationId,
    operationIdPasso,
    nuovoIdRpc: () => idRpc(),
    preparaPasso,
    registro,
    completa,
    annullaConfermato: () => completa({ annullata: true }),
    annulla: () => {
      const invio = corrente();
      if (
        invio?.workflowOperationId
        && ["in_corso", "esito_ignoto"].includes(invio.statoComando)
      ) {
        toast(
          `/${registro.comandoBuiltin} ha gia inviato un passo a Pi. Attendi o verifica l'esito nel pannello: la chiusura non lo rende ripetibile.`,
          "avviso",
        );
        return false;
      }
      return completa({ annullata: true });
    },
    fallisce,
    rpc: (comando, opzioni = {}) => {
      const {
        step = comando?.type || "azione",
        mutating = !String(comando?.type || "").startsWith("get_"),
        rpcId = idRpc(),
        finalStep = true,
        ...opzioniRpc
      } = opzioni;
      const operationId = mutating
        ? preparaPasso(step, { rpcId, finalStep }).operationId
        : null;
      return rpc(
        {
          ...comando,
          id: rpcId,
          ...(operationId ? { operationId } : {}),
        },
        { ...opzioniRpc, sessionId: sessione.id },
      ).then((dati) => {
        if (!finalStep) {
          aggiornaStatoOperazionePendente(sessione, registro.id, {
            statoComando: "passo_confermato",
            motivoComando: "workflow_passo_confermato",
            erroreComando: "",
          });
        }
        return dati;
      });
    },
  });
}

async function invocaComandoBuiltin(sessione, comando, argomenti, fotografia) {
  let nuovoTentativoDopoCatalogo = false;
  const giaDaVerificare = sessione.inviiPendenti.find((invio) => (
    invio.origine === "builtin" && invio.testo.trim() === fotografia.trim()
  ));
  if (giaDaVerificare) {
    if (giaDaVerificare.motivoComando !== "catalogo_obsoleto") {
      toast(
        `/${comando.name} ha gia un esito da verificare. Controlla il pannello sopra la casella e segnalo “Gia verificato” prima di ripeterlo.`,
        "avviso",
      );
      nascondiBozzaComandoDaVerificare(sessione, fotografia);
      return true;
    }
    const riprova = await conferma(
      "Riprova con il catalogo aggiornato?",
      `Pi ha rifiutato /${comando.name} prima di eseguirlo perche l'elenco comandi era cambiato. Questo e un nuovo tentativo manuale e non verra ripetuto automaticamente.`,
      "Riprova una volta",
    );
    if (!riprova) {
      nascondiBozzaComandoDaVerificare(sessione, fotografia);
      return true;
    }
    if (!dimenticaCopiaSicurezzaVerificata(sessione, giaDaVerificare)) return true;
    nuovoTentativoDopoCatalogo = true;
  }
  if (nuovoTentativoDopoCatalogo || !sessione.lineageId) {
    // Il rifiuto per catalogo obsoleto avviene prima dello stdin di Pi. Il retry
    // esplicitamente confermato e un nuovo intento e deve quindi avere lineage e
    // operationId nuovi, senza riusare il tombstone del tentativo precedente.
    sessione.lineageId = globalThis.crypto.randomUUID();
    sessione.lineageModificataLocalmente = true;
  }
  const id = idRpc();
  const attesa = preparaAttesaRpcEsterna(sessione.id, id, { nome: `/${comando.name}` });
  const registro = PALETTE_CORE.creaRegistroComandoBuiltin({
    id,
    testo: fotografia,
    lineageId: sessione.lineageId,
    nome: comando.name,
    argomenti,
  });
  if (!registro || !registraInvioPendente(sessione, registro)) {
    attesa.annulla();
    if (registro) dimenticaInvioPendente(sessione, registro.id);
    toast(
      `/${comando.name} non e stato inviato: non riesco a creare il registro locale che impedisce una doppia esecuzione. Il testo resta nella casella.`,
      "errore",
    );
    return true;
  }
  let comandoConfermato = false;
  try {
    let dati;
    let risultatoRpcAnticipato = null;
    try {
      dati = await chiedi("/api/invoca-comando", {
        corpo: {
          sessionId: sessione.id,
          name: comando.name,
          arguments: argomenti,
          id,
          operationId: registro.operationId,
          ...(sessione.revisioneCapacita != null
            ? { catalogRevision: sessione.revisioneCapacita }
            : {}),
        },
      });
    } catch (erroreHttp) {
      if (!attesa.stato.conclusa) throw erroreHttp;
      // L'evento SSE e autorevole se il comando era gia concluso quando il
      // POST ha perso la propria risposta HTTP.
      risultatoRpcAnticipato = await attesa.promessa;
      dati = { mode: "rpc", id, recoveredFromEvent: true };
    }
    if (APP.sessioni.get(sessione.id) !== sessione) {
      attesa.annulla();
      return true;
    }
    if (dati?.operation?.canonicalId) {
      conservaIdCanonicoOperazione(
        sessione,
        registro.operationId,
        dati.operation.canonicalId,
      );
    }
    if (dati?.operation?.status === "completed") {
      attesa.annulla();
      risultatoRpcAnticipato = datiDaOperazioneCompletata(dati.operation);
      dati = { ...dati, mode: dati.mode === "workflow" ? "workflow" : "rpc" };
    } else if (
      dati?.operation?.status === "pending"
      && dati.operation.canonicalId
      && dati.operation.canonicalId !== id
    ) {
      attesa.annulla();
      const stato = await attendiOperazioneServer(sessione.id, registro.operationId);
      risultatoRpcAnticipato = datiDaOperazioneCompletata(stato);
      dati = { ...dati, mode: "rpc", operation: stato };
    }
    let risultatoRpc = null;
    if (dati?.mode === "rpc") {
      if (dati.id && dati.id !== id) throw new Error("Il ponte ha correlato il comando a una risposta diversa");
      risultatoRpc = risultatoRpcAnticipato ?? await attesa.promessa;
    } else {
      attesa.annulla();
    }
    if (dati?.mode === "workflow") {
      const operazione = creaOperazioneWorkflow(sessione, registro, fotografia);
      await eseguiWorkflowComando(
        sessione,
        dati.action || comando.dispatch?.action,
        argomenti,
        dati,
        operazione,
      );
    } else if (dati?.mode === "terminal") {
      const registroCorrente = sessione.inviiPendenti.find((invio) => invio.id === id);
      if (registroCorrente && !dimenticaCopiaSicurezzaVerificata(sessione, registroCorrente)) return true;
      comandoConfermato = true;
      toast(dati.reason || `/${comando.name} richiede Pi completo nel terminale.`, "avviso");
      await apriPiCompleto(sessione);
    } else if (dati?.mode === "rpc") {
      const registroCorrente = sessione.inviiPendenti.find((invio) => invio.id === id);
      if (registroCorrente && !dimenticaCopiaSicurezzaVerificata(sessione, registroCorrente)) {
        toast(
          `Pi ha completato /${comando.name}, ma non riesco a salvare la conferma locale. La copia resta visibile: non reinviare il comando.`,
          "errore",
        );
        return true;
      }
      comandoConfermato = true;
      await gestisciEsitoRpcBuiltin(sessione, comando.name, argomenti, risultatoRpc || {});
    } else if (dati?.message) {
      const registroCorrente = sessione.inviiPendenti.find((invio) => invio.id === id);
      if (registroCorrente && !dimenticaCopiaSicurezzaVerificata(sessione, registroCorrente)) return true;
      comandoConfermato = true;
      toast(String(dati.message));
    }
    return true;
  } catch (errore) {
    attesa.annulla();
    if (comandoConfermato) {
      toast(
        `Pi ha gia completato /${comando.name}, ma l'interfaccia non ha terminato l'aggiornamento: ${testoErrore(errore)} Non reinviare il comando.`,
        "errore",
      );
      return true;
    }
    const catalogoObsoleto = PALETTE_CORE.erroreCatalogoComandiObsoleto(errore);
    let catalogoAggiornato = false;
    if (catalogoObsoleto && APP.sessioni.get(sessione.id) === sessione) {
      try {
        await caricaCapacita(sessione, { refresh: false });
        catalogoAggiornato = true;
      } catch {
        // Il marker conserva l'errore: nessun comando viene ritentato qui.
      }
    }
    const registroCorrente = sessione.inviiPendenti.find((invio) => invio.id === id);
    const transizione = PALETTE_CORE.transizioneEsitoOperazione(
      registroCorrente || registro,
      errore?.esitoIgnoto
        ? { esitoIgnoto: true, error: testoErrore(errore) }
        : { success: false, error: testoErrore(errore) },
    );
    if (registroCorrente && transizione?.modifiche) {
      aggiornaStatoOperazionePendente(sessione, id, {
        ...transizione.modifiche,
        ...(catalogoObsoleto ? { motivoComando: "catalogo_obsoleto" } : {}),
        statusHttpComando: errore?.statusHttp,
        codiceErroreComando: errore?.code || errore?.codice,
      });
      nascondiBozzaComandoDaVerificare(sessione, fotografia);
    }
    if (catalogoObsoleto) {
      toast(
        catalogoAggiornato
          ? `L'elenco comandi e stato aggiornato. /${comando.name} non e stato rieseguito: ripristinalo dal pannello e conferma un solo nuovo tentativo manuale.`
          : `/${comando.name} non e stato eseguito perche il catalogo e cambiato. Non lo ritento automaticamente; aggiorna i comandi e riprova manualmente dopo la verifica.`,
        "avviso",
      );
      return true;
    }
    toast(
      testoErrore(errore) + (errore?.esitoIgnoto
        ? " L'esito non e verificabile: la copia e nel pannello degli invii da verificare e non e pronta al reinvio."
        : " Pi ha rifiutato il comando: la copia resta nel pannello e va verificata prima di un nuovo tentativo."),
      errore?.esitoIgnoto ? "avviso" : "errore",
    );
    return true;
  }
}

async function gestisciComandoComposer(sessione, fotografia, testo) {
  const shell = testo.match(/^(!{1,2})([\s\S]*)$/);
  if (shell) {
    const comandoShell = shell[2].trim();
    if (!comandoShell) return false;
    if (sessione.allegati.length) {
      toast("Rimuovi o invia prima le immagini allegate; non appartengono al comando shell.", "avviso");
      return true;
    }
    await eseguiBash(sessione, comandoShell, null, {
      excludeFromContext: shell[1] === "!!",
      testoComposer: fotografia,
    });
    return true;
  }

  const richiamo = PALETTE_CORE.analizzaComandoDaInviare(testo);
  if (!richiamo) return false;
  let comando = trovaComandoCatalogo(sessione, richiamo.name);
  if (!comando && !sessione.capacitaComplete) {
    await caricaCapacita(sessione, { refresh: true });
    if (APP.sessioni.get(sessione.id) !== sessione) return true;
    comando = trovaComandoCatalogo(sessione, richiamo.name);
    if (!comando && !sessione.capacitaComplete) {
      toast("Sto ancora verificando i comandi di pi. Riprova tra un istante.", "avviso");
      return true;
    }
  }
  if (["builtin", "extension"].includes(comando?.source) && sessione.allegati.length) {
    toast("Rimuovi o invia prima le immagini allegate; non appartengono al comando di pi.", "avviso");
    return true;
  }
  if (!comando || ["skill", "prompt"].includes(comando.source)) return false;
  // Anche le estensioni passano dal catalogo verificato e da
  // /api/invoca-comando. Il ponte esegue soltanto quelle certificate per la
  // GUI; per le altre restituisce mode=terminal e apre Pi completo dopo la
  // conferma, senza mai inoltrare qui un prompt extension grezzo.
  if (!["builtin", "extension"].includes(comando.source)) return false;
  return invocaComandoBuiltin(sessione, comando, richiamo.arguments, fotografia);
}

async function invia() {
  const sessione = sessioneAttiva();
  if (
    !sessione
    || sessione.handoffInCorso
    || sessione.chiusuraInCorso
    || sessione.invioInCorso
  ) return;
  // Il salvataggio IndexedDB degli allegati puo essere ancora in corso. Il
  // latch va preso prima del primo await, altrimenti due Enter ravvicinati
  // invierebbero due RPC quando la stessa coda si sblocca.
  sessione.invioInCorso = true;
  aggiornaInterfacciaAttiva();
  try {
    const chiaveAttesa = sessione.chiaveBozza;
    await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
    if (
      sessioneAttiva() !== sessione
      || sessione.chiaveBozza !== chiaveAttesa
      || sessione.handoffInCorso
      || sessione.chiusuraInCorso
    ) return;
  if (sessione.erroreCronologia) {
    toast("Prima devo riuscire a verificare la cronologia. Usa Riprova, Libera spazio o Pi completo.", "errore");
    return;
  }
  const bozzaInviata = DOM.input.value;
  const testo = bozzaInviata.trim();
  sessione.bozza = bozzaInviata;
  salvaBozza(sessione);
  clearTimeout(timerSalvaBozza.get(sessione.id));
  timerSalvaBozza.delete(sessione.id);
  if (!testo && !sessione.allegati.length) return;
  if (new TextEncoder().encode(bozzaInviata).byteLength > LIMITE_TESTO_RICHIESTA) {
    toast("Il testo supera 2 MB. Allegalo come file o dividilo in piu richieste.", "errore");
    return;
  }
  // Comandi built-in e shell non diventano messaggi: devono essere
  // intercettati prima di cronologia ottimistica e registro degli invii.
  if (await gestisciComandoComposer(sessione, bozzaInviata, testo)) return;
  const eraInEsecuzione = sessione.inEsecuzione;
  const modoScelto = DOM.modoCoda.value;
  const nomeComando = PALETTE_CORE.analizzaComandoDaInviare(testo)?.name || null;
  const comandoNoto = nomeComando
    ? sessione.comandi.find((voce) => voce.name === nomeComando)
    : null;
  sessione.turnoAspettaTesto = comandoNoto?.source !== "extension";
  const allegatiInviati = [...sessione.allegati];
  const immagini = allegatiInviati.map(({ data, mimeType }) => ({ type: "image", data, mimeType }));
  const copiaAllegati = allegatiInviati.map((voce) => ({ ...voce }));
  if (!sessione.lineageId) sessione.lineageId = globalThis.crypto.randomUUID();
  const lineageInvio = sessione.lineageId;
  const testoInvio = testo || "Guarda le immagini allegate.";
  const duplicato = PALETTE_CORE.trovaInvioPendenteDuplicato(
    sessione.inviiPendenti,
    {
      lineageId: lineageInvio,
      testo: testoInvio,
      firmeAllegati: allegatiInviati.map(firmaImmagine),
    },
  );
  if (duplicato) {
    sessione.inviiNascosti.delete(duplicato.id);
    disegnaInviiDaVerificare(sessione);
    toast(
      "Questa richiesta e gia stata inviata ed e in verifica. Non la duplico: attendi la sincronizzazione oppure usa Ripristina / Gia verificato nella copia gialla.",
      "avviso",
    );
    return;
  }
  sessione.seguiFondo = true;
  const messaggio = aggiungiMessaggio(sessione, "tu · in invio", testo, "utente", { immagini: copiaAllegati });
  DOM.input.disabled = true;
  DOM.btnInvia.disabled = true;
  avvisa("");
  let idInvio = null;
  let immaginiConteggiate = false;
  try {
    idInvio = idRpc();
    const comando = {
      type: "prompt",
      id: idInvio,
      message: testoInvio,
      images: immagini.length ? immagini : undefined,
    };
    if (eraInEsecuzione) comando.streamingBehavior = modoScelto;
    const invioPendente = {
      id: idInvio,
      testo: comando.message,
      creatoIl: Date.now(),
      lineageId: lineageInvio,
      origine: comandoNoto?.source || null,
      allegati: allegatiInviati.map((allegato) => ({
        id: allegato.id,
        nome: allegato.nome,
        mimeType: allegato.mimeType,
        dimensione: allegato.dimensione,
        firma: firmaImmagine(allegato),
      })),
      allegatiDati: allegatiInviati.map((allegato) => ({ ...allegato })),
    };
    sessione.inviiNascosti.add(idInvio);
    registraInvioPendente(sessione, invioPendente);
    if (allegatiInviati.length) {
      const conservati = await scriviAllegatiInvio(
        idInvio,
        sessione.chiaveBozza,
        allegatiInviati,
      );
      if (!conservati) {
        sessione.invioNonPersistito = true;
        toast(
          "Non riesco a conservare le immagini dell'invio: non chiudere la finestra finche la richiesta non compare nella cronologia.",
          "errore",
        );
      }
    }
    await rpc(comando, { sessionId: sessione.id, timeout: 30000 });
    messaggio.autore.textContent = eraInEsecuzione
      ? modoScelto === "steer"
        ? "tu · correzione in coda"
        : "tu · richiesta in coda"
      : "tu";
    if (sessione.bozza === bozzaInviata) sessione.bozza = "";
    sessione.lineageId = null;
    sessione.lineageModificataLocalmente = false;
    sessione.byteImmaginiCronologia += immagini.reduce(
      (somma, immagine) => somma + String(immagine.data || "").length,
      0,
    );
    immaginiConteggiate = true;
    if (comandoNoto?.source === "extension") {
      // Un comando extension puo concludersi senza creare un messaggio user:
      // in questo caso l'ack RPC e l'esito definitivo e non va riproposto al
      // reload come se fosse un prompt perso.
      const verificaSalvata = !lineageInvio || segnaLineageRisolta(lineageInvio);
      if (!verificaSalvata) {
        sessione.invioNonPersistito = true;
        toast(
          "Il comando e completato, ma la verifica locale non e stata salvata: la copia resta disponibile.",
          "errore",
        );
      } else {
        dimenticaInvioPendente(sessione, idInvio);
        salvaBozza(sessione);
      }
    }
    // La copia persistita resta finche il messaggio non compare davvero nella
    // cronologia. Un follow-up e soltanto in RAM dopo l'ack e puo ancora andare
    // perso se PI viene chiuso prima del suo turno.
    const inviati = new Set(allegatiInviati);
    sessione.allegati = sessione.allegati.filter((allegato) => !inviati.has(allegato));
    void conservaAllegatiBozza(sessione);
    if (sessione.id === APP.attivaId) {
      DOM.input.value = sessione.bozza;
      disegnaAllegati();
      adattaAltezza();
    }
  } catch (errore) {
    if (errore?.esitoIgnoto) {
      sessione.inviiNascosti.delete(idInvio);
      if (sessione.id === APP.attivaId) disegnaInviiDaVerificare(sessione);
      if (!immaginiConteggiate) {
        sessione.byteImmaginiCronologia += immagini.reduce(
          (somma, immagine) => somma + String(immagine.data || "").length,
          0,
        );
      }
      messaggio.autore.textContent = "tu · esito da verificare";
      messaggio.msg.classList.add("avviso");
      toast(
        testoErrore(errore)
          + " Non reinviare subito: la cronologia verra risincronizzata e il testo resta disponibile.",
        "avviso",
      );
      setTimeout(() => sincronizzaSessione(sessione, { silenzioso: true }), 800);
    } else {
      dimenticaInvioPendente(sessione, idInvio);
      messaggio.autore.textContent = "tu · non inviato";
      messaggio.msg.classList.add("errore");
      toast(testoErrore(errore) + " Il testo e rimasto nella casella per riprovare.", "errore");
    }
    }
  } finally {
    sessione.invioInCorso = false;
    aggiornaInterfacciaAttiva();
    if (sessione.id === APP.attivaId) DOM.input.focus();
  }
}

// ---------------------------------------------------------------------------
// Azioni conversazione e statistiche
// ---------------------------------------------------------------------------

function mostraStatistiche(dati) {
  const corpo = apriModale("Uso e costo della conversazione");
  const griglia = crea("div", "stat-grid");
  const voci = [
    ["Messaggi totali", dati.totalMessages],
    ["Tuoi messaggi", dati.userMessages],
    ["Risposte di pi", dati.assistantMessages],
    ["Strumenti usati", dati.toolCalls],
    ["Token in entrata", dati.tokens?.input],
    ["Token in uscita", dati.tokens?.output],
    ["Token totali", dati.tokens?.total],
    ["Costo della sessione", Number.isFinite(dati.cost) ? dati.cost.toFixed(4) + " $" : "—"],
  ];
  for (const [etichetta, valore] of voci) {
    const scheda = crea("div", "stat");
    scheda.appendChild(crea("strong", null, typeof valore === "number" ? numero(valore) : String(valore ?? "—")));
    scheda.appendChild(crea("small", null, etichetta));
    griglia.appendChild(scheda);
  }
  corpo.appendChild(griglia);
  if (dati.contextUsage) {
    const percentuale = Number.isFinite(dati.contextUsage.percent) ? dati.contextUsage.percent : 0;
    const contesto = crea("div", "stat");
    contesto.style.marginTop = "10px";
    contesto.appendChild(crea("strong", null, `${percentuale.toFixed(1)}% del contesto usato`));
    contesto.appendChild(crea("small", null, `${numero(dati.contextUsage.tokens)} di ${numero(dati.contextUsage.contextWindow)} token`));
    const barra = crea("div", "barra-contesto");
    const piena = crea("span");
    piena.style.width = Math.max(0, Math.min(100, percentuale)) + "%";
    barra.appendChild(piena);
    contesto.appendChild(barra);
    corpo.appendChild(contesto);
  }
  if (dati.sessionFile) corpo.appendChild(crea("div", "percorso-attuale", dati.sessionFile));
}

async function nuovaConversazione(operazione = null) {
  const sessione = sessioneAttiva();
  if (!sessione) return;
  const confermato = !sessione.haMessaggi || (await conferma("Nuova conversazione?", "La conversazione attuale resta salvata e potrai riaprirla in seguito.", "Inizia nuova"));
  if (!confermato) {
    operazione?.annulla();
    return;
  }
  try {
    const dati = operazione
      ? await operazione.rpc({ type: "new_session" }, { timeout: 60000 })
      : await rpc({ type: "new_session" }, { sessionId: sessione.id, timeout: 60000 });
    if (dati.cancelled) {
      operazione?.annullaConfermato();
      toast("Un'estensione ha annullato la nuova conversazione.", "avviso");
      return;
    }
    operazione?.completa();
    renderCronologia(sessione, []);
    await sincronizzaSessione(sessione);
    toast("Nuova conversazione pronta.");
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function interrompi() {
  const sessione = sessioneAttiva();
  if (!sessione) return;
  try {
    await rpc({ type: "abort" }, { sessionId: sessione.id, timeout: 15000 });
    avvisa("Interruzione richiesta.");
    setTimeout(() => avvisa(""), 2500);
  } catch (errore) {
    toast(spiegaErrorePi(testoErrore(errore), sessione), "avviso");
  }
}

async function eseguiAzione(azione) {
  chiudiMenuLaterale();
  const sessione = sessioneAttiva();
  if (azione === "cartella") return apriSceltaCartella();
  if (azione === "conversazioni") return apriConversazioniSalvate();
  if (azione === "nuova" && !sessione) {
    return avviaSessione(null, { senzaCartella: true, forzaNuova: true });
  }
  if (!sessione) {
    toast("Avvia prima una conversazione.", "avviso");
    return;
  }
  if (azione === "modello") return apriSceltaModello();
  if (azione === "ragionamento") return apriSceltaRagionamento();
  if (azione === "nuova") return nuovaConversazione();
  if (azione === "interrompi") return interrompi();
  if (azione === "avanzate") return apriControlliAvanzati();
  if (azione === "albero") return mostraAlberoSessione(sessione);
  if (azione === "ricarica") return ricaricaRisorsePi();
  try {
    if (azione === "comprimi") {
      await rpc({ type: "compact" }, { sessionId: sessione.id, timeout: 5 * 60 * 1000 });
    } else if (azione === "statistiche") {
      mostraStatistiche(await rpc({ type: "get_session_stats" }, { sessionId: sessione.id }));
    } else if (azione === "esporta") {
      const dati = await rpc({ type: "export_html" }, { sessionId: sessione.id, timeout: 60000 });
      const corpo = apriModale("Conversazione esportata");
      corpo.appendChild(crea("p", "nota", "Il file HTML e pronto in:"));
      corpo.appendChild(crea("div", "percorso-attuale", dati.path || "percorso non comunicato"));
      const copia = crea("button", "bottone", "Copia percorso");
      copia.onclick = () => copiaTesto(dati.path || "");
      corpo.appendChild(copia);
    }
  } catch (errore) {
    toast(spiegaErrorePi(testoErrore(errore), sessione), "errore");
  }
}

// ---------------------------------------------------------------------------
// Controlli avanzati: tutte le capacita RPC restano raggiungibili
// ---------------------------------------------------------------------------

function sezioneAvanzata(titolo) {
  const sezione = crea("section", "sezione-avanzata");
  sezione.appendChild(crea("h4", null, titolo));
  return sezione;
}

function bottoneAzione(testo, azione, classe = "bottone") {
  const bottone = crea("button", classe, testo);
  bottone.type = "button";
  bottone.onclick = azione;
  return bottone;
}

async function apriImpostazioniPi(sessione, operazione = null) {
  const corpo = apriModale("Impostazioni di Pi", {
    larga: true,
    onCancel: () => operazione?.annulla(),
  });
  const modaleRichiesta = APP.modale;
  const caricamento = crea("p", "nota", "Leggo le impostazioni effettive di Pi…");
  caricamento.setAttribute("role", "status");
  corpo.appendChild(caricamento);
  let correnti;
  try {
    const dati = await rpc({ type: "get_rpc_settings" }, { sessionId: sessione.id });
    if (APP.modale !== modaleRichiesta) return;
    correnti = dati.settings;
    if (!correnti || typeof correnti !== "object") {
      throw new Error("Pi non ha restituito impostazioni verificabili");
    }
  } catch (errore) {
    operazione?.fallisce(errore);
    if (APP.modale !== modaleRichiesta) return;
    caricamento.className = "avviso-sicurezza";
    caricamento.textContent = "Non riesco a leggere le impostazioni: " + testoErrore(errore);
    return;
  }

  corpo.replaceChildren(crea(
    "p",
    "nota",
    "Queste opzioni cambiano il comportamento dell'agente, non soltanto l'aspetto della GUI. Le preferenze globali valgono anche nelle prossime sessioni di Pi.",
  ));
  const controlli = new Map();
  const aggiungiScelta = (nome, titolo, descrizione, opzioni) => {
    const riga = crea("label", "riga-impostazione impostazione-spiegata");
    const testo = crea("span", "testo-impostazione");
    testo.append(crea("strong", null, titolo), crea("small", null, descrizione));
    const selezione = crea("select", "selettore");
    selezione.setAttribute("aria-label", titolo);
    for (const [valore, etichetta] of opzioni) {
      const opzione = crea("option", null, etichetta);
      opzione.value = String(valore);
      selezione.appendChild(opzione);
    }
    selezione.value = String(correnti[nome]);
    riga.append(testo, selezione);
    corpo.appendChild(riga);
    controlli.set(nome, { elemento: selezione, tipo: typeof correnti[nome] });
  };
  aggiungiScelta("autoCompaction", "Libera spazio automaticamente", "Riassume il contesto quando si avvicina al limite del modello.", [[true, "Attivo"], [false, "Disattivo"]]);
  aggiungiScelta("autoRetry", "Riprova gli errori temporanei", "Consente a Pi di ritentare automaticamente richieste fallite per cause transitorie.", [[true, "Attivo"], [false, "Disattivo"]]);
  aggiungiScelta("steeringMode", "Correzioni durante il lavoro", "Una per volta attende una nuova risposta; tutte insieme consegna l'intera coda.", [["one-at-a-time", "Una per volta"], ["all", "Tutte insieme"]]);
  aggiungiScelta("followUpMode", "Richieste da fare dopo", "Decide come consegnare i messaggi accodati quando l'agente termina.", [["one-at-a-time", "Una per volta"], ["all", "Tutte insieme"]]);
  aggiungiScelta("autoResizeImages", "Ridimensiona immagini grandi", "Porta le immagini entro 2000×2000 per aumentare la compatibilita con i modelli.", [[true, "Attivo"], [false, "Disattivo"]]);
  aggiungiScelta("blockImages", "Blocca immagini verso i modelli", "Impedisce che allegati e risultati immagine vengano inviati al fornitore LLM.", [[false, "Consenti immagini"], [true, "Blocca immagini"]]);
  aggiungiScelta("enableSkillCommands", "Comandi delle skill", "Registra le skill installate come comandi /skill:nome nella palette slash.", [[true, "Attivi"], [false, "Disattivi"]]);
  aggiungiScelta("transport", "Trasporto del fornitore", "Sceglie il canale preferito quando il fornitore supporta piu modalita.", [["auto", "Automatico"], ["sse", "SSE"], ["websocket", "WebSocket"], ["websocket-cached", "WebSocket con cache"]]);
  aggiungiScelta("httpIdleTimeoutMs", "Timeout HTTP inattivo", "Tempo massimo senza header o nuovi dati; disattivalo per modelli locali che restano in pausa a lungo.", [[30000, "30 secondi"], [60000, "1 minuto"], [120000, "2 minuti"], [300000, "5 minuti"], [0, "Disattivato"]]);

  const stato = crea("p", "nota", "Le modifiche vengono applicate solo quando premi Salva.");
  stato.setAttribute("role", "status");
  stato.setAttribute("aria-live", "polite");
  corpo.appendChild(stato);
  DOM.modalePiede.hidden = false;
  const annulla = bottoneAzione("Annulla", () => chiudiModale());
  const salva = bottoneAzione("Salva impostazioni", async () => {
    salva.disabled = true;
    annulla.disabled = true;
    stato.textContent = "Applico le modifiche a Pi…";
    const modifiche = [];
    for (const [nome, controllo] of controlli) {
      const valore = controllo.tipo === "boolean"
        ? controllo.elemento.value === "true"
        : controllo.tipo === "number"
          ? Number(controllo.elemento.value)
          : controllo.elemento.value;
      if (valore !== correnti[nome]) modifiche.push([nome, valore]);
    }
    try {
      for (let indice = 0; indice < modifiche.length; indice += 1) {
        const [name, value] = modifiche[indice];
        const comando = {
          type: "set_rpc_setting",
          name,
          value,
        };
        if (operazione) {
          await operazione.rpc(comando, {
            step: `settings:${name}`,
            finalStep: indice === modifiche.length - 1,
          });
        } else {
          await rpc(comando, { sessionId: sessione.id });
        }
        correnti[name] = value;
      }
      sessione.statoRpc.rpcSettings = { ...correnti };
      if (modifiche.some(([nome]) => nome === "enableSkillCommands")) {
        await caricaCapacita(sessione, { refresh: true });
      }
      operazione?.completa();
      chiudiModale({ annulla: false });
      toast(modifiche.length ? "Impostazioni di Pi salvate." : "Nessuna impostazione da cambiare.");
    } catch (errore) {
      operazione?.fallisce(errore);
      stato.textContent = "Salvataggio interrotto: " + testoErrore(errore)
        + " Le opzioni gia confermate da Pi restano applicate.";
      salva.disabled = false;
      annulla.disabled = false;
      toast(testoErrore(errore), "errore");
    }
  }, "bottone primario");
  DOM.modalePiede.append(annulla, salva);
}

function apriControlliAvanzati(sessioneRichiesta = null) {
  const sessione = sessioneRichiesta || sessioneAttiva();
  if (!sessione) return;
  const corpo = apriModale("Controlli avanzati", { larga: true });
  corpo.appendChild(crea("p", "nota", "Le funzioni quotidiane restano nella barra laterale. Qui trovi sessioni ramificate, code, shell e il protocollo RPC completo."));

  const gestione = sezioneAvanzata("Sessione");
  const barraGestione = crea("div", "barra-modale");
  barraGestione.append(
    bottoneAzione("Rinomina", () => rinominaSessione(sessione)),
    bottoneAzione("Crea una copia", () => clonaSessione(sessione)),
    bottoneAzione("Crea versione da un messaggio", () => scegliFork(sessione)),
    bottoneAzione("Mostra albero", () => mostraAlberoSessione(sessione)),
    bottoneAzione("Copia ultima risposta", () => copiaUltimaRisposta(sessione)),
    bottoneAzione("Nuova conversazione nel terminale", () => apriPiCompleto(sessione)),
    bottoneAzione(
      "Sposta questa conversazione nel terminale",
      () => passaConversazioneAlTerminale(sessione),
    ),
  );
  gestione.appendChild(barraGestione);
  corpo.appendChild(gestione);

  const impostazioni = sezioneAvanzata("Comportamento automatico e coda");
  const rigaSteer = crea("label", "riga-impostazione");
  rigaSteer.appendChild(crea("span", null, "Correzioni durante il lavoro"));
  const selezioneSteer = crea("select", "selettore");
  selezioneSteer.style.width = "220px";
  for (const [valore, etichetta] of [["one-at-a-time", "una per volta"], ["all", "tutte insieme"]]) {
    const opzione = crea("option", null, etichetta);
    opzione.value = valore;
    opzione.selected = (sessione.statoRpc.steeringMode || "one-at-a-time") === valore;
    selezioneSteer.appendChild(opzione);
  }
  selezioneSteer.onchange = () => rpc({ type: "set_steering_mode", mode: selezioneSteer.value }, { sessionId: sessione.id }).catch((errore) => toast(testoErrore(errore), "errore"));
  rigaSteer.appendChild(selezioneSteer);
  impostazioni.appendChild(rigaSteer);

  const rigaFollow = crea("label", "riga-impostazione");
  rigaFollow.appendChild(crea("span", null, "Richieste da fare dopo"));
  const selezioneFollow = selezioneSteer.cloneNode(true);
  selezioneFollow.value = sessione.statoRpc.followUpMode || "one-at-a-time";
  selezioneFollow.onchange = () => rpc({ type: "set_follow_up_mode", mode: selezioneFollow.value }, { sessionId: sessione.id }).catch((errore) => toast(testoErrore(errore), "errore"));
  rigaFollow.appendChild(selezioneFollow);
  impostazioni.appendChild(rigaFollow);

  const barraAuto = crea("div", "barra-modale");
  barraAuto.append(
    bottoneAzione("Spazio automatico: attiva", () => comandoBreve(sessione, { type: "set_auto_compaction", enabled: true })),
    bottoneAzione("Spazio automatico: disattiva", () => comandoBreve(sessione, { type: "set_auto_compaction", enabled: false })),
    bottoneAzione("Tentativi automatici: attiva", () => comandoBreve(sessione, { type: "set_auto_retry", enabled: true })),
    bottoneAzione("Tentativi automatici: disattiva", () => comandoBreve(sessione, { type: "set_auto_retry", enabled: false })),
    bottoneAzione("Annulla nuovi tentativi", () => comandoBreve(sessione, { type: "abort_retry" })),
  );
  impostazioni.appendChild(barraAuto);
  corpo.appendChild(impostazioni);

  const shell = sezioneAvanzata("Shell diretta");
  shell.appendChild(crea("p", "avviso-sicurezza", "Questo comando viene eseguito sul computer con i tuoi permessi e il risultato entra nel contesto di pi. Usalo solo se sai esattamente cosa fa."));
  const comandoShell = crea("textarea", "area-testo codice");
  comandoShell.placeholder = "Esempio: git status";
  comandoShell.setAttribute("aria-label", "Comando shell diretto");
  shell.appendChild(comandoShell);
  const barraShell = crea("div", "barra-modale");
  const outputShell = crea("pre", "risultato-codice", "Nessun comando eseguito.");
  sessione.bashUi = outputShell;
  barraShell.append(
    bottoneAzione("Esegui", () => eseguiBash(sessione, comandoShell.value, outputShell), "bottone primario"),
    bottoneAzione("Ferma shell", () => comandoBreve(sessione, { type: "abort_bash" })),
  );
  shell.append(barraShell, outputShell);
  corpo.appendChild(shell);

  const grezzo = sezioneAvanzata("Protocollo RPC completo");
  grezzo.appendChild(crea("p", "nota", "Serve per funzioni nuove o non ancora dotate di un pulsante. Inserisci un oggetto JSON del protocollo ufficiale di pi; la sessione viene aggiunta automaticamente."));
  const jsonCampo = crea("textarea", "area-testo codice");
  jsonCampo.setAttribute("aria-label", "Comando RPC in formato JSON");
  jsonCampo.value = '{\n  "type": "get_state"\n}';
  const risultato = crea("pre", "risultato-codice", "La risposta apparira qui.");
  const invia = bottoneAzione("Invia comando RPC", async () => {
    try {
      const comando = JSON.parse(jsonCampo.value);
      if (!comando.type) throw new Error("Manca il campo type");
      risultato.textContent = "Attendo pi…";
      risultato.textContent = JSON.stringify(await rpc(comando, { sessionId: sessione.id, timeout: 10 * 60 * 1000 }), null, 2);
    } catch (errore) {
      risultato.textContent = "Errore: " + testoErrore(errore);
    }
  }, "bottone primario");
  grezzo.append(jsonCampo, invia, risultato);
  corpo.appendChild(grezzo);
}

async function comandoBreve(sessione, comando) {
  try {
    await rpc(comando, { sessionId: sessione.id, timeout: 30000 });
    toast("Impostazione applicata.");
  } catch (errore) {
    toast(testoErrore(errore), "errore");
  }
}

async function apriPiCompleto(sessione) {
  const confermato = await conferma(
    "Aprire una nuova conversazione nel terminale?",
    "Si aprira PI nella stessa cartella, ma in una conversazione nuova e separata. La chat attuale restera nella GUI. Usa invece “Sposta questa conversazione” per continuare proprio questa cronologia nel terminale.",
    "Apri nuova conversazione",
  );
  if (!confermato) return;
  try {
    await chiedi("/api/apri-terminale", { corpo: { sessionId: sessione.id } });
    toast("PI completo aperto in una nuova finestra.");
  } catch (errore) {
    toast(testoErrore(errore), "errore");
  }
}

async function passaConversazioneAlTerminale(
  sessione,
  { confermaGiaData = false, retryGrace = true } = {},
) {
  await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
  if (APP.sessioni.get(sessione.id) !== sessione) return;
  if (sessione.erroreAllegatiBozza) {
    toast("Prima recupera o scarta esplicitamente le immagini mancanti della bozza.", "errore");
    return;
  }
  if (sessione.id === APP.attivaId && sessione.bozza !== DOM.input.value) {
    ramificaLineageBozza(sessione);
    sessione.bozza = DOM.input.value;
    sessione.bozzaSporca = true;
  }
  clearTimeout(timerSalvaBozza.get(sessione.id));
  timerSalvaBozza.delete(sessione.id);
  if (sessione.bozzaSporca) salvaBozza(sessione);
  if (sessione.bozza.length || sessione.allegati.length) {
    toast(
      "Prima copia, invia o cancella la bozza e rimuovi le immagini: il terminale puo ricevere soltanto la cronologia gia salvata.",
      "errore",
    );
    if (sessione.id === APP.attivaId) DOM.input.focus();
    return;
  }
  const confermato = confermaGiaData || await conferma(
    "Spostare questa conversazione nel terminale?",
    "La scheda GUI verra chiusa solo dopo aver salvato e fermato Pi. Il terminale aprira lo stesso file e la stessa cronologia, non una chat vuota. Torna alla GUI riaprendo poi la conversazione dall'elenco delle salvate.",
    "Sposta al terminale",
  );
  if (!confermato) return;
  // Blocca subito editor, allegati e RPC: tra il POST e l'evento di chiusura il
  // processo deve restare una fotografia esatta della cronologia gia salvata.
  sessione.handoffInCorso = true;
  aggiornaInterfacciaAttiva();
  await (sessione.codaAllegatiBozza || Promise.resolve()).catch(() => {});
  if (sessione.bozza.length || sessione.allegati.length) {
    sessione.handoffInCorso = false;
    aggiornaInterfacciaAttiva();
    toast("La bozza e cambiata: il passaggio al terminale e stato annullato.", "errore");
    return;
  }
  try {
    await chiedi("/api/handoff-terminale", { corpo: { sessionId: sessione.id } });
    toast("Conversazione trasferita a PI completo nel terminale.");
  } catch (errore) {
    sessione.handoffInCorso = false;
    aggiornaInterfacciaAttiva();
    if (errore?.code === "HANDOFF_CLIENT_RECONNECT_GRACE" && retryGrace) {
      const attesa = Math.min(6_000, Math.max(250, Number(errore.retryAfterMs) || 1_000));
      toast("Attendo che la finestra appena chiusa venga scollegata, poi riprovo…", "avviso");
      await attendiBrevemente(attesa + 100);
      if (APP.sessioni.get(sessione.id) === sessione) {
        return passaConversazioneAlTerminale(sessione, {
          confermaGiaData: true,
          retryGrace: false,
        });
      }
      return;
    }
    if (errore?.code === "HANDOFF_OTHER_CLIENT_CONNECTED") {
      const riprova = await conferma(
        "Chiudi l'altra finestra di Interfaccia Pi",
        "La stessa conversazione e ancora collegata da un'altra finestra, per esempio l'anteprima nel browser. Chiudila prima: il blocco protegge bozze e immagini non ancora inviate. Poi premi Riprova.",
        "Riprova",
      );
      if (riprova && APP.sessioni.get(sessione.id) === sessione) {
        return passaConversazioneAlTerminale(sessione, {
          confermaGiaData: true,
          retryGrace: true,
        });
      }
      return;
    }
    toast(testoErrore(errore), "errore");
  }
}

async function rinominaSessione(sessione, operazione = null) {
  const nome = await chiediTesto("Rinomina la conversazione", "Nome facile da riconoscere", sessione.nomeSessione || "");
  if (nome == null) {
    operazione?.annulla();
    return;
  }
  try {
    if (operazione) await operazione.rpc({ type: "set_session_name", name: nome.trim() });
    else await rpc({ type: "set_session_name", name: nome.trim() }, { sessionId: sessione.id });
    operazione?.completa();
    sessione.nomeSessione = nome.trim() || null;
    disegnaSchede();
    aggiornaInterfacciaAttiva();
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function clonaSessione(sessione, operazione = null) {
  const confermato = await conferma("Creare una copia?", "Pi duplichera il ramo attuale in una nuova conversazione salvata.", "Crea copia");
  if (!confermato) {
    operazione?.annulla();
    return;
  }
  try {
    const dati = operazione
      ? await operazione.rpc({ type: "clone" }, { timeout: 60000 })
      : await rpc({ type: "clone" }, { sessionId: sessione.id, timeout: 60000 });
    if (!dati.cancelled) {
      operazione?.completa();
      await sincronizzaSessione(sessione);
    } else operazione?.annullaConfermato();
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function scegliFork(sessione, operazione = null) {
  try {
    const dati = await chiedi("/api/forche", { corpo: { sessionId: sessione.id } });
    const corpo = apriModale("Crea una versione da un messaggio", {
      onCancel: () => operazione?.annulla(),
    });
    corpo.appendChild(crea("p", "nota", "Scegli il punto da cui ripartire. Il lavoro corrente resta nella cronologia."));
    if (dati.troncati) {
      corpo.appendChild(crea("p", "avviso-sicurezza", `La conversazione contiene ${dati.totale} richieste: mostro le ${dati.messages.length} piu recenti.`));
    }
    const lista = crea("div", "lista");
    for (const messaggio of dati.messages || []) {
      const bottone = crea("button", "voce");
      bottone.type = "button";
      bottone.appendChild(crea("span", "ico", "↳"));
      const testo = crea("span", "voce-testo");
      testo.appendChild(crea("strong", null, breve(messaggio.text) || "Messaggio"));
      const consentito = messaggio.forkConsentito !== false;
      testo.appendChild(crea(
        "small",
        null,
        consentito
          ? "Riparti da questo punto"
          : "Troppo grande per la GUI: usa Pi completo nel terminale",
      ));
      bottone.appendChild(testo);
      bottone.disabled = !consentito;
      bottone.onclick = async () => {
        try {
          const comando = { type: "fork", entryId: messaggio.entryId };
          const esito = operazione
            ? await operazione.rpc(comando, { timeout: 60000 })
            : await rpc(comando, { sessionId: sessione.id, timeout: 60000 });
          chiudiModale({ annulla: false });
          if (!esito.cancelled) {
            operazione?.completa();
            await sincronizzaSessione(sessione);
            ramificaLineageBozza(sessione);
            sessione.bozza = esito.text || messaggio.text || "";
            sessione.bozzaSporca = true;
            salvaBozza(sessione);
            if (sessione.id === APP.attivaId) {
              DOM.input.value = sessione.bozza;
              adattaAltezza();
              aggiornaInterfacciaAttiva();
              DOM.input.focus();
            }
          } else operazione?.annullaConfermato();
        } catch (errore) {
          operazione?.fallisce(errore);
          toast(testoErrore(errore), "errore");
        }
      };
      lista.appendChild(bottone);
    }
    if (!(dati.messages || []).length) lista.appendChild(crea("p", "vuoto", "Non ci sono ancora messaggi da cui ripartire."));
    corpo.appendChild(lista);
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

function ripristinaTestoEditorDopoNavigazione(sessione, editorText) {
  const testo = String(editorText || "");
  if (!testo.trim() || sessione.bozza.trim()) return false;
  if (sessione.id === APP.attivaId && DOM.input.value.trim()) return false;
  ramificaLineageBozza(sessione);
  sessione.bozza = testo;
  sessione.bozzaSporca = true;
  salvaBozza(sessione);
  if (sessione.id === APP.attivaId) {
    DOM.input.value = testo;
    adattaAltezza();
    aggiornaInterfacciaAttiva();
    DOM.input.focus();
  }
  return true;
}

function scegliRiassuntoNavigazioneAlbero(sessione, nodo, operazione = null) {
  let navigazioneId = null;
  let riassuntoInCorso = false;
  let annullamentoInCorso = null;
  let statoNavigazione = null;
  const richiediAnnullamento = () => {
    if (!riassuntoInCorso || !navigazioneId) return Promise.resolve(false);
    if (annullamentoInCorso) return annullamentoInCorso;
    if (statoNavigazione?.isConnected) statoNavigazione.textContent = "Chiedo a Pi di annullare il riassunto…";
    toast("Annullamento del riassunto richiesto…", "avviso");
    annullamentoInCorso = rpc(
      { type: "abort_branch_summary" },
      { sessionId: sessione.id, timeout: 15_000 },
    ).then(() => {
      if (statoNavigazione?.isConnected) statoNavigazione.textContent = "Pi ha ricevuto la richiesta di annullamento; attendo la chiusura del riassunto.";
      toast("Pi ha ricevuto la richiesta di annullamento del riassunto.", "avviso");
      return true;
    }).catch((errore) => {
      if (statoNavigazione?.isConnected) statoNavigazione.textContent = "Annullamento non confermato: " + testoErrore(errore);
      toast("Non riesco a confermare l'annullamento: " + testoErrore(errore), "errore");
      return false;
    });
    return annullamentoInCorso;
  };
  const corpo = apriModale("Come tornare a questo punto?", {
    onCancel: () => {
      if (riassuntoInCorso) void richiediAnnullamento();
      else operazione?.annulla();
    },
  });
  const modaleNavigazione = APP.modale;
  corpo.appendChild(crea(
    "p",
    "nota",
    "Il ramo successivo resta nella conversazione. Puoi conservarlo senza riassunto oppure farlo sintetizzare da Pi prima di cambiare punto.",
  ));
  const gruppo = crea("fieldset", "gruppo-scelte");
  gruppo.appendChild(crea("legend", null, "Riassunto del ramo che lasci"));
  const nomeGruppo = "riassunto-albero-" + globalThis.crypto.randomUUID();
  const scelte = [
    ["none", "Nessun riassunto", "Torna subito al punto scelto."],
    ["summary", "Riassumi il ramo", "Pi conserva una sintesi utile del lavoro successivo."],
    ["custom", "Riassumi con istruzioni personalizzate", "Indica cosa deve privilegiare la sintesi."],
  ];
  const radio = new Map();
  for (const [valore, titolo, descrizione] of scelte) {
    const riga = crea("label", "riga-impostazione");
    const input = crea("input");
    input.type = "radio";
    input.name = nomeGruppo;
    input.value = valore;
    input.checked = valore === "none";
    const testo = crea("span");
    testo.append(crea("strong", null, titolo), crea("small", null, descrizione));
    riga.append(input, testo);
    gruppo.appendChild(riga);
    radio.set(valore, input);
  }
  const istruzioni = crea("textarea", "campo");
  istruzioni.rows = 4;
  istruzioni.maxLength = LIMITE_TESTO_RICHIESTA;
  istruzioni.placeholder = "Per esempio: conserva decisioni, file modificati e problemi ancora aperti";
  istruzioni.setAttribute("aria-label", "Istruzioni personalizzate per il riassunto del ramo");
  istruzioni.disabled = true;
  const aggiornaIstruzioni = () => {
    istruzioni.disabled = !radio.get("custom").checked;
    if (!istruzioni.disabled) istruzioni.focus();
  };
  for (const input of radio.values()) input.onchange = aggiornaIstruzioni;
  statoNavigazione = crea("p", "nota", "Scegli un'opzione e conferma.");
  statoNavigazione.setAttribute("role", "status");
  statoNavigazione.setAttribute("aria-live", "polite");
  corpo.append(gruppo, istruzioni, statoNavigazione);

  const azioni = crea("div", "barra-modale");
  const indietro = crea("button", "bottone", "Torna all'albero");
  indietro.type = "button";
  indietro.onclick = async () => {
    if (riassuntoInCorso) {
      indietro.disabled = true;
      await richiediAnnullamento();
      return;
    }
    chiudiModale({ annulla: false, continuaCoda: false });
    await mostraAlberoSessione(sessione, { selezionatoId: nodo.id, operazione });
  };
  const vai = crea("button", "bottone primario", "Vai a questo punto");
  vai.type = "button";
  vai.onclick = async () => {
    const modalita = [...radio].find(([, input]) => input.checked)?.[0] || "none";
    if (modalita === "custom" && !istruzioni.value.trim()) {
      toast("Scrivi le istruzioni per il riassunto personalizzato oppure scegli un'altra opzione.", "avviso");
      istruzioni.focus();
      return;
    }
    vai.disabled = true;
    indietro.textContent = modalita === "none" ? "Navigazione in corso…" : "Annulla riassunto";
    indietro.disabled = modalita === "none";
    const options = {
      summarize: modalita !== "none",
      ...(modalita === "custom" ? { customInstructions: istruzioni.value.trim() } : {}),
    };
    try {
      navigazioneId = operazione?.nuovoIdRpc() || idRpc();
      riassuntoInCorso = options.summarize;
      statoNavigazione.textContent = options.summarize
        ? "Pi sta riassumendo il ramo. Puoi annullare con il pulsante, Esc o la X."
        : "Pi sta cambiando il punto della conversazione…";
      const comando = { type: "navigate_tree", id: navigazioneId, entryId: nodo.id, options };
      const esito = operazione
        ? await operazione.rpc(comando, {
            timeout: 10 * 60 * 1000,
            rpcId: navigazioneId,
            step: "tree:navigate",
          })
        : await rpc(comando, { sessionId: sessione.id, timeout: 10 * 60 * 1000 });
      if (esito.aborted) {
        operazione?.annullaConfermato();
        toast("Riassunto del ramo annullato; il punto non e cambiato.", "avviso");
        if (APP.modale === modaleNavigazione || DOM.velo.hidden) {
          await mostraAlberoSessione(sessione, { selezionatoId: nodo.id });
        }
        return;
      }
      if (esito.cancelled) {
        operazione?.annullaConfermato();
        toast("Navigazione annullata da Pi.", "avviso");
        vai.disabled = false;
        indietro.disabled = false;
        indietro.textContent = "Torna all'albero";
        return;
      }
      if (APP.modale === modaleNavigazione) chiudiModale({ annulla: false });
      operazione?.completa();
      await sincronizzaSessione(sessione, { silenzioso: false });
      ripristinaTestoEditorDopoNavigazione(sessione, esito.editorText);
      toast(modalita === "none"
        ? "Punto della conversazione cambiato."
        : "Ramo riassunto e punto della conversazione cambiato.");
    } catch (errore) {
      operazione?.fallisce(errore);
      vai.disabled = false;
      indietro.disabled = false;
      indietro.textContent = "Torna all'albero";
      toast(testoErrore(errore), "errore");
    } finally {
      riassuntoInCorso = false;
      navigazioneId = null;
    }
  };
  azioni.append(indietro, vai);
  corpo.appendChild(azioni);
  radio.get("none").focus();
}

async function mostraAlberoSessione(
  sessione,
  { selezionatoId = null, operazione = null } = {},
) {
  try {
    const dati = await chiedi("/api/albero", { corpo: { sessionId: sessione.id } });
    const corpo = apriModale("Albero della conversazione", {
      larga: true,
      onCancel: () => operazione?.annulla(),
    });
    corpo.appendChild(crea("p", "nota", "Scegli un punto per tornarci. La cronologia successiva resta come un altro ramo e non viene cancellata."));
    const lista = crea("div", "lista albero-selezionabile");
    for (const nodo of dati.nodi || []) {
      const riga = crea("div", "albero-riga");
      riga.style.paddingLeft = `${Math.min(Number(nodo.profondita) || 0, 20) * 12}px`;
      const bottone = crea("button", "voce");
      bottone.type = "button";
      const corrente = nodo.id === dati.leafId;
      bottone.disabled = corrente || !nodo.id;
      bottone.appendChild(crea("span", "ico", corrente ? "●" : "↳"));
      const testo = crea("span", "voce-testo");
      testo.appendChild(crea("strong", null, nodo.label || nodo.descrizione || nodo.type || "Voce della conversazione"));
      testo.appendChild(crea("small", null, corrente ? "Punto attuale" : `Vai al punto ${nodo.id}`));
      bottone.appendChild(testo);
      bottone.onclick = () => {
        chiudiModale({ annulla: false, continuaCoda: false });
        scegliRiassuntoNavigazioneAlbero(sessione, nodo, operazione);
      };
      if (nodo.id === selezionatoId && !bottone.disabled) {
        setTimeout(() => bottone.focus(), 0);
      }
      const etichetta = crea("button", "mini-azione", "Etichetta");
      etichetta.type = "button";
      etichetta.disabled = !nodo.id;
      etichetta.setAttribute("aria-label", `Modifica etichetta del punto ${nodo.id || ""}`);
      etichetta.onclick = async () => {
        chiudiModale({ annulla: false, continuaCoda: false });
        const valore = await chiediTesto("Etichetta questo punto", "Nome breve del ramo (vuoto per rimuoverla)", nodo.label || "");
        if (valore == null) {
          await mostraAlberoSessione(sessione, { selezionatoId: nodo.id, operazione });
          return;
        }
        try {
          const comando = { type: "set_label", entryId: nodo.id, label: valore.trim() || null };
          if (operazione) {
            await operazione.rpc(comando, {
              step: `tree:label:${nodo.id}`,
              finalStep: false,
            });
          } else await rpc(comando, { sessionId: sessione.id });
          toast("Etichetta aggiornata.");
          await mostraAlberoSessione(sessione, { selezionatoId: nodo.id, operazione });
        } catch (errore) {
          operazione?.fallisce(errore);
          toast(testoErrore(errore), "errore");
        }
      };
      riga.append(bottone, etichetta);
      lista.appendChild(riga);
    }
    if (!lista.children.length) lista.appendChild(crea("p", "vuoto", "Conversazione vuota."));
    corpo.appendChild(lista);
    corpo.appendChild(crea("p", "nota", `${dati.totale || 0} voci · punto attuale: ${dati.leafId || "nessuno"}.`));
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function copiaUltimaRisposta(sessione, operazione = null) {
  try {
    const risposta = await fetch("/api/ultima-risposta", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-gui-token": APP.tokenApi || "",
        "x-pi-gui-client": APP.clientId,
        "x-pi-gui-replay": APP.replayId,
      },
      body: JSON.stringify({ sessionId: sessione.id }),
    });
    if (!risposta.ok) {
      let messaggio = `Errore HTTP ${risposta.status}`;
      try {
        messaggio = (await risposta.json()).errore || messaggio;
      } catch {
        // Il codice HTTP resta comprensibile.
      }
      throw new Error(messaggio);
    }
    const testo = await risposta.text();
    if (testo) await copiaTesto(testo);
    else toast("Non c'e ancora una risposta di pi da copiare.", "avviso");
    operazione?.completa();
  } catch (errore) {
    operazione?.fallisce(errore);
    toast(testoErrore(errore), "errore");
  }
}

async function eseguiBash(
  sessione,
  comando,
  output = null,
  { excludeFromContext = false, testoComposer = null } = {},
) {
  if (!comando.trim()) return false;
  const fotografia = typeof testoComposer === "string" ? testoComposer : null;
  const precedente = fotografia
    ? sessione.inviiPendenti.find((invio) => (
        invio.origine === "shell" && invio.testo.trim() === fotografia.trim()
      ))
    : null;
  if (precedente) {
    toast(
      "Questo comando shell ha gia un esito da verificare. Controlla il pannello e non rieseguirlo alla cieca.",
      "avviso",
    );
    nascondiBozzaComandoDaVerificare(sessione, fotografia);
    return false;
  }
  const confermato = await conferma("Eseguire questo comando?", comando, "Esegui sul computer");
  if (!confermato) return false;
  // La conferma chiude la finestra avanzata: l'output resta anche nella chat.
  const id = idRpc();
  let registro = null;
  if (fotografia) {
    if (!sessione.lineageId) sessione.lineageId = globalThis.crypto.randomUUID();
    registro = PALETTE_CORE.creaRegistroShell({
      id,
      testo: fotografia,
      lineageId: sessione.lineageId,
      comando: comando.trim(),
      excludeFromContext,
    });
    if (!registro || !registraInvioPendente(sessione, registro)) {
      if (registro) dimenticaInvioPendente(sessione, registro.id);
      toast(
        "Il comando shell non e stato inviato: non riesco a creare il registro locale che impedisce una doppia esecuzione. Il testo resta nella casella.",
        "errore",
      );
      return false;
    }
  }
  const operationId = registro?.operationId || `gui-shell-${globalThis.crypto.randomUUID()}`;
  const nomeStrumento = excludeFromContext ? "shell fuori contesto" : "shell diretta";
  const strumentoComposer = output
    ? null
    : apriStrumento(sessione, "diretto-" + id, nomeStrumento, { command: comando.trim() });
  output = output || strumentoComposer.pre;
  sessione.bashCorrenteId = id;
  sessione.bashOutput = "";
  sessione.bashUi = output;
  output.textContent = "Esecuzione…";
  try {
    const dati = await rpc({
      type: "bash",
      command: comando.trim(),
      id,
      operationId,
      excludeFromContext: Boolean(excludeFromContext),
    }, { sessionId: sessione.id, timeout: 30 * 60 * 1000 });
    if (registro) {
      const registroCorrente = sessione.inviiPendenti.find((invio) => invio.id === id);
      if (registroCorrente && !dimenticaCopiaSicurezzaVerificata(sessione, registroCorrente)) {
        aggiornaStatoOperazionePendente(sessione, id, {
          statoComando: "confermato",
          erroreComando: "Pi ha concluso il comando, ma la conferma locale non puo essere archiviata.",
        });
        nascondiBozzaComandoDaVerificare(sessione, fotografia);
        toast(
          "Pi ha concluso il comando shell, ma non riesco a salvare la conferma locale. Non rieseguirlo.",
          "errore",
        );
      }
    }
    // Gli eventi contengono tutto l'output; la risposta finale puo essere
    // troncata e va usata solo se non e arrivato alcun chunk in streaming.
    const finale = sessione.bashOutput || dati.output || "(nessun output)";
    output.textContent = finale;
    const fallito = Boolean(dati.cancelled || (dati.exitCode && dati.exitCode !== 0));
    if (strumentoComposer) {
      strumentoComposer.esito.textContent = fallito ? "errore" : "fatto";
      strumentoComposer.box.classList.toggle("fallito", fallito);
      aggiornaGruppoDiStrumento(strumentoComposer);
    } else {
      apriStrumento(
        sessione,
        "diretto-" + id,
        nomeStrumento,
        { command: comando.trim() },
        finale,
        true,
        fallito,
      );
    }
    return !dati.cancelled;
  } catch (errore) {
    output.textContent = "Errore: " + testoErrore(errore);
    if (strumentoComposer) {
      strumentoComposer.esito.textContent = "errore";
      strumentoComposer.box.classList.add("fallito");
      aggiornaGruppoDiStrumento(strumentoComposer);
    }
    if (registro) {
      const registroCorrente = sessione.inviiPendenti.find((invio) => invio.id === id);
      const transizione = PALETTE_CORE.transizioneEsitoOperazione(
        registroCorrente || registro,
        errore?.esitoIgnoto
          ? { esitoIgnoto: true, error: testoErrore(errore) }
          : { success: false, error: testoErrore(errore) },
      );
      if (registroCorrente && transizione?.modifiche) {
        aggiornaStatoOperazionePendente(sessione, id, transizione.modifiche);
        nascondiBozzaComandoDaVerificare(sessione, fotografia);
      }
      toast(
        testoErrore(errore) + (errore?.esitoIgnoto
          ? " L'esito del comando shell non e verificabile: non rieseguirlo; la copia resta nel pannello."
          : " Il comando shell e stato rifiutato; la copia resta nel pannello per la verifica."),
        errore?.esitoIgnoto ? "avviso" : "errore",
      );
    } else {
      toast(testoErrore(errore), "errore");
    }
    return false;
  } finally {
    sessione.bashCorrenteId = null;
    sessione.bashUi = null;
  }
}

function gestisciAggiornamentoBash(sessione, evento) {
  if (evento.id && sessione.bashCorrenteId && evento.id !== sessione.bashCorrenteId) return;
  const pezzo = evento.delta ?? evento.output ?? evento.chunk ?? evento.data ?? "";
  const limite = 2 * 1024 * 1024;
  const nuovo = sessione.bashOutput + String(pezzo);
  sessione.bashOutput = nuovo.length > limite
    ? "…output precedente omesso; mostro gli ultimi 2 MB…\n" + nuovo.slice(-limite)
    : nuovo;
  if (sessione.bashUi) sessione.bashUi.textContent = sessione.bashOutput;
}

// ---------------------------------------------------------------------------
// UI richiesta dalle estensioni pi
// ---------------------------------------------------------------------------

function urlAutenticazioneSicuro(valore) {
  try {
    const url = new URL(String(valore || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function collegaBrowserSistema(collegamento, href, { dopoApertura = null } = {}) {
  collegamento.href = href;
  collegamento.target = "_blank";
  collegamento.rel = "noopener noreferrer";
  collegamento.onclick = async (evento) => {
    evento.preventDefault();
    if (collegamento.dataset.aperturaInCorso === "true") return;
    collegamento.dataset.aperturaInCorso = "true";
    collegamento.setAttribute("aria-busy", "true");
    try {
      await chiedi("/api/apri-url", { corpo: { url: href, confirmed: true } });
      dopoApertura?.();
    } catch (errore) {
      toast(`Non riesco ad aprire il browser: ${testoErrore(errore)}. Usa “Copia collegamento” come alternativa.`, "errore");
    } finally {
      delete collegamento.dataset.aperturaInCorso;
      collegamento.removeAttribute("aria-busy");
    }
  };
  return collegamento;
}

function aggiungiLinkAutenticazione(
  contenitore,
  etichetta,
  valore,
  { dopoPassaggio = null } = {},
) {
  const href = urlAutenticazioneSicuro(valore);
  if (!href) return false;
  const riga = crea("div", "barra-modale");
  const link = crea("a", "bottone", etichetta || "Apri collegamento");
  collegaBrowserSistema(link, href, { dopoApertura: () => dopoPassaggio?.() });
  riga.append(link, bottoneAzione("Copia collegamento", async () => {
    await copiaTesto(href);
    dopoPassaggio?.();
  }));
  contenitore.appendChild(riga);
  return true;
}

async function annullaLoginProvider(sessionId, loginCommandId, { motivo = "Accesso annullato dall'interfaccia." } = {}) {
  if (!sessionId || typeof loginCommandId !== "string" || !loginCommandId.trim()) return false;
  const chiave = `${sessionId}:${loginCommandId}`;
  if (APP.loginProviderAnnullati.has(chiave)) return false;
  APP.loginProviderAnnullati.add(chiave);
  try {
    await chiedi("/api/annulla-login-provider", {
      corpo: { sessionId, loginCommandId },
    });
    toast(motivo, "avviso");
    return true;
  } catch (errore) {
    // Nessun retry automatico: ripetere una cancellazione di autenticazione
    // dopo una risposta HTTP persa renderebbe ambiguo lo stato del provider.
    toast(`Non riesco a confermare l'annullamento dell'accesso: ${testoErrore(errore)}`, "errore");
    return false;
  }
}

function chiudiInterfacciaLoginProvider(sessione, loginCommandId) {
  const id = String(loginCommandId || "").trim();
  if (!sessione?.id || !id) return;
  const appartiene = (richiesta) => richiesta?.sessione === sessione
    && AUTH_FLOW.eventoDelLogin(richiesta.evento, id);
  APP.dialoghiEstensione = APP.dialoghiEstensione.filter((richiesta) => !appartiene(richiesta));
  const attivo = appartiene(APP.dialogoEstensioneAttivo);
  const contesto = APP.modale?.contesto;
  const notificaAttiva = contesto?.tipo === "login-provider"
    && contesto.sessionId === sessione.id
    && contesto.loginCommandId === id;
  if (attivo || notificaAttiva) chiudiModale({ annulla: false });
}

function mostraNotificaAutenticazione(sessione, evento) {
  const auth = evento?.authEvent;
  if (!auth || typeof auth !== "object" || !DOM.velo.hidden) return false;
  if (!["auth_url", "device_code", "info"].includes(auth.type)) return false;
  const loginCommandId = AUTH_FLOW.loginCommandIdEvento(evento);
  const contesto = {
    tipo: "login-provider",
    sessionId: sessione.id,
    loginCommandId,
  };
  const corpo = apriModale("Accesso al fornitore", {
    contesto,
    onCancel: loginCommandId
      ? () => void annullaLoginProvider(sessione.id, loginCommandId)
      : null,
  });
  const continuaNelBrowser = () => {
    const corrente = APP.modale?.contesto;
    if (
      corrente?.tipo === contesto.tipo
      && corrente.sessionId === contesto.sessionId
      && corrente.loginCommandId === contesto.loginCommandId
    ) chiudiModale({ annulla: false });
  };
  if (auth.type === "auth_url") {
    corpo.appendChild(crea("p", "nota", auth.instructions || "Apri il collegamento per continuare l'accesso."));
    if (!aggiungiLinkAutenticazione(corpo, "Apri pagina di accesso", auth.url, {
      dopoPassaggio: continuaNelBrowser,
    })) {
      chiudiModale({ annulla: false });
      return false;
    }
  } else if (auth.type === "device_code") {
    corpo.appendChild(crea("p", "nota", "Apri la pagina di verifica e inserisci questo codice:"));
    const codice = String(auth.userCode || "").slice(0, 256);
    const boxCodice = crea("div", "percorso-attuale", codice || "Codice non comunicato");
    corpo.appendChild(boxCodice);
    if (codice) corpo.appendChild(bottoneAzione("Copia codice", () => copiaTesto(codice)));
    aggiungiLinkAutenticazione(corpo, "Apri pagina di verifica", auth.verificationUri, {
      dopoPassaggio: continuaNelBrowser,
    });
  } else {
    if (auth.message) corpo.appendChild(crea("p", "nota", String(auth.message)));
    for (const link of Array.isArray(auth.links) ? auth.links.slice(0, 32) : []) {
      aggiungiLinkAutenticazione(corpo, String(link?.label || "Apri collegamento"), link?.url);
    }
  }
  return true;
}

function gestisciInterfacciaEstensione(sessione, evento) {
  if (evento.method === "notify") {
    if (mostraNotificaAutenticazione(sessione, evento)) return;
    toast(evento.message || "Notifica di un'estensione", evento.notifyType === "error" ? "errore" : evento.notifyType === "warning" ? "avviso" : "");
    return;
  }
  if (evento.method === "setStatus") {
    if (evento.statusText) sessione.statiEstensioni.set(evento.statusKey || evento.id, evento.statusText);
    else sessione.statiEstensioni.delete(evento.statusKey || evento.id);
    if (sessione.id === APP.attivaId) disegnaEstensioni(sessione);
    return;
  }
  if (evento.method === "setWidget") {
    const mappa = evento.widgetPlacement === "belowEditor" ? sessione.widgetSotto : sessione.widgetSopra;
    if (Array.isArray(evento.widgetLines)) mappa.set(evento.widgetKey || evento.id, evento.widgetLines);
    else mappa.delete(evento.widgetKey || evento.id);
    if (sessione.id === APP.attivaId) disegnaEstensioni(sessione);
    return;
  }
  if (evento.method === "setTitle") {
    sessione.titoloEstensione = evento.title || null;
    if (evento.title) {
      if (sessione.id === APP.attivaId) document.title = evento.title;
      sessione.nomeSessione = evento.title.replace(/^pi\s*[-—:]?\s*/i, "") || sessione.nomeSessione;
      disegnaSchede();
    } else if (sessione.id === APP.attivaId) {
      document.title = "Interfaccia pi";
    }
    return;
  }
  if (evento.method === "set_editor_text") {
    ramificaLineageBozza(sessione);
    sessione.bozza = evento.text || "";
    sessione.bozzaSporca = true;
    salvaBozza(sessione);
    if (sessione.id === APP.attivaId) {
      DOM.input.value = sessione.bozza;
      adattaAltezza();
      aggiornaInterfacciaAttiva();
      DOM.input.focus();
    }
    return;
  }
  if (["select", "confirm", "input", "editor"].includes(evento.method)) {
    const chiave = `${sessione.id}:${String(evento.id ?? "")}`;
    if (APP.dialoghiEstensioneVisti.has(chiave)) return;
    APP.dialoghiEstensioneVisti.add(chiave);
    // Gli id sono univoci nel protocollo RPC; il limite evita comunque che una
    // pagina aperta per settimane conservi una lista senza fine.
    if (APP.dialoghiEstensioneVisti.size > 512) {
      APP.dialoghiEstensioneVisti.delete(APP.dialoghiEstensioneVisti.values().next().value);
    }
    APP.dialoghiEstensione.push({ sessione, evento, chiave });
    mostraProssimoDialogoEstensione();
  }
}

function mostraProssimoDialogoEstensione() {
  if (!DOM.velo.hidden || APP.dialogoEstensioneAttivo || !APP.dialoghiEstensione.length) return;
  const richiesta = APP.dialoghiEstensione.shift();
  APP.dialogoEstensioneAttivo = richiesta;
  const { sessione, evento } = richiesta;
  const loginCommandId = AUTH_FLOW.loginCommandIdEvento(evento);
  const fallbackOAuth = AUTH_FLOW.richiestaFallbackOAuth(evento);
  const annullaAutenticazione = () => {
    if (loginCommandId) void annullaLoginProvider(sessione.id, loginCommandId);
  };
  let rispostaInviata = false;
  const rispondi = async (risposta) => {
    if (rispostaInviata) return;
    rispostaInviata = true;
    chiudiModale({ annulla: false });
    try {
      await inviaSenzaAttesa({ type: "extension_ui_response", id: evento.id, ...risposta }, sessione.id);
      if (risposta.cancelled) annullaAutenticazione();
      setTimeout(() => {
        if (
          DOM.velo.hidden
          && APP.attivaId === sessione.id
          && !DOM.input.disabled
        ) {
          DOM.input.focus();
        }
      }, 0);
    } catch (errore) {
      APP.dialoghiEstensioneVisti.delete(richiesta.chiave);
      toast("Non riesco a rispondere all'estensione: " + testoErrore(errore), "errore");
      setTimeout(() => gestisciInterfacciaEstensione(sessione, evento), 0);
    }
  };
  const corpo = apriModale(
    fallbackOAuth ? "Completa l'accesso nel browser" : (evento.title || "Richiesta di un'estensione"),
    {
    contesto: loginCommandId
      ? { tipo: "login-provider", sessionId: sessione.id, loginCommandId }
      : null,
    onCancel: () => {
      if (!rispostaInviata) {
        rispostaInviata = true;
        annullaAutenticazione();
        inviaSenzaAttesa({ type: "extension_ui_response", id: evento.id, cancelled: true }, sessione.id)
          .catch((errore) => {
            APP.dialoghiEstensioneVisti.delete(richiesta.chiave);
            toast("Non riesco ad annullare la richiesta: " + testoErrore(errore), "errore");
            setTimeout(() => gestisciInterfacciaEstensione(sessione, evento), 0);
          });
      }
    },
  });
  APP.dialogoEstensioneAttivo = richiesta;
  let idDescrizione = null;
  if (evento.message || fallbackOAuth) {
    const descrizione = crea("p", "nota", fallbackOAuth
      ? "Attendi il completamento nel browser: questa finestra si chiudera da sola. Solo se il ritorno automatico non funziona, incolla qui l'indirizzo completo della pagina finale oppure il codice di autorizzazione."
      : evento.message);
    idDescrizione = "descrizione-estensione";
    descrizione.id = idDescrizione;
    DOM.modale.setAttribute("aria-describedby", idDescrizione);
    corpo.appendChild(descrizione);
  }

  if (evento.method === "select") {
    const lista = crea("div", "lista");
    for (const opzione of evento.options || []) {
      const bottone = crea("button", "voce");
      bottone.type = "button";
      bottone.appendChild(crea("span", "ico", "›"));
      bottone.appendChild(crea("span", "voce-testo", String(opzione)));
      bottone.onclick = () => rispondi({ value: opzione });
      lista.appendChild(bottone);
    }
    corpo.appendChild(lista);
  } else if (evento.method === "confirm") {
    DOM.modalePiede.hidden = false;
    DOM.modalePiede.append(
      bottoneAzione("No", () => rispondi({ confirmed: false })),
      bottoneAzione("Si", () => rispondi({ confirmed: true }), "bottone primario"),
    );
  } else {
    const campo = crea(evento.method === "editor" ? "textarea" : "input", evento.method === "editor" ? "area-testo" : "campo");
    if (evento.method === "input") {
      campo.type = evento.sensitive ? "password" : "text";
      if (evento.sensitive) campo.autocomplete = "off";
    }
    campo.placeholder = fallbackOAuth
      ? "URL finale http://localhost:1455/auth/callback?... oppure codice"
      : (evento.placeholder || "");
    campo.value = evento.prefill || "";
    campo.setAttribute(
      "aria-label",
      evento.label || (evento.method === "editor" ? "Testo richiesto dall'estensione" : "Risposta richiesta dall'estensione"),
    );
    if (idDescrizione) campo.setAttribute("aria-describedby", idDescrizione);
    corpo.appendChild(campo);
    DOM.modalePiede.hidden = false;
    DOM.modalePiede.append(
      bottoneAzione("Annulla", () => rispondi({ cancelled: true })),
      bottoneAzione("Conferma", () => rispondi({ value: campo.value }), "bottone primario"),
    );
    requestAnimationFrame(() => campo.focus());
  }
  if (evento.timeout && APP.modale) {
    APP.modale.timer = setTimeout(() => rispondi({ cancelled: true }), evento.timeout);
  }
}

// ---------------------------------------------------------------------------
// Collegamenti dei controlli e avvio
// ---------------------------------------------------------------------------

const ESEMPI = [
  ["Spiegami come puoi aiutarmi", "per iniziare senza una cartella"],
  ["Lavora sul file C:\\percorso\\file.ext e spiegamelo", "per usare un percorso esplicito"],
  ["Esegui pi --version e mostrami il risultato", "per lanciare un comando"],
  ["Aiutami a pianificare il prossimo lavoro", "per ragionare insieme"],
];

function disegnaEsempi() {
  const lista = $("#lista-esempi");
  lista.replaceChildren();
  for (const [richiesta, nota] of ESEMPI) {
    const bottone = crea("button", "voce");
    bottone.type = "button";
    bottone.disabled = !sessioneAttiva();
    bottone.appendChild(crea("span", "ico", "💬"));
    const testo = crea("span", "voce-testo");
    testo.appendChild(crea("strong", null, richiesta));
    testo.appendChild(crea("small", null, nota));
    bottone.appendChild(testo);
    bottone.onclick = () => {
      const sessione = sessioneAttiva();
      if (!sessione) return;
      ramificaLineageBozza(sessione);
      sessione.bozza = richiesta;
      sessione.bozzaSporca = true;
      salvaBozza(sessione);
      DOM.input.value = sessione.bozza;
      adattaAltezza();
      aggiornaInterfacciaAttiva();
      DOM.input.focus();
      chiudiMenuLaterale();
    };
    lista.appendChild(bottone);
  }
}

document.querySelectorAll("[data-azione]").forEach((bottone) => {
  bottone.onclick = async () => {
    const ritornoFocus = window.matchMedia("(max-width: 650px)").matches
      ? $("#btn-menu")
      : bottone;
    chiudiMenuLaterale();
    const esito = eseguiAzione(bottone.dataset.azione);
    if (APP.modale) APP.modale.precedente = ritornoFocus;
    await esito;
    if (APP.modale) APP.modale.precedente = ritornoFocus;
  };
});
const btnMenu = $("#btn-menu");
const pannelloLaterale = $("#pannello-laterale");
const mediaMenuLaterale = window.matchMedia("(max-width: 650px)");

function aggiornaAccessibilitaMenu() {
  const compatto = mediaMenuLaterale.matches;
  const aperto = compatto && document.body.classList.contains("menu-aperto");
  pannelloLaterale.inert = compatto && !aperto;
  if (compatto && !aperto) pannelloLaterale.setAttribute("aria-hidden", "true");
  else pannelloLaterale.removeAttribute("aria-hidden");
  btnMenu.setAttribute("aria-expanded", String(aperto));
  btnMenu.setAttribute("aria-label", aperto ? "Chiudi azioni e comandi" : "Apri azioni e comandi");
}

function chiudiMenuLaterale({ ripristinaFocus = false } = {}) {
  const eraAperto = document.body.classList.contains("menu-aperto");
  document.body.classList.remove("menu-aperto");
  aggiornaAccessibilitaMenu();
  if (ripristinaFocus && eraAperto) btnMenu.focus();
}
btnMenu.onclick = () => {
  document.body.classList.toggle("menu-aperto");
  aggiornaAccessibilitaMenu();
};
mediaMenuLaterale.addEventListener?.("change", () => {
  document.body.classList.remove("menu-aperto");
  aggiornaAccessibilitaMenu();
});
aggiornaAccessibilitaMenu();
DOM.conversazione.addEventListener("click", () => {
  if (document.body.classList.contains("menu-aperto")) chiudiMenuLaterale();
});
DOM.conversazione.addEventListener("scroll", () => {
  const sessione = sessioneAttiva();
  if (!sessione) return;
  const distanza = DOM.conversazione.scrollHeight - DOM.conversazione.scrollTop - DOM.conversazione.clientHeight;
  sessione.seguiFondo = distanza < 72;
});
document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape" && DOM.velo.hidden) {
    if (APP.menuAzioniComposer.aperto) {
      evento.preventDefault();
      evento.stopPropagation();
      chiudiMenuAzioniComposer({ ripristinaFocus: true });
      return;
    }
    chiudiMenuLaterale({ ripristinaFocus: true });
  }
});
$("#btn-apri-cartella").onclick = () => apriSceltaCartella();
$("#btn-nuova-chat").onclick = () => avviaSessione(null, {
  senzaCartella: true,
  forzaNuova: true,
});
DOM.btnModello.onclick = () => apriSceltaModello();
DOM.btnRagionamento.onclick = apriSceltaRagionamento;
DOM.btnControlli.onclick = apriControlliAvanzati;
DOM.btnFermaTop.onclick = interrompi;
DOM.btnCercaComandi.onclick = () => apriRicercaComandi();
DOM.btnAllega.onclick = () => {
  if (APP.menuAzioniComposer.aperto) chiudiMenuAzioniComposer({ ripristinaFocus: true });
  else apriMenuAzioniComposer();
};
DOM.menuAzioniComposer.onclick = (evento) => {
  const voce = evento.target.closest("[data-azione-composer]");
  if (!voce || voce.disabled || !DOM.menuAzioniComposer.contains(voce)) return;
  void eseguiAzioneMenuComposer(voce.dataset.azioneComposer);
};
DOM.menuAzioniComposer.addEventListener("keydown", (evento) => {
  if (!APP.menuAzioniComposer.aperto) return;
  const voci = vociMenuAzioniComposer();
  const indiceCorrente = voci.indexOf(document.activeElement);
  if (indiceCorrente >= 0) APP.menuAzioniComposer.indiceAttivo = indiceCorrente;
  if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
    evento.preventDefault();
    spostaFocusMenuAzioniComposer(evento.key === "ArrowDown" ? 1 : -1);
  } else if (evento.key === "Home" || evento.key === "End") {
    evento.preventDefault();
    spostaFocusMenuAzioniComposer(evento.key === "Home" ? "inizio" : "fine");
  } else if (evento.key === "Escape") {
    evento.preventDefault();
    evento.stopPropagation();
    chiudiMenuAzioniComposer({ ripristinaFocus: true });
  } else if (evento.key === "Tab") {
    evento.preventDefault();
    chiudiMenuAzioniComposer();
    (evento.shiftKey ? DOM.btnAllega : DOM.input).focus();
  }
});
DOM.scegliImmagini.onchange = async () => {
  await aggiungiImmagini(DOM.scegliImmagini.files || []);
  DOM.scegliImmagini.value = "";
};
DOM.input.addEventListener("input", () => {
  const sessione = sessioneAttiva();
  if (sessione) {
    ramificaLineageBozza(sessione);
    sessione.bozza = DOM.input.value;
    sessione.bozzaSporca = true;
    programmaSalvaBozza(sessione);
  }
  adattaAltezza();
  aggiornaInterfacciaAttiva();
  if (!composizioneInputInCorso) aggiornaPaletteComandi();
});
DOM.input.addEventListener("keydown", (evento) => {
  if (evento.isComposing || composizioneInputInCorso) return;
  if (APP.paletteComandi.aperta) {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      spostaSelezionePalette(evento.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (evento.key === "Home" || evento.key === "End") {
      evento.preventDefault();
      spostaSelezionePalette(evento.key === "Home" ? "inizio" : "fine");
      return;
    }
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      chiudiPaletteComandi({ sopprimi: true });
      return;
    }
    if ((evento.key === "Tab" || (evento.key === "Enter" && !evento.shiftKey)) && APP.paletteComandi.risultati.length) {
      evento.preventDefault();
      completaSelezionePalette();
      return;
    }
  }
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    invia();
  }
});
DOM.input.addEventListener("compositionstart", () => {
  composizioneInputInCorso = true;
  chiudiPaletteComandi();
});
DOM.input.addEventListener("compositionend", () => {
  composizioneInputInCorso = false;
  aggiornaPaletteComandi({ forza: true });
});
for (const evento of ["click", "select", "focus"]) {
  DOM.input.addEventListener(evento, () => {
    if (!composizioneInputInCorso) aggiornaPaletteComandi();
  });
}
document.addEventListener("pointerdown", (evento) => {
  if (
    APP.menuAzioniComposer.aperto
    && evento.target !== DOM.btnAllega
    && !DOM.menuAzioniComposer.contains(evento.target)
  ) {
    chiudiMenuAzioniComposer();
  }
  if (APP.paletteComandi.aperta && !DOM.composerShell.contains(evento.target)) {
    chiudiPaletteComandi();
  }
});
DOM.btnInvia.onclick = invia;

window.addEventListener("beforeunload", (evento) => {
  const sessione = sessioneAttiva();
  if (sessione && (sessione.bozzaSporca || sessione.bozza !== DOM.input.value)) {
    if (sessione.bozza !== DOM.input.value) ramificaLineageBozza(sessione);
    sessione.bozza = DOM.input.value;
    sessione.bozzaSporca = true;
    salvaBozza(sessione);
  }
  // Le immagini usano IndexedDB, ma la scrittura puo essere ancora in corso o
  // fallire per quota/privacy: il refresh resta esplicitamente protetto.
  if (
    APP.attese.size
    || [...APP.sessioni.values()].some(
      (voce) => voce.allegati.length
        || voce.inviiPendenti.length
        || voce.bozzaNonPersistita
        || voce.invioNonPersistito,
    )
  ) {
    evento.preventDefault();
    evento.returnValue = "";
  }
});

window.addEventListener("storage", (evento) => {
  if (!evento.newValue) return;
  if (evento.key?.startsWith(PREFISSO_BOZZE_RISOLTE)) {
    try {
      applicaLineageRisolta(JSON.parse(evento.newValue)?.lineageId);
    } catch {
      // Un record incompleto non modifica bozze in memoria.
    }
    return;
  }
  if (!evento.key?.startsWith(PREFISSO_INVII_RISOLTI)) return;
  let id;
  try {
    id = JSON.parse(evento.newValue)?.id;
  } catch {
    return;
  }
  if (!id) return;
  for (const sessione of APP.sessioni.values()) {
    const prima = sessione.inviiPendenti.length;
    sessione.inviiPendenti = sessione.inviiPendenti.filter((invio) => invio.id !== id);
    if (sessione.inviiPendenti.length !== prima) void eliminaAllegatiInvio(id);
  }
  disegnaInviiDaVerificare();
});

async function avvio() {
  disegnaEsempi();
  mostraNessunaSessione();
  segnaStato("lavora", "collego il ponte…");
  try {
    const stato = await aggiornaDalPonte({ sostituisci: true });
    let preferita = null;
    try {
      preferita = localStorage.getItem("pi-gui-sessione-attiva");
    } catch {
      preferita = null;
    }
    const sessioni = [...APP.sessioni.values()];
    const preferitaViva = APP.sessioni.get(preferita)?.attiva ? preferita : null;
    const ultimaViva = APP.sessioni.get(stato.ultimaSessioneId)?.attiva
      ? stato.ultimaSessioneId
      : null;
    const sessioneIniziale = preferitaViva
      || ultimaViva
      || idSessioneDiRipiego();
    if (sessioneIniziale) attivaSessione(sessioneIniziale);
    const connesso = await collegaEventi();
    if (!connesso) throw new Error("Il flusso eventi del ponte non si apre");
    if (!APP.sessioni.size) {
      await avviaSessione(null, { senzaCartella: true, forzaNuova: true });
    }
    await Promise.all([...APP.sessioni.values()].map((sessione) => sincronizzaSessione(sessione)));
    APP.bridgeOnline = true;
    if (APP.attivaId) attivaSessione(APP.attivaId);
    else mostraNessunaSessione();
  } catch (errore) {
    ponteNonRaggiungibile();
    toast(testoErrore(errore), "errore");
    programmaRiconnessione();
  }
}

avvio();
