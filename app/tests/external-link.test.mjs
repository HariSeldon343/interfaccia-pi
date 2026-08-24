import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  apriUrlSistema,
  creaPonte,
  risolviDestinazioneApribile,
  rimuoviRichiesteInterattiveLogin,
  urlEsternoSicuro,
} from "../server.mjs";

const directoryTest = dirname(fileURLToPath(import.meta.url));

test("il pulsante di autenticazione delega l'apertura al ponte desktop", async () => {
  const sorgente = await readFile(join(directoryTest, "../public/app.js"), "utf8");
  assert.match(sorgente, /function collegaBrowserSistema\(collegamento, href, \{/);
  assert.match(sorgente, /chiedi\("\/api\/apri-url"/);
  assert.match(sorgente, /url:\s*href/);
  assert.match(sorgente, /confirmed:\s*true/);
  assert.match(sorgente, /\.\.\.\(sessionId \? \{ sessionId \} : \{\}\)/);
  assert.match(
    sorgente,
    /function aggiungiLinkAutenticazione[\s\S]*?collegaBrowserSistema\(link, href, \{/,
  );
  assert.match(sorgente, /crea\("button", "link-locale", etichetta\)/);
  assert.match(sorgente, /collegamento\.type = "button"/);
  assert.doesNotMatch(sorgente, /tipo === "web" \? href : "#"/);
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
  assert.equal(
    urlEsternoSicuro("mailto:test@example.com?subject=100%25"),
    "mailto:test@example.com?subject=100%25",
  );
  assert.equal(urlEsternoSicuro("mailto:test@example.com?subject=ok%0d%0aBcc:x@example.com"), null);
  assert.equal(urlEsternoSicuro("mailto:test@example.com?subject=ok%250d%250aBcc:x@example.com"), null);
  assert.equal(urlEsternoSicuro("mailto:test@example.com?subject=ok%25%30%64Bcc:x@example.com"), null);
});

test("i collegamenti locali sono canonicalizzati, confinati e non possono avviare file attivi", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-gui-local-link-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const progetto = join(radice, "Progetto con spazi");
  const cartella = join(progetto, "Documenti finali");
  const file = join(cartella, "Checklist approvata.xlsx");
  const fuori = join(radice, "fuori.xlsx");
  const attivo = join(cartella, "aggiornamento.exe");
  const pif = join(cartella, "collegamento.pif");
  await mkdir(cartella, { recursive: true });
  await Promise.all([
    writeFile(file, "test", "utf8"),
    writeFile(fuori, "test", "utf8"),
    writeFile(attivo, "test", "utf8"),
    writeFile(pif, "test", "utf8"),
  ]);

  const assoluto = await risolviDestinazioneApribile(file);
  assert.equal(assoluto.tipo, "locale");
  assert.equal(assoluto.percorso, await realpath(file));
  assert.match(assoluto.href, /^file:/);
  assert.match(assoluto.href, /Checklist%20approvata\.xlsx$/);
  assert.deepEqual(
    await risolviDestinazioneApribile(join("Documenti finali", "Checklist approvata.xlsx"), {
      cartellaBase: progetto,
    }),
    assoluto,
  );
  assert.deepEqual(await risolviDestinazioneApribile(assoluto.href), assoluto);
  await assert.rejects(
    risolviDestinazioneApribile(join("..", "fuori.xlsx"), { cartellaBase: progetto }),
    /restare nella cartella di lavoro/,
  );
  await assert.rejects(risolviDestinazioneApribile(attivo), /tipo di file/);
  await assert.rejects(risolviDestinazioneApribile(pif), /tipo di file/);
  await assert.rejects(risolviDestinazioneApribile("javascript:alert(1)"), /schema/);
  await assert.rejects(risolviDestinazioneApribile(join(cartella, "inesistente.xlsx")), /non esistono/);
  if (process.platform === "win32") {
    await assert.rejects(risolviDestinazioneApribile(String.raw`\\.\pipe\pi-gui`), /namespace|pipe/);
    await assert.rejects(risolviDestinazioneApribile(`${file}:segreto`), /NTFS/);
    await assert.rejects(risolviDestinazioneApribile(String.raw`\\server\share\documento.xlsx`), /unita locali/);
  }

  const chiamate = [];
  await apriUrlSistema(file, {
    platform: "win32",
    spawnProcesso: (comando, argomenti, opzioni) => {
      chiamate.push({ comando, argomenti, opzioni });
      const processo = new EventEmitter();
      processo.unref = () => {};
      queueMicrotask(() => processo.emit("spawn"));
      return processo;
    },
  });
  assert.equal(chiamate[0].comando.toLowerCase(), "explorer.exe");
  assert.deepEqual(chiamate[0].argomenti, [await realpath(file)]);
  assert.equal(chiamate[0].opzioni.shell, false);
});

test("POST /api/apri-url richiede clic confermato e URL sicuro", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "pi-gui-external-link-"));
  const documento = join(radice, "Documento con spazi.xlsx");
  const eseguibile = join(radice, "non-aprire.cmd");
  await Promise.all([
    writeFile(documento, "test", "utf8"),
    writeFile(eseguibile, "test", "utf8"),
  ]);
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
  const relativoSenzaSessione = await post({ url: "Documento con spazi.xlsx", confirmed: true });
  assert.equal(relativoSenzaSessione.status, 400);
  const attivo = await post({ url: eseguibile, confirmed: true });
  assert.equal(attivo.status, 403);
  const locale = await post({ url: documento, confirmed: true });
  assert.equal(locale.status, 200, JSON.stringify(locale.body));
  assert.equal(locale.body.tipo, "locale");
  const valido = await post({ url: "https://auth.openai.com/oauth/authorize?state=test", confirmed: true });
  assert.equal(valido.status, 200, JSON.stringify(valido.body));
  assert.deepEqual(aperti, [
    (await risolviDestinazioneApribile(documento)).href,
    "https://auth.openai.com/oauth/authorize?state=test",
  ]);
});
