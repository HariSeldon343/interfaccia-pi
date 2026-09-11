import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CODICI_EVAL } from "../app/consiglio-scrittore.mjs";
import { contestoDaAmbiente, validaToolConsiglio } from "../app/consiglio-guard.mjs";
import {
  calcolaImpronteFile,
  controlloAncoraValido,
  eseguiPianoTest,
  rilevaPianoTest,
  valutaEval,
} from "../app/consiglio-controlli.mjs";

const NPM_CLI = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

async function cartellaTemporanea(t) {
  const creata = await mkdtemp(join(tmpdir(), "pi-gui-consiglio-"));
  const cartella = await realpath(creata);
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return cartella;
}

async function progettoNpm(t, { scriptTest, file = {} }) {
  const cartella = await cartellaTemporanea(t);
  const manifesto = {
    name: "progetto-finto-consiglio",
    version: "1.0.0",
    private: true,
    scripts: { test: scriptTest },
  };
  await writeFile(join(cartella, "package.json"), `${JSON.stringify(manifesto, null, 2)}\n`, "utf8");
  for (const [nome, contenuto] of Object.entries(file)) {
    await writeFile(join(cartella, nome), contenuto, "utf8");
  }
  return cartella;
}

async function npmDisponibile() {
  try {
    const informazioni = await stat(NPM_CLI);
    return informazioni.isFile();
  } catch {
    return false;
  }
}

function caselleValide() {
  return CODICI_EVAL.map((codice, indice) => ({
    codice,
    segnata: true,
    descrizione: `condizione ${indice + 1}`,
    evidenza: `evidenza della condizione ${indice + 1}`,
  }));
}

function pianoManualeSuScript(cartella, nomeScript) {
  return {
    origine: "manuale",
    eseguibile: process.execPath,
    argomenti: [join(cartella, nomeScript)],
    cwd: cartella,
    filePiano: null,
    pianoHash: null,
  };
}

// --- guardia degli strumenti ---------------------------------------------

async function workspaceGuardia(t) {
  const cartella = await cartellaTemporanea(t);
  await mkdir(join(cartella, ".git"), { recursive: true });
  await writeFile(join(cartella, ".git", "config"), "[core]\n", "utf8");
  await writeFile(join(cartella, "package.json"), '{"scripts":{"test":"node prova.mjs"}}\n', "utf8");
  await writeFile(join(cartella, "sorgente.mjs"), "export const uno = 1;\n", "utf8");
  return cartella;
}

test("il consigliere non può scrivere", async (t) => {
  const cartella = await workspaceGuardia(t);
  const contesto = { ruolo: "consigliere", workspace: cartella, filePiano: join(cartella, "package.json") };
  for (const strumento of ["write", "edit"]) {
    const esito = validaToolConsiglio(strumento, { path: join(cartella, "sorgente.mjs") }, contesto);
    assert.equal(esito.consentito, false, `${strumento} non deve essere consentito al consigliere`);
    assert.match(esito.motivo, /consigliere/i);
  }
  const lettura = validaToolConsiglio("read", { path: join(cartella, "sorgente.mjs") }, contesto);
  assert.equal(lettura.consentito, true);
});

test("anche la lettura resta dentro la cartella di lavoro", async (t) => {
  const cartella = await workspaceGuardia(t);
  const fuori = await cartellaTemporanea(t);
  const contesto = { ruolo: "consigliere", workspace: cartella, filePiano: "" };
  const senzaPercorso = validaToolConsiglio("ls", {}, contesto);
  assert.equal(senzaPercorso.consentito, true, senzaPercorso.motivo);
  const dentro = validaToolConsiglio("grep", { pattern: "uno", path: cartella }, contesto);
  assert.equal(dentro.consentito, true, dentro.motivo);
  const esterna = validaToolConsiglio("read", { path: join(fuori, "estraneo.txt") }, contesto);
  assert.equal(esterna.consentito, false);
  assert.match(esterna.motivo, /esce dalla cartella di lavoro/i);
  const senzaPercorsoObbligatorio = validaToolConsiglio("read", {}, contesto);
  assert.equal(senzaPercorsoObbligatorio.consentito, false);
});

