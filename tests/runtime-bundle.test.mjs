import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applicaAdapterRpcPi,
  PI_INTEGRITA_SUPPLEMENTARE,
  PI_RPC_ADAPTER_PATCH,
  RUNTIME_SPEC,
} from "../scripts/vendor-pi-runtime.mjs";

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

async function esiste(percorso) {
  try {
    await access(percorso);
    return true;
  } catch {
    return false;
  }
}

test("runtime portable blocca Node, PI e gli strumenti base a digest noti", () => {
  assert.equal(RUNTIME_SPEC.node.version, "24.18.0");
  assert.match(RUNTIME_SPEC.node.url, /^https:\/\/nodejs\.org\/dist\/v24\.18\.0\//);
  assert.match(RUNTIME_SPEC.node.sha256, /^[a-f0-9]{64}$/);
  assert.equal(RUNTIME_SPEC.pi.name, "@earendil-works/pi-coding-agent");
  assert.equal(RUNTIME_SPEC.pi.version, "0.84.2");
  assert.match(RUNTIME_SPEC.pi.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  assert.equal(Object.keys(PI_INTEGRITA_SUPPLEMENTARE).length, 6);
  for (const [percorso, integrity] of Object.entries(PI_INTEGRITA_SUPPLEMENTARE)) {
    assert.match(percorso, /^node_modules\/@earendil-works\/pi-/);
    assert.match(integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  }
  assert.deepEqual(
    { fd: RUNTIME_SPEC.tools.fd.version, rg: RUNTIME_SPEC.tools.rg.version },
    { fd: "10.4.2", rg: "15.2.0" },
  );
  assert.match(RUNTIME_SPEC.tools.fd.sha256, /^[a-f0-9]{64}$/);
  assert.match(RUNTIME_SPEC.tools.rg.sha256, /^[a-f0-9]{64}$/);
});

test("build desktop richiede il vendor verificato e Node 22.19 minimo", async () => {
  const [pacchetto, lock, launcher] = await Promise.all([
    readFile(join(RADICE, "package.json"), "utf8").then(JSON.parse),
    readFile(join(RADICE, "package-lock.json"), "utf8").then(JSON.parse),
    readFile(join(RADICE, "avvia.mjs"), "utf8"),
  ]);
  assert.equal(pacchetto.engines.node, ">=22.19.0");
  assert.equal(lock.packages[""].engines.node, ">=22.19.0");
  assert.equal(pacchetto.scripts["build:desktop"], "npm run vendor:pi && tauri build");
  assert.equal(pacchetto.scripts["build:desktop:offline"], "npm run vendor:pi:check && tauri build");
  assert.match(launcher, /VERSIONE_NODE_MINIMA = \[22, 19, 0\]/);
  assert.match(launcher, /versioneNodeSupportata\(process\.versions\.node\)/);
});

test("Tauri include runtime completo e il launcher release lo preferisce", async () => {
  const [config, rust] = await Promise.all([
    readFile(join(RADICE, "src-tauri", "tauri.conf.json"), "utf8").then(JSON.parse),
    readFile(join(RADICE, "src-tauri", "src", "lib.rs"), "utf8"),
  ]);
  assert.equal(config.bundle.resources["../vendor/pi-runtime/node"], "runtime/node");
  assert.equal(config.bundle.resources["../vendor/pi-runtime/pi"], "runtime/pi");
  assert.equal(config.bundle.resources["../vendor/pi-runtime/tools"], "runtime/tools");
  assert.equal(config.bundle.resources["../vendor/pi-runtime/manifest.json"], "runtime/manifest.json");
  assert.equal(config.bundle.resources["../licenses"], "licenses");
  assert.equal(config.bundle.resources["../app/public/palette-core.js"], "app/public/palette-core.js");
  assert.equal(config.bundle.resources["../app/public/link-core.js"], "app/public/link-core.js");
  assert.equal(await esiste(join(RADICE, "licenses", "INTERFACCIA-PI-ISC.txt")), true);
  assert.doesNotMatch(JSON.stringify(config.bundle.resources), /(?:Users|AppData|\.pi[\\/])/i);

  assert.match(rust, /join\("runtime"\)[\s\S]*join\("node"\)/);
  assert.match(rust, /join\("runtime"\)[\s\S]*join\("pi"\)[\s\S]*join\("cli\.js"\)/);
  assert.match(rust, /tools\.join\("fd\.exe"\)\.is_file\(\)/);
  assert.match(rust, /tools\.join\("rg\.exe"\)\.is_file\(\)/);
  assert.match(rust, /comando\.env\("PI_GUI_NODE", &node\)/);
  assert.match(rust, /comando\.env\("PI_GUI_PI_CLI", &cli\)/);
  assert.match(rust, /cartelle\.push\(percorso_semplice\(tools\)\)/);
  assert.match(rust, /#\[cfg\(debug_assertions\)\][\s\S]*fn runtime_pi_sviluppo/);
  assert.match(rust, /#\[cfg\(not\(debug_assertions\)\)\][\s\S]*None/);
});

test("vendor isola npm, completa il lock e non acquisisce il profilo utente", async () => {
  const sorgente = await readFile(join(RADICE, "scripts", "vendor-pi-runtime.mjs"), "utf8");
  assert.match(sorgente, /NPM_CONFIG_USERCONFIG/);
  assert.match(sorgente, /NPM_CONFIG_GLOBALCONFIG/);
  assert.match(sorgente, /NODE_OPTIONS: ""/);
  assert.match(sorgente, /"--ignore-scripts"/);
  assert.match(sorgente, /Shrinkwrap PI privo di integrity non autorizzata/);
  assert.match(sorgente, /Valore dell'ambiente sensibile/);
  assert.match(sorgente, /Percorso del profilo utente rilevato/);
  assert.match(sorgente, /binarioNativoVerificato/);
  assert.match(sorgente, /if \(!binarioNativoVerificato\)/);
  assert.match(sorgente, /cartelleSensibili = new Set\(\["\.pi", "\.agents"\]\)/);
  assert.doesNotMatch(sorgente, /testo della stessa licenza SPDX da un'altra dipendenza/);
  assert.match(sorgente, /(?:testo|template) canonico SPDX MIT/);
  assert.match(sorgente, /non ne viene attribuito uno per inferenza/);
  assert.match(sorgente, /testo canonico SPDX Apache-2\.0/);
  assert.ok(sorgente.includes(String.raw`models(?:[._-][^.]+)*\.json`));
});

test("adapter RPC PI e bloccato a sorgente, patch e digest esatti", async () => {
  const [sorgenteVendor, patch] = await Promise.all([
    readFile(join(RADICE, "scripts", "vendor-pi-runtime.mjs"), "utf8"),
    readFile(join(RADICE, "scripts", PI_RPC_ADAPTER_PATCH.patch), "utf8"),
  ]);
  assert.equal(PI_RPC_ADAPTER_PATCH.upstreamSha256, "b8056af06447a3b89b680519bae1ce1d9063a266d827c3ca92f2dcd57c5ffd2b");
  assert.equal(PI_RPC_ADAPTER_PATCH.patchedSha256, "fd50d795ef19913814570f2ee8a7cb946b27c303290201cb6d7d127d2086d408");
  assert.match(patch, /^diff --git a\/dist\/modes\/rpc\/rpc-mode\.js b\/dist\/modes\/rpc\/rpc-mode\.js/m);
  assert.equal((patch.match(/^@@ /gm) || []).length, 11);
  assert.equal((patch.match(/PI_GUI_RPC_ADAPTER_V1/g) || []).length, 1);

  const npmCi = sorgenteVendor.indexOf('[npmCli, "ci"');
  const applicazione = sorgenteVendor.indexOf("await applicaAdapterRpcPi(radicePi)");
  const smoke = sorgenteVendor.indexOf("await smokeRuntime(runtime, temporanea)");
  assert.ok(npmCi >= 0 && npmCi < applicazione && applicazione < smoke);
  assert.match(sorgenteVendor, /contesto divergente/);
  assert.match(sorgenteVendor, /risultato non riproducibile/);

  const radicePi = join(RADICE, "vendor", "pi-runtime", "pi");
  const rpc = join(radicePi, ...PI_RPC_ADAPTER_PATCH.target.split("/"));
  if (await esiste(rpc)) {
    const testo = await readFile(rpc, "utf8");
    const digest = createHash("sha256").update(testo, "utf8").digest("hex");
    assert.equal(digest, PI_RPC_ADAPTER_PATCH.patchedSha256);
    assert.equal((testo.match(/PI_GUI_RPC_ADAPTER_V1/g) || []).length, 1);
    for (const comando of [
      "set_scoped_models",
      "refresh_models",
      "get_rpc_settings",
      "set_rpc_setting",
      "export_jsonl",
      "import_jsonl",
      "navigate_tree",
      "abort_branch_summary",
      "set_label",
      "reload",
      "get_auth_providers",
      "login_provider",
      "abort_login_provider",
      "logout_provider",
    ]) {
      assert.match(testo, new RegExp(`case \\\"${comando}\\\"`));
    }
    assert.match(testo, /sensitive: true/);
    assert.match(testo, /authEvent,/);
    assert.match(testo, /new AbortController\(\)/);
    assert.match(testo, /signal: loginController\.signal/);
    assert.match(testo, /authEvent: \{ type: "prompt", loginCommandId \}/);
    assert.match(testo, /AbortSignal\.any\(\[loginController\.signal, request\.signal\]\)/);
    assert.match(testo, /fsConstants\.COPYFILE_EXCL/);
    assert.match(testo, /configureHttpDispatcher\(value\)/);
    assert.match(testo, /Promise\.race\(\[refreshResult, timeoutResult\]\)/);
    assert.match(testo, /scopedModels: session\.scopedModels\.slice\(0, 256\)/);
    assert.match(testo, /settingsManager\.setEnabledModels\(allModelsEnabled/);
    assert.match(testo, /await session\.settingsManager\.flush\(\)/);
    assert.deepEqual(await applicaAdapterRpcPi(radicePi), {
      modified: false,
      sha256: PI_RPC_ADAPTER_PATCH.patchedSha256,
    });
  }
});

test("adapter RPC rifiuta un file diverso dall'upstream bloccato", async () => {
  const temporanea = await mkdtemp(join(tmpdir(), "pi-rpc-adapter-mismatch-"));
  try {
    const cartella = join(temporanea, "dist", "modes", "rpc");
    await mkdir(cartella, { recursive: true });
    await writeFile(join(cartella, "rpc-mode.js"), "export const altered = true;\n", "utf8");
    await assert.rejects(
      applicaAdapterRpcPi(temporanea),
      /SHA-256 upstream inatteso/,
    );
  } finally {
    await rm(temporanea, { recursive: true, force: true });
  }
});

test("runtime RPC esegue adapter, settings, refresh, auth e rebind", { timeout: 60_000 }, async (t) => {
  const runtime = join(RADICE, "vendor", "pi-runtime");
  const node = join(runtime, "node", "node.exe");
  const cli = join(runtime, "pi", "dist", "cli.js");
  if (!(await esiste(node)) || !(await esiste(cli))) {
    t.skip("runtime generato solo dalla fase vendor/build");
    return;
  }

  const temporanea = await mkdtemp(join(tmpdir(), "pi-rpc-adapter-smoke-"));
  const home = join(temporanea, "home");
  const sessioni = join(temporanea, "sessions");
  const agentDir = join(home, ".pi", "agent");
  const roaming = join(home, "AppData", "Roaming");
  const local = join(home, "AppData", "Local");
  await mkdir(roaming, { recursive: true });
  await mkdir(local, { recursive: true });
  await mkdir(sessioni, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const skillDir = join(agentDir, "skills", "smoke-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), [
    "---",
    "name: smoke-skill",
    "description: Skill usata dal collaudo RPC",
    "---",
    "Esegui il collaudo richiesto.",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({
    providers: {
      "pi-gui-smoke": {
        baseUrl: "http://127.0.0.1:9/v1",
        api: "openai-completions",
        apiKey: "smoke-only-placeholder",
        models: [{ id: "model-a" }, { id: "model-b" }],
      },
    },
  }, null, 2)}\n`, "utf8");
  const env = Object.fromEntries(Object.entries({
    SystemRoot: process.env.SystemRoot || "C:\\Windows",
    WINDIR: process.env.WINDIR || process.env.SystemRoot || "C:\\Windows",
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    TEMP: temporanea,
    TMP: temporanea,
    HOME: home,
    USERPROFILE: home,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    PI_OFFLINE: "1",
    NODE_OPTIONS: "",
    PATH: [join(runtime, "node"), join(process.env.SystemRoot || "C:\\Windows", "System32")].join(delimiter),
  }).filter(([, valore]) => typeof valore === "string"));
  const processo = spawn(node, [
    cli,
    "--mode", "rpc",
    "--offline",
    "--session-dir", sessioni,
    "--no-context-files",
    "--no-extensions",
    "--no-prompt-templates",
  ], {
    cwd: temporanea,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  processo.stdout.setEncoding("utf8");
  processo.stderr.setEncoding("utf8");
  let buffer = "";
  let stderr = "";
  let sequenza = 0;
  const pendenti = new Map();
  const richiesteSensibili = [];
  let trattieniRichiestaSensibile = false;
  let risolviRichiestaSensibile = null;
  processo.stderr.on("data", (chunk) => { stderr += chunk; });
  processo.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const fine = buffer.indexOf("\n");
      if (fine < 0) break;
      const riga = buffer.slice(0, fine);
      buffer = buffer.slice(fine + 1);
      if (!riga) continue;
      const evento = JSON.parse(riga);
      if (evento.type === "extension_ui_request" && evento.method === "input" && evento.sensitive === true) {
        richiesteSensibili.push(evento);
        if (trattieniRichiestaSensibile) {
          risolviRichiestaSensibile?.(evento);
          risolviRichiestaSensibile = null;
        } else {
          processo.stdin.write(`${JSON.stringify({
            type: "extension_ui_response",
            id: evento.id,
            cancelled: true,
          })}\n`);
        }
      }
      if (evento.type === "response" && pendenti.has(evento.id)) {
        const risolvi = pendenti.get(evento.id);
        pendenti.delete(evento.id);
        risolvi(evento);
      }
    }
  });
  const inviaConId = (id, type, dati = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendenti.delete(id);
      reject(new Error(`Timeout RPC ${type}: ${stderr.slice(-1000)}`));
    }, 20_000);
    pendenti.set(id, (risposta) => {
      clearTimeout(timer);
      resolve(risposta);
    });
    processo.stdin.write(`${JSON.stringify({ id, type, ...dati })}\n`);
  });
  const invia = (type, dati = {}) => inviaConId(`smoke-${++sequenza}`, type, dati);

  try {
    const catalogoModelli = await invia("get_available_models");
    assert.equal(catalogoModelli.success, true);
    const modelliSmoke = catalogoModelli.data.models.filter((model) => model.provider === "pi-gui-smoke");
    assert.equal(modelliSmoke.length, 2);
    const primoModello = modelliSmoke[0];
    await writeFile(join(agentDir, "models.json"), `${JSON.stringify({
      providers: {
        "pi-gui-smoke": {
          baseUrl: "http://127.0.0.1:9/v1",
          api: "openai-completions",
          apiKey: "smoke-only-placeholder",
          models: [{ id: "model-a" }, { id: "model-b" }, { id: "model-c" }],
        },
      },
    }, null, 2)}\n`, "utf8");
    const refresh = await invia("refresh_models");
    assert.equal(refresh.success, true);
    assert.equal(refresh.data.timedOut, false);
    assert.equal(refresh.data.modelCount >= 3, true);
    const dopoRefresh = await invia("get_available_models");
    assert.equal(
      dopoRefresh.data.models.some((model) => model.provider === "pi-gui-smoke" && model.id === "model-c"),
      true,
    );
    const modelliRichiesti = [{
      provider: primoModello.provider,
      modelId: primoModello.id,
      thinkingLevel: "high",
    }];
    const scoped = await invia("set_scoped_models", { models: modelliRichiesti });
    assert.equal(scoped.success, true);
    assert.deepEqual(scoped.data.models, modelliRichiesti);
    const stato = await invia("get_state");
    assert.equal(stato.success, true);
    assert.deepEqual(stato.data.scopedModels, modelliRichiesti);
    const settingsPath = join(agentDir, "settings.json");
    let settingsPersistite = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(settingsPersistite.enabledModels, [`${primoModello.provider}/${primoModello.id}`]);
    assert.doesNotMatch(JSON.stringify(settingsPersistite.enabledModels), /:high/);
    const tutti = await invia("set_scoped_models", { models: [] });
    assert.equal(tutti.success, true);
    assert.deepEqual(tutti.data.models, []);
    assert.deepEqual((await invia("get_state")).data.scopedModels, []);
    settingsPersistite = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(Object.hasOwn(settingsPersistite, "enabledModels"), false);
    const settingsRpc = await invia("get_rpc_settings");
    assert.equal(settingsRpc.success, true);
    assert.equal(settingsRpc.data.schemaVersion, 1);
    assert.deepEqual(Object.keys(settingsRpc.data.settings).sort(), [
      "autoCompaction",
      "autoResizeImages",
      "autoRetry",
      "blockImages",
      "enableSkillCommands",
      "followUpMode",
      "httpIdleTimeoutMs",
      "steeringMode",
      "transport",
    ]);
    const timeoutNonValido = await invia("set_rpc_setting", { name: "httpIdleTimeoutMs", value: 123 });
    assert.equal(timeoutNonValido.success, false);
    assert.match(timeoutNonValido.error, /supported TUI value/i);
    const aggiornamenti = {
      autoCompaction: false,
      autoRetry: false,
      steeringMode: "all",
      followUpMode: "all",
      blockImages: true,
      autoResizeImages: false,
      enableSkillCommands: false,
      transport: "sse",
      httpIdleTimeoutMs: 30_000,
    };
    for (const [name, value] of Object.entries(aggiornamenti)) {
      const impostata = await invia("set_rpc_setting", { name, value });
      assert.equal(impostata.success, true, `${name}: ${impostata.error || "rifiutata"}`);
      assert.deepEqual(impostata.data, { name, value });
    }
    assert.deepEqual((await invia("get_rpc_settings")).data.settings, aggiornamenti);
    const comandiSenzaSkill = await invia("get_commands");
    assert.equal(comandiSenzaSkill.data.commands.some((comando) => comando.name === "skill:smoke-skill"), false);
    const riabilitaSkill = await invia("set_rpc_setting", { name: "enableSkillCommands", value: true });
    assert.equal(riabilitaSkill.success, true);
    const comandiConSkill = await invia("get_commands");
    assert.equal(comandiConSkill.data.commands.some((comando) => comando.name === "skill:smoke-skill"), true);
    settingsPersistite = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settingsPersistite.compaction.enabled, false);
    assert.equal(settingsPersistite.retry.enabled, false);
    assert.equal(settingsPersistite.steeringMode, "all");
    assert.equal(settingsPersistite.followUpMode, "all");
    assert.deepEqual(settingsPersistite.images, { blockImages: true, autoResize: false });
    assert.equal(settingsPersistite.enableSkillCommands, true);
    assert.equal(settingsPersistite.transport, "sse");
    assert.equal(settingsPersistite.httpIdleTimeoutMs, 30_000);
    const auth = await invia("get_auth_providers");
    assert.equal(auth.success, true);
    assert.ok(Array.isArray(auth.data.providers));
    for (const provider of auth.data.providers) {
      assert.deepEqual(
        Object.keys(provider).sort(),
        ["credentialType", "id", "methods", "name"],
      );
    }
    const providerSegreto = auth.data.providers.find((provider) => provider.id === "anthropic" && provider.methods.apiKey)
      ?? auth.data.providers.find((provider) => provider.methods.apiKey);
    if (providerSegreto) {
      trattieniRichiestaSensibile = true;
      const promptRicevuto = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Il login non ha richiesto il segreto in tempo")), 5000);
        risolviRichiestaSensibile = (evento) => {
          clearTimeout(timer);
          resolve(evento);
        };
      });
      const loginId = `smoke-${++sequenza}`;
      const loginInCorso = inviaConId(loginId, "login_provider", {
        providerId: providerSegreto.id,
        authType: "api_key",
      });
      const richiesta = await promptRicevuto;
      assert.equal(richiesta.sensitive, true);
      assert.equal(richiesta.loginCommandId, loginId);
      assert.deepEqual(richiesta.authEvent, { type: "prompt", loginCommandId: loginId });
      const annullamento = await invia("abort_login_provider", { loginCommandId: loginId });
      assert.equal(annullamento.success, true);
      assert.deepEqual(annullamento.data, { loginCommandId: loginId, cancelled: true });
      const loginAnnullato = await loginInCorso;
      assert.equal(loginAnnullato.success, false);
      assert.match(loginAnnullato.error, /abort|cancel/i);

      // Il finally dell'adapter libera lo slot e un secondo accesso arriva
      // nuovamente al prompt, che la GUI annulla nel modo ordinario.
      trattieniRichiestaSensibile = false;
      const loginSuccessivo = await invia("login_provider", {
        providerId: providerSegreto.id,
        authType: "api_key",
      });
      assert.equal(loginSuccessivo.success, false);
      assert.match(loginSuccessivo.error, /cancel/i);
      assert.equal(richiesteSensibili.length, 2);
    }
    const esportazione = join(temporanea, "sessione-export.jsonl");
    assert.equal((await invia("export_jsonl", { outputPath: esportazione })).success, true);
    assert.equal(await esiste(esportazione), true);
    assert.equal((await invia("reload")).success, true);
    assert.equal((await invia("get_commands")).success, true);
    assert.equal((await invia("import_jsonl", { inputPath: esportazione, cwdOverride: temporanea })).success, true);
    assert.equal((await invia("get_commands")).success, true);
    const statoImportato = await invia("get_state");
    const fileCorrente = statoImportato.data.sessionFile;
    const bytesCorrenti = await readFile(fileCorrente);
    const collisioneArchiviata = join(sessioni, "collisione.jsonl");
    const cartellaEsterna = join(temporanea, "esterna");
    await mkdir(cartellaEsterna);
    await writeFile(collisioneArchiviata, "archivio-da-preservare\n", "utf8");
    const bytesArchiviati = await readFile(collisioneArchiviata);
    const collisioneEsterna = join(cartellaEsterna, "collisione.jsonl");
    await writeFile(collisioneEsterna, "sorgente-diversa\n", "utf8");
    const collisione = await invia("import_jsonl", { inputPath: collisioneEsterna, cwdOverride: temporanea });
    assert.equal(collisione.success, false);
    assert.match(collisione.error, /same file name|overwritten/i);
    assert.deepEqual(await readFile(collisioneArchiviata), bytesArchiviati);
    assert.deepEqual(await readFile(fileCorrente), bytesCorrenti);
    const abortRiassunto = await invia("abort_branch_summary");
    assert.equal(abortRiassunto.success, true);
    assert.deepEqual(abortRiassunto.data, { requested: true });
    const navigazione = await invia("navigate_tree", { entryId: "missing-entry", options: { summarize: false } });
    assert.equal(navigazione.command, "navigate_tree");
    assert.equal(navigazione.success, false);
    const etichetta = await invia("set_label", { entryId: "missing-entry", label: "smoke" });
    assert.equal(etichetta.command, "set_label");
    assert.equal(etichetta.success, false);
  } finally {
    processo.stdin.end();
    await new Promise((resolve) => {
      if (processo.exitCode !== null) return resolve();
      processo.once("exit", resolve);
      setTimeout(() => {
        processo.kill();
        resolve();
      }, 5_000).unref();
    });
    await rm(temporanea, { recursive: true, force: true });
  }
});

test("runtime RPC ricarica le skill create dopo l'avvio solo con reload", { timeout: 45_000 }, async (t) => {
  const runtime = join(RADICE, "vendor", "pi-runtime");
  const node = join(runtime, "node", "node.exe");
  const cli = join(runtime, "pi", "dist", "cli.js");
  if (!(await esiste(node)) || !(await esiste(cli))) {
    t.skip("runtime generato solo dalla fase vendor/build");
    return;
  }

  const temporanea = await mkdtemp(join(tmpdir(), "pi-rpc-skill-reload-"));
  const home = join(temporanea, "home");
  const sessioni = join(temporanea, "sessions");
  const agentDir = join(home, ".pi", "agent");
  const roaming = join(home, "AppData", "Roaming");
  const local = join(home, "AppData", "Local");
  const scriviSkill = async (nome, descrizione) => {
    const cartella = join(agentDir, "skills", nome);
    await mkdir(cartella, { recursive: true });
    await writeFile(join(cartella, "SKILL.md"), [
      "---",
      `name: ${nome}`,
      `description: ${descrizione}`,
      "---",
      `Esegui la procedura ${nome}.`,
      "",
    ].join("\n"), "utf8");
  };

  await mkdir(roaming, { recursive: true });
  await mkdir(local, { recursive: true });
  await mkdir(sessioni, { recursive: true });
  await scriviSkill("skill-avvio", "Skill presente prima dell'avvio RPC");

  const env = Object.fromEntries(Object.entries({
    SystemRoot: process.env.SystemRoot || "C:\\Windows",
    WINDIR: process.env.WINDIR || process.env.SystemRoot || "C:\\Windows",
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    TEMP: temporanea,
    TMP: temporanea,
    HOME: home,
    USERPROFILE: home,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    PI_OFFLINE: "1",
    NODE_OPTIONS: "",
    PATH: [join(runtime, "node"), join(process.env.SystemRoot || "C:\\Windows", "System32")].join(delimiter),
  }).filter(([, valore]) => typeof valore === "string"));
  const processo = spawn(node, [
    cli,
    "--mode", "rpc",
    "--offline",
    "--session-dir", sessioni,
    "--no-context-files",
    "--no-extensions",
    "--no-prompt-templates",
  ], {
    cwd: temporanea,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  processo.stdout.setEncoding("utf8");
  processo.stderr.setEncoding("utf8");
  let buffer = "";
  let stderr = "";
  let sequenza = 0;
  const pendenti = new Map();
  processo.stderr.on("data", (chunk) => { stderr += chunk; });
  processo.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const fine = buffer.indexOf("\n");
      if (fine < 0) break;
      const riga = buffer.slice(0, fine);
      buffer = buffer.slice(fine + 1);
      if (!riga) continue;
      const evento = JSON.parse(riga);
      if (evento.type === "response" && pendenti.has(evento.id)) {
        const risolvi = pendenti.get(evento.id);
        pendenti.delete(evento.id);
        risolvi(evento);
      }
    }
  });
  const invia = (type, dati = {}) => new Promise((resolve, reject) => {
    const id = `skill-reload-${++sequenza}`;
    const timer = setTimeout(() => {
      pendenti.delete(id);
      reject(new Error(`Timeout RPC ${type}: ${stderr.slice(-1000)}`));
    }, 15_000);
    pendenti.set(id, (risposta) => {
      clearTimeout(timer);
      resolve(risposta);
    });
    processo.stdin.write(`${JSON.stringify({ id, type, ...dati })}\n`);
  });
  const contieneSkill = (risposta, nome) => risposta.data.commands
    .some((comando) => comando.name === `skill:${nome}`);

  try {
    const riabilitaSkill = await invia("set_rpc_setting", { name: "enableSkillCommands", value: true });
    assert.equal(riabilitaSkill.success, true);
    const catalogoIniziale = await invia("get_commands");
    assert.equal(catalogoIniziale.success, true);
    assert.equal(contieneSkill(catalogoIniziale, "skill-avvio"), true);
    assert.equal(contieneSkill(catalogoIniziale, "skill-dinamica"), false);

    await scriviSkill("skill-dinamica", "Skill creata mentre RPC e in esecuzione");
    const primaDelReload = await invia("get_commands");
    assert.equal(primaDelReload.success, true);
    assert.equal(contieneSkill(primaDelReload, "skill-avvio"), true);
    assert.equal(contieneSkill(primaDelReload, "skill-dinamica"), false);

    const reload = await invia("reload");
    assert.equal(reload.success, true);
    const dopoIlReload = await invia("get_commands");
    assert.equal(dopoIlReload.success, true);
    assert.equal(contieneSkill(dopoIlReload, "skill-avvio"), true);
    assert.equal(contieneSkill(dopoIlReload, "skill-dinamica"), true);
  } finally {
    processo.stdin.end();
    await new Promise((resolve) => {
      if (processo.exitCode !== null) return resolve();
      processo.once("exit", resolve);
      setTimeout(() => {
        processo.kill();
        resolve();
      }, 5_000).unref();
    });
    await rm(temporanea, { recursive: true, force: true });
  }
});

test("manifesto generato, quando presente, non contiene configurazione utente", async (t) => {
  const runtime = join(RADICE, "vendor", "pi-runtime");
  const manifestoPath = join(runtime, "manifest.json");
  if (!(await esiste(manifestoPath))) {
    t.skip("runtime generato solo dalla fase vendor/build");
    return;
  }
  const manifesto = JSON.parse(await readFile(manifestoPath, "utf8"));
  assert.equal(manifesto.node.version, RUNTIME_SPEC.node.version);
  assert.equal(manifesto.pi.version, RUNTIME_SPEC.pi.version);
  assert.equal(manifesto.tools.fd.version, RUNTIME_SPEC.tools.fd.version);
  assert.equal(manifesto.tools.rg.version, RUNTIME_SPEC.tools.rg.version);
  assert.ok(manifesto.packageCount > 100);
  assert.ok(manifesto.files.length > 1_000);
  const percorsi = manifesto.files.map((voce) => voce.path);
  assert.ok(percorsi.includes("node/node.exe"));
  assert.ok(percorsi.includes("pi/dist/cli.js"));
  assert.ok(percorsi.includes("tools/fd.exe"));
  assert.ok(percorsi.includes("tools/rg.exe"));
  assert.equal(
    percorsi.some((percorso) => /(?:^|\/)(?:\.pi|\.agents)(?:\/|$)|(?:^|\/)(?:auth|settings|trust|credentials)\.json$/i.test(percorso)),
    false,
  );
});
