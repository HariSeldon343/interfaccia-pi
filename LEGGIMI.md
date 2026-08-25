# Interfaccia grafica per pi

Versione 2.4.1, aggiornata il 25/08/2026.

È una finestra pensata per usare l'agente `pi` senza dover conoscere i comandi
del terminale. Le operazioni quotidiane sono visibili e spiegate in italiano;
le funzioni tecniche restano raccolte sotto **Controlli avanzati**. Il layout
segue una struttura conversazionale essenziale, con le Skills raccolte in un
elenco a scomparsa e spiegate in linguaggio naturale.

## Il percorso più semplice

1. Scrivi subito, oppure premi **Apri una cartella** se il lavoro richiede un workspace.
2. Naviga fra unità, preferite e cartelle recenti, oppure incolla un percorso.
3. Controlla il modello indicato in alto; premi il suo nome per cambiarlo.
4. Scrivi la richiesta e premi **Invia**.

La cartella viene aperta in una nuova scheda. Aprirne un'altra non chiude né
cancella la conversazione precedente: ogni scheda ha un processo `pi`, un
modello, una coda e una cronologia indipendenti. Si possono tenere aperte fino
a sei cartelle contemporaneamente.

## Cosa si può fare dalla finestra

- iniziare anche senza cartella e usare percorsi assoluti quando servono file locali;
- accedere ai provider con account/OAuth quando Pi lo supporta, senza essere obbligati a inserire una chiave API;
- aprire più cartelle e passare dall'una all'altra tramite le schede;
- scegliere e cercare i modelli, distinguendo quelli locali da quelli cloud e
  vedendo subito se LM Studio, Ollama o llama.cpp sono realmente in esecuzione;
- scegliere quanto il modello deve ragionare;
- iniziare, rinominare, clonare, ramificare, comprimere ed esportare una
  conversazione;
- aprire **Cronologia e rami** dalla barra Strumenti e tornare a un passaggio
  precedente senza cancellare il lavoro successivo, che resta in un altro ramo;
- cercare e riaprire conversazioni salvate realmente da `pi`;
- inviare testo e immagini, anche incollando direttamente uno screenshot con
  `Ctrl+V`, correggere il lavoro in corso oppure accodare una richiesta successiva;
- vedere risposta e stato in streaming; ragionamenti e strumenti tecnici restano
  raccolti in blocchi compatti, espandibili soltanto quando servono;
- interrompere sempre il lavoro dalla barra superiore;
- digitare `/` per cercare e richiamare dalla stessa casella tutti i 22 comandi
  incorporati di `pi`, oltre a prompt e skill, con nome leggibile e spiegazione;
- aggiornare dal pannello Skills le competenze installate dopo l'avvio, senza
  riavviare o perdere la conversazione;
- usare `! comando` e `!! comando` come nel terminale: il primo conserva il
  risultato nel contesto, il secondo lo esegue fuori dal contesto; la GUI chiede
  sempre conferma prima di avviare la shell;
- usare, sotto **Controlli avanzati**, le operazioni del protocollo RPC che non
  mettono a rischio la cronologia e la shell diretta con un avviso esplicito.

Al primo avvio di una cartella viene chiesto se considerare attendibili le
istruzioni, skill e risorse del progetto. L'opzione è visibile perché possono
guidare `pi` a usare strumenti con i permessi dell'utente.

## Tutto pi: cosa significa con precisione

La versione 2.4 è un'impalcatura grafica sopra la modalità RPC della stessa
build `pi` 0.84.2 inclusa nell'installer. Il bridge legge il catalogo originale
dei comandi incorporati, lo unisce a prompt e skill della cartella e lo espone
alla palette aperta da `/`. Ogni comando viene tradotto in un'operazione RPC
verificata o in un flusso grafico equivalente: modello, modelli rapidi,
importazione, esportazione, condivisione, cronologia, rami, fiducia, accesso ai
provider, nuova sessione, compattazione, ripresa, ricarica e chiusura.

Le poche operazioni mancanti nell'RPC ufficiale di `pi` 0.84.2 sono fornite da
un adapter locale, applicato soltanto alla versione e al digest esatti del
runtime incluso. Se la versione non coincide, la preparazione dell'installer
fallisce invece di applicare una patch incerta. Le letture monolitiche che
possono superare il limite del protocollo (`get_messages`, albero, fork e ultima
risposta) sono sostituite da endpoint locali equivalenti, a flusso o con
anteprima limitata.