test("lo scrittore scrive solo dentro il workspace", async (t) => {
  const cartella = await workspaceGuardia(t);
  const fuori = await cartellaTemporanea(t);
  const contesto = { ruolo: "scrittore", workspace: cartella, filePiano: join(cartella, "package.json") };
  const dentro = validaToolConsiglio("write", { path: join(cartella, "nuovo", "file.mjs") }, contesto);
  assert.equal(dentro.consentito, true, dentro.motivo);
  const relativo = validaToolConsiglio("edit", { path: "sorgente.mjs" }, contesto);
  assert.equal(relativo.consentito, true, relativo.motivo);
  const esterno = validaToolConsiglio("write", { path: join(fuori, "file.mjs") }, contesto);
  assert.equal(esterno.consentito, false);
  assert.match(esterno.motivo, /esce dalla cartella di lavoro/i);
});

test("bash è sempre negato", async (t) => {
  const cartella = await workspaceGuardia(t);
  for (const ruolo of ["consigliere", "scrittore"]) {
    const esito = validaToolConsiglio("bash", { command: "npm test" }, { ruolo, workspace: cartella, filePiano: "" });
    assert.equal(esito.consentito, false, `bash non deve essere consentito al ruolo ${ruolo}`);
    assert.match(esito.motivo, /sempre negato/i);
  }
});

test("un percorso dentro .git è negato", async (t) => {
  const cartella = await workspaceGuardia(t);
  const contesto = { ruolo: "scrittore", workspace: cartella, filePiano: join(cartella, "package.json") };
  for (const strumento of ["write", "read"]) {
    const esito = validaToolConsiglio(strumento, { path: join(cartella, ".git", "config") }, contesto);
    assert.equal(esito.consentito, false, `${strumento} dentro .git non deve essere consentito`);
    assert.match(esito.motivo, /\.git/);
  }
});

test("un percorso che esce dal workspace è negato", async (t) => {
  const cartella = await workspaceGuardia(t);
  const contesto = { ruolo: "scrittore", workspace: cartella, filePiano: "" };
  const relativo = validaToolConsiglio("write", { path: join("..", "fuga.txt") }, contesto);
  assert.equal(relativo.consentito, false);
  assert.match(relativo.motivo, /esce dalla cartella di lavoro/i);
  const lettura = validaToolConsiglio("read", { path: join(cartella, "..", "fuga.txt") }, contesto);
  assert.equal(lettura.consentito, false);
});

test("un collegamento che punta fuori dal workspace è negato", async (t) => {
  const cartella = await workspaceGuardia(t);
  const fuori = await cartellaTemporanea(t);
  const collegamento = join(cartella, "ponte");
  try {
    await symlink(fuori, collegamento, "junction");
  } catch {
    t.skip("questa postazione non permette di creare collegamenti di cartella");
    return;
  }
  const contesto = { ruolo: "scrittore", workspace: cartella, filePiano: "" };
  const esito = validaToolConsiglio("write", { path: join(collegamento, "file.mjs") }, contesto);
  assert.equal(esito.consentito, false);
  assert.match(esito.motivo, /esce dalla cartella di lavoro/i);
});

test("il file del piano dei test è negato in scrittura", async (t) => {
  const cartella = await workspaceGuardia(t);
  const filePiano = join(cartella, "package.json");
  const contesto = { ruolo: "scrittore", workspace: cartella, filePiano };
  for (const strumento of ["write", "edit"]) {
    const esito = validaToolConsiglio(strumento, { path: filePiano }, contesto);
    assert.equal(esito.consentito, false, `${strumento} sul piano non deve essere consentito`);
    assert.match(esito.motivo, /piano dei test/i);
  }
  const lettura = validaToolConsiglio("read", { path: filePiano }, contesto);
  assert.equal(lettura.consentito, true, lettura.motivo);
});

