// Il registro appartiene alla GUI: non si scrive mai nelle risorse personali di Pi.
import { mkdir, open, rm, lstat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { creaSerializzatore, scriviFileAtomico } from "./persistenza-atomica.mjs";
import { leggiFileRegolare, verificaPercorsoRegolare } from "./estensioni-manifest.mjs";

const serializza = creaSerializzatore();
const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const VERSIONE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export const DURATA_LOCK_ESTENSIONI_MS = 5 * 60 * 1000;

export function erroreEstensioni(messaggio, code = "ESTENSIONI_INVALID", statusHttp = 400) {
  return Object.assign(new Error(messaggio), { code, statusHttp, statusCode: statusHttp });
}

export function registroEstensioniVuoto() {
  return { schemaVersion: 1, versioneArchivio: 0, estensioni: [], risorsePersonali: [] };
}

export function radiceProgrammiEstensioni({ home = homedir(), env = process.env, platform = process.platform } = {}) {
  const base = platform === "win32"
    ? env.LOCALAPPDATA || join(home, "AppData", "Local")
    : env.XDG_DATA_HOME || join(home, ".local", "share");
  // LOCALAPPDATA/XDG sono radici autorizzate, come home: risolviamo una
  // sola volta gli alias del profilo, senza accettare link dentro i programmi.
  let esistente = resolve(base);
  const mancanti = [];
  while (true) {
    try { return resolve(realpathSync(esistente), ...mancanti, "it.amodeo.interfaccia-pi", "estensioni"); }
    catch (errore) {
      if (errore.code !== "ENOENT") throw errore;
      const padre = dirname(esistente);
      if (padre === esistente) throw errore;
      mancanti.unshift(esistente.slice(padre.length).replace(/^[\\/]+/u, ""));
      esistente = padre;
    }
  }
}

function processoEsiste(pid) {
  try { process.kill(pid, 0); return true; }
  catch (errore) {
    if (errore.code === "ESRCH") return false;
    // EPERM indica un processo esistente che non possiamo interrogare.
    if (errore.code === "EPERM") return true;
    throw errore;
  }
}

function campiChiusi(oggetto, campi) {
  return oggetto && typeof oggetto === "object" && !Array.isArray(oggetto)
    && Object.keys(oggetto).every((chiave) => campi.includes(chiave));
}

export function validaRegistroEstensioni(registro) {
  const invalido = () => { throw erroreEstensioni("Il registro delle estensioni non è valido.", "ESTENSIONI_REGISTRO_INVALID", 500); };
  if (!campiChiusi(registro, ["schemaVersion", "versioneArchivio", "estensioni", "risorsePersonali"])
    || registro.schemaVersion !== 1 || !Number.isSafeInteger(registro.versioneArchivio) || registro.versioneArchivio < 0
    || !Array.isArray(registro.estensioni) || !Array.isArray(registro.risorsePersonali)) invalido();
  const ids = new Set();
  for (const voce of registro.estensioni) {
    if (!campiChiusi(voce, ["id", "versioneInstallata", "versioniPresenti", "attiva", "attivaApplicata", "versioneApplicata", "installataIl", "origine", "chiaveId", "statoApplicazione"])
      || typeof voce.id !== "string" || voce.id.length > 64 || !ID.test(voce.id) || ids.has(voce.id)
      || !VERSIONE.test(voce.versioneInstallata) || !Array.isArray(voce.versioniPresenti)
      || !voce.versioniPresenti.every((v) => typeof v === "string" && VERSIONE.test(v))
      || new Set(voce.versioniPresenti).size !== voce.versioniPresenti.length
      || !voce.versioniPresenti.includes(voce.versioneInstallata)
      || typeof voce.attiva !== "boolean" || typeof voce.attivaApplicata !== "boolean"
      || (voce.versioneApplicata !== null && !voce.versioniPresenti.includes(voce.versioneApplicata))
      || voce.attivaApplicata !== (voce.versioneApplicata !== null)
      || typeof voce.installataIl !== "string" || !Number.isFinite(Date.parse(voce.installataIl))
      || typeof voce.origine !== "string" || typeof voce.chiaveId !== "string"
      || !["Applicata", "Da applicare"].includes(voce.statoApplicazione)) invalido();
    ids.add(voce.id);
  }
  const percorsi = new Set();
  for (const voce of registro.risorsePersonali) {
    if (!campiChiusi(voce, ["percorso", "attiva", "attivaApplicata", "sha256", "sha256Applicata"])
      || typeof voce.percorso !== "string" || !voce.percorso || percorsi.has(voce.percorso)
      || typeof voce.attiva !== "boolean" || typeof voce.attivaApplicata !== "boolean"
      || typeof voce.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(voce.sha256)
      || (voce.sha256Applicata !== null && (typeof voce.sha256Applicata !== "string" || !/^[a-f0-9]{64}$/u.test(voce.sha256Applicata)))
      || voce.attivaApplicata !== (voce.sha256Applicata !== null)) invalido();
    percorsi.add(voce.percorso);
  }
  return registro;
}

export function verificaVersioneArchivio(registro, versioneAttesa) {
  if (!Number.isSafeInteger(versioneAttesa) || versioneAttesa < 0) {
    throw erroreEstensioni("La versione attesa del registro è obbligatoria.");
  }
  if (registro.versioneArchivio !== versioneAttesa) {
    throw erroreEstensioni("Il registro delle estensioni è cambiato. Ricarica il pannello.", "ESTENSIONI_CONFLITTO", 409);
  }
}

// Controlla anche gli antenati che esistono già quando la directory finale non
// esiste ancora: una giunzione non può trasformare mkdir in una scrittura altrove.
export async function verificaAntenatiEstensioni(directory) {
  let corrente = resolve(directory);
  while (true) {
    try { await lstat(corrente); break; }
    catch (errore) {
      if (errore.code !== "ENOENT") throw errore;
      const padre = dirname(corrente);
      if (padre === corrente) throw errore;
      corrente = padre;
    }
  }
  await verificaPercorsoRegolare(corrente, { directory: true });
}

export function creaArchivioEstensioni({ home = homedir(), percorso = join(home, ".pi", "gui", "estensioni.json"), scriviFile = scriviFileAtomico,
  ora = Date.now, pidEsiste = processoEsiste } = {}) {
  percorso = resolve(percorso);
  const lock = percorso + ".lock";
  async function leggiLock() {
    try {
      await verificaAntenatiEstensioni(dirname(percorso));
      const info = await lstat(lock);
      const bytes = await leggiFileRegolare(lock, 4096);
      let dati;
      try { dati = JSON.parse(bytes.toString("utf8")); } catch { dati = null; }
      return { info, bytes, dati };
    } catch (errore) {
      if (errore.code === "ENOENT") return null;
      throw errore;
    }
  }
  async function rimuoviLockSeUguale(atteso) {
    const corrente = await leggiLock();
    if (corrente && corrente.info.ino === atteso.info.ino && corrente.info.dev === atteso.info.dev
      && corrente.bytes.equals(atteso.bytes)) await rm(lock, { force: true });
  }
  async function pulisciLockMorto() {
    const corrente = await leggiLock();
    if (!corrente) return;
    const { dati, info } = corrente;
    const valido = Number.isSafeInteger(dati?.pid) && dati.pid > 0
      && Number.isSafeInteger(dati?.creatoIl) && dati.creatoIl > 0;
    // Un lock vuoto può essere appena stato aperto da un altro processo:
    // senza metadati lo recuperiamo soltanto dopo la soglia di cinque minuti.
    const scaduto = ora() - (valido ? dati.creatoIl : info.mtimeMs) >= DURATA_LOCK_ESTENSIONI_MS;
    if (scaduto || (valido && !pidEsiste(dati.pid))) await rimuoviLockSeUguale(corrente);
  }
  const pronto = serializza(percorso, pulisciLockMorto);
  // La pulizia parte all'apertura; l'eventuale errore viene consegnato alla
  // prima operazione, anche quando il chiamante non usa subito l'archivio.
  pronto.catch(() => {});
  async function leggi() {
    await pronto;
    try {
      await verificaAntenatiEstensioni(dirname(percorso));
      const info = await lstat(percorso);
      if (!info.isFile() || info.isSymbolicLink()) throw erroreEstensioni("Il registro delle estensioni non è un file regolare.");
      return validaRegistroEstensioni(JSON.parse((await leggiFileRegolare(percorso, 8 * 1024 * 1024)).toString("utf8")));
    } catch (errore) {
      if (errore.code === "ENOENT") return registroEstensioniVuoto();
      if (errore instanceof SyntaxError) throw erroreEstensioni("Il registro delle estensioni non è leggibile.", "ESTENSIONI_REGISTRO_INVALID", 500);
      throw errore;
    }
  }

  async function modifica(versioneAttesa, cambia) {
    await pronto;
    return serializza(percorso, async () => {
      // Una lettura obsoleta non crea nemmeno la cartella del registro.
      verificaVersioneArchivio(await leggi(), versioneAttesa);
      await verificaAntenatiEstensioni(dirname(percorso));
      await mkdir(dirname(percorso), { recursive: true });
      await verificaAntenatiEstensioni(dirname(percorso));
      let handle;
      const proprietario = randomUUID();
      const verificaLock = async () => {
        const dati = (await leggiLock())?.dati;
        if (dati?.proprietario !== proprietario || !Number.isSafeInteger(dati.creatoIl)
          || ora() - dati.creatoIl >= DURATA_LOCK_ESTENSIONI_MS) {
          throw erroreEstensioni("Il blocco del registro è scaduto. Ricarica il pannello e riprova.", "ESTENSIONI_CONFLITTO", 409);
        }
      };
      try {
        await pulisciLockMorto();
        try { handle = await open(lock, "wx", 0o600); }
        catch (errore) {
          if (errore.code === "EEXIST") throw erroreEstensioni("Il registro delle estensioni è in aggiornamento. Riprova.", "ESTENSIONI_CONFLITTO", 409);
          throw errore;
        }
        await handle.writeFile(JSON.stringify({ pid: process.pid, creatoIl: ora(), proprietario }) + "\n", "utf8");
        await handle.sync();
        const corrente = await leggi();
        verificaVersioneArchivio(corrente, versioneAttesa);
        const aggiornato = await cambia(structuredClone(corrente));
        const prossimo = validaRegistroEstensioni({ ...aggiornato, schemaVersion: 1, versioneArchivio: corrente.versioneArchivio + 1 });
        await scriviFile(percorso, JSON.stringify(prossimo, null, 2) + "\n", {
          primaPubblicazione: async () => { await verificaAntenatiEstensioni(dirname(percorso)); await verificaLock(); },
        });
        return structuredClone(prossimo);
      } finally {
        if (handle) {
          await handle.close();
          await verificaAntenatiEstensioni(dirname(percorso));
          const corrente = await leggiLock();
          if (corrente?.dati?.proprietario === proprietario) await rimuoviLockSeUguale(corrente);
        }
      }
    });
  }

  const salva = (registro, versioneAttesa) => modifica(versioneAttesa, () => registro);
  return { percorso, leggi, salva, modifica };
}
