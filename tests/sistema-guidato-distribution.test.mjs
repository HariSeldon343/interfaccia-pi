import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

test("il vendoring rifiuta il fallback implicito a una cartella privata locale", () => {
  const esito = spawnSync(
    process.execPath,
    [join(RADICE, "scripts", "vendor-sistema-guidato.mjs")],
    { cwd: RADICE, encoding: "utf8", env: { ...process.env, SISTEMA_GUIDATO_SOURCE: "" } },
  );
  assert.notEqual(esito.status, 0);
  assert.match(esito.stderr, /Indicare una sola sorgente/u);
  assert.doesNotMatch(esito.stderr, /C:\\src\\sistema-guidato/iu);
});

test("il preparatore supporta soltanto sorgente esplicita o release privata bloccata", async () => {
  const script = await readFile(join(RADICE, "scripts", "prepare-sistema-guidato.ps1"), "utf8");
  assert.match(script, /param\([\s\S]*\[string\]\$SourcePath/u);
  assert.match(script, /SISTEMA_GUIDATO_SOURCE/u);
  assert.match(script, /SISTEMA_GUIDATO_BUNDLE_REPOSITORY/u);
  assert.match(script, /SISTEMA_GUIDATO_BUNDLE_TAG/u);
  assert.match(script, /SISTEMA_GUIDATO_BUNDLE_ASSET/u);
  assert.match(script, /SISTEMA_GUIDATO_BUNDLE_SHA256/u);
  assert.match(script, /SISTEMA_GUIDATO_BUNDLE_TOKEN/u);
});

test("il token privato resta in header e viene rimosso prima di avviare Node", async () => {
  const script = await readFile(join(RADICE, "scripts", "prepare-sistema-guidato.ps1"), "utf8");
  const rimozione = script.indexOf("Remove-Item Env:SISTEMA_GUIDATO_BUNDLE_TOKEN");
  const avvioNode = script.indexOf("& node $vendorScript");
  assert.ok(rimozione >= 0 && rimozione < avvioNode);
  assert.match(script, /Authorization = "Bearer \$bundleToken"/u);
  assert.doesNotMatch(script, /--token|token=/iu);
});

test("download, digest ed estrazione avvengono in ordine fail-closed", async () => {
  const script = await readFile(join(RADICE, "scripts", "prepare-sistema-guidato.ps1"), "utf8");
  const download = script.indexOf("Invoke-WebRequest");
  const digest = script.indexOf("Get-FileHash");
  const confronto = script.indexOf("$actualSha256 -cne $expectedSha256");
  const estrazione = script.indexOf("Expand-Archive");
  const vendoring = script.lastIndexOf("Invoke-VendorScript");
  assert.ok(download >= 0 && download < digest);
  assert.ok(digest < confronto && confronto < estrazione);
  assert.ok(estrazione < vendoring);
  assert.match(script, /--artifact-root=\$extractPath/u);
});

test("l'asset estratto accetta esattamente runtime e due manifesti sorgente", async () => {
  const script = await readFile(join(RADICE, "scripts", "prepare-sistema-guidato.ps1"), "utf8");
  assert.match(
    script,
    /\$required = @\('runtime', 'release-manifest\.json', 'pi-package-compatibility\.json'\)/u,
  );
  assert.match(script, /\$topLevel\.Count -ne \$required\.Count/u);
  assert.match(script, /Layout del file Sistema Guidato non valido/u);
});

test("il cleanup ricorsivo e confinato alla directory temporanea verificata", async () => {
  const script = await readFile(join(RADICE, "scripts", "prepare-sistema-guidato.ps1"), "utf8");
  assert.match(script, /function Assert-SafeTemporaryPath/u);
  assert.match(script, /StartsWith\(\$prefix, \[System\.StringComparison\]::OrdinalIgnoreCase\)/u);
  assert.match(script, /Remove-Item -LiteralPath \$safeWorkDirectory -Recurse -Force/u);
});

test("i workflow pubblici acquisiscono e verificano il bundle prima dei test", async () => {
  for (const nome of ["verifica-windows.yml", "compila-windows.yml"]) {
    const workflow = await readFile(join(RADICE, ".github", "workflows", nome), "utf8");
    for (const configurazione of [
      "SISTEMA_GUIDATO_BUNDLE_TOKEN",
      "SISTEMA_GUIDATO_BUNDLE_REPOSITORY",
      "SISTEMA_GUIDATO_BUNDLE_TAG",
      "SISTEMA_GUIDATO_BUNDLE_ASSET",
      "SISTEMA_GUIDATO_BUNDLE_SHA256",
    ]) assert.match(workflow, new RegExp(configurazione, "u"), nome);
    const prepara = workflow.indexOf("scripts/prepare-sistema-guidato.ps1");
    const verifica = workflow.indexOf("npm run vendor:sistema:check", prepara);
    const testJavascript = workflow.indexOf("npm test", verifica);
    assert.ok(prepara >= 0 && prepara < verifica, nome);
    assert.ok(verifica < testJavascript, nome);
  }
});

test("il bundle generato non viene assunto come file versionato", async () => {
  const ignore = await readFile(join(RADICE, ".gitignore"), "utf8");
  assert.match(ignore, /^\/vendor\/sistema-guidato\/$/mu);
  assert.match(ignore, /^\/vendor\/\.sistema-guidato-stage-\*\/$/mu);
});