test("senza contesto la guardia nega write, edit e bash", async (t) => {
  const cartella = await workspaceGuardia(t);
  const contestiInvalidi = [
    undefined,
    {},
    { ruolo: "arbitro", workspace: cartella, filePiano: "" },
    { ruolo: "scrittore", workspace: "cartella-relativa", filePiano: "" },
    { ruolo: "scrittore", workspace: "", filePiano: "" },
    { ruolo: "scrittore", workspace: join(cartella, "cartella-che-non-esiste"), filePiano: "" },
    { ruolo: "scrittore", workspace: join(cartella, "package.json"), filePiano: "" },
  ];
  for (const contesto of contestiInvalidi) {
    for (const strumento of ["write", "edit", "bash"]) {
      const esito = validaToolConsiglio(strumento, { path: join(cartella, "sorgente.mjs") }, contesto);
      assert.equal(
        esito.consentito,
        false,
        `${strumento} deve restare negato con contesto ${JSON.stringify(contesto)}`,
      );
      assert.ok(esito.motivo.length > 0);
    }
  }
  const sconosciuto = validaToolConsiglio("todo_write", { path: join(cartella, "sorgente.mjs") }, {
    ruolo: "scrittore",
    workspace: cartella,
    filePiano: "",
  });
  assert.equal(sconosciuto.consentito, false);
});

test("senza workspace valido anche read resta negato", async (t) => {
  const cartella = await workspaceGuardia(t);
  const fintoSegreto = join(homedir(), ".pi", "finto-segreto-del-test.json");
  const contestiInvalidi = [
    undefined,
    { ruolo: "consigliere", workspace: "", filePiano: "" },
    { ruolo: "scrittore", workspace: "", filePiano: "" },
    { ruolo: "consigliere", workspace: "cartella-relativa", filePiano: "" },
    { ruolo: "consigliere", workspace: join(cartella, "cartella-che-non-esiste"), filePiano: "" },
  ];
  for (const contesto of contestiInvalidi) {
    for (const strumento of ["read", "ls", "find", "grep"]) {
      const esito = validaToolConsiglio(strumento, { path: fintoSegreto }, contesto);
      assert.equal(
        esito.consentito,
        false,
        `${strumento} deve restare negato con contesto ${JSON.stringify(contesto)}`,
      );
      assert.match(esito.motivo, /contesto del consiglio non è valido/i);
    }
  }
  const conWorkspace = validaToolConsiglio(
    "read",
    { path: join(cartella, "sorgente.mjs") },
    { ruolo: "consigliere", workspace: cartella, filePiano: "" },
  );
  assert.equal(conWorkspace.consentito, true, conWorkspace.motivo);
});

test("un piano dichiarato con percorso relativo nega comunque la scrittura", async (t) => {
  const cartella = await workspaceGuardia(t);
  const relativo = { ruolo: "scrittore", workspace: cartella, filePiano: "package.json" };
  for (const strumento of ["write", "edit"]) {
    const esito = validaToolConsiglio(strumento, { path: join(cartella, "package.json") }, relativo);
    assert.equal(esito.consentito, false, `${strumento} non deve passare con un piano dichiarato male`);
    assert.match(esito.motivo, /percorso non assoluto/i);
  }
  const altroFile = validaToolConsiglio("write", { path: join(cartella, "sorgente.mjs") }, relativo);
  assert.equal(altroFile.consentito, false, "con il piano dichiarato male non si scrive da nessuna parte");
  const assoluto = { ruolo: "scrittore", workspace: cartella, filePiano: join(cartella, "package.json") };
  const consentito = validaToolConsiglio("write", { path: join(cartella, "sorgente.mjs") }, assoluto);
  assert.equal(consentito.consentito, true, consentito.motivo);
});

test("il contesto si legge dalle tre variabili d'ambiente concordate", () => {
  const contesto = contestoDaAmbiente({
    PI_GUI_CONSIGLIO_RUOLO: " scrittore ",
    PI_GUI_CONSIGLIO_WORKSPACE: "C:\\Progetti\\esempio",
    PI_GUI_CONSIGLIO_PIANO: "C:\\Progetti\\esempio\\package.json",
  });
  assert.deepEqual(contesto, {
    ruolo: "scrittore",
    workspace: "C:\\Progetti\\esempio",
    filePiano: "C:\\Progetti\\esempio\\package.json",
  });
  assert.deepEqual(contestoDaAmbiente({}), { ruolo: "", workspace: "", filePiano: "" });
});

