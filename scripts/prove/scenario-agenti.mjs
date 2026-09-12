import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Caricato soltanto dall'avviatore isolato di P1. Le richieste automatiche
// usano il Pi finto; il percorso del browser resta una prova del titolare.
export async function prepara({ temporanea, cliPi, radice }) {
  assert.equal(cliPi, join(radice, "tests", "fake-pi.mjs"), "lo scenario richiede esclusivamente Pi finto");
  const workspace = join(temporanea, "consiglio-catalogo-due-consiglio-uscita-valida-agenti");
  await mkdir(workspace, { recursive: true });
  const testo = join(workspace, "nota-sintetica.md");
  const immagine = join(workspace, "immagine-sintetica.png");
  const esterno = join(temporanea, "testo-esterno.txt");
  await writeFile(testo, "Nota sintetica della prova Agenti. Nessun dato reale.\n", "utf8");
  await writeFile(esterno, "Allegato sintetico fuori dalla cartella del consiglio.\n", "utf8");
  await writeFile(immagine, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gRcAAAAASUVORK5CYII=", "base64"));
  return {
    workspace, testo, immagine, esterno,
    istruzioni: [
      `Cartella di lavoro sintetica (due modelli obbligatori): ${workspace}`,
      "Il controllo automatico prepara Prova congelamento come predefinita e lascia una conversazione sorgente viva.",
      "Apri il browser sull'indirizzo stampato dall'avviatore e conserva schermate, comando e riga Prova isolata come evidenza.",
      "Scrivi «Prova sintetica del pulsante Agenti». Un clic sul primario Agenti · Prova congelamento deve aprire un solo lavoro; la conversazione sorgente non deve ricevere un invio ordinario.",
      "Nella scheda Risultato verifica due assegnazioni diverse, nome/versione congelati e Rifai. Annulla il lavoro prima di avviarne un altro.",
      "Solo tastiera: Tab fino alla freccia Scegli la preimpostazione, Invio per aprire; Freccia giù/su cambia voce e un solo elemento resta nella sequenza Tab.",
      "Premi Esc nell'elenco: si chiude e il fuoco torna alla freccia. Riapri e scegli Rapido con Barra: l'avvio è diretto. Ripeti con Invio su un'altra preimpostazione.",
      "Riapri l'elenco, raggiungi Gestisci con le frecce e premi Invio: la finestra ha aria-modal=true e il fuoco entra nel primo controllo utile.",
      "Nella finestra usa solo Tab, Maiusc+Tab, frecce, Invio e Barra: crea Solo scrittore, rinomina, duplica, scegli la predefinita ed elimina la copia. Tab e Maiusc+Tab devono restare nella finestra.",
      "Premi Esc nella finestra Gestisci: il fuoco torna al controllo che l'ha aperta. Verifica anche il pulsante Chiudi a tastiera.",
      "Apri Gestisci in due finestre: modifica nella prima e salva una versione vecchia nella seconda. Deve apparire il conflitto 409 e nessun valore della prima deve essere sovrascritto.",
      "Nel composer, Ctrl+Maiusc+Invio avvia la preimpostazione corrente. Fuori dal composer non avvia nulla; Invio ordinario conserva la sua funzione.",
      `Allega l'immagine ${immagine}: Agenti deve fermarsi con il motivo, bozza e chip intatti. Ripeti con il file caricato fuori dalla cartella ${esterno}.`,
      `Un riferimento a ${testo} nella cartella è ammesso; un riferimento a un file esterno è bloccato. Il contenuto testuale si può incollare nella richiesta.`,
      "Durante l'importazione di un allegato premi Agenti due volte: le quattro code devono terminare, deve partire al massimo un lavoro e un cambio conversazione deve annullare l'avvio preparato.",
      "Crea una preimpostazione di tipo Codice: leggi il consenso unico. Se cambi la preimpostazione nell'altra finestra durante il consenso, l'avvio deve fermarsi e chiedere di rivedere la scelta.",
      "Occupa i posti fino a lasciarne meno dei ruoli necessari: Agenti deve mostrare posti insufficienti e non aprire nessuna sessione di ruolo parziale.",
      "Chiudi ogni conversazione viva: il primario è disattivato con il motivo; Gestisci resta apribile e mostra le assegnazioni salvate spiegando che i modelli effettivi non sono leggibili.",
      "Approva continua a mettere il risultato nella bozza senza inviarlo. Il testo accanto ad Approva e la gestione di una bozza cambiata sono verifiche di P3.",
    ],
  };
}

function coppieRuoli(dati) {
  return dati.ruoli.map(({ roleId, provider, modello }) => ({ roleId, provider, modello }));
}

async function attendiBozza(api, lavoroId) {
  const limite = Date.now() + 30_000;
  let ultimo;
  while (Date.now() < limite) {
    const esito = await api("/api/consiglio/stato", { lavoroId });
    assert.equal(esito.stato, 200, JSON.stringify(esito.corpo));
    ultimo = esito.corpo;
    if (["bozza_valida", "bozza_bloccata", "interrotto", "annullato"].includes(ultimo.lavoro.stato)) return ultimo;
    await new Promise((risolvi) => setTimeout(risolvi, 25));
  }
  throw new Error(`La bozza sintetica non è arrivata entro trenta secondi: ${JSON.stringify(ultimo?.lavoro)}.`);
}

export async function verifica({ fixture, api, cliPi, radice, temporanea }) {
  assert.equal(cliPi, join(radice, "tests", "fake-pi.mjs"));
  assert.equal(fixture.workspace, join(temporanea, "consiglio-catalogo-due-consiglio-uscita-valida-agenti"));
  const sorgente = await api("/api/avvia", { cartella: fixture.workspace });
  assert.equal(sorgente.stato, 200, JSON.stringify(sorgente.corpo));
  const sourceSessionId = sorgente.corpo.id;
  const via = "/api/consiglio/preimpostazioni?sessionId=" + encodeURIComponent(sourceSessionId);
  let lettura = await api(via);
  assert.equal(lettura.stato, 200, JSON.stringify(lettura.corpo));
  const catalogo = lettura.corpo.catalogo;
  assert.ok(Array.isArray(catalogo) && catalogo.length >= 2, "con un modello solo questa prova del congelamento non vale");
  const coppia = (modello) => ({ provider: modello.provider, modelId: modello.modelId });
  const primo = coppia(catalogo[0]);
  const secondo = catalogo.slice(1).map(coppia).find((modello) => JSON.stringify(modello) !== JSON.stringify(primo));
  assert.ok(secondo, "servono due coppie provider/modello diverse lette dal catalogo");
  let archivio = lettura.corpo.archivio;
  async function cambia(operazione) {
    const risposta = await api(via, { versioneArchivioAttesa: archivio.versioneArchivio, ...operazione });
    assert.equal(risposta.stato, 200, JSON.stringify(risposta.corpo));
    archivio = risposta.corpo.archivio;
    return archivio;
  }
  const dati = {
    nome: "Prova congelamento", tipo: "testo", istruzioni: "Usa soltanto i dati sintetici della prova.",
    ordine: ["consigliere-1", "scrittore"], livello: { "consigliere-1": null, scrittore: null },
    assegnazioni: { "consigliere-1": primo, scrittore: secondo },
  };
  await cambia({ azione: "crea", preimpostazione: dati });
  let preset = archivio.preimpostazioni.find((voce) => voce.nome === dati.nome);
  assert.ok(preset);
  await cambia({ azione: "predefinita", id: preset.id, versioneAttesa: preset.versione });
  preset = archivio.preimpostazioni.find((voce) => voce.id === preset.id);
  const congelata = { id: preset.id, nome: preset.nome, versione: preset.versione };
  const richiesta = {
    sourceSessionId, operationId: "scenario-agenti-" + randomUUID(),
    prompt: "Produci una breve nota sintetica per verificare le assegnazioni del consiglio.",
    tipo: "testo", preimpostazione: { id: preset.id, versione: preset.versione },
    allegati: [{ percorso: fixture.testo, nome: "nota-sintetica.md" }],
  };
  const avvio = await api("/api/consiglio/avvia", richiesta);
  assert.equal(avvio.stato, 202, JSON.stringify(avvio.corpo));
  const lavoroId = avvio.corpo.lavoroId;
  try {
    const prima = await attendiBozza(api, lavoroId);
    assert.equal(prima.lavoro.stato, "bozza_valida", JSON.stringify(prima.lavoro));
    assert.deepEqual(prima.lavoro.preimpostazione, congelata);
    const coppie = coppieRuoli(prima);
    assert.deepEqual(coppie, [
      { roleId: "consigliere-1", provider: primo.provider, modello: primo.modelId },
      { roleId: "scrittore", provider: secondo.provider, modello: secondo.modelId },
    ]);
    const versioneSuperata = archivio.versioneArchivio;
    await cambia({ azione: "modifica", id: preset.id, versioneAttesa: preset.versione,
      preimpostazione: { ...dati, assegnazioni: { "consigliere-1": secondo, scrittore: primo } } });
    const conflitto = await api(via, { azione: "modifica", id: preset.id, versioneAttesa: preset.versione,
      versioneArchivioAttesa: versioneSuperata, preimpostazione: { ...dati, nome: "Nome superato" } });
    assert.equal(conflitto.stato, 409, "una seconda finestra non può sovrascrivere una versione nuova");
    const rifatto = await api("/api/consiglio/rifai", { lavoroId, revisioneAttesa: prima.lavoro.revisione,
      operationId: "scenario-rifai-" + randomUUID(), ripristina: false });
    assert.equal(rifatto.stato, 202, JSON.stringify(rifatto.corpo));
    const dopo = await attendiBozza(api, lavoroId);
    assert.equal(dopo.lavoro.stato, "bozza_valida", JSON.stringify(dopo.lavoro));
    assert.deepEqual(coppieRuoli(dopo), coppie, "Rifai riusa i due modelli congelati anche dopo la modifica del preset");
    assert.deepEqual(dopo.lavoro.preimpostazione, congelata);
    await writeFile(join(temporanea, "evidenza-agenti.json"), JSON.stringify({
      workspace: fixture.workspace, sourceSessionId, lavoroId, catalogo,
      preimpostazione: congelata, prima: coppie, dopo: coppieRuoli(dopo), conflitto: conflitto.stato,
    }, null, 2) + "\n", "utf8");
    console.log("PASS automatico: due modelli distinti congelati, Rifai invariato e conflitto 409. La prova del gesto e della tastiera resta da svolgere nel browser.");
  } finally {
    const annullato = await api("/api/consiglio/annulla", { lavoroId });
    assert.equal(annullato.stato, 200, JSON.stringify(annullato.corpo));
  }
  // Il browser riparte con le stesse due assegnazioni leggibili della prova.
  lettura = await api(via);
  assert.equal(lettura.stato, 200, JSON.stringify(lettura.corpo));
  archivio = lettura.corpo.archivio;
  preset = archivio.preimpostazioni.find((voce) => voce.id === preset.id);
  await cambia({ azione: "modifica", id: preset.id, versioneAttesa: preset.versione, preimpostazione: dati });
}
