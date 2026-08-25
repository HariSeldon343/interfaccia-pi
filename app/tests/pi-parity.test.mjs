import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  caricaCatalogoBuiltinPi,
  caricaSupportoRuntimePi,
  preparaInvocazioneCapacita,
  unificaCatalogoCapacita,
} from "../server.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const CLI_PI = join(QUI, "..", "..", "vendor", "pi-runtime", "pi", "dist", "cli.js");
const require = createRequire(import.meta.url);
const AUTH = require("../public/auth-flow-core.js");
const PALETTE = require("../public/palette-core.js");

test("la testata compatta limita lo stato reale e il composer rende espliciti i file", async () => {
  const [html, stile] = await Promise.all([
    readFile(join(QUI, "../public/index.html"), "utf8"),
    readFile(join(QUI, "../public/stile.css"), "utf8"),
  ]);
  assert.match(
    html,
    /id="btn-allega"[\s\S]*?aria-label="[^"]*(?:allega|file)[^"]*"/i,
    "il nome accessibile del pulsante + deve rendere scopribile l'allegato file",
  );
  assert.match(html, /id="azione-allega-file"/);
  assert.match(html, /id="scegli-file"[^>]*\bmultiple\b/);
  assert.match(stile, /\.controlli-testata\s*>\s*\.stato\s*\{[\s\S]*?max-width:\s*118px/);
  assert.doesNotMatch(
    stile.slice(stile.indexOf("Interfaccia 2.5.1")),
    /\.barra\s*>\s*\.stato/,
    "il limite responsive deve corrispondere alla gerarchia DOM reale",
  );
  const compatto = stile.slice(stile.lastIndexOf("@media (max-width: 650px)"));
  assert.match(compatto, /#suggerimento\s*\{[\s\S]*?display:\s*block/,
    "l'hint file deve restare disponibile anche quando lo spazio si riduce");
});

const PROVIDER = [
  { id: "anthropic", name: "Anthropic", methods: { oauth: true, apiKey: true } },
  { id: "github-copilot", name: "GitHub Copilot", methods: { oauth: true, apiKey: true } },
  { id: "openai", name: "OpenAI", methods: { oauth: false, apiKey: true } },
  { id: "openai-codex", name: "OpenAI Codex", methods: { oauth: true, apiKey: false } },
  { id: "xai", name: "xAI", methods: { oauth: true, apiKey: true } },
];

test("/login replica prima la scelta account o chiave API del terminale", () => {
  assert.deepEqual(
    AUTH.scelteMetodo().map((voce) => [voce.id, voce.titolo]),
    [
      ["oauth", "Accedi con un account"],
      ["api_key", "Accedi con una chiave API"],
    ],
  );

  const account = AUTH.filtraProvider(PROVIDER, { authType: "oauth" });
  assert.deepEqual(account.map((provider) => provider.id), [
    "anthropic",
    "github-copilot",
    "openai-codex",
    "xai",
  ]);
  assert.equal(new Set(account.map((provider) => provider.id)).size, account.length);
  assert.equal(AUTH.nomeProvider(account[2], "oauth"), "OpenAI (ChatGPT Plus/Pro)");

  const apiKey = AUTH.filtraProvider(PROVIDER, { authType: "api_key" });
  assert.ok(apiKey.some((provider) => provider.id === "openai"));
  assert.ok(!apiKey.some((provider) => provider.id === "openai-codex"));
});

test("/login <provider> conserva la stessa risoluzione esatta di Pi", () => {
  assert.equal(AUTH.trovaProviderEsatto(PROVIDER, "OPENAI CODEX")?.id, "openai-codex");
  assert.equal(AUTH.trovaProviderEsatto(PROVIDER, "openai-codex")?.id, "openai-codex");
  assert.equal(AUTH.trovaProviderEsatto(PROVIDER, "open") ?? null, null);
  assert.deepEqual(
    AUTH.scelteMetodo(AUTH.trovaProviderEsatto(PROVIDER, "xai")).map((voce) => voce.id),
    ["oauth", "api_key"],
  );
});

test("il ciclo OAuth riconosce tutte le finestre appartenenti allo stesso login", () => {
  assert.equal(
    AUTH.loginCommandIdEvento({ loginCommandId: " login-1 " }),
    "login-1",
  );
  assert.equal(
    AUTH.loginCommandIdEvento({ authEvent: { loginCommandId: "login-2" } }),
    "login-2",
  );
  assert.equal(AUTH.loginCommandIdEvento({}), "");
  assert.equal(
    AUTH.eventoDelLogin({ authEvent: { loginCommandId: "login-2" } }, "login-2"),
    true,
  );
  assert.equal(AUTH.eventoDelLogin({ loginCommandId: "login-3" }, "login-2"), false);
});

test("il campo API key Z.AI non viene scambiato per il fallback OAuth OpenAI", () => {
  assert.equal(AUTH.richiestaFallbackOAuth({
    method: "input",
    title: "Z.AI API key",
    placeholder: "Enter Z.AI API key",
    sensitive: true,
    authEvent: { type: "prompt", loginCommandId: "login-zai" },
  }), false);
  assert.equal(AUTH.richiestaFallbackOAuth({
    method: "input",
    title: "Complete login in your browser, or paste the authorization code / redirect URL here:",
    placeholder: "http://localhost:1455/auth/callback",
    authEvent: { type: "prompt", loginCommandId: "login-openai" },
  }), true);
});

test("il ragionamento parte chiuso e gli invii correnti non sembrano errori", async () => {
  const invii = [{ id: "corrente" }, { id: "da-recuperare" }];
  assert.deepEqual(
    PALETTE.inviiVisibiliDaVerificare(invii, new Set(["corrente"])),
    [{ id: "da-recuperare" }],
  );

  const sorgente = await readFile(join(QUI, "../public/app.js"), "utf8");
  assert.match(
    sorgente,
    /box\.open = Boolean\(testo && sessione\.ragionamentiAperti\?\.has\(testo\)\);/,
  );
  assert.doesNotMatch(sorgente, /box\.open = !testo;/);
  assert.doesNotMatch(
    sorgente,
    /sessione\.bloccoRagionamento\.box\.open = false;/,
  );
});

test("un retry della stessa bozza non crea un secondo invio ambiguo", () => {
  const invii = [{
    id: "primo",
    lineageId: "lineage-1",
    testo: "Correggi il lavoro",
    allegati: [{ firma: "image/png:10:a:b" }],
  }];
  assert.equal(
    PALETTE.trovaInvioPendenteDuplicato(invii, {
      lineageId: "lineage-1",
      testo: " Correggi il lavoro ",
      firmeAllegati: ["image/png:10:a:b"],
    })?.id,
    "primo",
  );
  assert.equal(PALETTE.trovaInvioPendenteDuplicato(invii, {
    lineageId: "lineage-2",
    testo: "Correggi il lavoro",
    firmeAllegati: ["image/png:10:a:b"],
  }), null);
});

test("la compattazione e uno stato GUI esplicito e sospende il timeout del prompt", async () => {
  const sorgente = await readFile(join(QUI, "../public/app.js"), "utf8");
  assert.match(sorgente, /sessione\.compattazioneInCorso = true;[\s\S]{0,180}sospendiTimeoutPromptPerCompattazione/);
  assert.match(sorgente, /sessione\.compattazioneInCorso = false;[\s\S]{0,180}riprendiTimeoutPromptDopoCompattazione/);
  assert.match(sorgente, /sta liberando spazio…/);
  assert.match(sorgente, /Contesto · riassunto in corso…/);
  assert.match(sorgente, /pressioneContestoCambioModello\(sessione, modello\)/);
});

test("le attivita tecniche sono raggruppate e chiuse per impostazione predefinita", async () => {
  const [javascript, stile] = await Promise.all([
    readFile(join(QUI, "../public/app.js"), "utf8"),
    readFile(join(QUI, "../public/stile.css"), "utf8"),
  ]);
  assert.match(javascript, /function ottieniGruppoAttivita\(sessione\)/);
  assert.match(javascript, /crea\("details", "gruppo-attivita"\)/);
  assert.match(javascript, /gruppo\.corpo\.appendChild\(box\)/);
  assert.doesNotMatch(javascript, /gruppo\.box\.open\s*=\s*true;\s*\/\/\s*default/);
  assert.match(stile, /\.gruppo-attivita\s*>\s*summary/);
  assert.match(stile, /\.gruppo-attivita\.con-errori\s+\.stato/);
});

test("un reload durante lo streaming non presenta una falsa conversazione vuota", async () => {
  const [javascript, stile] = await Promise.all([
    readFile(join(QUI, "../public/app.js"), "utf8"),
    readFile(join(QUI, "../public/stile.css"), "utf8"),
  ]);
  assert.match(javascript, /function mostraCronologiaParziale\(sessione\)/);
  assert.match(javascript, /function mostraCronologiaInAttesa\(sessione\)/);
  assert.match(javascript, /Cronologia salvata visibile/);
  assert.match(javascript, /consentiParziale:\s*!leggiCronologiaCompleta/);
  assert.match(javascript, /sessione\.messaggiSincronizzati\s*=\s*!parziale/);
  assert.match(javascript, /Gia aperta · Pi sta lavorando/);
  assert.match(stile, /\.cronologia-in-attesa\s*\{/);
  assert.match(stile, /\.sessione-gia-aperta\s*\{/);
});

test("tutti i comandi built-in del Pi installato hanno una strategia GUI", async () => {
  const catalogo = await caricaCatalogoBuiltinPi(CLI_PI);
  const capacita = unificaCatalogoCapacita(catalogo.comandi, []);
  assert.deepEqual(
    capacita.filter((voce) => voce.source === "builtin" && voce.availability?.surface !== "gui"),
    [],
  );
  assert.deepEqual(
    new Set(capacita.filter((voce) => voce.source === "builtin").map((voce) => voce.name)),
    new Set([...catalogo.comandi.map((voce) => voce.name), "sistema"]),
  );
  const sistema = capacita.find((voce) => voce.name === "sistema");
  assert.equal(sistema?.dispatch.kind, "workflow");
  assert.equal(sistema?.dispatch.action, "sistema-guidato-panel");
});

test("la GUI legge da Pi i modelli predefiniti usati dopo il primo login", async () => {
  const supporto = await caricaSupportoRuntimePi(CLI_PI);
  assert.equal(typeof supporto.modelliPredefiniti["openai-codex"], "string");
  assert.ok(supporto.modelliPredefiniti["openai-codex"].length > 0);
});

test("l'estensione integrata /llama resta utilizzabile nella GUI via RPC", async () => {
  const catalogo = await caricaCatalogoBuiltinPi(CLI_PI);
  const llama = unificaCatalogoCapacita(catalogo.comandi, [{
    name: "llama",
    description: "Manage llama.cpp router models",
    source: "extension",
  }]).find((voce) => voce.name === "llama" && voce.source === "extension");
  assert.equal(llama.availability?.surface, "gui");
  assert.equal(llama.dispatch?.kind, "prompt");
  assert.deepEqual(preparaInvocazioneCapacita(llama, ""), {
    mode: "rpc",
    command: { type: "prompt", message: "/llama" },
  });
});