// --- caselle EVAL ---------------------------------------------------------

test("una casella non segnata produce fail", () => {
  const caselle = caselleValide();
  caselle[2].segnata = false;
  const esito = valutaEval(caselle);
  assert.equal(esito.esito, "fail");
  assert.ok(esito.motivi.some((motivo) => motivo.includes("E3")));
});

test("una evidenza vuota produce fail", () => {
  const caselle = caselleValide();
  caselle[0].evidenza = "   ";
  const esito = valutaEval(caselle);
  assert.equal(esito.esito, "fail");
  assert.ok(esito.motivi.some((motivo) => motivo.includes("E1")));
});

test("quattro caselle segnate con evidenza producono pass", () => {
  const esito = valutaEval(caselleValide());
  assert.equal(esito.esito, "pass");
  assert.deepEqual(esito.motivi, []);
  assert.equal(valutaEval(caselleValide().slice(0, 3)).esito, "fail");
  assert.equal(valutaEval(null).esito, "fail");
});

// --- rilevamento del piano ------------------------------------------------

test("uno script test nel manifesto diventa un piano npm con l'impronta del manifesto", async (t) => {
  const cartella = await progettoNpm(t, { scriptTest: "node --test tests/*.test.mjs" });
  const npmFinto = join(cartella, "npm-cli.js");
  const esito = await rilevaPianoTest(cartella, { risolviNpmCli: async () => npmFinto });
  assert.ok(esito.piano, esito.motivo);
  assert.equal(esito.piano.origine, "npm");
  assert.equal(esito.piano.eseguibile, process.execPath);
  assert.deepEqual(esito.piano.argomenti, [npmFinto, "run", "test"]);
  assert.equal(esito.piano.cwd, cartella);
  assert.equal(esito.piano.filePiano, join(cartella, "package.json"));
  const atteso = createHash("sha256")
    .update(await readFile(join(cartella, "package.json")))
    .digest("hex");
  assert.equal(esito.piano.pianoHash, atteso);
});

test("senza script test il piano è assente con motivo", async (t) => {
  const cartella = await cartellaTemporanea(t);
  const senzaManifesto = await rilevaPianoTest(cartella);
  assert.equal(senzaManifesto.piano, null);
  assert.match(senzaManifesto.motivo, /package\.json/);

  await writeFile(join(cartella, "package.json"), '{"name":"senza-test","scripts":{}}\n', "utf8");
  const senzaScript = await rilevaPianoTest(cartella);
  assert.equal(senzaScript.piano, null);
  assert.match(senzaScript.motivo, /scripts\.test/);
});

test("senza npm-cli.js risolvibile il piano è assente con motivo", async (t) => {
  const cartella = await progettoNpm(t, { scriptTest: "node prova.mjs" });
  const esito = await rilevaPianoTest(cartella, { risolviNpmCli: async () => null });
  assert.equal(esito.piano, null);
  assert.match(esito.motivo, /npm-cli\.js/);
});

test("un piano indicato a mano viene accettato con eseguibile e argomenti separati", async (t) => {
  const cartella = await cartellaTemporanea(t);
  const esito = await rilevaPianoTest(cartella, {
    pianoManuale: { eseguibile: process.execPath, argomenti: ["--test", "tests"] },
  });
  assert.ok(esito.piano, esito.motivo);
  assert.equal(esito.piano.origine, "manuale");
  assert.equal(esito.piano.eseguibile, process.execPath);
  assert.deepEqual(esito.piano.argomenti, ["--test", "tests"]);
  assert.equal(esito.piano.cwd, cartella);
  assert.equal(esito.piano.filePiano, null);
  assert.equal(esito.piano.pianoHash, null);
});

