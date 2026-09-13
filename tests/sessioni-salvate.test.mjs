import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creaPonte, paginaSessioniSalvate } from "../app/server.mjs";

test("la ricerca trova il testo oltre il titolo e il testoRicerca resta interno al ponte", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pi-ricerca-"));
  const archivio = join(home, ".pi", "agent", "sessions", "sintetiche");
  await mkdir(archivio, { recursive: true });
  const messaggio = "alfa ".repeat(26) + "cassaforte";
  const lungo = messaggio + " beta".repeat(500) + " oltrelimite";
  await writeFile(join(archivio, "ricercabile.jsonl"), [
    { type: "session", id: "ricercabile", cwd: home, timestamp: "2026-01-01T00:00:00.000Z" },
    { type: "message", message: { role: "user", content: `<skill>parolatecnica</skill>\n${lungo}` } },
  ].map(JSON.stringify).join("\n") + "\n");
  const ponte = creaPonte({ home, cliPi: null, ambienteEstensioni: { LOCALAPPDATA: join(home, "locale") } });
  await new Promise((ok) => ponte.server.listen(0, "127.0.0.1", ok));
  t.after(async () => {
    try { await ponte.chiudiTutto(); }
    finally {
      ponte.server.closeAllConnections();
      await new Promise((ok) => ponte.server.close(ok));
      await rm(home, { recursive: true, force: true });
    }
  });
  const risposta = await fetch(`http://127.0.0.1:${ponte.server.address().port}/api/sessioni-salvate`, {
    method: "POST", headers: { "content-type": "application/json", "x-pi-gui-token": ponte.tokenApi },
    body: JSON.stringify({ ricerca: "cassaforte" }),
  });
  assert.equal(risposta.status, 200);
  const corpo = await risposta.json();
  assert.deepEqual(corpo.sessioni.map((s) => s.id), ["ricercabile"]);
  assert.ok(corpo.sessioni[0].primoMessaggio.length <= 121);
  assert.doesNotMatch(corpo.sessioni[0].primoMessaggio, /cassaforte/);
  assert.ok(!Object.hasOwn(corpo.sessioni[0], "testoRicerca"));
  assert.doesNotMatch(JSON.stringify(corpo), /testoRicerca/);
  const pagina = await paginaSessioniSalvate(home, { ricerca: "cassaforte" });
  assert.equal(pagina.sessioni[0].testoRicerca, lungo.slice(0, 2000));
  assert.equal((await paginaSessioniSalvate(home, { ricerca: "parolatecnica" })).sessioni.length, 0);
  assert.equal((await paginaSessioniSalvate(home, { ricerca: "oltrelimite" })).sessioni.length, 0);
});

test("una conversazione oltre l'ottantesima in una cartella poco usata resta raggiungibile, e il vecchio client continua a funzionare", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pi-pagine-"));
  const archivio = join(home, ".pi", "agent", "sessions", "sintetiche");
  await mkdir(archivio, { recursive: true });
  const rara = join(home, "cartella-rara");
  for (let i = 0; i < 95; i++) {
    const file = join(archivio, `${String(i).padStart(3, "0")}.jsonl`);
    await writeFile(file, [
      { type: "session", id: `sintetica-${i}`, cwd: i === 94 ? rara : home, timestamp: "2026-01-01T00:00:00.000Z" },
      { type: "session_info", name: i === 94 ? "Conversazione remota sintetica" : `Conversazione ${i}` },
    ].map(JSON.stringify).join("\n") + "\n");
    const data = new Date(Date.UTC(2026, 0, 1) - i * 1000);
    await utimes(file, data, data);
  }
  const ponte = creaPonte({ home, cliPi: null, ambienteEstensioni: { LOCALAPPDATA: join(home, "locale") } });
  await new Promise((ok) => ponte.server.listen(0, "127.0.0.1", ok));
  t.after(async () => {
    try { await ponte.chiudiTutto(); }
    finally {
      ponte.server.closeAllConnections();
      await new Promise((ok) => ponte.server.close(ok));
      await rm(home, { recursive: true, force: true });
    }
  });
  const base = `http://127.0.0.1:${ponte.server.address().port}`;
  async function leggi(corpo) {
    const risposta = await fetch(base + "/api/sessioni-salvate", { method: "POST", headers: {
      "content-type": "application/json", "x-pi-gui-token": ponte.tokenApi,
    }, body: JSON.stringify(corpo) });
    assert.equal(risposta.status, 200);
    return risposta.json();
  }
  const vecchio = await leggi({});
  assert.equal(vecchio.sessioni.length, 80);
  assert.ok(vecchio.prossimoCursore);
  const seconda = await leggi({ cursore: vecchio.prossimoCursore });
  assert.equal(seconda.sessioni.length, 15);
  assert.equal(seconda.prossimoCursore, null);
  assert.equal(new Set([...vecchio.sessioni, ...seconda.sessioni].map((s) => s.id)).size, 95);
  assert.equal((await leggi({ cartella: rara })).sessioni[0].id, "sintetica-94");
  assert.equal((await leggi({ ricerca: "remota", limite: 1 })).sessioni[0].id, "sintetica-94");
  await assert.rejects(paginaSessioniSalvate(home, { limite: 0 }), /limite/);
  await assert.rejects(paginaSessioniSalvate(home, { cursore: "non-un-cursore" }), /cursore/);
  await assert.rejects(paginaSessioniSalvate(home, { ricerca: "diversa", cursore: vecchio.prossimoCursore }), /cursore/);
});