Rimane una sola distinzione intenzionale. I processi della GUI partono con
`--no-extensions`: in PI 0.84.2 un'estensione arbitraria può cambiare file di
sessione dall'interno senza comunicarlo al bridge e aggirerebbe il blocco
anti-doppia-apertura. Skill, prompt template, file di contesto, strumenti e i
22 comandi incorporati restano disponibili; estensioni e componenti TUI
personalizzati si usano con **Nuova conversazione nel terminale**.

Nei Controlli avanzati ci sono due percorsi distinti. **Nuova conversazione nel
terminale** crea un lavoro separato nella stessa cartella, utile per pacchetti,
estensioni, temi e personalizzazioni TUI. **Sposta questa conversazione nel
terminale** chiude in sicurezza il processo RPC e consegna proprio il suo JSONL
al TUI, mantenendolo riservato finché il terminale rimane aperto. Il passaggio
richiede editor e allegati vuoti e, per non perdere bozze presenti altrove,
un'unica finestra della GUI collegata. Non è una limitazione nascosta: è il
confine dell'API RPC e del coordinamento sessioni forniti oggi da `pi` 0.84.2.
Il terminale separato usa un archivio dedicato (`--session-dir`): così il suo
comando `/resume` non può aprire per errore un JSONL già posseduto dalla GUI.

## Importante: la cartella non è una sandbox

La cartella scelta è il punto di partenza e determina istruzioni, skill e
salvataggi della sessione. Non è un recinto di sicurezza. `pi`, i suoi
strumenti, la shell e le estensioni possono usare percorsi assoluti e quindi
accedere anche ad altri file consentiti dal tuo account Windows.

## Installazione e avvio

Per installare la versione corrente, usa:

`src-tauri\target-final-2.4.1\release\bundle\nsis\Interfaccia pi_2.4.1_x64-setup.exe`