test("un piano a mano scritto come stringa di shell viene rifiutato", async (t) => {
  const cartella = await cartellaTemporanea(t);
  const comeStringa = await rilevaPianoTest(cartella, { pianoManuale: "npm test && echo fatto" });
  assert.equal(comeStringa.piano, null);
  assert.match(comeStringa.motivo, /shell/i);

  const conCampoComando = await rilevaPianoTest(cartella, { pianoManuale: { comando: "npm test" } });
  assert.equal(conCampoComando.piano, null);
  assert.match(conCampoComando.motivo, /shell/i);

  const conMetacaratteri = await rilevaPianoTest(cartella, {
    pianoManuale: { eseguibile: "node prova.mjs && rm -rf .", argomenti: [] },
  });
  assert.equal(conMetacaratteri.piano, null);
  assert.match(conMetacaratteri.motivo, /shell/i);

  const argomentiStringa = await rilevaPianoTest(cartella, {
    pianoManuale: { eseguibile: process.execPath, argomenti: "--test tests" },
  });
  assert.equal(argomentiStringa.piano, null);
  assert.match(argomentiStringa.motivo, /lista/i);
});

// --- esecuzione del piano -------------------------------------------------

test("un comando che esce con zero dà pass", async (t) => {
  if (!(await npmDisponibile())) {
    t.skip("npm-cli.js non è risolvibile accanto a node su questa postazione");
    return;
  }
  const cartella = await progettoNpm(t, {
    scriptTest: "node prova.mjs",
    file: { "prova.mjs": "process.stdout.write('PROVA-CONSIGLIO-OK');\n" },
  });
  const rilevato = await rilevaPianoTest(cartella);
  assert.ok(rilevato.piano, rilevato.motivo);
  const esito = await eseguiPianoTest(rilevato.piano, { timeoutMs: 120_000, fileDichiarati: [] });
  assert.equal(esito.esito, "pass", esito.motivi.join(" | ") + "\n" + esito.log);
  assert.equal(esito.codice, 0);
  assert.ok(esito.log.includes("PROVA-CONSIGLIO-OK"));
  assert.deepEqual(esito.motivi, []);
});

test("un progetto finto che fallisce dà fail con il codice di uscita", async (t) => {
  if (!(await npmDisponibile())) {
    t.skip("npm-cli.js non è risolvibile accanto a node su questa postazione");
    return;
  }
  const cartella = await progettoNpm(t, {
    scriptTest: "node fallisce.mjs",
    file: { "fallisce.mjs": "process.stdout.write('PROVA-CONSIGLIO-KO');\nprocess.exit(3);\n" },
  });
  const rilevato = await rilevaPianoTest(cartella);
  assert.ok(rilevato.piano, rilevato.motivo);
  const esito = await eseguiPianoTest(rilevato.piano, { timeoutMs: 120_000 });
  assert.equal(esito.esito, "fail");
  assert.equal(esito.codice, 3, esito.log);
  assert.ok(esito.log.includes("PROVA-CONSIGLIO-KO"), "il comando deve essere davvero partito");
  assert.ok(esito.motivi.some((motivo) => motivo.includes("codice 3")));
});

test("un piano cambiato dopo il congelamento dà fail e non viene eseguito", async (t) => {
  const cartella = await progettoNpm(t, {
    scriptTest: "node sentinella.mjs",
    file: {
      "sentinella.mjs": "import { writeFileSync } from 'node:fs';\nwriteFileSync('sentinella.txt', 'eseguito');\n",
    },
  });
  const rilevato = await rilevaPianoTest(cartella, { risolviNpmCli: async () => NPM_CLI });
  assert.ok(rilevato.piano, rilevato.motivo);

  const manifesto = JSON.parse(await readFile(join(cartella, "package.json"), "utf8"));
  manifesto.scripts.test = "node sentinella.mjs && node sentinella.mjs";
  await writeFile(join(cartella, "package.json"), `${JSON.stringify(manifesto, null, 2)}\n`, "utf8");

  const esito = await eseguiPianoTest(rilevato.piano, { timeoutMs: 30_000 });
  assert.equal(esito.esito, "fail");
  assert.equal(esito.codice, null);
  assert.ok(esito.motivi.some((motivo) => motivo.includes("cambiato dopo il consenso")));
  assert.equal(existsSync(join(cartella, "sentinella.txt")), false, "il comando non doveva partire");
});

