import { open, rename, link, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export function creaSerializzatore() {
  const code = new Map();
  return async function serializza(chiave, lavoro) {
    const precedente = code.get(chiave) || Promise.resolve();
    let libera;
    const coda = new Promise((risolvi) => { libera = risolvi; });
    code.set(chiave, coda);
    await precedente;
    try {
      return await lavoro();
    } finally {
      libera();
      if (code.get(chiave) === coda) code.delete(chiave);
    }
  };
}

export async function scriviFileAtomico(percorso, contenuto, { primaPubblicazione = null, esclusivo = false } = {}) {
  const temporaneo = percorso + "." + process.pid + "." + randomUUID() + ".tmp";
  let handle;
  try {
    if (primaPubblicazione) await primaPubblicazione();
    handle = await open(temporaneo, "wx", 0o600);
    await handle.writeFile(contenuto, typeof contenuto === "string" ? "utf8" : undefined);
    await handle.sync();
    await handle.close();
    handle = null;
    if (primaPubblicazione) await primaPubblicazione();
    if (esclusivo) {
      // link pubblica il temporaneo completo e fallisce se il nome esiste già.
      await link(temporaneo, percorso);
      await rm(temporaneo);
    } else {
      await rename(temporaneo, percorso);
    }
  } catch (errore) {
    await handle?.close().catch(() => {});
    await rm(temporaneo, { force: true }).catch(() => {});
    throw errore;
  }
}
