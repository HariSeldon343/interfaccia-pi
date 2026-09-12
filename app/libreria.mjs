import { createHash } from "node:crypto";
import { lstat, realpath, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve, isAbsolute } from "node:path";
import CORE from "./public/library-core.js";
import { creaSerializzatore, scriviFileAtomico } from "./persistenza-atomica.mjs";
import { documentoTestuale } from "./estrazione.mjs";
import { verificaDestinazionePercorsoReale } from "./estensioni-manifest.mjs";

const serializzaLibrerie = creaSerializzatore();
const CATEGORIE = new Set(["normativa", "audit", "client-evidence", "linee-guida", "web-clip", "documenti"]);
const STATI_ESTRAZIONE = new Set(["ok", "vuoto", "non-supportato", "errore"]);
const LIMITE_BYTE_INDICE = 32 * 1024 * 1024;
export const MASSIMO_FILE_OPERAZIONE = 200;
export const MASSIMO_BYTE_OPERAZIONE = 300 * 1024 * 1024;

function erroreLibreria(messaggio, statusHttp = 400) {
  return Object.assign(new Error(messaggio), { statusHttp });
}

function chiavePercorso(percorso) {
  const risolto = resolve(percorso);
  return process.platform === "win32" ? risolto.toLowerCase() : risolto;
}

function oggetto(valore) {
  return valore !== null && typeof valore === "object" && !Array.isArray(valore);
}

function testoValido(valore, massimo = 4096) {
  return typeof valore === "string" && valore.length > 0 && valore.length <= massimo && !/[\u0000-\u001f\u007f]/.test(valore);
}

function intero(valore) {
  return Number.isSafeInteger(valore) && valore >= 0;
}

export function quotaOperazioneConsentita({ numero, byte }, dimensione) {
  if (!intero(numero) || !intero(byte) || !intero(dimensione)) throw erroreLibreria("Contatori della libreria non validi.");
  if (numero >= MASSIMO_FILE_OPERAZIONE) throw erroreLibreria("L'operazione supera il massimo di 200 file.", 429);
  if (byte + dimensione > MASSIMO_BYTE_OPERAZIONE) throw erroreLibreria("L'operazione supera il massimo di 300 MiB.", 413);
  return { numero: numero + 1, byte: byte + dimensione };
}

function voceValida(voce, radice) {
  if (!oggetto(voce) || !CATEGORIE.has(voce.categoria) || !testoValido(voce.nome_originale, 240)
    || !testoValido(voce.percorso) || !isAbsolute(voce.percorso) || !testoValido(voce.mimeType, 200)
    || !intero(voce.dimensione) || voce.dimensione > CORE.LIMITE_FILE || typeof voce.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(voce.sha256)
    || !testoValido(voce.importato, 50) || !Number.isFinite(Date.parse(voce.importato))) return false;
  try { CORE.normalizzaPercorsoRelativo(voce.percorso_relativo_origine); } catch { return false; }
  if (chiavePercorso(dirname(voce.percorso)) !== chiavePercorso(join(radice, "raw", voce.categoria))) return false;
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(basename(voce.percorso))) return false;
  if (voce.testo !== null && voce.testo !== voce.percorso + ".testo.md") return false;
  const estrazione = voce.estrazione;
  return oggetto(estrazione) && STATI_ESTRAZIONE.has(estrazione.stato) && intero(estrazione.pagine)
    && intero(estrazione.caratteri) && typeof estrazione.motivo === "string" && estrazione.motivo.length <= 4000
    && testoValido(estrazione.parser, 200)
    && (estrazione.parser !== "testo-originale" || (documentoTestuale(voce.percorso) && voce.testo === null))
    && (voce.testo === null || ["ok", "vuoto"].includes(estrazione.stato));
}

function indiceValido(indice, radice) {
  return oggetto(indice) && indice.versione === 1 && oggetto(indice.voci)
    && Object.entries(indice.voci).every(([chiave, voce]) => /^[a-f0-9]{32}(?:-[a-f0-9]{64})?$/.test(chiave) && voceValida(voce, radice));
}

function stringaYaml(valore) {
  return JSON.stringify(String(valore));
}

function schedaWiki(voce, md5, testo) {
  const relativa = "raw/" + voce.categoria + "/" + basename(voce.percorso);
  return [
    "---", "type: source", "title: " + stringaYaml(voce.nome_originale),
    "fonte_primaria: " + stringaYaml("[[" + relativa + "]]"), "entity_collegata: \"TODO\"",
    "ente_emittente: \"TODO\"", "data_pubblicazione: null", "data_import_vault: " + stringaYaml(voce.importato),
    "parser: " + stringaYaml(voce.estrazione.parser), "hash_md5: " + stringaYaml(md5),
    "dimensione_byte: " + voce.dimensione, "pagine: " + voce.estrazione.pagine, "status: draft",
    "tags: [source, " + voce.categoria + "]", "---", "", "## Sintesi provvisoria", "",
    testo.trim() ? testo.trim().split(/\s+/).slice(0, 300).join(" ") : "testo non estratto", "",
  ].join("\n");
}

