import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

test("il Pi reale carica /sistema e apre il menu tramite il protocollo UI RPC", async (t) => {
  const candidati = [
    join(RADICE, "vendor", "pi-runtime"),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Interfaccia pi", "runtime") : null,
  ].filter(Boolean);
  const runtime = candidati.find((voce) => existsSync(join(voce, "node", "node.exe")) && existsSync(join(voce, "pi", "dist", "cli.js")));
  if (!runtime) {
    t.skip("runtime Pi reale non disponibile");
    return;
  }
  const temporanea = await mkdtemp(join(tmpdir(), "pi-sistema-rpc-"));
  const home = join(temporanea, "home");
  const sessioni = join(temporanea, "sessions");
  await mkdir(home, { recursive: true });
  await mkdir(sessioni, { recursive: true });
  const node = join(runtime, "node", "node.exe");
  const cli = join(runtime, "pi", "dist", "cli.js");
  const estensione = join(RADICE, "app", "extensions", "sistema-guidato", "index.ts");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    PI_OFFLINE: "1",
    NODE_OPTIONS: "",
    PATH: [join(runtime, "node"), join(process.env.SystemRoot || "C:\\Windows", "System32")].join(delimiter),
  };
  const processo = spawn(node, [
    cli,
    "--mode", "rpc",
    "--offline",
    "--session-dir", sessioni,
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--extension", estensione,
  ], { cwd: temporanea, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  processo.stdout.setEncoding("utf8");
  processo.stderr.setEncoding("utf8");
  let buffer = "";
  let stderr = "";
  let sequenza = 0;
  const pendenti = new Map();
  const eventi = [];
  const atteseEvento = [];
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
      eventi.push(evento);
      if (evento.type === "response" && pendenti.has(evento.id)) {
        const completa = pendenti.get(evento.id);
        pendenti.delete(evento.id);
        completa(evento);
      }
      for (let indice = atteseEvento.length - 1; indice >= 0; indice -= 1) {
        if (atteseEvento[indice].predicato(evento)) {
          const [{ completa }] = atteseEvento.splice(indice, 1);
          completa(evento);
        }
      }
    }
  });
  const invia = (type, dati = {}) => new Promise((resolve, reject) => {
    const id = `sistema-smoke-${++sequenza}`;
    const timer = setTimeout(() => {
      pendenti.delete(id);
      reject(new Error(`Timeout RPC ${type}: ${stderr.slice(-1500)}`));
    }, 15_000);
    pendenti.set(id, (risposta) => {
      clearTimeout(timer);
      resolve(risposta);
    });
    processo.stdin.write(`${JSON.stringify({ id, type, ...dati })}\n`);
  });
  const attendiEvento = (predicato) => new Promise((resolve, reject) => {
    const giaRicevuto = eventi.find(predicato);
    if (giaRicevuto) return resolve(giaRicevuto);
    const timer = setTimeout(() => reject(new Error(`Timeout evento UI: ${stderr.slice(-1500)}`)), 15_000);
    atteseEvento.push({ predicato, completa: (evento) => { clearTimeout(timer); resolve(evento); } });
  });
  try {
    const catalogo = await invia("get_commands");
    assert.equal(catalogo.success, true, stderr);
    assert.ok(catalogo.data.commands.some((comando) => comando.name === "sistema" && comando.source === "extension"));
    const rispostaPrompt = invia("prompt", { message: "/sistema" });
    const richiesta = await attendiEvento((evento) => evento.type === "extension_ui_request" && evento.method === "select");
    assert.equal(richiesta.title, "Sistema di gestione guidato");
    assert.deepEqual(richiesta.options, [
      "Crea un nuovo sistema",
      "Riprendi un sistema in chat",
      "Continua le domande guidate",
      "Collega un'evidenza",
      "Documenti e output",
      "Stato e verifica",
      "Collega la cartella dei template",
      "Annulla",
    ]);
    processo.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: richiesta.id, cancelled: true })}\n`);
    const risposta = await rispostaPrompt;
    assert.equal(risposta.success, true, stderr);
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
