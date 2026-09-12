import { realpathSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { creaArchivioEstensioni, DURATA_LOCK_ESTENSIONI_MS, radiceProgrammiEstensioni } from "../app/estensioni-store.mjs";

async function fixture(t) {
  const radice = await mkdtemp(join(tmpdir(), "pi-estensioni-lock-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  return { radice, percorso: join(radice, "estensioni.json"), lock: join(radice, "estensioni.json.lock") };
}

test("il lock registra pid e ora e si libera dopo la modifica", async (t) => {
  const { percorso, lock } = await fixture(t);
  const ora = Date.now();
  const archivio = creaArchivioEstensioni({ percorso, ora: () => ora });
  await archivio.modifica(0, async (registro) => {
    const dati = JSON.parse(await readFile(lock, "utf8"));
    assert.equal(dati.pid, process.pid);
    assert.equal(dati.creatoIl, ora);
    assert.equal(typeof dati.proprietario, "string");
    return registro;
  });
  assert.equal((await archivio.leggi()).versioneArchivio, 1);
  await assert.rejects(lstat(lock), { code: "ENOENT" });
});

test("l'apertura raccoglie il lock di un pid morto e quello oltre cinque minuti", async (t) => {
  const { percorso, lock } = await fixture(t);
  const ora = Date.now();
  for (const scenario of [
    { pid: 12345, creatoIl: ora, vivo: false },
    { pid: process.pid, creatoIl: ora - DURATA_LOCK_ESTENSIONI_MS - 1, vivo: true },
  ]) {
    await writeFile(lock, JSON.stringify({ pid: scenario.pid, creatoIl: scenario.creatoIl, proprietario: "vecchio" }));
    const interrogati = [];
    const archivio = creaArchivioEstensioni({ percorso, ora: () => ora, pidEsiste: (pid) => { interrogati.push(pid); return scenario.vivo; } });
    assert.equal((await archivio.leggi()).versioneArchivio, 0);
    await assert.rejects(lstat(lock), { code: "ENOENT" });
    if (!scenario.vivo) assert.deepEqual(interrogati, [scenario.pid]);
  }
});

test("un lock attivo conserva il conflitto senza cambiare il registro", async (t) => {
  const { percorso, lock } = await fixture(t);
  const contenuto = JSON.stringify({ pid: process.pid, creatoIl: Date.now(), proprietario: "altro" });
  await writeFile(lock, contenuto);
  const archivio = creaArchivioEstensioni({ percorso });
  assert.equal((await archivio.leggi()).versioneArchivio, 0);
  await assert.rejects(archivio.modifica(0, (registro) => registro), { code: "ESTENSIONI_CONFLITTO" });
  assert.equal(await readFile(lock, "utf8"), contenuto);
  await assert.rejects(lstat(percorso), { code: "ENOENT" });
});

test("un lock vuoto recente e protetto e quello abbandonato viene raccolto", async (t) => {
  const { percorso, lock } = await fixture(t);
  await writeFile(lock, "");
  const archivio = creaArchivioEstensioni({ percorso });
  await archivio.leggi();
  await assert.rejects(archivio.modifica(0, (registro) => registro), { code: "ESTENSIONI_CONFLITTO" });
  const passato = new Date(Date.now() - DURATA_LOCK_ESTENSIONI_MS - 1000);
  await utimes(lock, passato, passato);
  await archivio.modifica(0, (registro) => registro);
  await assert.rejects(lstat(lock), { code: "ENOENT" });
});

test("un proprietario scaduto non pubblica e non cancella il lock subentrato", async (t) => {
  const { percorso, lock } = await fixture(t);
  const subentrato = JSON.stringify({ pid: process.pid, creatoIl: Date.now(), proprietario: "nuovo" });
  const archivio = creaArchivioEstensioni({ percorso, scriviFile: async (_percorso, _testo, { primaPubblicazione }) => {
    await writeFile(lock, subentrato);
    await primaPubblicazione();
    assert.fail("Un proprietario scaduto non deve pubblicare");
  } });
  await assert.rejects(archivio.modifica(0, (registro) => registro), { code: "ESTENSIONI_CONFLITTO" });
  assert.equal(await readFile(lock, "utf8"), subentrato);
  await assert.rejects(lstat(percorso), { code: "ENOENT" });
});

test("la pubblicazione rifiuta il lock alla scadenza anche senza un altro proprietario", async (t) => {
  const { percorso, lock } = await fixture(t);
  let ora = Date.now();
  const archivio = creaArchivioEstensioni({ percorso, ora: () => ora });
  await assert.rejects(archivio.modifica(0, (registro) => {
    ora += DURATA_LOCK_ESTENSIONI_MS;
    return registro;
  }), { code: "ESTENSIONI_CONFLITTO" });
  await assert.rejects(lstat(percorso), { code: "ENOENT" });
  await assert.rejects(lstat(lock), { code: "ENOENT" });
  assert.equal((await archivio.leggi()).versioneArchivio, 0);
});

test("LOCALAPPDATA normalizza il profilo reindirizzato senza fidarsi dei link nei programmi", async (t) => {
  const { radice } = await fixture(t);
  const reale = join(radice, "profilo-reale");
  const alias = join(radice, "profilo-alias");
  await mkdir(reale);
  await symlink(reale, alias, process.platform === "win32" ? "junction" : "dir");
  // Stessa risoluzione usata dal codice (realpath non nativo): niente espansione dei nomi corti 8.3, che sui runner GitHub differisce dalla forma nativa.
  const attesa = join(realpathSync(reale), "AppData", "Local", "it.amodeo.interfaccia-pi", "estensioni");
  const calcola = () => radiceProgrammiEstensioni({ platform: "win32", env: { LOCALAPPDATA: join(alias, "AppData", "Local") } });
  assert.equal(calcola(), attesa);
  const altrove = join(radice, "altrove");
  await mkdir(altrove);
  await mkdir(dirname(dirname(attesa)), { recursive: true });
  await symlink(altrove, dirname(attesa), process.platform === "win32" ? "junction" : "dir");
  assert.equal(calcola(), attesa);
  assert.notEqual(calcola(), join(await realpath(altrove), "estensioni"));
});