export function creaGestoreLibreria({ home, estrai, iniziaPreparazione = () => ({ termina() {} }), erroreHttp = erroreLibreria, serializza = serializzaLibrerie, scriviAtomico = scriviFileAtomico }) {
  async function infoSicura(percorso, tipo, { assente = false } = {}) {
    let info;
    try { info = await lstat(percorso); } catch (errore) {
      if (assente && errore.code === "ENOENT") return null;
      throw errore;
    }
    if (info.isSymbolicLink() || (tipo === "directory" && !info.isDirectory()) || (tipo === "file" && !info.isFile())) {
      throw erroreHttp("Percorso della libreria non sicuro: " + percorso, 409);
    }
    const reale = await realpath(percorso);
    try { await verificaDestinazionePercorsoReale(resolve(percorso), reale, process.platform); }
    catch { throw erroreHttp("Percorso della libreria non sicuro: " + percorso, 409); }
    return info;
  }

  async function directorySicura(percorso, crea = false) {
    const presente = await infoSicura(percorso, "directory", { assente: true });
    if (presente || !crea) return presente;
    await infoSicura(dirname(percorso), "directory");
    try { await mkdir(percorso); } catch (errore) { if (errore.code !== "EEXIST") throw errore; }
    return infoSicura(percorso, "directory");
  }

  async function radiceSessione(sessione, crea = false) {
    if (sessione.senzaCartella) {
      let percorso = resolve(home);
      await infoSicura(percorso, "directory");
      for (const parte of [".pi", "gui", "libreria"]) {
        percorso = join(percorso, parte);
        const presente = await directorySicura(percorso, crea);
        if (!presente) return join(resolve(home), ".pi", "gui", "libreria");
      }
      return percorso;
    }
    if (!testoValido(sessione.cartella) || !isAbsolute(sessione.cartella)) throw erroreHttp("La cartella di lavoro non è valida.", 400);
    const radice = resolve(sessione.cartella);
    await infoSicura(radice, "directory");
    return radice;
  }

  async function verificaStruttura(radice, categoria = null, crea = false) {
    await infoSicura(radice, "directory");
    const raw = join(radice, "raw");
    const presente = await directorySicura(raw, crea);
    if (categoria && presente) await directorySicura(join(raw, categoria), crea);
    await infoSicura(join(radice, ".ingest-index.json"), "file", { assente: true });
    const wiki = join(radice, "wiki");
    const haWiki = await directorySicura(wiki);
    return Boolean(haWiki && await directorySicura(join(wiki, "sources")));
  }

  async function caricaIndice(radice) {
    const percorso = join(radice, ".ingest-index.json");
    const info = await infoSicura(percorso, "file", { assente: true });
    const nuovo = (avviso) => ({ indice: { versione: 1, voci: {} }, avvisi: [avviso] });
    if (!info) return nuovo("Indice della libreria assente: creato un nuovo indice; i file esistenti sono conservati.");
    if (info.size > LIMITE_BYTE_INDICE) throw erroreHttp("L'indice della libreria supera il limite di lettura di 32 MiB.", 413);
    let indice;
    try { indice = JSON.parse(await readFile(percorso, "utf8")); } catch (errore) {
      if (!(errore instanceof SyntaxError)) throw errore;
    }
    return indiceValido(indice, radice) ? { indice, avvisi: [] }
      : nuovo("Indice della libreria corrotto: ricreato senza cancellare i file esistenti.");
  }

  async function riferimentoVoce(voce) {
    const percorso = voce.testo || (voce.estrazione.parser === "testo-originale" && documentoTestuale(voce.percorso) ? voce.percorso : null);
    if (!percorso || !["ok", "vuoto"].includes(voce.estrazione.stato)) return null;
    const info = await infoSicura(percorso, "file");
    return { nome: voce.testo ? voce.nome_originale + ".testo.md" : voce.nome_originale, percorso,
      mimeType: voce.testo ? "text/markdown" : voce.mimeType, dimensione: info.size };
  }

  function serializzaIndice(indice) {
    const contenuto = JSON.stringify(indice, null, 2) + "\n";
    if (Buffer.byteLength(contenuto, "utf8") > LIMITE_BYTE_INDICE) {
      throw erroreHttp("L'indice della libreria supererebbe il limite di 32 MiB; il documento non è stato aggiunto.", 413);
    }
    return contenuto;
  }

  async function nomeDisponibile(directory, nome, sha256, dimensione) {
    for (let versione = 1; versione <= 10000; versione += 1) {
      const candidato = join(directory, CORE.nomeLibreria(nome, versione));
      const raw = await infoSicura(candidato, "voce", { assente: true });
      const testo = await infoSicura(candidato + ".testo.md", "voce", { assente: true });
      if (!raw && !testo) return { percorso: candidato, duplicato: false };
      if (raw?.isFile() && raw.size === dimensione
        && createHash("sha256").update(await readFile(candidato)).digest("hex") === sha256) {
        return { percorso: candidato, duplicato: true };
      }
    }
    throw erroreHttp("Troppi nomi uguali nella libreria.", 409);
  }

  async function recuperaSidecar(percorso) {
    const info = await infoSicura(percorso + ".testo.md", "file", { assente: true });
    if (!info || info.size > 32 * 1024 * 1024) return null;
    const contenuto = await readFile(percorso + ".testo.md", "utf8");
    const intestazione = /^# Testo estratto da [^\n]*\nFonte: [^\n]*\nPagine: (\d+)\nCaratteri: (\d+)\nEstratto il: [^\n]+\nParser: ([^\n]+)\nDocumento lungo: leggere con offset e limit\n\n/.exec(contenuto);
    if (!intestazione) return null;
    const pagine = Number(intestazione[1]);
    const caratteri = Number(intestazione[2]);
    const parser = intestazione[3];
    if (!intero(pagine) || !intero(caratteri) || caratteri > 5_000_000 || !testoValido(parser, 200) || parser === "testo-originale") return null;
    const corpo = contenuto.slice(intestazione[0].length);
    const separatore = corpo.lastIndexOf("\n");
    if (separatore < 0) return null;
    const testo = corpo.slice(0, separatore);
    const motivo = corpo.slice(separatore + 1);
    return { stato: testo.trim() ? "ok" : "vuoto", pagine, caratteri, parser, testo, contenuto, motivo };
  }

  async function creaScheda(radice, voce, md5, testo, primaPubblicazione, riparaIndice = false) {
    const file = CORE.nomeLibreria(voce.nome_originale);
    const estensione = CORE.estensioneFile(file);
    const base = (estensione ? file.slice(0, -estensione.length - 1) + "-" + estensione : file);
    if (riparaIndice) {
      const fonte = "fonte_primaria: " + stringaYaml("[[raw/" + voce.categoria + "/" + basename(voce.percorso) + "]]");
      for (const nome of await readdir(join(radice, "wiki", "sources"))) {
        if (nome !== base + ".md" && !(nome.startsWith(base + "-v") && nome.endsWith(".md"))) continue;
        const percorso = join(radice, "wiki", "sources", nome);
        const info = await infoSicura(percorso, "voce");
        if (!info.isFile() || info.size > CORE.LIMITE_FILE) continue;
        const righe = (await readFile(percorso, "utf8")).split(/\r?\n/);
        if (righe.includes(fonte) && righe.includes("hash_md5: " + stringaYaml(md5))) return;
      }
    }
    for (let versione = 1; versione <= 10000; versione += 1) {
      const destinazione = join(radice, "wiki", "sources", base + (versione > 1 ? "-v" + versione : "") + ".md");
      if (await infoSicura(destinazione, "voce", { assente: true })) continue;
      try {
        await scriviAtomico(destinazione, schedaWiki(voce, md5, testo), {
          esclusivo: true, primaPubblicazione,
        });
        return;
      } catch (errore) { if (errore.code !== "EEXIST") throw errore; }
    }
    throw erroreHttp("Troppi nomi uguali nelle schede wiki.", 409);
  }

  async function indicizza(sessione, { nome, percorsoRelativo, mimeType, dati, ancoraValida = () => true }) {
    const preparazione = iniziaPreparazione(sessione.id);
    const { generazione } = preparazione;
    try {
      if (!testoValido(nome, 240) || /[\\/]/.test(nome) || !testoValido(mimeType, 200) || !Buffer.isBuffer(dati)) {
        throw erroreHttp("I dati del documento non sono validi.", 400);
      }
      let relativo;
      try { relativo = CORE.normalizzaPercorsoRelativo(percorsoRelativo); } catch { throw erroreHttp("Percorso relativo non valido.", 400); }
      if (dati.length > CORE.LIMITE_FILE) throw erroreHttp("Il file supera il limite di 10 MiB.", 413);
      const esclusione = CORE.motivoEsclusione({ nome, percorsoRelativo: relativo, dimensione: dati.length });
      if (esclusione) return { esito: "saltato", motivo: esclusione, voce: null, riferimento: null, avvisi: [] };
      const radice = await radiceSessione(sessione, true);
      return await serializza(chiavePercorso(radice), async () => {
        if (!ancoraValida()) throw erroreHttp("La sessione è stata chiusa o modificata.", 409);
        await verificaStruttura(radice);
        const { indice, avvisi } = await caricaIndice(radice);
        const md5 = createHash("md5").update(dati).digest("hex");
        const sha256 = createHash("sha256").update(dati).digest("hex");
        const percorsoIndice = join(radice, ".ingest-index.json");
        for (const chiave of [md5, md5 + "-" + sha256]) {
          const voce = indice.voci[chiave];
          if (!voce || voce.sha256 !== sha256) continue;
          await verificaStruttura(radice, voce.categoria);
          const info = await infoSicura(voce.percorso, "file");
          if (info.size !== voce.dimensione || info.size > CORE.LIMITE_FILE) continue;
          if (createHash("sha256").update(await readFile(voce.percorso)).digest("hex") !== sha256) continue;
          const riferimento = await riferimentoVoce(voce);
          if (!ancoraValida()) throw erroreHttp("La sessione è stata chiusa o modificata.", 409);
          return { esito: "duplicato", motivo: "Contenuto già presente nella libreria.", voce, radice, percorsoIndice, riferimento, avvisi };
        }
        const categoria = CORE.categoriaFile(nome);
        await verificaStruttura(radice, categoria);
        const { percorso, duplicato } = await nomeDisponibile(join(radice, "raw", categoria), nome, sha256, dati.length);
        const recuperata = duplicato && !documentoTestuale(nome) ? await recuperaSidecar(percorso) : null;
        if (!ancoraValida()) throw erroreHttp("La sessione è stata chiusa o modificata.", 409);
        const estrazione = recuperata || await estrai(sessione.id, { nome, dati, generazione });
        if (estrazione.annullata || !ancoraValida()) throw erroreHttp(estrazione.motivo || "Indicizzazione annullata per chiusura.", 409);
        const haWiki = await verificaStruttura(radice, categoria, true);
        const testo = typeof estrazione.contenuto === "string" ? percorso + ".testo.md" : null;
        const voce = { percorso, nome_originale: nome, percorso_relativo_origine: relativo, categoria, mimeType,
          dimensione: dati.length, sha256, importato: new Date().toISOString(), testo,
          estrazione: { stato: estrazione.stato, pagine: estrazione.pagine, caratteri: estrazione.caratteri,
            motivo: estrazione.motivo || "", parser: estrazione.parser } };
        if (!voceValida(voce, radice)) throw erroreHttp("Il risultato dell'estrazione non è valido.", 500);
        indice.voci[indice.voci[md5] ? md5 + "-" + sha256 : md5] = voce;
        const contenutoIndice = serializzaIndice(indice);
        const primaPubblicazione = async () => {
          if (!ancoraValida()) throw erroreHttp("Indicizzazione annullata per chiusura della sessione.", 409);
          await verificaStruttura(radice, categoria);
        };
        if (!duplicato) await scriviAtomico(percorso, dati, { esclusivo: true, primaPubblicazione });
        if (testo && (!duplicato || !await infoSicura(testo, "file", { assente: true }))) {
          await scriviAtomico(testo, estrazione.contenuto, { esclusivo: true, primaPubblicazione });
        }
        if (haWiki && !sessione.senzaCartella) await creaScheda(radice, voce, md5, estrazione.testo || "", primaPubblicazione, duplicato);
        await scriviAtomico(percorsoIndice, contenutoIndice, { primaPubblicazione });
        return { esito: duplicato ? "duplicato" : "indicizzato", motivo: duplicato ? "indice riparato" : estrazione.motivo || "",
          voce, radice, percorsoIndice, riferimento: await riferimentoVoce(voce), avvisi };
      });
    } finally {
      preparazione.termina();
    }
  }

  async function stato(sessione) {
    const radice = await radiceSessione(sessione);
    const percorsoIndice = join(radice, ".ingest-index.json");
    return serializza(chiavePercorso(radice), async () => {
      if (!await infoSicura(radice, "directory", { assente: true })) return { radice, percorsoIndice, numero: 0, ultime: [], avvisi: [] };
      await verificaStruttura(radice);
      const { indice, avvisi } = await caricaIndice(radice);
      const voci = Object.values(indice.voci);
      return { radice, percorsoIndice, numero: voci.length, ultime: voci.sort((prima, seconda) => seconda.importato.localeCompare(prima.importato)).slice(0, 10), avvisi };
    });
  }

  return { indicizza, stato };
}
