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

function codaDiagnostica(valore, limite) {
  const righe = String(valore ?? "").trimEnd().split(/\r?\n/u);
  const testo = righe.join("\n");
  if (righe.length <= 8 && Buffer.byteLength(JSON.stringify(testo), "utf8") <= limite) return testo;
  const separatore = "\n[…]\n";
  const spazio = Math.floor((limite - Buffer.byteLength(JSON.stringify(separatore), "utf8")) / 2);
  // Si limita anche la rappresentazione JSON, senza spezzare caratteri Unicode.
  let testa = "";
  for (const carattere of righe.slice(0, 4).join("\n")) {
    if (Buffer.byteLength(JSON.stringify(testa + carattere), "utf8") > spazio) break;
    testa += carattere;
  }
  let coda = "";
  for (const carattere of Array.from(righe.slice(-4).join("\n")).reverse()) {
    if (Buffer.byteLength(JSON.stringify(carattere + coda), "utf8") > spazio) break;
    coda = carattere + coda;
  }
  return testa + separatore + coda;
}

// Il terzo parametro esegui consente di sostituire l'esecutore PowerShell nelle prove.
export async function proteggiPermessiChiave(handle, destinazione, esegui = eseguiFile) {
  await handle.chmod(0o600);
  if (process.platform !== "win32") return;
  // chmod non governa la DACL di Windows. Il file è ancora vuoto: si sostituisce
  // la DACL con il solo SID corrente e la si rilegge prima di scrivere la chiave.
  // Nel comando entra soltanto il percorso, codificato senza interpolazione shell.
  const percorsoBase64 = Buffer.from(destinazione, "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$passo = 'acl'
try {
$percorso = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${percorsoBase64}'))
$info = [IO.FileInfo]::new($percorso)
$identita = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identita.User
$proprietarioPredefinito = $identita.Owner
$diritti = [Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::Synchronize
function Nuova-AclPrivata {
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $regola = [Security.AccessControl.FileSystemAccessRule]::new($sid, $diritti, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($regola)
  return $acl
}
$acl = Nuova-AclPrivata
$passo = 'proprietario'
try {
  $acl.SetOwner($sid)
  $info.SetAccessControl($acl)
} catch {
  # Un token elevato può avere come proprietario predefinito Administrators.
  # Un oggetto nuovo modifica solo la DACL, senza riproporre il proprietario.
  $erroreProprietario = $_.Exception.Message
  $passo = 'ripiego'
  try {
    $info.SetAccessControl((Nuova-AclPrivata))
  } catch {
    throw "DACL privata non applicata: $($_.Exception.Message); tentativo con proprietario: $erroreProprietario"
  }
}
$passo = 'rilettura'
try {
  $letta = $info.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
} catch {
  # All comprende la SACL: un utente ordinario può non avere SeSecurityPrivilege.
  # In quel solo caso si rileggono comunque proprietario, gruppo e DACL completi.
  $causa = $_.Exception
  while ($null -ne $causa.InnerException) { $causa = $causa.InnerException }
  if ($causa -isnot [Security.AccessControl.PrivilegeNotHeldException] -or $causa.PrivilegeName -ne 'SeSecurityPrivilege') { throw }
  $sezioni = [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group -bor [Security.AccessControl.AccessControlSections]::Access
  $letta = $info.GetAccessControl($sezioni)
}
$passo = 'verifica'
$regole = @($letta.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$proprietario = $letta.GetOwner([Security.Principal.SecurityIdentifier]).Value
if (-not $letta.AreAccessRulesProtected -or ($proprietario -ne $sid.Value -and $proprietario -ne $proprietarioPredefinito.Value) -or $regole.Count -ne 1) { throw 'ACL privata non verificata' }
$r = $regole[0]
if ($r.IdentityReference.Value -ne $sid.Value -or $r.IsInherited -or $r.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or [int]$r.FileSystemRights -ne [int]$diritti) { throw 'Permessi privati non verificati' }
[Console]::Out.WriteLine("VERIFICA proprietario=$proprietario regole=$($regole.Count)")
if ($proprietario -ne $sid.Value) { Write-Output "chiave protetta dalla sola DACL, proprietario $proprietario" }
} catch {
  [Console]::Error.WriteLine("PASSO=$passo " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message)
  exit 3
}
`;
  const windows = process.env.SystemRoot;
  // Windows PowerShell ricostruisce i propri percorsi dei moduli, anche se il
  // processo chiamante proviene da PowerShell 7. I nomi Windows ignorano il caso.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([nome]) => !/^(?:PSModulePath|PSExecutionPolicyPreference)$/iu.test(nome)));
  try {
    if (!windows || !isAbsolute(windows)) {
      throw Object.assign(new Error("La cartella di Windows non è disponibile per proteggere la chiave privata"), {
        code: "SYSTEMROOT_NON_VALIDO", stderr: "La cartella di Windows non è disponibile per proteggere la chiave privata",
      });
    }
    const { stdout } = await esegui(join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
    ], { env, shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
    if (stdout) process.stdout.write(stdout);
  } catch (errore) {
    // Il comando non riceve la chiave; solo codice, testa e coda dei flussi, entro 2 KB.
    const cause = {
      code: typeof errore.code === "number" ? errore.code : codaDiagnostica(errore.code, 128),
      stdout: codaDiagnostica(errore.stdout, 900),
      stderr: codaDiagnostica(errore.stderr, 900),
    };
    throw Object.assign(new Error("Impossibile restringere e verificare i permessi della chiave privata su Windows; nessun byte privato è stato scritto", { cause }), { code: "ESTENSIONE_PERMESSI" });
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
