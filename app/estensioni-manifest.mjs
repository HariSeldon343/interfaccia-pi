import { createHash, verify } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { chiaveEstensione, PORTACHIAVI_ESTENSIONI } from "./estensioni-chiavi.mjs";
import { VERSIONE_HOST } from "./versione-host.mjs";

export const NOME_MANIFESTO = "manifesto-estensione.json";
export const NOME_FIRMA = "manifest.sig";
export const LIMITI_ESTENSIONI = Object.freeze({
  manifestoByte: 2 * 1024 * 1024,
  file: 20_000,
  byte: 512 * 1024 * 1024,
  percorso: 240,
});
const CAMPI = ["schemaVersion", "id", "nome", "versione", "editore", "descrizione", "categoria", "host", "pi", "pannelli", "backend", "files", "limiti", "chiaveId"];
const METADATI = new Set([NOME_MANIFESTO, NOME_FIRMA]);

function errore(testo, code = "ESTENSIONE_NON_VALIDA") {
  return Object.assign(new Error(testo), { code });
}

function campiChiusi(valore, campi, etichetta) {
  if (!valore || typeof valore !== "object" || Array.isArray(valore)
    || Object.keys(valore).some((campo) => !campi.includes(campo))) {
    throw errore(`${etichetta}: campi non previsti o struttura non valida`);
  }
}

function testo(valore, massimo = 1000) {
  return typeof valore === "string" && valore.trim().length > 0
    && valore.length <= massimo && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(valore);
}

export function triplettaVersione(valore) {
  if (typeof valore !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(valore)) {
    throw errore(`Versione non numerica: ${String(valore)}`);
  }
  const parti = valore.split(".").map(Number);
  if (parti.some((parte) => !Number.isSafeInteger(parte))) throw errore("Versione numerica oltre il limite");
  return parti;
}

export function confrontaVersioni(a, b) {
  const sinistra = triplettaVersione(a);
  const destra = triplettaVersione(b);
  for (let i = 0; i < 3; i += 1) {
    if (sinistra[i] !== destra[i]) return sinistra[i] < destra[i] ? -1 : 1;
  }
  return 0;
}

export function versioneHostCompatibile(versione, host) {
  campiChiusi(host, ["minInclusa", "maxEsclusa"], "Intervallo host");
  if (confrontaVersioni(host.minInclusa, host.maxEsclusa) >= 0) throw errore("Intervallo host vuoto o invertito");
  return confrontaVersioni(versione, host.minInclusa) >= 0 && confrontaVersioni(versione, host.maxEsclusa) < 0;
}

export function limitiEstensioni(limiti = {}) {
  campiChiusi(limiti, Object.keys(LIMITI_ESTENSIONI), "Limiti");
  const risultato = { ...LIMITI_ESTENSIONI };
  for (const [campo, valore] of Object.entries(limiti)) {
    if (!Number.isSafeInteger(valore) || valore < 1 || valore > LIMITI_ESTENSIONI[campo]) {
      throw errore(`Limite non valido: ${campo}`);
    }
    risultato[campo] = valore;
  }
  return risultato;
}

