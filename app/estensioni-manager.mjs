// Installazione per utente. La firma verifica provenienza e integrità, non confina il codice.
import { chmod, lstat, mkdir, open, readdir, rename, rm, rmdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { creaSerializzatore } from "./persistenza-atomica.mjs";
import { confrontaVersioni, leggiManifestoEstensione, verificaFileInventariato, verificaPacchettoEstensione, verificaPercorsoRegolare, LIMITI_ESTENSIONI, NOME_MANIFESTO, NOME_FIRMA } from "./estensioni-manifest.mjs";
import { elencoRisorsePersonali, verificaRisorsaPersonale, MASSIMO_TESTO } from "./estensioni-risorse.mjs";
import { creaArchivioEstensioni, erroreEstensioni, radiceProgrammiEstensioni, verificaAntenatiEstensioni, verificaVersioneArchivio } from "./estensioni-store.mjs";
import { VERSIONE_HOST } from "./versione-host.mjs";

const serializza = creaSerializzatore();
const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const VERSIONE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const ATTESA_RESIDUI_LEGACY_MS = 5 * 60 * 1000;

function nomeResiduo(tipo) {
  return `.${tipo}-${process.pid}-${Date.now()}-${randomUUID()}`;
}

async function residuoAbbandonato(percorso, nome) {
  const proprietario = /^\.(?:staging|rimozione)-(\d+)-(\d+)-/u.exec(nome);
  if (proprietario && Number.isSafeInteger(Number(proprietario[1])) && Number(proprietario[1]) > 0) {
    try { process.kill(Number(proprietario[1]), 0); return false; }
    catch (errore) { return errore.code === "ESRCH"; }
  }
  // I residui del formato precedente non hanno un proprietario: una cartella
  // appena creata può ancora appartenere a un'istanza della versione precedente.
  return Date.now() - (await lstat(percorso)).mtimeMs >= ATTESA_RESIDUI_LEGACY_MS;
}

function confinato(radice, percorso) {
  const scarto = relative(resolve(radice), resolve(percorso));
  if (!scarto || scarto === ".." || scarto.startsWith(".." + sep) || isAbsolute(scarto)) {
    throw erroreEstensioni("Il percorso del programma non è nella cartella delle estensioni.");
  }
  return resolve(percorso);
}

async function regolare(percorso, directory = false) {
  return verificaPercorsoRegolare(percorso, { directory });
}

async function proteggi(percorso, scrivibile = false) {
  await verificaAntenatiEstensioni(dirname(percorso));
  const info = await lstat(percorso);
  if (info.isSymbolicLink()) {
    if (scrivibile) return; // rm rimuove il collegamento, non visita la destinazione.
    throw erroreEstensioni(`Collegamento non ammesso: ${percorso}`);
  }
  if (info.isDirectory()) {
    if (scrivibile) await chmod(percorso, 0o700);
    for (const nome of await readdir(percorso)) await proteggi(join(percorso, nome), scrivibile);
    if (!scrivibile) await chmod(percorso, 0o555);
  } else if (info.isFile() && info.nlink === 1) await chmod(percorso, scrivibile ? 0o600 : 0o444);
  else throw erroreEstensioni(`Voce non regolare: ${percorso}`);
}

// Ogni voce viene ricontrollata immediatamente prima della copia. Il limite si
// applica anche ai byte letti, così una sorgente che cresce non aggira il cancello.
async function copiaControllata(sorgente, destinazione, limiti, osservaCopia) {
  let file = 0;
  let byte = 0;
  let directory = 0;
  async function visita(da, a) {
    await regolare(da, true);
    if (++directory > limiti.file + 1) throw erroreEstensioni("La cartella supera il limite di voci verificabili.");
    await mkdir(a);
    for (const nome of await readdir(da)) {
      const origine = join(da, nome);
      const arrivo = join(a, nome);
      const relativo = relative(sorgente, origine);
      if (relativo.length > limiti.percorso || arrivo.length > limiti.percorso) throw erroreEstensioni(`Percorso troppo lungo: ${relativo}`);
      const info = await lstat(origine);
      if (info.isSymbolicLink()) throw erroreEstensioni(`Collegamento non ammesso: ${relativo}`);
      if (info.isDirectory()) { await visita(origine, arrivo); continue; }
      if (!info.isFile()) throw erroreEstensioni(`Voce non regolare: ${relativo}`);
      const controllo = [NOME_MANIFESTO, NOME_FIRMA].includes(relativo);
      if (!controllo && ++file > limiti.file) throw erroreEstensioni("La cartella supera il limite di file.");
      let lettura;
      let scrittura;
      try {
        lettura = await open(origine, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const aperto = await lettura.stat();
        if (!aperto.isFile() || aperto.nlink > 1 || aperto.ino !== info.ino || aperto.dev !== info.dev) throw erroreEstensioni(`Il file è cambiato durante la copia: ${relativo}`);
        osservaCopia?.(relativo);
        scrittura = await open(arrivo, "wx", 0o600);
        const buffer = Buffer.alloc(64 * 1024);
        let scritti = 0;
        while (true) {
          const { bytesRead } = await lettura.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          scritti += bytesRead;
          if (controllo ? scritti > limiti.manifestoByte : (byte += bytesRead) > limiti.byte) throw erroreEstensioni(`Il file supera i limiti durante la copia: ${relativo}`);
          let posizione = 0;
          while (posizione < bytesRead) posizione += (await scrittura.write(buffer, posizione, bytesRead - posizione)).bytesWritten;
        }
        await scrittura.sync();
      } finally {
        await lettura?.close();
        await scrittura?.close();
      }
    }
  }
  await visita(sorgente, destinazione);
}

export function creaGestoreEstensioni({
  home = homedir(), env = process.env, platform = process.platform,
  portachiavi, versioneHost = VERSIONE_HOST, limiti = LIMITI_ESTENSIONI,
  radiceProgrammi = radiceProgrammiEstensioni({ home, env, platform }),
  archivio = creaArchivioEstensioni({ home }),
  sessioniOccupate = () => false, applicaSessioni = async () => {}, sospendiSessioni = async () => {},
  primaDiInstallare = async () => null, rilevaMigrazione = async () => null,
  osservaCopia = null, adesso = () => new Date().toISOString(), avvisaRisorsaPersonale = () => {},
} = {}) {
  radiceProgrammi = resolve(radiceProgrammi);
  limiti = { ...LIMITI_ESTENSIONI, ...limiti };
  for (const [nome, massimo] of Object.entries(LIMITI_ESTENSIONI)) {
    if (!Number.isSafeInteger(limiti[nome]) || limiti[nome] < 1 || limiti[nome] > massimo) throw erroreEstensioni("I limiti delle estensioni non sono validi.");
  }
  const opzioni = { portachiavi, versioneHost, limiti };
  const problemi = new Map();
  const problemiPersonali = new Map();
  function risolviProblemaPersonale(percorso) {
    if (!problemiPersonali.delete(percorso)) return;
    try { avvisaRisorsaPersonale({ percorso, risolta: true }); }
    catch { /* Un osservatore non può bloccare la conversazione. */ }
  }
  let avvisiRisorsePersonali = [];
  const percorsoVersione = (id, versione) => {
    if (typeof id !== "string" || id.length > 64 || !ID.test(id) || !VERSIONE.test(versione)) throw erroreEstensioni("L'identificativo o la versione dell'estensione non è valido.");
    return confinato(radiceProgrammi, join(radiceProgrammi, id, versione));
  };
  async function verificaRadici(id) {
    for (const percorso of [radiceProgrammi, join(radiceProgrammi, id)]) {
      await verificaAntenatiEstensioni(percorso);
    }
  }
  async function verificaVoce(voce, versione = voce.versioneInstallata) {
    try {
      await verificaRadici(voce.id);
      const verificata = await verificaPacchettoEstensione(percorsoVersione(voce.id, versione), opzioni);
      if (verificata.manifesto.id !== voce.id || verificata.manifesto.versione !== versione) throw erroreEstensioni("manifesto-estensione.json: identità diversa dalla versione installata.");
      problemi.delete(voce.id);
      return verificata;
    } catch (errore) {
      const stato = errore.code === "ESTENSIONE_NON_COMPATIBILE" ? "Non compatibile" : "Manomessa";
      const messaggio = `${voce.id}: ${errore.message}`;
      problemi.set(voce.id, { stato, messaggio });
      throw erroreEstensioni(messaggio, stato === "Manomessa" ? "ESTENSIONE_MANOMESSA" : "ESTENSIONE_NON_COMPATIBILE");
    }
  }
  function cerca(registro, id) {
    const voce = registro.estensioni.find((v) => v.id === id);
    if (!voce) throw erroreEstensioni("L'estensione non è installata.", "ESTENSIONE_ASSENTE", 404);
    return voce;
  }
  function aggiornaStato(voce) {
    voce.statoApplicazione = voce.attiva !== voce.attivaApplicata
      || (voce.attiva && voce.versioneInstallata !== voce.versioneApplicata) ? "Da applicare" : "Applicata";
  }
  async function anteprime(verificata) {
    const risultato = [];
    for (const [gruppo, tipo] of [["skills", "skill"], ["prompts", "prompt"], ["themes", "tema"]]) {
      for (const risorsa of verificata.risorse[gruppo] || []) {
        for (const percorso of [risorsa]) {
          const voce = verificata.manifesto.files.find((f) => resolve(verificata.radice, f.percorso) === resolve(percorso));
          const bytes = await verificaFileInventariato(percorso, voce, MASSIMO_TESTO);
          const troncata = voce.byte > MASSIMO_TESTO;
          risultato.push({ tipo, percorso, origine: verificata.radice, radice: verificata.radice,
            testo: new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: troncata }), troncata,
            messaggio: troncata ? "Anteprima troncata a 2 MB. Il file completo è stato verificato; apri il percorso di origine per leggerlo tutto." : "" });
        }
      }
    }
    return risultato;
  }
  async function personali(registro) {
    let risorse;
    const erroriLettura = new Map();
    avvisiRisorsePersonali = [];
    try { risorse = await elencoRisorsePersonali({ home, env, onErrore: (percorso, errore) => {
      erroriLettura.set(percorso, errore);
      avvisiRisorsePersonali.push(`${percorso}: ${errore.message}`);
    } }); }
    catch (errore) {
      // Un'origine personale non verificabile non nasconde i pacchetti e non
      // trasforma una scrittura del registro riuscita in un errore dell'operazione.
      risorse = [];
      avvisiRisorsePersonali = [`Le risorse personali non sono tutte verificabili: ${errore.message}`];
    }
    const risultato = risorse.map((risorsa) => {
      const voce = registro.risorsePersonali.find((v) => v.percorso === risorsa.percorso);
      return { ...risorsa, attiva: voce?.attiva || false, attivaApplicata: voce?.attivaApplicata || false,
        stato: voce && voce.sha256 !== risorsa.sha256 ? "Da rileggere" : "Verificata",
        messaggio: voce && voce.sha256 !== risorsa.sha256 ? "Il testo è cambiato. Rileggilo e attiva di nuovo la risorsa per accettarlo." : "",
        statoApplicazione: voce && (voce.attiva !== voce.attivaApplicata || (voce.attiva && risorsa.sha256 !== voce.sha256Applicata)) ? "Da applicare" : "Applicata" };
    });
    for (const voce of registro.risorsePersonali) {
      if (risultato.some((r) => r.percorso === voce.percorso)) continue;
      const problema = erroriLettura.get(voce.percorso);
      risultato.push({ ...voce, tipo: "risorsa", radice: dirname(voce.percorso), origine: dirname(voce.percorso), testo: "",
        stato: problema && !["ENOENT", "ESTENSIONE_ASSENTE"].includes(problema.code) ? "Da rileggere" : "Assente",
        messaggio: problema ? `La risorsa personale non è verificabile: ${problema.message} Puoi disattivarla nell'app.` : "La risorsa personale non è più presente. Puoi disattivarla nell'app.",
        statoApplicazione: voce.attiva || voce.attivaApplicata ? "Da applicare" : "Applicata" });
    }
    for (const risorsa of risultato) {
      if (risorsa.stato === "Verificata") continue;
      avvisiRisorsePersonali.push(`${risorsa.percorso}: ${risorsa.messaggio}`);
    }
    return risultato;
  }
  async function elenco() {
    const registro = await archivio.leggi();
    const estensioni = [];
    for (const voce of registro.estensioni) {
      let extra = {};
      try {
        const verificata = await verificaVoce(voce);
        extra = { nome: verificata.manifesto.nome, editore: verificata.manifesto.editore, descrizione: verificata.manifesto.descrizione,
          categoria: verificata.manifesto.categoria, host: verificata.manifesto.host, pannelli: verificata.manifesto.pannelli,
          risorse: await anteprime(verificata), compatibile: true };
      } catch (errore) {
        // Anche l'anteprima viene letta con gli stessi vincoli della verifica.
        if (!problemi.has(voce.id)) problemi.set(voce.id, { stato: "Manomessa", messaggio: errore.message });
      }
      const problema = problemi.get(voce.id);
      estensioni.push({ ...voce, ...extra, stato: problema?.stato || (voce.statoApplicazione === "Da applicare" ? "Da applicare" : voce.attivaApplicata ? "Attiva" : "Disattiva"),
        messaggio: problema?.messaggio || "", rimovibile: !voce.attivaApplicata && !sessioniOccupate() });
    }
    const risorsePersonali = await personali(registro);
    return { ...registro, estensioni, risorsePersonali, avvisiRisorsePersonali, migrazione: await rilevaMigrazione() };
  }
  async function pulisciProgramma(percorso) {
    confinato(radiceProgrammi, percorso);
    await verificaAntenatiEstensioni(dirname(percorso));
    try { await proteggi(percorso, true); await rm(percorso, { recursive: true, force: true }); }
    catch (errore) { if (errore.code !== "ENOENT") throw errore; }
  }
  async function pulisciResidui() {
    await archivio.leggi(); // Include il recupero del lock lasciato da un arresto.
    await verificaAntenatiEstensioni(radiceProgrammi);
    let voci;
    try { voci = await readdir(radiceProgrammi, { withFileTypes: true }); }
    catch (errore) { if (errore.code === "ENOENT") return; throw errore; }
    for (const voce of voci) {
      const percorso = confinato(radiceProgrammi, join(radiceProgrammi, voce.name));
      if (/^\.(?:staging|rimozione)-/u.test(voce.name)) {
        if (await residuoAbbandonato(percorso, voce.name)) await pulisciProgramma(percorso);
      } else if (ID.test(voce.name) && voce.isDirectory() && !voce.isSymbolicLink()) {
        await verificaAntenatiEstensioni(percorso);
        for (const nome of await readdir(percorso)) {
          const residuo = confinato(radiceProgrammi, join(percorso, nome));
          if (/^\.(?:staging|rimozione)-/u.test(nome) && await residuoAbbandonato(residuo, nome)) await pulisciProgramma(residuo);
        }
      }
    }
  }
  // La creazione accoda subito il recupero, senza gare con le operazioni dello
  // stesso registro. Ogni ingresso pubblico ne attende l'esito.
  const inizializzazione = serializza(archivio.percorso, pulisciResidui);
  inizializzazione.catch(() => {});
  const dopoInizializzazione = (operazione) => async (...argomenti) => {
    await inizializzazione;
    return operazione(...argomenti);
  };
  async function installazione({ cartella, versioneAttesa, confermaMigrazione = false }, aggiornamento) {
    return serializza(archivio.percorso, async () => {
      const registro = await archivio.leggi();
      verificaVersioneArchivio(registro, versioneAttesa);
      if (typeof cartella !== "string" || !isAbsolute(cartella)) throw erroreEstensioni("Scegli il percorso assoluto della cartella dell'estensione.");
      const sorgente = resolve(cartella);
      // Primo tempo: firma e schema prima di copiare o creare cartelle.
      const iniziale = await leggiManifestoEstensione(sorgente, opzioni);
      const manifesto = iniziale.manifesto;
      const precedente = registro.estensioni.find((voce) => voce.id === manifesto.id);
      if (aggiornamento && !precedente) throw erroreEstensioni("L'estensione da aggiornare non è installata.");
      if (precedente && confrontaVersioni(manifesto.versione, precedente.versioneInstallata) <= 0) throw erroreEstensioni("Versione precedente o già installata.");
      if (precedente?.versioniPresenti.includes(manifesto.versione)) throw erroreEstensioni("Versione già installata.");
      const destinazione = percorsoVersione(manifesto.id, manifesto.versione);
      await verificaRadici(manifesto.id);
      try { await lstat(destinazione); throw erroreEstensioni("Versione già installata."); }
      catch (errore) { if (errore.code !== "ENOENT") throw errore; }
      // Secondo tempo: inventario reale e tetti verificati interamente sulla sorgente.
      const sorgenteVerificata = await verificaPacchettoEstensione(sorgente, opzioni);
      if (sorgenteVerificata.manifestSha256 !== iniziale.manifestSha256) throw erroreEstensioni("Il manifesto è cambiato durante la verifica.");
      const radiceId = dirname(destinazione);
      const staging = confinato(radiceProgrammi, join(radiceId, nomeResiduo("staging")));
      for (const percorso of [...manifesto.files.map((f) => f.percorso), NOME_MANIFESTO, NOME_FIRMA]) {
        if (join(staging, percorso).length > iniziale.limiti.percorso || join(destinazione, percorso).length > iniziale.limiti.percorso) {
          throw erroreEstensioni(`Percorso troppo lungo nella cartella d'installazione: ${percorso}`);
        }
      }
      const migrazione = await primaDiInstallare({ manifesto, radice: sorgente, confermaMigrazione });
      if (migrazione?.annullata) return { annullata: true, versioneArchivio: registro.versioneArchivio };
      let pubblicata = false;
      try {
        await mkdir(radiceId, { recursive: true });
        await verificaRadici(manifesto.id);
        // Terzo tempo: lstat di ogni voce durante la copia, poi riverifica sulla copia.
        await copiaControllata(sorgente, staging, iniziale.limiti, osservaCopia);
        const copia = await verificaPacchettoEstensione(staging, opzioni);
        if (copia.manifestSha256 !== iniziale.manifestSha256) throw erroreEstensioni("manifesto-estensione.json è cambiato durante la copia.");
        await proteggi(staging);
        try { await lstat(destinazione); throw erroreEstensioni("Versione già installata."); }
        catch (errore) { if (errore.code !== "ENOENT") throw errore; }
        // Quarto tempo: pubblicazione in un nome non esistente, mai riscrittura in loco.
        await rename(staging, destinazione);
        pubblicata = true;
        await archivio.modifica(versioneAttesa, (corrente) => {
          const voce = precedente ? cerca(corrente, manifesto.id) : {
            id: manifesto.id, versioneInstallata: manifesto.versione, versioniPresenti: [],
            attiva: false, attivaApplicata: false, versioneApplicata: null,
          };
          Object.assign(voce, { versioneInstallata: manifesto.versione, versioniPresenti: [...voce.versioniPresenti, manifesto.versione],
            installataIl: adesso(), origine: sorgente, chiaveId: manifesto.chiaveId });
          aggiornaStato(voce);
          if (!precedente) corrente.estensioni.push(voce);
          return corrente;
        });
      } catch (errore) {
        await pulisciProgramma(pubblicata ? destinazione : staging);
        await rmdir(radiceId).catch(() => {});
        await rmdir(radiceProgrammi).catch(() => {});
        throw errore;
      }
      problemi.delete(manifesto.id);
      return elenco();
    });
  }
  async function attiva({ id, percorso, attiva: desiderata, versioneAttesa }) {
    return serializza(archivio.percorso, async () => {
      if (typeof desiderata !== "boolean" || Boolean(id) === Boolean(percorso)) throw erroreEstensioni("Indica una sola estensione o risorsa personale e uno stato valido.");
      await archivio.modifica(versioneAttesa, async (registro) => {
        if (id) {
          const voce = cerca(registro, id);
          if (desiderata) await verificaVoce(voce);
          voce.attiva = desiderata;
          aggiornaStato(voce);
        } else {
          const salvata = registro.risorsePersonali.find((r) => r.percorso === percorso);
          if (!desiderata && salvata) { salvata.attiva = false; risolviProblemaPersonale(percorso); return registro; }
          const risorsa = (await personali(registro)).find((r) => r.percorso === percorso);
          if (!risorsa) throw erroreEstensioni("La risorsa personale non è presente nelle cartelle di Pi.");
          if (risorsa.tipo === "tema" && desiderata) throw erroreEstensioni("I temi personali sono consultabili; l'attivazione dei temi non è supportata nella 2.9.");
          await verificaRisorsaPersonale(risorsa, { home, env });
          let voce = registro.risorsePersonali.find((r) => r.percorso === percorso);
          if (!voce) { voce = { percorso, attiva: false, attivaApplicata: false, sha256: risorsa.sha256, sha256Applicata: null }; registro.risorsePersonali.push(voce); }
          Object.assign(voce, { attiva: desiderata, sha256: risorsa.sha256 });
        }
        return registro;
      });
      return elenco();
    });
  }
  async function configura(registro, desiderata = false) {
    const risorse = { skills: [], prompts: [], themes: [] };
    for (const voce of registro.estensioni) {
      if (!(desiderata ? voce.attiva : voce.attivaApplicata)) continue;
      const verificata = await verificaVoce(voce, desiderata ? voce.versioneInstallata : voce.versioneApplicata);
      risorse.skills.push(...verificata.risorse.skills);
      risorse.prompts.push(...verificata.risorse.prompts);
    }
    for (const voce of registro.risorsePersonali) {
      if (!(desiderata ? voce.attiva : voce.attivaApplicata)) { risolviProblemaPersonale(voce.percorso); continue; }
      try {
        const risorsa = await verificaRisorsaPersonale({ percorso: voce.percorso, sha256: desiderata ? voce.sha256 : voce.sha256Applicata }, { home, env });
        risolviProblemaPersonale(voce.percorso);
        if (risorsa.tipo === "skill") risorse.skills.push(risorsa.percorso);
        else if (risorsa.tipo === "prompt") risorse.prompts.push(risorsa.percorso);
      } catch (errore) {
        // Solo le risorse personali degradano: il file cambiato non entra in Pi
        // e non impedisce l'apertura delle altre conversazioni.
        const stato = errore.code === "ESTENSIONE_ASSENTE" || errore.code === "ENOENT" ? "Assente" : "Da rileggere";
        const messaggio = `Avviso: errore di verifica della risorsa personale ${voce.percorso}. ${errore.message} La risorsa è esclusa da Pi; rileggila e riattivala oppure disattivala nell'app.`;
        const precedente = problemiPersonali.get(voce.percorso);
        problemiPersonali.set(voce.percorso, { percorso: voce.percorso, stato, messaggio });
        if (precedente?.messaggio !== messaggio) {
          try { avvisaRisorsaPersonale({ percorso: voce.percorso, stato, messaggio }); }
          catch { /* Un osservatore non può bloccare la conversazione. */ }
        }
      }
    }
    risorse.skills = [...new Set(risorse.skills)];
    risorse.prompts = [...new Set(risorse.prompts)];
    return risorse;
  }
  async function applica({ versioneAttesa }) {
    return serializza(archivio.percorso, async () => {
      const corrente = await archivio.leggi();
      verificaVersioneArchivio(corrente, versioneAttesa);
      if (sessioniOccupate()) return { ...await elenco(), rinviata: true, messaggio: "Da applicare: è in corso un turno, un lavoro degli agenti o un test. Le sessioni restano aperte." };
      // Tutta la configurazione supera il preflight prima di fermare una sessione.
      await configura(corrente, true);
      let applicazioneIniziata = false;
      try {
        await archivio.modifica(versioneAttesa, async (registro) => {
          if (sessioniOccupate()) throw erroreEstensioni("L'applicazione è rinviata: una sessione è in uso.", "ESTENSIONI_IN_USO", 409);
          let ultimeRisorse;
          const riverifica = async () => (ultimeRisorse = await configura(registro, true));
          const risorse = await riverifica();
          applicazioneIniziata = true;
          await applicaSessioni(risorse, riverifica);
          for (const voce of registro.estensioni) {
            voce.attivaApplicata = voce.attiva;
            voce.versioneApplicata = voce.attiva ? voce.versioneInstallata : null;
            aggiornaStato(voce);
          }
          for (const voce of registro.risorsePersonali) {
            voce.attivaApplicata = voce.attiva && [...ultimeRisorse.skills, ...ultimeRisorse.prompts].includes(voce.percorso);
            voce.sha256Applicata = voce.attivaApplicata ? voce.sha256 : null;
          }
          return registro;
        });
      } catch (errore) {
        if (applicazioneIniziata) {
          try {
            const riverificaPrecedente = () => configura(corrente);
            await applicaSessioni(await riverificaPrecedente(), riverificaPrecedente);
          } catch (ripristino) {
            let arresto = "";
            try { await sospendiSessioni(); }
            catch (erroreArresto) { arresto = ` Anche l'arresto richiede attenzione: ${erroreArresto.message}.`; }
            throw erroreEstensioni(`L'applicazione non è riuscita: ${errore.message}. Anche il ripristino delle sessioni richiede attenzione: ${ripristino.message}.${arresto}`, "ESTENSIONI_RIPRISTINO", 500);
          }
        }
        throw errore;
      }
      return { ...await elenco(), rinviata: false };
    });
  }
  async function tornaVersione({ id, versione, conferma, versioneAttesa }) {
    return serializza(archivio.percorso, async () => {
      if (conferma !== `Torna a ${versione}`) throw erroreEstensioni(`Per tornare alla versione precedente scrivi: Torna a ${versione}`);
      await archivio.modifica(versioneAttesa, async (registro) => {
        const voce = cerca(registro, id);
        if (!voce.versioniPresenti.includes(versione) || confrontaVersioni(versione, voce.versioneInstallata) >= 0) throw erroreEstensioni("Scegli una versione precedente già presente.");
        const verificata = await verificaVoce(voce, versione);
        voce.versioneInstallata = versione;
        voce.chiaveId = verificata.manifesto.chiaveId;
        voce.origine = verificata.radice;
        aggiornaStato(voce);
        return registro;
      });
      return elenco();
    });
  }
  async function rimuovi({ id, versioneAttesa }) {
    return serializza(archivio.percorso, async () => {
      const registro = await archivio.leggi();
      verificaVersioneArchivio(registro, versioneAttesa);
      const voce = cerca(registro, id);
      if (voce.attivaApplicata || sessioniOccupate()) throw erroreEstensioni("In uso, non rimovibile adesso. Disattiva l'estensione e applica prima di rimuoverla.", "ESTENSIONI_IN_USO", 409);
      await verificaRadici(id);
      const programma = confinato(radiceProgrammi, join(radiceProgrammi, id));
      const cestino = confinato(radiceProgrammi, join(radiceProgrammi, nomeResiduo("rimozione")));
      let spostata = false;
      try {
        await rename(programma, cestino);
        spostata = true;
        await archivio.modifica(versioneAttesa, (corrente) => {
          corrente.estensioni = corrente.estensioni.filter((v) => v.id !== id);
          return corrente;
        });
      } catch (errore) {
        if (spostata) await rename(cestino, programma);
        throw errore;
      }
      await pulisciProgramma(cestino);
      problemi.delete(id);
      return elenco();
    });
  }
  async function backendVerificato(id = "sistema-guidato") {
    const voce = (await archivio.leggi()).estensioni.find((v) => v.id === id);
    if (!voce?.attivaApplicata) return null;
    const verificata = await verificaVoce(voce, voce.versioneApplicata);
    if (verificata.manifesto.categoria !== "backend") return null;
    return { manifesto: verificata.manifesto, radice: verificata.radice, ingresso: verificata.backendIngresso, chiaveId: verificata.manifesto.chiaveId };
  }
  return { archivio, radiceProgrammi, elenco: dopoInizializzazione(elenco),
    avvisiRisorsePersonaliAttivi: () => [...problemiPersonali.values()].map((voce) => ({ ...voce })),
    installa: dopoInizializzazione((dati) => installazione(dati, false)), aggiorna: dopoInizializzazione((dati) => installazione(dati, true)),
    attiva: dopoInizializzazione(attiva), applica: dopoInizializzazione(applica), tornaVersione: dopoInizializzazione(tornaVersione),
    rimuovi: dopoInizializzazione(rimuovi), backendVerificato: dopoInizializzazione(backendVerificato),
    risorsePerPi: dopoInizializzazione(async () => configura(await archivio.leggi())) };
}