test("un comando che supera il timeout dà fail e viene terminato", async (t) => {
  const cartella = await cartellaTemporanea(t);
  await writeFile(join(cartella, "lento.mjs"), "setTimeout(() => {}, 30000);\n", "utf8");
  let pidElencato = null;
  let terminazione = null;
  let figlio = null;
  const esito = await eseguiPianoTest(pianoManualeSuScript(cartella, "lento.mjs"), {
    timeoutMs: 700,
    attesaChiusuraMs: 8000,
    onProcesso: (processo) => {
      figlio = processo;
    },
    elencaDiscendenti: async (pid) => {
      pidElencato = pid;
      return [{ pid: 999_999, creatoIl: "finto" }];
    },
    terminaDiscendenti: async (processi, taskkill) => {
      terminazione = { processi, taskkill };
      return true;
    },
  });
  assert.equal(esito.esito, "fail");
  assert.ok(esito.motivi.some((motivo) => motivo.includes("tempo massimo")));
  assert.equal(typeof pidElencato, "number");
  assert.ok(terminazione, "terminaDiscendenti deve essere chiamata");
  assert.equal(terminazione.processi.length, 1);
  assert.ok(figlio, "onProcesso deve ricevere il figlio");
  assert.equal(figlio.killed, true);
});

test("se l'elenco dei discendenti fallisce il figlio viene terminato lo stesso", async (t) => {
  const cartella = await cartellaTemporanea(t);
  await writeFile(join(cartella, "interminabile.mjs"), "setInterval(() => {}, 1000);\n", "utf8");
  let figlio = null;
  let terminazione = null;
  const esito = await eseguiPianoTest(pianoManualeSuScript(cartella, "interminabile.mjs"), {
    timeoutMs: 700,
    attesaChiusuraMs: 8000,
    onProcesso: (processo) => {
      figlio = processo;
    },
    elencaDiscendenti: async () => {
      throw new Error("elenco dei discendenti non riuscito");
    },
    terminaDiscendenti: async (processi, taskkill) => {
      terminazione = { processi, taskkill };
      return true;
    },
  });
  assert.equal(esito.esito, "fail");
  assert.ok(esito.motivi.some((motivo) => motivo.includes("elenco dei processi discendenti")));
  assert.ok(esito.motivi.some((motivo) => motivo.includes("tempo massimo")));
  assert.ok(
    !esito.motivi.some((motivo) => motivo.includes("non si è chiuso")),
    "il figlio deve chiudersi davvero, non scadere l'attesa di scorta",
  );
  assert.ok(figlio, "onProcesso deve ricevere il figlio");
  assert.equal(figlio.killed, true, "il segnale di terminazione deve partire anche se l'elenco fallisce");
  assert.ok(
    figlio.exitCode !== null || figlio.signalCode !== null,
    "il processo deve risultare concluso, non vivo",
  );
  assert.ok(terminazione, "terminaDiscendenti va chiamata comunque, con l'elenco vuoto");
  assert.deepEqual(terminazione.processi, []);
  // Prova a livello di sistema: Windows non lascia cancellare la cartella di
  // lavoro di un processo vivo, quindi se la rimozione riesce il figlio è morto.
  await rm(cartella, { recursive: true });
  assert.equal(existsSync(cartella), false);
});

test("onProcesso riceve il figlio appena parte", async (t) => {
  const cartella = await cartellaTemporanea(t);
  await writeFile(join(cartella, "veloce.mjs"), "process.stdout.write('ciao');\n", "utf8");
  const osservati = [];
  const esito = await eseguiPianoTest(pianoManualeSuScript(cartella, "veloce.mjs"), {
    timeoutMs: 30_000,
    onProcesso: (processo) => {
      osservati.push({ pid: processo.pid, uscito: processo.exitCode });
    },
  });
  assert.equal(esito.esito, "pass");
  assert.equal(osservati.length, 1);
  assert.equal(typeof osservati[0].pid, "number");
  assert.ok(osservati[0].pid > 0);
  assert.equal(osservati[0].uscito, null, "onProcesso deve arrivare prima della fine del processo");
});

