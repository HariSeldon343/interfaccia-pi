import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { percorsoEstensioneValido, verificaDestinazionePercorso, verificaPercorsoRegolare } from "../app/estensioni-manifest.mjs";

async function fixture(t) {
  const radice = await mkdtemp(join(tmpdir(), "pi-estensioni-percorsi-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const cartella = join(radice, "cartella con nome più lungo");
  await mkdir(cartella);
  await writeFile(join(cartella, "prova.txt"), "Contenuto sintetico.");
  return { radice, cartella };
}

function eseguiCmd(argomenti) {
  return new Promise((resolveEsito, reject) => {
    const figlio = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
      ["/d", "/u", "/s", "/c", ...argomenti], {
        shell: false, windowsHide: true, windowsVerbatimArguments: true, timeout: 10_000,
      });
    let stdout = "";
    let stderr = "";
    figlio.stdout.setEncoding("utf16le").on("data", (dati) => { stdout += dati; });
    figlio.stderr.setEncoding("utf16le").on("data", (dati) => { stderr += dati; });
    figlio.on("error", reject);
    figlio.on("close", (code) => resolveEsito({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

test("il confronto Windows ammette solo differenze di maiuscole ed espansioni 8.3 dichiarate", () => {
  for (const [dichiarato, reale] of [
    ["C:\\Users\\runneradmin\\prova.txt", "c:\\USERS\\RunnerAdmin\\PROVA.TXT"],
    ["C:\\Users\\RUNNER~1\\prova.txt", "c:\\Users\\runneradmin\\prova.txt"],
    ["C:\\CARTELLA~123\\PROVA~12.TXT", "c:\\cartella con nome più lungo\\prova completa.txt"],
    ["\\\\SERVER\\SHARE\\RUNNER~1\\prova.txt", "\\\\server\\share\\runneradmin\\prova.txt"],
  ]) assert.doesNotThrow(() => verificaDestinazionePercorso(dichiarato, reale, "win32"), dichiarato);
});

test("il confronto rifiuta una componente lunga diversa anche accanto a un alias 8.3", () => {
  for (const [dichiarato, reale] of [
    ["C:\\Users\\dichiarata\\prova.txt", "C:\\Users\\destinazione\\prova.txt"],
    ["C:\\Users\\RUNNER~1\\dichiarata\\prova.txt", "C:\\Users\\runneradmin\\destinazione\\prova.txt"],
    ["C:\\Users\\runneradmin\\prova.txt", "C:\\Users\\RUNNER~1\\prova.txt"],
    ["C:\\Users\\RUNNER~1\\prova.txt", "C:\\Users\\runneradmin\\altra\\prova.txt"],
  ]) assert.throws(() => verificaDestinazionePercorso(dichiarato, reale, "win32"), { code: "ESTENSIONE_NON_VALIDA" }, dichiarato);
});

test("il confronto rifiuta radici diverse per unità sostituite e dischi di rete mappati", () => {
  for (const [dichiarato, reale] of [
    ["P:\\Users\\runneradmin\\prova.txt", "C:\\Users\\runneradmin\\prova.txt"],
    ["P:\\Users\\RUNNER~1\\prova.txt", "C:\\Users\\runneradmin\\prova.txt"],
    ["Z:\\Users\\runneradmin\\prova.txt", "\\\\server\\share\\Users\\runneradmin\\prova.txt"],
    ["\\\\server\\share\\prova.txt", "\\\\server\\altra\\prova.txt"],
  ]) assert.throws(() => verificaDestinazionePercorso(dichiarato, reale, "win32"), { code: "ESTENSIONE_NON_VALIDA" }, dichiarato);
});

test("le componenti divergenti devono rispettare la forma corta 8.3", () => {
  for (const componente of ["RUNNER", "RUNNER~", "~1", "RUNNER~1234", "NOMETROPPO~1", "RUNNER~A", "RUNNER~1.TESTO"]) {
    assert.throws(() => verificaDestinazionePercorso(`C:\\Users\\${componente}\\prova.txt`, "C:\\Users\\runneradmin\\prova.txt", "win32"), {
      code: "ESTENSIONE_NON_VALIDA",
    }, componente);
  }
});

test("fuori da Windows il confronto resta esatto anche per nomi che sembrano 8.3", () => {
  assert.doesNotThrow(() => verificaDestinazionePercorso("/tmp/prova.txt", "/tmp/prova.txt", "linux"));
  for (const dichiarato of ["/tmp/PROVA.txt", "/tmp/PROVA~1.txt"]) {
    assert.throws(() => verificaDestinazionePercorso(dichiarato, "/tmp/prova.txt", "linux"), { code: "ESTENSIONE_NON_VALIDA" });
  }
});

test("la forma corta 8.3 di un antenato Windows esistente ammette il file regolare", {
  skip: process.platform !== "win32" && "I nomi corti 8.3 richiedono Windows",
}, async (t) => {
  // Il profilo può conservare il nome corto anche se la sua creazione è stata
  // disattivata sul volume: chiediamo la forma corta prima di creare la fixture.
  const lunga = await realpath(tmpdir());
  const esito = await eseguiCmd(["for", "%I", "in", `("${lunga}")`, "do", "@echo", "%~sI"]);
  assert.equal(esito.code, 0, esito.stderr);
  const corta = esito.stdout;
  assert.ok(corta, "cmd deve restituire il percorso");
  if (resolve(corta).toLowerCase() === resolve(lunga).toLowerCase()) {
    const motivo = "Nessuna forma corta 8.3 disponibile per tmpdir() o i suoi antenati esistenti";
    if (process.env.CI !== undefined) assert.fail(motivo);
    t.skip(motivo);
    return;
  }
  assert.equal((await realpath(corta)).toLowerCase(), lunga.toLowerCase());
  const { cartella } = await fixture(t);
  const cartellaCorta = join(corta, relative(lunga, await realpath(cartella)));
  assert.equal((await verificaPercorsoRegolare(cartellaCorta, { directory: true })).isDirectory(), true);
  assert.equal((await verificaPercorsoRegolare(join(cartellaCorta, "prova.txt"))).isFile(), true);
});

test("una giunzione Windows viene rifiutata anche quando è un antenato del file", {
  skip: process.platform !== "win32" && "Le giunzioni richiedono Windows",
}, async (t) => {
  const { radice, cartella } = await fixture(t);
  const giunzione = join(radice, "giunzione");
  let esito;
  try { esito = await eseguiCmd(["mklink", "/J", `"${giunzione}"`, `"${cartella}"`]); }
  catch (causa) {
    if (!["ENOENT", "EACCES", "EPERM"].includes(causa.code)) throw causa;
    t.skip(`mklink /J non disponibile: ${causa.code}`);
    return;
  }
  if (esito.code !== 0) {
    t.skip(`mklink /J non disponibile (uscita ${esito.code}): ${esito.stderr || esito.stdout}`);
    return;
  }
  await assert.rejects(verificaPercorsoRegolare(giunzione, { directory: true }), {
    code: "ESTENSIONE_NON_VALIDA", message: /Collegamento, giunzione o voce non regolare/u,
  });
  await assert.rejects(verificaPercorsoRegolare(join(giunzione, "prova.txt")), {
    code: "ESTENSIONE_NON_VALIDA", message: /Collegamento, giunzione o voce non regolare/u,
  });
});

for (const tipo of ["file", "dir"]) {
  test(`un collegamento simbolico di tipo ${tipo} viene rifiutato`, async (t) => {
    const { radice, cartella } = await fixture(t);
    const collegamento = join(radice, "collegamento");
    try { await symlink(tipo === "file" ? join(cartella, "prova.txt") : cartella, collegamento, tipo); }
    catch (causa) {
      if (!["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(causa.code)) throw causa;
      t.skip(`Creazione del collegamento simbolico non disponibile: ${causa.code}`);
      return;
    }
    await assert.rejects(verificaPercorsoRegolare(
      tipo === "file" ? collegamento : join(collegamento, "prova.txt"),
    ), { code: "ESTENSIONE_NON_VALIDA", message: /Collegamento, giunzione o voce non regolare/u });
  });
}

test("i punti doppi mantengono la risoluzione ordinaria e restano vietati nei percorsi del manifesto", async (t) => {
  const { radice, cartella } = await fixture(t);
  const esterno = join(radice, "esterno.txt");
  await writeFile(esterno, "File sintetico esterno alla sottocartella.");
  const conPunti = `${cartella}${sep}..${sep}esterno.txt`;
  assert.equal(resolve(conPunti), esterno);
  // La guardia verifica il percorso assoluto risolto; il confine del pacchetto
  // è imposto separatamente dalla validazione dei percorsi del manifesto.
  assert.equal((await verificaPercorsoRegolare(conPunti)).isFile(), true);
  assert.equal(percorsoEstensioneValido("../esterno.txt"), false);
  assert.equal(percorsoEstensioneValido("cartella/../../esterno.txt"), false);
  await assert.rejects(verificaPercorsoRegolare(cartella), { code: "ESTENSIONE_NON_VALIDA" });
  await assert.rejects(verificaPercorsoRegolare(esterno, { directory: true }), { code: "ESTENSIONE_NON_VALIDA" });
});
