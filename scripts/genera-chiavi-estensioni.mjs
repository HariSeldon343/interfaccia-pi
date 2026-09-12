#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { leggiFileRegolare } from "../app/estensioni-manifest.mjs";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eseguiFile = promisify(execFile);

async function proteggiPermessiChiave(handle, destinazione) {
  await handle.chmod(0o600);
  if (process.platform !== "win32") return;
  // chmod non governa la DACL di Windows. Il file è ancora vuoto: si sostituisce
  // la DACL con il solo SID corrente e la si rilegge prima di scrivere la chiave.
  // Nel comando entra soltanto il percorso, codificato senza interpolazione shell.
  const percorsoBase64 = Buffer.from(destinazione, "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$percorso = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${percorsoBase64}'))
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$diritti = [Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete
$acl = [Security.AccessControl.FileSecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$regola = [Security.AccessControl.FileSystemAccessRule]::new($sid, $diritti, [Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($regola)
Set-Acl -LiteralPath $percorso -AclObject $acl
$letta = Get-Acl -LiteralPath $percorso
$regole = @($letta.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$attesi = [int]$diritti -bor [int][Security.AccessControl.FileSystemRights]::Synchronize
if (-not $letta.AreAccessRulesProtected -or $letta.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $regole.Count -ne 1) { throw 'ACL privata non verificata' }
$r = $regole[0]
if ($r.IdentityReference.Value -ne $sid.Value -or $r.IsInherited -or $r.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or [int]$r.FileSystemRights -ne $attesi) { throw 'Permessi privati non verificati' }
`;
  const windows = process.env.SystemRoot;
  if (!windows || !isAbsolute(windows)) throw new Error("La cartella di Windows non è disponibile per proteggere la chiave privata");
  try {
    await eseguiFile(join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
    ], { shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
  } catch {
    throw Object.assign(new Error("Impossibile restringere e verificare i permessi della chiave privata su Windows; nessun byte privato è stato scritto"), { code: "ESTENSIONE_PERMESSI" });
  }
}

export async function scriviChiavePrivataProtetta(handle, destinazione, privata, proteggi = proteggiPermessiChiave) {
  await proteggi(handle, destinazione);
  await handle.writeFile(privata, "utf8");
  await handle.sync();
}

export function dentroCartella(percorso, radice) {
  const scarto = relative(radice, percorso);
  return scarto === "" || (scarto !== ".." && !scarto.startsWith(".." + sep) && !isAbsolute(scarto));
}

// La chiave entra soltanto come percorso esplicito: mai PEM o riferimenti a
// variabili d'ambiente. Si confrontano anche le radici reali, incluse le giunzioni.
export async function percorsoChiaveEsterna(percorso, { cartellaPacchetto } = {}) {
  if (typeof percorso !== "string" || !percorso.trim() || /[\r\n\0]/u.test(percorso)
    || /^(?:env:|--|\$)|%[^%]+%|\$\{[^}]+\}|-----BEGIN/iu.test(percorso)) {
    throw new Error("Indicare il percorso della chiave privata come argomento, senza variabili d'ambiente");
  }
  const assoluto = resolve(percorso);
  const repository = await realpath(REPOSITORY);
  const padre = await realpath(dirname(assoluto));
  const reale = join(padre, relative(dirname(assoluto), assoluto));
  if (dentroCartella(assoluto, REPOSITORY) || dentroCartella(reale, repository)) {
    throw new Error("La chiave privata deve restare fuori dal repository");
  }
  if (cartellaPacchetto && dentroCartella(reale, await realpath(cartellaPacchetto))) {
    throw new Error("La chiave privata deve restare fuori dalla cartella del pacchetto");
  }
  // Vale anche per un'altra copia di lavoro, compresi i worktree con .git file.
  for (let corrente = padre; ; corrente = dirname(corrente)) {
    if (await lstat(join(corrente, ".git")).catch((errore) => {
      if (errore.code === "ENOENT") return null;
      throw errore;
    })) throw new Error("La chiave privata deve restare fuori da ogni repository");
    if (dirname(corrente) === corrente) break;
  }
  return reale;
}

export function descriviChiavePubblica(pubblica) {
  const der = pubblica.export({ type: "spki", format: "der" });
  const chiaveId = "ed25519-" + createHash("sha256").update(der).digest("hex").slice(0, 40);
  return {
    chiaveId, pubblica: pubblica.export({ type: "spki", format: "pem" }),
    stato: "attiva", dal: new Date().toISOString().slice(0, 10), primaParte: true,
  };
}

export async function generaChiaviEstensioni(percorso) {
  const destinazione = await percorsoChiaveEsterna(percorso);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privata = privateKey.export({ type: "pkcs8", format: "pem" });
  let handle;
  let creato = false;
  try {
    handle = await open(destinazione, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    creato = true;
    await scriviChiavePrivataProtetta(handle, destinazione, privata);
  } catch (errore) {
    await handle?.close();
    handle = null;
    if (creato) await rm(destinazione, { force: true });
    throw errore;
  } finally {
    await handle?.close();
  }
  return descriviChiavePubblica(publicKey);
}

export async function leggiChiavePrivataEstensioni(percorso, opzioni = {}) {
  const destinazione = await percorsoChiaveEsterna(percorso, opzioni);
  const bytes = await leggiFileRegolare(destinazione, 16 * 1024);
  let privata;
  try { privata = createPrivateKey(bytes); }
  catch { throw new Error("Il file non contiene una chiave privata leggibile"); }
  if (privata.type !== "private" || privata.asymmetricKeyType !== "ed25519") {
    throw new Error("La chiave privata deve essere Ed25519");
  }
  return { privata, pubblica: descriviChiavePubblica(createPublicKey(privata)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Uso: node scripts/genera-chiavi-estensioni.mjs <percorso-privata-esterno-al-repository>");
    const pubblica = await generaChiaviEstensioni(process.argv[2]);
    process.stdout.write(`Chiave privata salvata soltanto nel percorso indicato.\nkeyId (chiaveId nel manifesto): ${pubblica.chiaveId}\n`);
    process.stdout.write("Incollare questa sola voce pubblica in PORTACHIAVI_ESTENSIONI di app/estensioni-chiavi.mjs, dopo la verifica della chiave di rilascio:\n");
    process.stdout.write(JSON.stringify(pubblica, null, 2) + "\n");
  } catch (errore) {
    process.stderr.write(errore.message + "\n");
    process.exitCode = 1;
  }
}
