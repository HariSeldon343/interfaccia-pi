import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generaChiaviEstensioni, leggiChiavePrivataEstensioni, proteggiPermessiChiave, scriviChiavePrivataProtetta } from "../scripts/genera-chiavi-estensioni.mjs";
import { firmaPacchettoEstensione } from "../scripts/firma-pacchetto-estensione.mjs";
import { controllaPacchettoOpzionale, creaPacchettoSistemaGuidato } from "../scripts/vendor-sistema-guidato.mjs";
import { NOME_FIRMA, NOME_MANIFESTO, verificaPacchettoEstensione } from "../app/estensioni-manifest.mjs";
import { PORTACHIAVI_ESTENSIONI } from "../app/estensioni-chiavi.mjs";

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function temporanea(t) {
  const radice = await mkdtemp(join(tmpdir(), "pi-ext-strumenti-firma-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  return radice;
}

async function creaRisorse(radice) {
  await mkdir(join(radice, "skills/prova"), { recursive: true });
  await writeFile(join(radice, "skills/prova/SKILL.md"), "Risorsa sintetica di prova.\n");
  await writeFile(join(radice, "package.json"), JSON.stringify({
    name: "@prova/risorse", version: "1.0.0", pi: { skills: ["skills/prova/SKILL.md"], prompts: [], themes: [], extensions: [] },
    interfacciaPi: { id: "risorse-prova", nome: "Risorse di prova", editore: "Prova", descrizione: "Solo dati sintetici",
      categoria: "risorse", host: { minInclusa: "2.9.0", maxEsclusa: "3.0.0" }, pannelli: [], limiti: {} },
  }, null, 2));
}

test("la protezione dei permessi precede i byte privati e il suo errore impedisce ogni scrittura", async () => {
  const eventi = [];
  const handle = { writeFile: async (testo) => eventi.push(["scrittura", testo]), sync: async () => eventi.push(["sync"]) };
  const proteggi = async () => eventi.push(["permessi verificati"]);
  await scriviChiavePrivataProtetta(handle, "destinazione sintetica", "byte sintetici", proteggi);
  assert.deepEqual(eventi, [["permessi verificati"], ["scrittura", "byte sintetici"], ["sync"]]);
  eventi.length = 0;
  const negato = Object.assign(new Error("Permessi negati nella prova"), { code: "EPERM" });
  await assert.rejects(scriviChiavePrivataProtetta(handle, "destinazione sintetica", "byte sintetici", async () => { throw negato; }), { code: "EPERM" });
  assert.deepEqual(eventi, []);
});

test("l'errore PowerShell conserva uscita e ultime righe entro 2 KB senza scrivere byte privati", {
  skip: process.platform !== "win32" && "La protezione DACL richiede Windows",
}, async () => {
  const eventi = [];
  const privata = "byte privati sintetici da non esporre";
  const handle = {
    chmod: async (modo) => eventi.push(["chmod", modo]),
    writeFile: async () => eventi.push(["scrittura"]),
    sync: async () => eventi.push(["sync"]),
  };
  const guasto = Object.assign(new Error(privata), {
    code: 23,
    stdout: ["inizio da scartare", ...Array(12).fill("à\t".repeat(400)), "ultima riga stdout: è fallito"].join("\n"),
    stderr: ["inizio da scartare", ...Array(12).fill("è\0".repeat(400)), "ultima riga stderr: accesso negato"].join("\n"),
  });
  const esegui = async (_eseguibile, argomenti) => {
    const script = Buffer.from(argomenti.at(-1), "base64").toString("utf16le");
    assert.equal(script.includes(privata), false);
    throw guasto;
  };
  await assert.rejects(scriviChiavePrivataProtetta(handle, "destinazione sintetica", privata,
    (file, destinazione) => proteggiPermessiChiave(file, destinazione, esegui)), (errore) => {
    assert.equal(errore.code, "ESTENSIONE_PERMESSI");
    assert.equal(errore.cause.code, 23);
    assert.match(errore.cause.stdout, /ultima riga stdout: è fallito$/u);
    assert.match(errore.cause.stderr, /ultima riga stderr: accesso negato$/u);
    const diagnostica = JSON.stringify(errore.cause);
    assert.ok(Buffer.byteLength(diagnostica, "utf8") <= 2048);
    assert.doesNotMatch(diagnostica, /inizio da scartare|\uFFFD/u);
    assert.equal(diagnostica.includes(privata), false);
    return true;
  });
  assert.deepEqual(eventi, [["chmod", 0o600]]);
});

test("un SystemRoot inesistente rende diagnosticabile il mancato avvio e impedisce la scrittura privata", {
  skip: process.platform !== "win32" && "La protezione DACL richiede Windows",
}, async () => {
  const windows = process.env.SystemRoot;
  const eventi = [];
  const handle = {
    chmod: async () => eventi.push("chmod"),
    writeFile: async () => eventi.push("scrittura"),
    sync: async () => eventi.push("sync"),
  };
  try {
    process.env.SystemRoot = join(REPOSITORY, "cartella-windows-assente-nella-prova");
    await assert.rejects(scriviChiavePrivataProtetta(handle, "destinazione sintetica", "byte privati sintetici"), (errore) => {
      assert.equal(errore.code, "ESTENSIONE_PERMESSI");
      assert.equal(errore.cause.code, "ENOENT");
      assert.equal(errore.cause.stdout, "");
      assert.equal(errore.cause.stderr, "");
      return true;
    });
  } finally {
    if (windows === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = windows;
  }
  assert.deepEqual(eventi, ["chmod"]);
});

test("la DACL privata è applicata e riletta anche quando Set-Acl rifiuta il cambio di proprietario", {
  skip: process.platform !== "win32" && "La protezione DACL richiede Windows",
}, async (t) => {
  const radice = await temporanea(t);
  const percorso = join(radice, "privata-fallback.pem");
  const handle = await open(percorso, "wx", 0o600);
  const esegui = async (eseguibile, argomenti, opzioni) => {
    const script = Buffer.from(argomenti.at(-1), "base64").toString("utf16le");
    const prova = String.raw`
$script:tentativiAcl = 0
function Set-Acl {
  param($LiteralPath, $AclObject)
  $script:tentativiAcl++
  if ($script:tentativiAcl -eq 1) { throw 'Cambio di proprietario negato nella prova' }
  Microsoft.PowerShell.Security\Set-Acl -LiteralPath $LiteralPath -AclObject $AclObject
}
${script}
if ($script:tentativiAcl -ne 2) { throw 'Fallback DACL non esercitato' }
`;
    return promisify(execFile)(eseguibile, [...argomenti.slice(0, -1), Buffer.from(prova, "utf16le").toString("base64")], opzioni);
  };
  try {
    await scriviChiavePrivataProtetta(handle, percorso, "byte sintetici dopo la verifica DACL",
      (file, destinazione) => proteggiPermessiChiave(file, destinazione, esegui));
  } finally {
    await handle.close();
  }
  assert.equal(await readFile(percorso, "utf8"), "byte sintetici dopo la verifica DACL");
});

test("la verifica rifiuta una DACL con due regole lasciando il file privato vuoto", {
  skip: process.platform !== "win32" && "La protezione DACL richiede Windows",
}, async (t) => {
  const radice = await temporanea(t);
  const percorso = join(radice, "privata-dacl-non-valida.pem");
  const handle = await open(percorso, "wx", 0o600);
  const esegui = async (eseguibile, argomenti, opzioni) => {
    const script = Buffer.from(argomenti.at(-1), "base64").toString("utf16le");
    const prova = String.raw`
function Get-Acl {
  param($LiteralPath)
  $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
  $altroSid = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
  $altraRegola = [Security.AccessControl.FileSystemAccessRule]::new($altroSid, [Security.AccessControl.FileSystemRights]::Read, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($altraRegola)
  if (@($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])).Count -ne 2) { throw 'DACL sintetica a due regole non costruita' }
  return $acl
}
${script}
`;
    return promisify(execFile)(eseguibile, [...argomenti.slice(0, -1), Buffer.from(prova, "utf16le").toString("base64")], opzioni);
  };
  try {
    await assert.rejects(scriviChiavePrivataProtetta(handle, percorso, "byte privati sintetici",
      (file, destinazione) => proteggiPermessiChiave(file, destinazione, esegui)), (errore) => {
      assert.equal(errore.code, "ESTENSIONE_PERMESSI");
      assert.match(errore.cause.stderr, /ACL privata non verificata/u);
      return true;
    });
    assert.equal((await handle.stat()).size, 0);
  } finally {
    await handle.close();
  }
  assert.equal((await readFile(percorso)).length, 0);
});

test("l'avviso sulla sola DACL indica il SID del proprietario alternativo verificato", {
  skip: process.platform !== "win32" && "La protezione DACL richiede Windows",
}, async (t) => {
  const radice = await temporanea(t);
  const percorso = join(radice, "privata-proprietario-alternativo.pem");
  const handle = await open(percorso, "wx", 0o600);
  const messaggi = [];
  const scrivi = t.mock.method(process.stdout, "write", (testo) => { messaggi.push(String(testo)); return true; });
  const esegui = async (eseguibile, argomenti, opzioni) => {
    const script = Buffer.from(argomenti.at(-1), "base64").toString("utf16le");
    const prova = String.raw`
function Get-Acl {
  param($LiteralPath)
  $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $LiteralPath
  $script:proprietarioPredefinito = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl.SetOwner($script:proprietarioPredefinito)
  return $acl
}
${script}
`;
    return promisify(execFile)(eseguibile, [...argomenti.slice(0, -1), Buffer.from(prova, "utf16le").toString("base64")], opzioni);
  };
  try {
    await scriviChiavePrivataProtetta(handle, percorso, "byte sintetici dopo l'avviso",
      (file, destinazione) => proteggiPermessiChiave(file, destinazione, esegui));
  } finally {
    scrivi.mock.restore();
    await handle.close();
  }
  assert.equal(messaggi.join("").replace(/\r\n/gu, "\n"), "chiave protetta dalla sola DACL, proprietario S-1-5-32-544\n");
  assert.equal(await readFile(percorso, "utf8"), "byte sintetici dopo l'avviso");
});

test("la coppia Ed25519 resta nel percorso privato esplicito e restituisce solo la voce pubblica", async (t) => {
  const radice = await temporanea(t);
  const percorso = join(radice, "privata.pem");
  const pubblica = await generaChiaviEstensioni(percorso);
  const privata = createPrivateKey(await readFile(percorso));
  assert.equal(privata.asymmetricKeyType, "ed25519");
  assert.match(pubblica.chiaveId, /^ed25519-[a-f0-9]{40}$/u);
  assert.equal(pubblica.pubblica, createPublicKey(privata).export({ type: "spki", format: "pem" }));
  assert.doesNotMatch(JSON.stringify(pubblica), /PRIVATE KEY/u);
  if (process.platform !== "win32") assert.equal((await stat(percorso)).mode & 0o777, 0o600);
  const prima = await readFile(percorso);
  await assert.rejects(generaChiaviEstensioni(percorso), { code: "EEXIST" });
  assert.deepEqual(await readFile(percorso), prima);
  assert.equal(PORTACHIAVI_ESTENSIONI.some((voce) => voce.chiaveId === pubblica.chiaveId), false);
});

test("gli strumenti di firma rifiutano chiavi dal repository e riferimenti a variabili d'ambiente", async () => {
  for (const percorso of [undefined, "", "env:CHIAVE_PRIVATA", "$CHIAVE_PRIVATA", "${CHIAVE_PRIVATA}", "%CHIAVE_PRIVATA%", "-----BEGIN PRIVATE KEY-----"]) {
    await assert.rejects(generaChiaviEstensioni(percorso), /argomento, senza variabili/u);
    await assert.rejects(leggiChiavePrivataEstensioni(percorso), /argomento, senza variabili/u);
  }
  for (const funzione of [generaChiaviEstensioni, leggiChiavePrivataEstensioni]) {
    await assert.rejects(funzione(join(REPOSITORY, "privata-proibita.pem")), /fuori dal repository/u);
  }
});

test("la firma genera inventario chiuso e manifest.sig verificati con la chiave pubblica derivata", async (t) => {
  const radice = await temporanea(t);
  const percorso = join(radice, "privata.pem");
  const pubblica = await generaChiaviEstensioni(percorso);
  const pacchetto = join(radice, "pacchetto");
  await creaRisorse(pacchetto);
  const verificato = await firmaPacchettoEstensione(pacchetto, percorso);
  assert.equal(NOME_FIRMA, "manifest.sig");
  assert.equal(verificato.manifesto.chiaveId, pubblica.chiaveId);
  assert.deepEqual(verificato.files.map((voce) => voce.percorso), ["package.json", "skills/prova/SKILL.md"]);
  const bytes = await readFile(join(pacchetto, NOME_MANIFESTO));
  const firma = await readFile(join(pacchetto, NOME_FIRMA), "utf8");
  assert.match(firma, /^[A-Za-z0-9+/]{86}==$/u);
  assert.equal(verify(null, bytes, createPublicKey(pubblica.pubblica), Buffer.from(firma, "base64")), true);
  await verificaPacchettoEstensione(pacchetto, { portachiavi: [pubblica] });
  await writeFile(join(pacchetto, "skills/prova/SKILL.md"), "Risorsa sintetica cambiata.\n");
  await assert.rejects(verificaPacchettoEstensione(pacchetto, { portachiavi: [pubblica] }));
  const rifirmato = await firmaPacchettoEstensione(pacchetto, percorso);
  assert.notEqual(rifirmato.manifestSha256, verificato.manifestSha256);
  await assert.rejects(firmaPacchettoEstensione(pacchetto, join(pacchetto, "privata.pem")), /fuori dalla cartella del pacchetto/u);
});

test("un collegamento alla chiave privata o dentro il pacchetto non viene firmato", async (t) => {
  const radice = await temporanea(t);
  const percorso = join(radice, "privata.pem");
  await generaChiaviEstensioni(percorso);
  const alias = join(radice, "alias.pem");
  try { await symlink(percorso, alias); }
  catch (errore) {
    if (["EPERM", "EACCES"].includes(errore.code)) return t.skip("Il sistema non consente di creare collegamenti simbolici nel test");
    throw errore;
  }
  await assert.rejects(leggiChiavePrivataEstensioni(alias), /Collegamento|reindirizzato/u);
  const pacchetto = join(radice, "pacchetto");
  await creaRisorse(pacchetto);
  await symlink(percorso, join(pacchetto, "segreto.pem"));
  await assert.rejects(firmaPacchettoEstensione(pacchetto, percorso), /Collegamento/u);
});

test("il controllo opzionale salta solo il pacchetto assente e fallisce su firma o contenuto non validi", async (t) => {
  const radice = await temporanea(t);
  const messaggi = [];
  const opzioni = { destinazione: join(radice, "pacchetto"), scrivi: (testo) => messaggi.push(testo) };
  assert.equal((await controllaPacchettoOpzionale(opzioni)).saltato, true);
  assert.match(messaggi.join(""), /firmato assente; controllo saltato/u);
  await mkdir(opzioni.destinazione);
  await writeFile(join(opzioni.destinazione, NOME_FIRMA), "firma incompleta");
  await assert.rejects(controllaPacchettoOpzionale(opzioni), /incompleto/u);
  await writeFile(join(opzioni.destinazione, NOME_MANIFESTO), "{}");
  await assert.rejects(controllaPacchettoOpzionale(opzioni));
  assert.equal(messaggi.length, 1);
});

test("il vendor Sistema Guidato firma da un percorso privato esplicito con lo stesso strumento", async (t) => {
  const radice = await temporanea(t);
  const chiavePrivata = join(radice, "privata.pem");
  const pubblica = await generaChiaviEstensioni(chiavePrivata);
  const artifactRoot = join(radice, "artefatto");
  const files = new Map([
    ["runtime/server/server.mjs", "export const prova = true;\n"],
    ["runtime/dashboard/index.html", "<main>Prova sintetica</main>"],
    ["runtime/templates/manifest.json", "{}"],
  ]);
  for (const [nome, contenuto] of files) {
    await mkdir(dirname(join(artifactRoot, nome)), { recursive: true });
    await writeFile(join(artifactRoot, nome), contenuto);
  }
  await writeFile(join(artifactRoot, "release-manifest.json"), JSON.stringify({ schemaVersion: 1,
    package: "@sistema-guidato/pi-sistema-guidato", version: "0.1.1",
    runtime: { server: "runtime/server/server.mjs", dashboard: "runtime/dashboard/index.html", templates: "runtime/templates" },
    files: [...files].map(([path, contenuto]) => ({ path, bytes: Buffer.byteLength(contenuto), sha256: hash(contenuto) })),
  }));
  await writeFile(join(artifactRoot, "pi-package-compatibility.json"), JSON.stringify({ manifestKind: "pi-package-compatibility", schemaVersion: 1,
    packageVersion: "0.1.1", projectSchemaReaders: [1, 2], projectSchemaWriters: [2],
    pi: { productionBaseline: "0.84.2", productionPatchId: "PI_GUI_RPC_ADAPTER_V1" }, capabilities: { interfacciaPiPanel: true },
  }));
  const destinazione = join(radice, "firmato");
  await creaPacchettoSistemaGuidato({ artifactRoot, destinazione, chiavePrivata });
  const risultato = await controllaPacchettoOpzionale({ destinazione, portachiavi: [pubblica], scrivi: () => {} });
  assert.equal(risultato.saltato, false);
  assert.equal(risultato.verificato.manifesto.id, "sistema-guidato");
  assert.equal(risultato.verificato.manifesto.chiaveId, pubblica.chiaveId);
  assert.ok(risultato.verificato.files.some((voce) => voce.percorso === "integration-manifest.json"));
  await assert.rejects(creaPacchettoSistemaGuidato({ artifactRoot, destinazione, chiavePrivata }), /esiste già/u);
});