export function percorsoEstensioneValido(percorso, massimo = LIMITI_ESTENSIONI.percorso) {
  return typeof percorso === "string" && percorso.length > 0 && percorso.length <= massimo
    && percorso === percorso.normalize("NFC") && !isAbsolute(percorso)
    && !/[\\<>:"|?*\u0000-\u001f\u007f]/u.test(percorso)
    && percorso.split("/").every((parte) => parte && parte !== "." && parte !== ".."
      && !/[. ]$/u.test(parte)
      && !/^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(parte));
}

function validaPercorso(percorso, massimo) {
  if (!percorsoEstensioneValido(percorso, massimo)) throw errore(`Percorso non ammesso: ${percorso}`);
}

export function validaManifestoEstensione(manifesto, {
  versioneHost = VERSIONE_HOST, portachiavi = PORTACHIAVI_ESTENSIONI, limiti = {},
} = {}) {
  campiChiusi(manifesto, CAMPI, "Manifesto");
  if (manifesto.schemaVersion !== 1) throw errore("Versione dello schema del manifesto non supportata");
  if (typeof manifesto.id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(manifesto.id)) {
    throw errore("Id del pacchetto non normalizzato: usare minuscole, cifre e trattino, massimo 64 caratteri");
  }
  for (const campo of ["nome", "editore", "descrizione", "chiaveId"]) {
    if (!testo(manifesto[campo], campo === "descrizione" ? 8000 : 200)) throw errore(`Campo del manifesto non valido: ${campo}`);
  }
  triplettaVersione(manifesto.versione);
  if (!["risorse", "backend"].includes(manifesto.categoria)) throw errore("Categoria del pacchetto non supportata");
  if (!versioneHostCompatibile(versioneHost, manifesto.host)) throw errore("Pacchetto non compatibile con questa versione dell'host", "ESTENSIONE_NON_COMPATIBILE");
  const tetti = limitiEstensioni(limiti);
  const dichiarati = limitiEstensioni(manifesto.limiti ?? {});
  for (const campo of Object.keys(tetti)) tetti[campo] = Math.min(tetti[campo], dichiarati[campo]);
  if (!Array.isArray(manifesto.files) || manifesto.files.length === 0 || manifesto.files.length > tetti.file) {
    throw errore("Inventario assente o oltre il limite di file", "ESTENSIONE_LIMITE");
  }
  const visti = new Set();
  let byte = 0;
  for (const voce of manifesto.files) {
    campiChiusi(voce, ["percorso", "byte", "sha256"], "Voce dell'inventario");
    validaPercorso(voce.percorso, tetti.percorso);
    const canonico = voce.percorso.toLowerCase();
    if (METADATI.has(canonico)) throw errore(`Manifesto e firma non entrano nell'inventario: ${voce.percorso}`);
    if (visti.has(canonico)) throw errore(`Percorso duplicato nell'inventario: ${voce.percorso}`);
    if (!Number.isSafeInteger(voce.byte) || voce.byte < 0 || typeof voce.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(voce.sha256)) {
      throw errore(`Dimensione o sha256 non validi: ${voce.percorso}`);
    }
    visti.add(canonico);
    byte += voce.byte;
    if (!Number.isSafeInteger(byte) || byte > tetti.byte) throw errore("Pacchetto oltre il limite di byte", "ESTENSIONE_LIMITE");
  }
  campiChiusi(manifesto.pi, ["skills", "prompts", "extensions", "themes"], "Risorse Pi");
  for (const tipo of ["skills", "prompts", "extensions", "themes"]) {
    const percorsi = manifesto.pi[tipo];
    if (!Array.isArray(percorsi)) throw errore(`Elenco Pi non valido: ${tipo}`);
    if (tipo === "extensions" && percorsi.length) throw errore("pi.extensions non vuoto: non supportato nella 2.9");
    const risorseViste = new Set();
    for (const percorso of percorsi) {
      validaPercorso(percorso, tetti.percorso);
      if (!manifesto.files.some((voce) => voce.percorso === percorso)) throw errore(`Risorsa Pi non inventariata: ${percorso}`);
      if (risorseViste.has(percorso.toLowerCase())) throw errore(`Risorsa Pi duplicata: ${percorso}`);
      risorseViste.add(percorso.toLowerCase());
      if ((tipo === "skills" || tipo === "prompts") && !/\.md$/iu.test(percorso)) throw errore(`Formato della risorsa Pi non ammesso: ${percorso}`);
      if (tipo === "themes" && !/\.json$/iu.test(percorso)) throw errore(`Formato del tema Pi non ammesso: ${percorso}`);
    }
  }
  if (manifesto.categoria === "backend") {
    campiChiusi(manifesto.backend, ["ingresso"], "Backend");
    validaPercorso(manifesto.backend.ingresso, tetti.percorso);
    if (!manifesto.files.some((voce) => voce.percorso === manifesto.backend.ingresso)
      || !/\.(?:mjs|cjs|js)$/u.test(manifesto.backend.ingresso)) throw errore("Il solo ingresso del backend deve essere un file JavaScript inventariato");
  } else if (manifesto.backend !== undefined && manifesto.backend !== null) {
    throw errore("Un pacchetto di risorse non può dichiarare un backend");
  }
  const chiave = chiaveEstensione(manifesto.chiaveId, portachiavi);
  if (manifesto.pannelli !== undefined && !Array.isArray(manifesto.pannelli)) throw errore("Elenco dei pannelli non valido");
  if (manifesto.pannelli?.length) {
    if (!chiave.primaParte || manifesto.id !== "sistema-guidato" || manifesto.categoria !== "backend") {
      throw errore("I pannelli sono riservati al solo Sistema Guidato firmato di prima parte");
    }
    if (manifesto.pannelli.length !== 1) throw errore("È consentito il solo pannello del Sistema Guidato");
    campiChiusi(manifesto.pannelli[0], ["id", "percorso"], "Pannello");
    if (manifesto.pannelli[0].id !== "sistema-guidato" || manifesto.pannelli[0].percorso !== "/sistema") {
      throw errore("È consentito il solo pannello del Sistema Guidato su /sistema");
    }
  }
  return { manifesto, chiave, limiti: tetti };
}

// lstat su ogni antenato impedisce di raggiungere un payload attraverso una
// giunzione. realpath intercetta anche redirezioni del filesystem/reparse point.
export async function verificaPercorsoRegolare(percorso, { directory = false } = {}) {
  const assoluto = resolve(percorso);
  const radice = parse(assoluto).root;
  const parti = relative(radice, assoluto).split(sep).filter(Boolean);
  let corrente = radice;
  let info;
  for (let i = 0; i < parti.length; i += 1) {
    corrente = join(corrente, parti[i]);
    try { info = await lstat(corrente); }
    catch (causa) {
      if (causa.code === "ENOENT") throw errore(`File o cartella assente: ${percorso}`, "ESTENSIONE_ASSENTE");
      throw errore(`Impossibile verificare il percorso: ${percorso}`);
    }
    if (info.isSymbolicLink() || (!info.isDirectory() && (i !== parti.length - 1 || directory))
      || (i === parti.length - 1 && !directory && (!info.isFile() || info.nlink > 1))) {
      throw errore(`Collegamento, giunzione o voce non regolare: ${percorso}`);
    }
  }
  // La risoluzione si esegue sulla destinazione completa: risolvere anche le
  // cartelle superiori richiederebbe accessi non necessari fuori dal pacchetto.
  let reale;
  try { reale = await realpath(assoluto); }
  catch { throw errore(`Impossibile verificare la destinazione del percorso: ${percorso}`); }
  const normalizza = (valore) => process.platform === "win32" ? resolve(valore).toLowerCase() : resolve(valore);
  if (normalizza(reale) !== normalizza(assoluto)) throw errore(`Percorso reindirizzato o punto di ripristino: ${percorso}`);
  return info;
}

export async function leggiFileRegolare(percorso, massimo) {
  const prima = await verificaPercorsoRegolare(percorso);
  if (prima.size > massimo) throw errore(`File oltre il limite: ${percorso}`, "ESTENSIONE_LIMITE");
  let handle;
  try {
    handle = await open(percorso, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const aperto = await handle.stat();
    if (!aperto.isFile() || aperto.nlink > 1 || aperto.dev !== prima.dev || aperto.ino !== prima.ino || aperto.size !== prima.size) {
      throw errore(`File cambiato durante la verifica: ${percorso}`, "ESTENSIONE_MANOMESSA");
    }
    const buffer = Buffer.alloc(prima.size + 1);
    let letti = 0;
    while (letti < buffer.length) {
      const { bytesRead } = await handle.read(buffer, letti, buffer.length - letti, null);
      if (!bytesRead) break;
      letti += bytesRead;
    }
    const dopo = await handle.stat();
    if (letti !== prima.size || dopo.size !== prima.size || dopo.mtimeMs !== prima.mtimeMs || dopo.ctimeMs !== prima.ctimeMs) {
      throw errore(`File cambiato durante la verifica: ${percorso}`, "ESTENSIONE_MANOMESSA");
    }
    await verificaPercorsoRegolare(percorso);
    return buffer.subarray(0, letti);
  } catch (causa) {
    if (causa.code?.startsWith("ESTENSIONE_")) throw causa;
    throw errore(`Impossibile leggere il file in modo verificabile: ${percorso}`);
  } finally {
    await handle?.close();
  }
}

function descriviPacchetto(radice, manifesto, bytes, limiti) {
  return {
    radice, manifesto, limiti,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    files: manifesto.files,
    risorse: Object.fromEntries(["skills", "prompts", "themes"].map((tipo) => [tipo, manifesto.pi[tipo].map((percorso) => resolve(radice, percorso))])),
    backendIngresso: manifesto.backend?.ingresso ? resolve(radice, manifesto.backend.ingresso) : null,
  };
}

export async function leggiManifestoEstensione(radice, opzioni = {}) {
  radice = resolve(radice);
  await verificaPercorsoRegolare(radice, { directory: true });
  const tetti = limitiEstensioni(opzioni.limiti);
  const bytes = await leggiFileRegolare(join(radice, NOME_MANIFESTO), tetti.manifestoByte);
  let manifesto;
  try { manifesto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw errore("Manifesto dell'estensione non leggibile"); }
  const validato = validaManifestoEstensione(manifesto, opzioni);
  if (bytes.length > validato.limiti.manifestoByte) throw errore("Manifesto oltre il limite dichiarato", "ESTENSIONE_LIMITE");
  const bytesFirma = await leggiFileRegolare(join(radice, NOME_FIRMA), 128);
  const testoFirma = bytesFirma.toString("ascii");
  if (bytesFirma.some((byte) => byte > 127) || !/^[A-Za-z0-9+/]{86}==$/u.test(testoFirma)) {
    throw errore("Firma non valida: richiesta una sola riga base64 Ed25519 senza involucro", "ESTENSIONE_FIRMA");
  }
  const firma = Buffer.from(testoFirma, "base64");
  if (firma.length !== 64 || firma.toString("base64") !== testoFirma || !verify(null, bytes, validato.chiave.pubblica, firma)) {
    throw errore(`Firma del manifesto non valida: ${NOME_MANIFESTO}`, "ESTENSIONE_FIRMA");
  }
  return descriviPacchetto(radice, manifesto, bytes, validato.limiti);
}

export async function inventarioCartellaEstensione(radice, { limiti = {} } = {}) {
  radice = resolve(radice);
  const tetti = limitiEstensioni(limiti);
  await verificaPercorsoRegolare(radice, { directory: true });
  const file = [];
  const visti = new Set();
  const directory = [radice];
  let byte = 0;
  let numeroVoci = 0;
  while (directory.length) {
    const corrente = directory.pop();
    await verificaPercorsoRegolare(corrente, { directory: true });
    let nomi;
    try { nomi = await readdir(corrente); }
    catch { throw errore(`Impossibile elencare la cartella: ${corrente}`); }
    for (const nome of nomi) {
      const assoluto = join(corrente, nome);
      const percorso = relative(radice, assoluto).split(sep).join("/");
      validaPercorso(percorso, tetti.percorso);
      if (assoluto.length > tetti.percorso) throw errore(`Percorso troppo lungo: ${percorso}`, "ESTENSIONE_LIMITE");
      if (visti.has(percorso.toLowerCase())) throw errore(`Percorso duplicato su Windows: ${percorso}`);
      visti.add(percorso.toLowerCase());
      numeroVoci += 1;
      if (numeroVoci > tetti.file * 2 + 2) throw errore("Cartella oltre il limite di voci", "ESTENSIONE_LIMITE");
      const info = await lstat(assoluto).catch(() => { throw errore(`Impossibile verificare la voce: ${percorso}`); });
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink > 1))) {
        throw errore(`Collegamento, giunzione o voce non regolare: ${percorso}`);
      }
      await verificaPercorsoRegolare(assoluto, { directory: info.isDirectory() });
      if (info.isDirectory()) {
        directory.push(assoluto);
      } else {
        if (!METADATI.has(percorso)) byte += info.size;
        file.push({ percorso, byte: info.size });
        if (file.length > tetti.file + 2 || byte > tetti.byte) throw errore(`Pacchetto oltre i limiti: ${percorso}`, "ESTENSIONE_LIMITE");
      }
    }
  }
  return file.sort((a, b) => a.percorso.localeCompare(b.percorso));
}

