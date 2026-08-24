import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  apriUrlSistema,
  creaPonte,
  rimuoviRichiesteInterattiveLogin,
  urlEsternoSicuro,
} from "../server.mjs";

const directoryTest = dirname(fileURLToPath(import.meta.url));

test("il pulsante di autenticazione delega l'apertura al ponte desktop", async () => {
  const sorgente = await readFile(join(directoryTest, "../public/app.js"), "utf8");
  assert.match(sorgente, /function collegaBrowserSistema\(collegamento, href, \{/);
  assert.match(sorgente, /chiedi\("\/api\/apri-url", \{ corpo: \{ url: href, confirmed: true \} \}\)/);
  assert.match(
    sorgente,
    /function aggiungiLinkAutenticazione[\s\S]*?collegaBrowserSistema\(link, href, \{/,
  );
  assert.match(sorgente, /chiudiInterfacciaLoginProvider\(sessione, evento\.id\)/);
  assert.match(sorgente, /dopoPassaggio\?\.\(\)/);
});

test("la conclusione OAuth elimina soltanto le richieste interattive dello stesso login", () => {
  const pendenti = new Map([
    ["manuale", { evento: { loginCommandId: "login-1" } }],
    ["annidata", { evento: { authEvent: { loginCommandId: "login-1" } } }],
    ["altro", { evento: { loginCommandId: "login-2" } }],
  ]);
  assert.equal(rimuoviRichiesteInterattiveLogin(pendenti, "login-1"), 2);
  assert.deepEqual([...pendenti.keys()], ["altro"]);
});

test("il ponte apre URL web soltanto tramite argv e senza shell", async () => {
  const chiamate = [];
  const spawnProcesso = (comando, argomenti, opzioni) => {
    chiamate.push({ comando, argomenti, opzioni });
    const processo = new EventEmitter();
    processo.unref = () => {};
    queueMicrotask(() => processo.emit("spawn"));
    return processo;
  };
  const href = "https://auth.openai.com/oauth/authorize?state=abc%20123";
  assert.equal(urlEsternoSicuro(href), href);
  await apriUrlSistema(href, { platform: "win32", spawnProcesso });
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].comando.toLowerCase(), "rundll32.exe");
  assert.deepEqual(chiamate[0].argomenti, ["url.dll,FileProtocolHandler", href]);
  assert.equal(chiamate[0].opzioni.shell, false);
  assert.equal(urlEsternoSicuro("javascript:alert(1)"), null);
  assert.equal(urlEsternoSicuro("file:///C:/Windows/System32/calc.exe"), null);
});

test("POST /api/apri-url richiede clic confermato e URL sicuro", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-gui-external-link-"));
  const aperti = [];
  const ponte = creaPonte({
    home: radice,
    cliPi: null,
    apriUrl: async (url) => aperti.push(url),
  });
  await new Promise((resolve, reject) => {
    ponte.server.once("error", reject);
    ponte.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await ponte.chiudiTutto({ definitiva: false });
    await new Promise((resolve) => ponte.server.close(resolve));
    await rm(radice, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${ponte.server.address().port}`;
  const post = async (corpo) => {
    const risposta = await fetch(url + "/api/apri-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-gui-token": ponte.tokenApi,
      },
      body: JSON.stringify(corpo),
    });
    return { status: risposta.status, body: await risposta.json() };
  };

  const nonConfermato = await post({ url: "https://example.com", confirmed: false });
  assert.equal(nonConfermato.status, 400);
  const nonSicuro = await post({ url: "javascript:alert(1)", confirmed: true });
  assert.equal(nonSicuro.status, 400);
  const valido = await post({ url: "https://auth.openai.com/oauth/authorize?state=test", confirmed: true });
  assert.equal(valido.status, 200, JSON.stringify(valido.body));
  assert.deepEqual(aperti, ["https://auth.openai.com/oauth/authorize?state=test"]);
});
