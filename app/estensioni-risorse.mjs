import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { leggiFileRegolare, verificaPercorsoRegolare } from "./estensioni-manifest.mjs";

export const MASSIMO_TESTO = 2 * 1024 * 1024;
const MASSIMO_VOCI = 20_000;
const digest = (contenuto) => createHash("sha256").update(contenuto).digest("hex");

export function radiciRisorsePersonali({ home = homedir() } = {}) {
  return [
    { tipo: "skill", radice: resolve(home, ".pi", "agent", "skills") },
    { tipo: "prompt", radice: resolve(home, ".pi", "agent", "prompts") },
    { tipo: "tema", radice: resolve(home, ".pi", "agent", "themes") },
    { tipo: "skill", radice: resolve(home, ".agents", "skills") },
  ];
}

function dentro(percorso, radice) {
  const scarto = relative(radice, percorso);
  return scarto !== "" && scarto !== ".." && !scarto.startsWith(".." + sep) && !isAbsolute(scarto);
}

function formatoPersonale(percorso, voce) {
  if (voce.tipo === "tema") return /\.json$/iu.test(percorso);
  if (!/\.md$/iu.test(percorso)) return false;
  return voce.tipo === "prompt" || basename(percorso).toUpperCase() === "SKILL.MD"
    || !relative(voce.radice, percorso).includes(sep);
}

function trovaOrigine(percorso, opzioni) {
  return radiciRisorsePersonali(opzioni).find((voce) => dentro(percorso, voce.radice) && formatoPersonale(percorso, voce));
}

export async function verificaRisorsaPersonale(risorsa, opzioni = {}) {
  const percorso = resolve(typeof risorsa === "string" ? risorsa : risorsa?.percorso || "");
  const voce = trovaOrigine(percorso, opzioni);
  if (!voce) throw Object.assign(new Error("Risorsa personale fuori dalle radici consentite di Pi"), { code: "ESTENSIONE_RISORSA" });
  const contenuto = await leggiFileRegolare(percorso, MASSIMO_TESTO);
  const sha256 = digest(contenuto);
  if (risorsa?.sha256 && risorsa.sha256 !== sha256) {
    throw Object.assign(new Error(`Risorsa personale cambiata: ${percorso}. Rileggere il testo prima di attivarla.`), { code: "ESTENSIONE_MANOMESSA" });
  }
  let testo;
  try { testo = new TextDecoder("utf-8", { fatal: true }).decode(contenuto); }
  catch { throw Object.assign(new Error(`Risorsa personale non leggibile come testo UTF-8: ${percorso}`), { code: "ESTENSIONE_RISORSA" }); }
  return {
    id: digest(process.platform === "win32" ? percorso.toLowerCase() : percorso),
    nome: basename(percorso), tipo: voce.tipo, percorso, radice: voce.radice,
    origine: voce.radice, radiceOrigine: voce.radice, testo, sha256,
    attiva: false,
  };
}

// Il modulo importa solo operazioni di lettura: le preferenze vivono nel registro
// della GUI, mai nei settings, nelle skill o nelle altre cartelle personali di Pi.
export async function elencoRisorsePersonali({ home = homedir(), risorsePersonali = {}, onErrore = () => {}, ...opzioni } = {}) {
  const risultato = [];
  let numeroVoci = 0;
  for (const origine of radiciRisorsePersonali({ home })) {
    const radiceInfo = await lstat(origine.radice).catch((errore) => {
      if (errore.code === "ENOENT") return null;
      throw new Error(`Impossibile leggere la cartella delle risorse personali: ${origine.radice}`);
    });
    if (!radiceInfo) continue;
    await verificaPercorsoRegolare(origine.radice, { directory: true });
    const directory = [origine.radice];
    while (directory.length) {
      const corrente = directory.pop();
      await verificaPercorsoRegolare(corrente, { directory: true });
      const nomi = await readdir(corrente).catch(() => { throw new Error(`Impossibile elencare le risorse personali: ${corrente}`); });
      for (const nome of nomi) {
        numeroVoci += 1;
        if (numeroVoci > MASSIMO_VOCI) throw new Error("Le risorse personali di Pi superano il limite verificabile");
        const percorso = join(corrente, nome);
        let info;
        try { info = await lstat(percorso); }
        catch (errore) { onErrore(percorso, errore); continue; }
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink > 1)) {
          onErrore(percorso, new Error("Risorsa personale non regolare: è necessario rileggere l'origine."));
          continue;
        }
        if (info.isDirectory()) {
          directory.push(percorso);
        } else if (formatoPersonale(percorso, origine)) {
          let risorsa;
          try { risorsa = await verificaRisorsaPersonale({ percorso }, { home, ...opzioni }); }
          catch (errore) { onErrore(percorso, errore); continue; }
          const scelta = Array.isArray(risorsePersonali)
            ? risorsePersonali.find((voce) => voce.percorso === percorso)?.attiva
            : risorsePersonali[percorso] ?? risorsePersonali[risorsa.id];
          risorsa.attiva = scelta === true;
          risultato.push(risorsa);
        }
      }
    }
  }
  return risultato.sort((a, b) => a.percorso.localeCompare(b.percorso));
}

export const elencaRisorsePersonali = elencoRisorsePersonali;