L'installazione è per il profilo utente e crea il collegamento nel menu Start.
La variante `.msi` nella cartella `bundle\msi\` è pensata per installazioni
amministrate.

L'installer è autocontenuto: distribuisce Node.js 24.18.0 con npm/Corepack,
`@earendil-works/pi-coding-agent` 0.84.2 con la sua closure bloccata,
`fd` 10.4.2 e `ripgrep` 15.2.0. L'app installata non usa Node o PI globali e
funziona anche se non sono presenti nel `PATH`. Il runtime estratto pesa circa
201 MiB; versioni, sorgenti, digest e licenze sono descritti in
`licenses/RUNTIME-COMPONENTS.md` e nel manifesto incluso.

Configurazione, login, modelli, sessioni, trust, skill e pacchetti personali
non vengono incorporati nell'installer: restano nella cartella `.pi` del
profilo Windows e vengono creati o letti soltanto durante l'uso. Anche il
motore LLM e i suoi modelli (per esempio LM Studio) restano componenti separati.
Il comando `pi update --self` non modifica il runtime dell'applicazione: per
aggiornare PI si installa una nuova Interfaccia pi. L'npm incluso resta invece
disponibile a `pi install` per i pacchetti dell'utente.

Il primo avvio della serie 2 controlla anche un'eventuale versione 1.x rimasta
attiva. Non la termina mai automaticamente, neppure se appare inattiva: chiudi
la vecchia conversazione e tutte le sue finestre, quindi riapri la versione corrente. Se la
vecchia finestra non esiste più ma il ponte è rimasto acceso, riavvia Windows.
La serie 2 usa la stessa porta 4666 come blocco di sistema: vecchia e nuova versione
non possono lavorare in parallelo sullo stesso file di conversazione.

Gli eseguibili prodotti localmente non hanno una firma digitale dell'editore:
Windows può quindi mostrare un avviso SmartScreen. Per una distribuzione ad
altre persone è consigliato firmare EXE, MSI e installer con un certificato di
code signing.

Senza installazione puoi fare doppio clic su **Interfaccia pi.bat**. Il
lanciatore accende il bridge locale e apre la stessa interfaccia nel browser;
questo solo percorso di sviluppo/portable richiede Node.js 22.19 o successivo
e PI 0.84.2 installati o indicati esplicitamente.

## Sicurezza del bridge locale

Il bridge ascolta solo su `127.0.0.1`. Le operazioni che cambiano stato
richiedono un token casuale valido per il singolo avvio, JSON, `Origin` e
`Host` locali coerenti. Le pagine sono servite con una Content Security Policy
restrittiva e i processi vengono avviati senza shell intermedia.

Questo impedisce a una normale pagina web esterna di pilotare il bridge locale.
Il token non sostituisce comunque la prudenza verso estensioni o comandi che
l'utente decide volontariamente di eseguire.

Il confine di protezione è la macchina locale, non il singolo profilo Windows:
un programma o un altro account locale capace di collegarsi a `127.0.0.1` può
raggiungere il bridge e non va considerato isolato. La GUI è quindi pensata per
un PC personale o mono-utente. La protezione blocca le normali pagine web
esterne, non malware o utenti locali ostili.

Le bozze testuali non inviate sono conservate in chiaro nello spazio locale
della WebView/browser per facilitare il recupero dopo un riavvio. Un invio
accettato ma non ancora visibile nella cronologia conserva per 30 giorni un
marker separato; testo e immagini gia inviate sono recuperabili dalla sezione
**Invii da verificare**. Anche le immagini soltanto allegate vengono conservate
in IndexedDB e ripristinate con la bozza; se il salvataggio locale fallisce,
l'app avverte di non chiudere o ricaricare la finestra.

La GUI impedisce inoltre a una seconda finestra di chiudere o trasferire le
sessioni mentre un altro client recente potrebbe conservare dati non inviati.

Una cronologia JSONL append-only oltre 128 MB non viene caricata nella WebView,
per evitare picchi di memoria. La compattazione riduce il contesto del modello
ma non accorcia quel file: usa **Continua questa conversazione nel terminale**.

Su Windows il bridge controlla e termina l'albero dei processi conosciuto. Un
programma avviato intenzionalmente in background che si stacca dopo la chiusura
della propria shell può però sopravvivere: una garanzia assoluta richiederebbe
un Job Object nativo. Chiudi esplicitamente server di sviluppo e daemon che hai
chiesto a `pi` di lasciare in esecuzione.

## Se qualcosa non va

| Sintomo | Cosa fare |
|---|---|
| Il ponte non risponde | Chiudi un vecchio avvio dell'interfaccia e riaprila |
| Node.js non supportato nel lancio browser | Installa Node.js 22.19 o successivo; PI 0.84.2 non supporta versioni precedenti |
| Nessun modello disponibile | Avvia il server locale oppure digita `/login` nella casella della GUI |
| La risposta non parte | Controlla il messaggio rosso; il testo rimane nell'editor e può essere reinviato |
| Il contesto è quasi pieno | Premi **Comprimi conversazione** o scegli un modello con più contesto |
| Una cronologia supera 128 MB | Usa **Continua questa conversazione nel terminale**; compattare non riduce il JSONL append-only |
| Ti serve un'estensione | Usa **Apri PI completo nel terminale**; la GUI RPC carica skill e prompt ma disattiva le estensioni |

## Architettura

| File | Ruolo |
|---|---|
| `avvia.mjs` | verifica la firma del bridge, lo avvia e apre l'interfaccia |
| `app/server.mjs` | gestisce processi `pi` RPC indipendenti e API locale protetta |
| `app/public/index.html` | struttura semantica della finestra |
| `app/public/stile.css` | layout desktop, zoom elevato e modalità compatta |
| `app/public/palette-core.js` | ricerca, completamento e analisi sicura dei comandi `/` |
| `app/public/app.js` | stato delle schede, RPC, sincronizzazione e accessibilità |
| `scripts/patches/pi-0.84.2-rpc-adapter-v1.patch` | adapter RPC verificato per i comandi mancanti |
| `tests/fake-pi.mjs` | agente RPC finto per verifiche riproducibili |
| `tests/server.test.mjs` | test di sicurezza, lifecycle, UTF-8, multi-sessione ed estensioni |

## Verifica e ricompilazione

Dal terminale, nella cartella del progetto:

```text
npm run check
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run vendor:pi:check
$env:CARGO_TARGET_DIR = Join-Path $PWD 'src-tauri\target-final-2.4.1'
npm run build:desktop:offline
```

I test non richiedono un modello: usano un agente RPC finto. Il collaudo
finale con un modello reale resta importante per verificare configurazione,
credenziali e prestazioni della macchina.