test("il log oltre il limite viene troncato", async (t) => {
  const cartella = await cartellaTemporanea(t);
  await writeFile(join(cartella, "rumoroso.mjs"), "process.stdout.write('x'.repeat(20000));\n", "utf8");
  const esito = await eseguiPianoTest(pianoManualeSuScript(cartella, "rumoroso.mjs"), {
    timeoutMs: 30_000,
    limiteLog: 2000,
  });
  assert.equal(esito.esito, "pass");
  assert.equal(esito.troncato, true);
  assert.ok(esito.log.length < 20_000);
  assert.ok(esito.log.includes("caratteri omessi"));
});

test("un file dichiarato e cambiato dopo l'esecuzione rende il controllo obsoleto", async (t) => {
  const cartella = await cartellaTemporanea(t);
  await writeFile(
    join(cartella, "scrive.mjs"),
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('uscita.txt', 'primo contenuto');\n",
    "utf8",
  );
  const piano = pianoManualeSuScript(cartella, "scrive.mjs");
  const esito = await eseguiPianoTest(piano, { timeoutMs: 30_000, fileDichiarati: ["uscita.txt"] });
  assert.equal(esito.esito, "pass", esito.motivi.join(" | "));
  assert.equal(esito.impronteFile.length, 1);
  assert.equal(esito.impronteFile[0].stato, "presente");

  const primaVerifica = await controlloAncoraValido({ piano, impronteFile: esito.impronteFile });
  assert.equal(primaVerifica.valido, true, primaVerifica.motivi.join(" | "));

  await appendFile(join(cartella, "uscita.txt"), " e una aggiunta", "utf8");
  const secondaVerifica = await controlloAncoraValido({ piano, impronteFile: esito.impronteFile });
  assert.equal(secondaVerifica.valido, false);
  assert.ok(secondaVerifica.motivi.some((motivo) => motivo.includes("uscita.txt")));
});

test("un percorso dichiarato che non è un file regolare rende il controllo non valido", async (t) => {
  const cartella = await cartellaTemporanea(t);
  await mkdir(join(cartella, "src"), { recursive: true });
  await writeFile(join(cartella, "src", "a.mjs"), "export const a = 1;\n", "utf8");
  const { impronte, motivi } = await calcolaImpronteFile(cartella, ["src"]);
  assert.equal(impronte.length, 1);
  assert.equal(impronte[0].stato, "non-file");
  assert.ok(motivi.some((motivo) => motivo.includes("non è un file")), motivi.join(" | "));

  await writeFile(join(cartella, "riesce.mjs"), "process.stdout.write('ok');\n", "utf8");
  const esito = await eseguiPianoTest(pianoManualeSuScript(cartella, "riesce.mjs"), {
    timeoutMs: 30_000,
    fileDichiarati: ["src"],
  });
  assert.equal(esito.codice, 0, "il comando deve uscire bene: il fail viene dal percorso dichiarato");
  assert.equal(esito.esito, "fail", esito.motivi.join(" | "));

  await writeFile(join(cartella, "src", "a.mjs"), "export const a = 2;\n", "utf8");
  await writeFile(join(cartella, "src", "b.mjs"), "export const b = 3;\n", "utf8");
  const verifica = await controlloAncoraValido({ piano: null, impronteFile: impronte });
  assert.equal(verifica.valido, false, "una cartella dichiarata non può spegnere il controllo di freschezza");
  assert.ok(verifica.motivi.some((motivo) => motivo.includes("src")));
});

test("un file dichiarato fuori dalla cartella di lavoro blocca il controllo", async (t) => {
  const cartella = await cartellaTemporanea(t);
  const fuori = await cartellaTemporanea(t);
  await writeFile(join(fuori, "estraneo.txt"), "contenuto\n", "utf8");
  const { impronte, motivi } = await calcolaImpronteFile(cartella, [join(fuori, "estraneo.txt")]);
  assert.equal(impronte.length, 1);
  assert.equal(impronte[0].fuoriCartella, true);
  assert.ok(motivi.some((motivo) => motivo.includes("fuori dalla cartella di lavoro")));
});