// Il digest copre sempre il file intero; in memoria resta soltanto l'anteprima
// richiesta. Anche un file inventariato molto grande usa un buffer fisso.
export async function verificaFileInventariato(percorso, voce, massimoTesto = 0) {
  const prima = await verificaPercorsoRegolare(percorso);
  const alterato = () => errore(`File dell'estensione alterato: ${voce.percorso}`, "ESTENSIONE_MANOMESSA");
  if (prima.size !== voce.byte) throw alterato();
  let handle;
  try {
    handle = await open(percorso, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const aperto = await handle.stat();
    if (!aperto.isFile() || aperto.nlink > 1 || aperto.dev !== prima.dev || aperto.ino !== prima.ino || aperto.size !== prima.size) throw alterato();
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    const anteprima = Buffer.alloc(Math.min(prima.size, massimoTesto));
    let letti = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      if (letti + bytesRead > prima.size) throw alterato();
      if (letti < anteprima.length) buffer.copy(anteprima, letti, 0, Math.min(bytesRead, anteprima.length - letti));
      hash.update(buffer.subarray(0, bytesRead));
      letti += bytesRead;
    }
    const dopo = await handle.stat();
    const percorsoDopo = await verificaPercorsoRegolare(percorso);
    if (letti !== voce.byte || hash.digest("hex") !== voce.sha256
      || dopo.size !== prima.size || dopo.mtimeMs !== prima.mtimeMs || dopo.ctimeMs !== prima.ctimeMs
      || percorsoDopo.dev !== prima.dev || percorsoDopo.ino !== prima.ino
      || percorsoDopo.mtimeMs !== prima.mtimeMs || percorsoDopo.ctimeMs !== prima.ctimeMs) throw alterato();
    return anteprima;
  } finally {
    await handle?.close();
  }
}

