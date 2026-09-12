import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { argomentiAvvioPi, creaPonte } from "../app/server.mjs";
import { creaGestoreEstensioni } from "../app/estensioni-manager.mjs";
import { elencoRisorsePersonali } from "../app/estensioni-risorse.mjs";

const qui = dirname(fileURLToPath(import.meta.url));
async function ambiente(t) {
  const home = await mkdtemp(join(tmpdir(), "pi-risorse-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { LOCALAPPDATA: join(home, "locale"), XDG_DATA_HOME: join(home, "dati") };
  const coppia = generateKeyPairSync("ed25519");
  const portachiavi = [{ chiaveId: "test-pi", pubblica: coppia.publicKey.export({ format: "pem", type: "spki" }), stato: "attiva", dal: "2026-01-01", primaParte: false }];
  const cartella = join(home, "sorgente");
  await mkdir(join(cartella, "skills"), { recursive: true });
  await mkdir(join(cartella, "prompts"));
  const file = { "skills/SKILL.md": "---\nname: sintetica\ndescription: Prova\n---\nTesto sintetico.\n", "prompts/prova.md": "Modello vuoto sintetico.\n", "package.json": '{"name":"prova","pi":{"skills":["skills/SKILL.md"],"prompts":["prompts/prova.md"]}}' };
  for (const [percorso, testo] of Object.entries(file)) await writeFile(join(cartella, percorso), testo);
  const manifesto = { schemaVersion: 1, id: "prova-risorse", nome: "Prova", versione: "1.0.0", editore: "Test", descrizione: "Risorse sintetiche", categoria: "risorse",
    host: { minInclusa: "2.9.0", maxEsclusa: "3.0.0" }, pi: { skills: ["skills/SKILL.md"], prompts: ["prompts/prova.md"], extensions: [], themes: [] },
    pannelli: [], backend: null, limiti: {}, chiaveId: "test-pi", files: Object.entries(file).map(([percorso, testo]) => ({ percorso, byte: Buffer.byteLength(testo), sha256: createHash("sha256").update(testo).digest("hex") })),
  };
  const byte = Buffer.from(JSON.stringify(manifesto));
  await writeFile(join(cartella, "manifesto-estensione.json"), byte);
  await writeFile(join(cartella, "manifest.sig"), sign(null, byte, coppia.privateKey).toString("base64"));
  const personale = join(home, ".pi", "agent", "skills", "personale", "SKILL.md");
  await mkdir(dirname(personale), { recursive: true });
  await writeFile(personale, "---\nname: personale\ndescription: Prova personale\n---\nRisorsa personale sintetica.\n");
  return { home, env, portachiavi, cartella, personale };
}

test("le risorse personali si elencano con l'origine e nessun file di pi viene scritto", async (t) => {
  const dati = await ambiente(t);
  for (const [relativo, testo] of [[".agents/skills/altra/SKILL.md", "Skill aggiuntiva"], [".pi/agent/prompts/prova.md", "Prompt sintetico"], [".pi/agent/themes/prova.json", "{}"]]) {
    const p = join(dati.home, relativo); await mkdir(dirname(p), { recursive: true }); await writeFile(p, testo);
  }
  const radicePi = join(dati.home, ".pi", "agent");
  const fotografia = async () => {
    const nomi = await readdir(radicePi, { recursive: true, withFileTypes: true });
    return Promise.all(nomi.filter((v) => v.isFile()).map(async (v) => [join(v.parentPath, v.name), await readFile(join(v.parentPath, v.name), "utf8")]));
  };
  const prima = await fotografia();
  const risorse = await elencoRisorsePersonali({ home: dati.home });
  assert.equal(risorse.length, 4);
  assert.ok(risorse.every((r) => r.percorso.startsWith(r.radice) && r.testo && r.attiva === false));
  assert.deepEqual(await fotografia(), prima);
});

test("le risorse attive entrano come percorsi espliciti e quelle disattivate non compaiono", async (t) => {
  const dati = await ambiente(t);
  const gestore = creaGestoreEstensioni(dati);
  let stato = await gestore.installa({ cartella: dati.cartella, versioneAttesa: 0 });
  stato = await gestore.attiva({ id: "prova-risorse", attiva: true, versioneAttesa: stato.versioneArchivio });
  assert.deepEqual((await gestore.risorsePerPi()).skills, []);
  stato = await gestore.applica({ versioneAttesa: stato.versioneArchivio });
  const attive = argomentiAvvioPi({ cliPi: "pi.mjs", risorseVerificate: await gestore.risorsePerPi() });
  for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"]) assert.ok(attive.includes(flag));
  assert.equal(attive.filter((a) => a === "--skill").length, 1);
  assert.equal(attive.filter((a) => a === "--prompt-template").length, 1);
  assert.ok(!attive.includes(dati.personale));
  assert.ok(!attive.includes("-e"));
  assert.ok(!attive.includes("--offline"));
  stato = await gestore.attiva({ percorso: dati.personale, attiva: true, versioneAttesa: stato.versioneArchivio });
  stato = await gestore.applica({ versioneAttesa: stato.versioneArchivio });
  assert.ok((await gestore.risorsePerPi()).skills.includes(dati.personale));
  stato = await gestore.attiva({ id: "prova-risorse", attiva: false, versioneAttesa: stato.versioneArchivio });
  stato = await gestore.applica({ versioneAttesa: stato.versioneArchivio });
  const spente = argomentiAvvioPi({ cliPi: "pi.mjs", risorseVerificate: await gestore.risorsePerPi() });
  assert.equal(spente.filter((a) => a === "--skill").length, 1);
  assert.ok(spente.includes(dati.personale));
  assert.ok(!spente.includes("--prompt-template"));
  t.diagnostic("Argomenti con pacchetto attivo: " + JSON.stringify(attive));
  t.diagnostic("Argomenti dopo disattivazione, risorsa personale attiva: " + JSON.stringify(spente));
});

test("il ponte riverifica le risorse a ogni lancio e applica solo a sessioni ferme sullo stesso jsonl", async (t) => {
  const dati = await ambiente({ after() {} });
  const ponte = creaPonte({ home: dati.home, cliPi: join(qui, "fake-pi.mjs"), portachiavi: dati.portachiavi, ambienteEstensioni: dati.env,
    radiceSenzaCartella: join(dati.home, "senza-cartella"), elencaDiscendenti: async () => [], terminaDiscendenti: async () => true,
    caricaSupportoRuntime: async () => ({ versione: "0.84.2", modelliPredefiniti: {}, getAgentDir: () => join(dati.home, ".pi", "agent") }),
  });
  await new Promise((ok) => ponte.server.listen(0, "127.0.0.1", ok));
  t.after(async () => {
    try { await ponte.chiudiTutto(); }
    finally {
      ponte.server.closeAllConnections();
      await new Promise((ok) => ponte.server.close(ok));
      await rm(dati.home, { recursive: true, force: true });
    }
  });
  const base = `http://127.0.0.1:${ponte.server.address().port}`;
  async function post(via, corpo) {
    const risposta = await fetch(base + via, { method: "POST", headers: { "content-type": "application/json", "x-pi-gui-token": ponte.tokenApi }, body: JSON.stringify(corpo) });
    return { status: risposta.status, dati: await risposta.json() };
  }
  const avvio = await post("/api/avvia", { senzaCartella: true });
  assert.equal(avvio.status, 200, JSON.stringify(avvio));
  const sessione = [...ponte.sessioni.values()][0];
  const id = sessione.id;
  const fileSessione = sessione.fileSessione;
  const prima = sessione.proc;
  const testoAllegato = Buffer.from("Allegato sintetico della bozza");
  const allegato = await post("/api/allega-file", { sessionId: id, nome: "bozza.txt", mimeType: "text/plain",
    dimensione: testoAllegato.length, data: testoAllegato.toString("base64") });
  assert.equal(allegato.status, 200, JSON.stringify(allegato));
  let stato = await ponte.estensioni.installa({ cartella: dati.cartella, versioneAttesa: 0 });
  stato = await ponte.estensioni.attiva({ id: "prova-risorse", attiva: true, versioneAttesa: stato.versioneArchivio });
  sessione.inEsecuzione = true;
  const rinvio = await post("/api/estensioni/applica", { versioneAttesa: stato.versioneArchivio });
  assert.equal(rinvio.status, 200, JSON.stringify(rinvio));
  assert.equal(rinvio.dati.rinviata, true);
  assert.equal(sessione.proc, prima);
  sessione.inEsecuzione = false;
  // Una richiesta ammessa prima di Applica completa il corpo soltanto dopo
  // il riavvio, mentre il registro non è ancora pubblicato: deve restare bloccata.
  const corpoTardivo = JSON.stringify({ sessionId: id, type: "prompt", message: "Messaggio sintetico che non deve essere inoltrato", id: "ritardo-applica" });
  const richiestaAmmessa = new Promise((ok) => ponte.server.once("request", ok));
  let richiestaTardiva;
  const rispostaTardiva = new Promise((ok, no) => {
    richiestaTardiva = request(base + "/api/comando", { method: "POST", headers: {
      "content-type": "application/json", "x-pi-gui-token": ponte.tokenApi,
      "content-length": Buffer.byteLength(corpoTardivo),
    } }, (risposta) => {
      let testo = ""; risposta.setEncoding("utf8"); risposta.on("data", (pezzo) => { testo += pezzo; });
      risposta.on("end", () => ok({ status: risposta.statusCode, dati: JSON.parse(testo) }));
    });
    richiestaTardiva.on("error", no);
    richiestaTardiva.write(corpoTardivo.slice(0, 1));
  });
  await richiestaAmmessa;
  const modificaOriginale = ponte.estensioni.archivio.modifica;
  ponte.estensioni.archivio.modifica = (versione, cambia) => modificaOriginale(versione, async (registro) => {
    const prossimo = await cambia(registro);
    richiestaTardiva.end(corpoTardivo.slice(1));
    const rifiutata = await rispostaTardiva;
    assert.equal(rifiutata.status, 409, JSON.stringify(rifiutata));
    assert.match(rifiutata.dati.errore, /estensioni/i);
    return prossimo;
  });
  const applicata = await post("/api/estensioni/applica", { versioneAttesa: stato.versioneArchivio });
  ponte.estensioni.archivio.modifica = modificaOriginale;
  assert.equal(applicata.status, 200, JSON.stringify(applicata));
  assert.equal(applicata.dati.rinviata, false);
  assert.equal(sessione.id, id);
  assert.equal(sessione.fileSessione, fileSessione);
  assert.notEqual(sessione.proc, prima);
  assert.deepEqual(await readFile(allegato.dati.allegato.percorso), testoAllegato);
  const args = sessione.proc.spawnargs;
  t.diagnostic("Avvio effettivo del ponte dopo Applica: " + JSON.stringify(args));
  assert.ok(args.includes("--skill"));
  assert.equal(args[args.indexOf("--session") + 1], fileSessione);
  const skill = (await ponte.estensioni.risorsePerPi()).skills[0];
  await chmod(skill, 0o600);
  await writeFile(skill, "Byte alterati sintetici");
  const bloccato = await post("/api/avvia", { senzaCartella: true, forzaNuova: true });
  assert.equal(bloccato.status, 400, JSON.stringify(bloccato));
  assert.match(bloccato.dati.errore, /SKILL\.md/);
});

test("una risorsa personale cambiata lascia aprire le conversazioni e l'avviso arriva dopo l'avvio senza restare dopo la rilettura", async (t) => {
  const dati = await ambiente({ after() {} });
  const ponte = creaPonte({ home: dati.home, cliPi: join(qui, "fake-pi.mjs"), portachiavi: dati.portachiavi, ambienteEstensioni: dati.env,
    radiceSenzaCartella: join(dati.home, "senza-cartella"), elencaDiscendenti: async () => [], terminaDiscendenti: async () => true,
    caricaSupportoRuntime: async () => ({ versione: "0.84.2", modelliPredefiniti: {}, getAgentDir: () => join(dati.home, ".pi", "agent") }),
  });
  await new Promise((ok) => ponte.server.listen(0, "127.0.0.1", ok));
  const connessioni = [];
  t.after(async () => {
    for (const connessione of connessioni) connessione.destroy();
    try { await ponte.chiudiTutto(); }
    finally {
      ponte.server.closeAllConnections();
      await new Promise((ok) => ponte.server.close(ok));
      await rm(dati.home, { recursive: true, force: true });
    }
  });
  const base = `http://127.0.0.1:${ponte.server.address().port}`;
  async function avvia() {
    const risposta = await fetch(base + "/api/avvia", { method: "POST", headers: {
      "content-type": "application/json", "x-pi-gui-token": ponte.tokenApi,
    }, body: JSON.stringify({ senzaCartella: true, forzaNuova: true }) });
    const corpo = await risposta.json();
    assert.equal(risposta.status, 200, JSON.stringify(corpo));
    return [...ponte.sessioni.values()].at(-1);
  }
  async function ascolta() {
    const eventi = [];
    const attese = new Set();
    let fallita = null;
    const richiesta = request(base + "/api/eventi?token=" + ponte.tokenApi, (risposta) => {
      risposta.setEncoding("utf8");
      let buffer = "";
      risposta.on("data", (testo) => {
        buffer += testo;
        let fine;
        while ((fine = buffer.indexOf("\n\n")) !== -1) {
          const blocco = buffer.slice(0, fine);
          buffer = buffer.slice(fine + 2);
          if (!blocco.startsWith("data: ")) continue;
          eventi.push(JSON.parse(blocco.slice(6)));
          for (const risveglia of attese) risveglia();
        }
      });
    });
    connessioni.push(richiesta);
    richiesta.on("error", (errore) => { fallita = errore; for (const risveglia of attese) risveglia(); });
    richiesta.end();
    const attendi = (predicato) => new Promise((ok, no) => {
      const scadenza = setTimeout(() => { attese.delete(controlla); no(new Error("Evento SSE di prova non arrivato")); }, 5000);
      function controlla() {
        const evento = eventi.find(predicato);
        if (!evento && !fallita) return;
        clearTimeout(scadenza);
        attese.delete(controlla);
        if (fallita) no(fallita); else ok(evento);
      }
      attese.add(controlla);
      controlla();
    });
    await attendi((evento) => evento.type === "gui_snapshot");
    return { eventi, attendi };
  }

  let stato = await ponte.estensioni.attiva({ percorso: dati.personale, attiva: true, versioneAttesa: 0 });
  stato = await ponte.estensioni.applica({ versioneAttesa: stato.versioneArchivio });
  await writeFile(dati.personale, "Risorsa personale sintetica cambiata da rileggere.\n");
  const flusso = await ascolta();
  const avvisoPersonale = (evento) => evento.type === "gui_errore" && evento.messaggio.includes(dati.personale);
  for (let numero = 0; numero < 2; numero++) {
    const sessione = await avvia();
    await flusso.attendi((evento) => evento.guiSessionId === sessione.id && avvisoPersonale(evento));
    assert.ok(sessione.proc);
    assert.equal(sessione.proc.spawnargs.includes(dati.personale), false);
    const avvio = flusso.eventi.findIndex((evento) => evento.type === "gui_sessione_avviata" && evento.guiSessionId === sessione.id);
    const avviso = flusso.eventi.findIndex((evento) => avvisoPersonale(evento) && evento.guiSessionId === sessione.id);
    assert.ok(avvio >= 0 && avviso > avvio, "L'avviso deve seguire l'evento che crea la conversazione nel client");
    assert.equal(flusso.eventi.filter((evento) => avvisoPersonale(evento) && evento.guiSessionId === sessione.id).length, 1);
  }
  const riconnesso = await ascolta();
  await riconnesso.attendi(avvisoPersonale);
  assert.ok(riconnesso.eventi.findIndex(avvisoPersonale) > riconnesso.eventi.findIndex((evento) => evento.type === "gui_snapshot"));
  const avvisiPrima = flusso.eventi.filter(avvisoPersonale).length;
  stato = await ponte.estensioni.attiva({ percorso: dati.personale, attiva: true, versioneAttesa: stato.versioneArchivio });
  stato = await ponte.estensioni.applica({ versioneAttesa: stato.versioneArchivio });
  for (const sessione of ponte.sessioni.values()) assert.ok(sessione.proc.spawnargs.includes(dati.personale));
  const nuova = await avvia();
  await flusso.attendi((evento) => evento.type === "gui_sessione_avviata" && evento.guiSessionId === nuova.id);
  assert.ok(nuova.proc.spawnargs.includes(dati.personale));
  assert.equal(flusso.eventi.filter(avvisoPersonale).length, avvisiPrima);
  assert.deepEqual(ponte.estensioni.avvisiRisorsePersonaliAttivi(), []);
});
