import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { SessionePi, creaDirectorySenzaCartella } from "../server.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const CLI_PI = join(QUI, "..", "..", "vendor", "pi-runtime", "pi", "dist", "cli.js");

test("smoke con il runtime Pi incluso: la modalita senza cartella carica davvero", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-gui-real-smoke-"));
  const directoryLavoro = await creaDirectorySenzaCartella(join(radice, "neutral"));
  process.env.PI_CODING_AGENT_SESSION_DIR = join(radice, "sessions");
  await mkdir(process.env.PI_CODING_AGENT_SESSION_DIR, { recursive: true });
  const eventi = [];
  const sessione = new SessionePi({
    id: "smoke-real-pi",
    cliPi: CLI_PI,
    emetti: (evento) => eventi.push(evento),
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
    estensioniBuiltinConsentite: new Set(["llama"]),
  });
  t.after(async () => {
    await sessione.ferma({ notifica: false });
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
    await rm(radice, { recursive: true, force: true });
  });

  await sessione.avvia({
    cartella: null,
    directoryLavoro,
    senzaCartella: true,
    approvaProgetto: true,
  });
  const stato = await sessione.inviaEAttendi({ type: "get_state" }, 15000);
  const comandi = await sessione.inviaEAttendi({ type: "get_commands" }, 15000);
  const autenticazione = await sessione.inviaEAttendi({ type: "get_auth_providers" }, 15000);
  sessione.verificaCatalogoComandi();

  assert.equal(sessione.senzaCartella, true);
  assert.equal(sessione.cartella, null);
  assert.equal(sessione.directoryLavoro, directoryLavoro);
  assert.match(stato.sessionFile, /\.jsonl$/i);
  assert.ok(comandi.commands.some((comando) => comando.name === "llama" && comando.source === "extension"));
  const openAiAccount = autenticazione.providers.find((provider) => provider.id === "openai-codex");
  assert.equal(openAiAccount.methods.oauth, true);
  assert.equal(openAiAccount.methods.apiKey, false);
  assert.equal(eventi.some((evento) => evento.type === "gui_errore"), false,
    JSON.stringify(eventi.filter((evento) => evento.type === "gui_errore")));
});