export async function verificaPacchettoEstensione(radice, opzioni = {}) {
  const pacchetto = await leggiManifestoEstensione(radice, opzioni);
  const fisici = await inventarioCartellaEstensione(pacchetto.radice, { limiti: pacchetto.limiti });
  const attesi = new Set([...pacchetto.files.map((voce) => voce.percorso), ...METADATI]);
  const trovati = new Set(fisici.map((voce) => voce.percorso));
  const divergente = fisici.find((voce) => !attesi.has(voce.percorso))?.percorso
    || [...attesi].find((percorso) => !trovati.has(percorso));
  if (divergente) throw errore(`Inventario divergente, file aggiunto o mancante: ${divergente}`, "ESTENSIONE_MANOMESSA");
  for (const voce of pacchetto.files) {
    await verificaFileInventariato(join(pacchetto.radice, voce.percorso), voce);
  }
  // Un cambio dei metadati durante il controllo non può sfruttare la verifica
  // precedente; si rileggono anche firma e chiave (compresa l'eventuale revoca).
  const dopo = await leggiManifestoEstensione(pacchetto.radice, opzioni);
  if (dopo.manifestSha256 !== pacchetto.manifestSha256) throw errore(`File dell'estensione alterato: ${NOME_MANIFESTO}`, "ESTENSIONE_MANOMESSA");
  return pacchetto;
}
