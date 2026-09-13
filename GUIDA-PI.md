# Guida a pi, in italiano

Aggiornata al 22/08/2026. Versione verificata:
`@earendil-works/pi-coding-agent` 0.84.2.

## Cos'è pi

`pi` è un agente che può leggere e modificare file, eseguire comandi e usare
modelli di fornitori diversi oppure modelli locali. La stessa conversazione
può cambiare modello e livello di ragionamento senza ricominciare da capo.

Puoi usarlo in due modi:

- con **Interfaccia pi**, un'impalcatura grafica sopra `pi`, pensata per mouse,
  linguaggio semplice e più cartelle;
- nel terminale, con la presentazione TUI originale e le estensioni arbitrarie.

## La cartella di lavoro

Ogni processo `pi` ha una cartella corrente (`cwd`). Da quella cartella
derivano il progetto, le istruzioni caricate, le skill e la posizione logica
della conversazione salvata.

La cartella corrente **non limita i permessi**. `pi`, i suoi strumenti e le
estensioni possono aprire percorsi assoluti esterni alla cartella se l'account
Windows ne ha il permesso. Va quindi considerata un contesto, non una sandbox.

Nell'interfaccia grafica ogni cartella aperta occupa una scheda e usa un
processo indipendente. Questo è il modo corretto di lavorare su più progetti
contemporaneamente: `pi` non ha un singolo workspace multi-root nativo.

## Uso quotidiano nell'interfaccia grafica

1. Inizia senza cartella oppure premi **Apri una cartella**.
2. Se usi una cartella, scegli l'unità o incolla il percorso completo.
3. Decidi se usare istruzioni, skill e risorse locali del progetto.
4. Premi il nome del modello in alto se vuoi cambiarlo.
5. Scrivi la richiesta.

La barra delle schede consente di passare fra progetti senza chiudere le altre
conversazioni. **Conversazioni salvate** cerca le sessioni reali di `pi` e le
riapre in una nuova scheda.

Ogni scheda conserva separatamente testo e immagini non ancora inviati. Le
bozze sopravvivono alla riapertura dell'app per un massimo di 30 giorni: il
testo usa lo spazio locale della pagina e le immagini IndexedDB. Se il browser
non riesce a salvarle, la GUI avverte di non chiudere o ricaricare la finestra.

Durante una risposta puoi:

- premere **Ferma**;
- scegliere **Correggi adesso** per guidare il turno in corso;
- scegliere **Aggiungi dopo** per mettere la richiesta in coda;
- vedere i file e i comandi usati dall'agente;
- copiare una risposta, comprimere la cronologia o controllare costo e contesto.

Digita `/` nella casella del messaggio per aprire la palette completa. La GUI
legge dalla build di `pi` inclusa i 22 comandi incorporati e li unisce ai prompt
e alle skill della cartella. Puoi scrivere per filtrare, usare le frecce e
Invio, oppure fare click: il comando viene inserito nell'editor e puoi ancora
leggerlo o completarne gli argomenti prima di inviarlo.

Il pulsante **＋** accanto alla casella apre le stesse funzioni senza dover
ricordare la sintassi: puoi allegare file, scegliere **Allega cartella**,
allegare un'immagine supportata oppure incollare
direttamente uno screenshot nel composer con `Ctrl+V`, cercare una skill o
una procedura nel catalogo reale della conversazione, vedere i comandi forniti
dalle estensioni e ricaricare le risorse dopo un'installazione o una modifica di
configurazione. Quest'ultima voce esegue il `/reload` nativo: non installa e non
abilita pacchetti da sola, ma rende disponibili quelli gia installati o
configurati senza perdere la conversazione.
Se nella casella hai gia scritto una richiesta, scegliendo una skill o un
comando estensione dal menu **＋** quel testo viene conservato come argomento.

Le risposte di Pi sanno di essere mostrate nella GUI e usano collegamenti
Markdown realmente selezionabili. I link `http` e `https` si aprono nel browser
di sistema; file e cartelle locali si aprono nell'app associata o in Esplora
file. Sono riconosciuti sia `[etichetta](C:\percorso con spazi\file.xlsx)` sia
`[etichetta](file:///C:/percorso%20con%20spazi/file.xlsx)`. Dentro una
conversazione con cartella, un target Markdown relativo viene risolto rispetto
alla cartella di lavoro; un percorso relativo scritto come semplice testo non
diventa invece cliccabile, per evitare interpretazioni ambigue. I percorsi
assoluti senza spazi e gli URL web scritti in chiaro vengono riconosciuti
automaticamente. Un percorso con spazi deve essere sempre racchiuso in un link
Markdown esplicito: cosi la GUI non confonde il nome con la frase che lo segue.

L'apertura avviene solo dopo il clic e viene verificata dal ponte locale: il
file o la cartella devono esistere davvero, i collegamenti relativi non possono
uscire dal progetto, le unita di rete e i namespace di dispositivo sono
bloccati e la chat non apre file eseguibili, installer, script, scorciatoie o
altri formati attivi. Pi non crea collegamenti sul Desktop se non glielo chiedi
esplicitamente.

Le immagini supportate dalla GUI sono PNG, JPEG, WebP o GIF. Puoi
sceglierli dal pulsante **＋** o incollare uno screenshot con `Ctrl+V`: compare
subito la stessa anteprima rimovibile prima dell'invio. Il modello selezionato
deve essere indicato come **immagini** nella finestra **Scegli modello**. Con un
modello solo testo, per esempio GLM-5.3 nell'attuale catalogo di Pi, la GUI ferma
l'invio e te lo spiega invece di lasciare che Pi sostituisca l'allegato con
`image omitted`.

Per documenti e sorgenti usa **＋ > Allega file**, **Allega cartella** o
trascina file e cartelle nella chat. Prima di leggere i contenuti compare
un'unica domanda: indicizzare tutti i documenti nella libreria, scegliere
quali indicizzare oppure usarli soltanto nella chat. **Scelgo** apre le
caselle di spunta con percorso, tipo, dimensione e contatore. **No, solo nella
chat** ammette fino a otto file singoli; una cartella si può solo indicizzare.
**Annulla** o **Esc** annulla anche le immagini del trascinamento misto.
Una selezione vuota in **Scelgo** lascia invece proseguire le immagini.

L'indicizzazione conserva gli originali in `raw/<categoria>/` e aggiorna
`.ingest-index.json`. Per PDF, DOCX, XLSX e PPTX crea accanto al documento un
file `.testo.md`: è questo il percorso riferito a Pi. I file già testuali
mantengono il riferimento all'originale; gli altri binari sono conservati
senza essere riferiti. I PDF privi di testo richiedono OCR, che non è incluso.
Se esiste `wiki/sources/`, viene creata anche una scheda fonte in bozza.

Il chip **N file in libreria** resta con la bozza e si può rimuovere senza
cancellare i documenti. Oltre otto riferimenti complessivi, Pi riceve i primi
sette più l'indice: l'app mostra un avviso prima dell'invio. I testi lunghi
si leggono con `offset` e `limit`.

Il caricamento ammette 200 file e 300 MiB per operazione, fino a 10 MiB per
file; eseguibili, cartelle nascoste e cartelle di dipendenze o compilazione
sono esclusi. **Ferma** completa il file corrente e poi si arresta. Il
riepilogo mostra indicizzati, duplicati e saltati e permette di copiare il
percorso della libreria. Il cambio di scheda ferma i file successivi.

Con **Chiedi al consiglio**, nella barra Strumenti, la stessa richiesta va a più
modelli insieme, fino a quattro consiglieri, e un ruolo in più, lo scrittore, ne
fonde le risposte in un testo solo. I modelli dei ruoli si scelgono una volta in
**Ruoli del consiglio**, dentro le impostazioni. La scheda **Risultato** mostra il
testo unico e la tabella di chi ha scritto che cosa. **Approva** lo porta nella
casella del messaggio, dove puoi ancora correggerlo prima di inviarlo, e **Rifai**
chiede un altro giro. Se il lavoro tocca dei file, il consenso si dà una volta
sola e dice quale cartella verrà modificata, quale comando di test verrà eseguito
alla fine e se i file si possono riportare indietro con git.

Anche la shell rapida conserva la sintassi originale: `! git status` esegue il
comando e aggiunge il risultato al contesto; `!! git status` lo esegue senza
aggiungerlo al contesto. In entrambi i casi la GUI mostra prima una conferma.

## Modelli e riservatezza

Il selettore distingue:

- **Locale**: il modello gira sul computer; i contenuti non vengono inviati a
  un fornitore esterno dal modello stesso;
- **Cloud**: prompt, file inseriti e contesto vengono trasmessi al provider;
- **Gateway**: il programma può essere locale, ma può inoltrare i dati a uno o
  più fornitori esterni.

Il costo indicato dalla GUI proviene dalle statistiche restituite da `pi`. Un
costo pari a zero può significare modello locale o tariffazione non disponibile:
controlla sempre l'etichetta privacy del modello.

Per collegare o scollegare un provider digita `/login` o `/logout` nella GUI e
segui la finestra guidata. I campi segreti vengono mascherati e le credenziali
restano nei file di configurazione di `pi` sul computer.

Quel pulsante apre una conversazione separata e isolata. Se invece vuoi portare
la conversazione corrente nel TUI, svuota prima editor e allegati e scegli
**Continua questa conversazione nel terminale**. La GUI ferma il proprio
processo, riserva il JSONL fino alla chiusura del terminale e impedisce una
doppia apertura. Per sicurezza il passaggio richiede che non siano collegate
altre finestre dell'interfaccia.

## Gli stessi comandi di pi nella GUI

| Comando | Cosa fa |
|---|---|
| `/model` | sceglie un modello |
| `/login` e `/logout` | collega o scollega un provider |
| `/new` | inizia una conversazione nuova |
| `/resume` | sceglie una conversazione passata |
| `/tree` | naviga fra i rami della conversazione; e disponibile anche come **Cronologia e rami** nella barra Strumenti |
| `/fork` | crea una copia da un punto della cronologia |
| `/compact` | riassume il contesto per liberare spazio |
| `/copy` | copia l'ultima risposta |
| `/export` | salva la conversazione come pagina HTML |
| `/reload` | ricarica estensioni, skill, prompt, temi e configurazioni senza perdere la conversazione; nella barra **Strumenti** corrisponde a **Ricarica estensioni** |
| `/settings` | apre le impostazioni interattive |
| `/hotkeys` | mostra le scorciatoie disponibili |

La palette comprende inoltre `/scoped-models`, `/import`, `/share`, `/name`,
`/session`, `/changelog`, `/clone`, `/trust` e `/quit`: sono tutti i 22 comandi
incorporati dichiarati da `pi` 0.84.2. Alcuni aprono un selettore o una finestra
grafica, altri inviano direttamente l'operazione RPC equivalente.

I comandi delle estensioni mostrano sempre se sono disponibili nella GUI oppure
se richiedono **PI completo nel terminale**. Soltanto le estensioni il cui flusso
RPC e stato verificato dall'interfaccia vengono eseguite nella GUI; tutte le
altre passano comunque dal catalogo sicuro del ponte, che propone il terminale
senza inoltrare un comando grezzo. Una estensione puo infatti eseguire codice e
cambiare conversazione fuori dal coordinamento della GUI. Prompt template e
skill non sono estensioni e funzionano normalmente nella GUI.

Per chi scrive estensioni con un pannello, l'host comunica il tema in due modi:
all'apertura aggiunge all'URL il parametro `tema`, poi a ogni cambio invia
`postMessage({ tipo: "pi-gui-tema", tema }, window.location.origin)` al pannello
visibile. I valori sono soltanto `"caldo"` e `"notte"`: la scelta `"automatico"`
viene risolta dall'host in base al tema del sistema. Il pannello deve leggere
il parametro all'avvio e ascoltare i messaggi verificando l'origine della GUI;
quando finisce di caricarsi riceve anche il tema corrente. La lettura e
l'applicazione del tema dentro il pannello sono a carico dell'estensione.

## Avvio dal terminale

| Cosa vuoi | Comando |
|---|---|
| Nuova conversazione | `pi` |
| Continua l'ultima | `pi -c` |
| Scegli una sessione | `pi -r` |
| Domanda singola | `pi -p "riassumi questo progetto"` |
| Parti con un file | `pi @documento.md "controlla questo"` |

Prima entra nella cartella corretta, per esempio:

```text
cd "C:\percorso\della\tua\cartella"
pi
```

## Istruzioni permanenti e fiducia nel progetto

`pi` legge le istruzioni globali e quelle del progetto, fra cui `AGENTS.md` e,
quando previsto, `CLAUDE.md`. Istruzioni, skill, prompt e pacchetti locali
possono contenere codice o indicazioni non affidabili.

Nella GUI la casella **Usa anche istruzioni, skill e risorse contenute nella
cartella** controlla l'avvio con `--approve` o `--no-approve`. Se non conosci
la provenienza del progetto, lasciala disattivata. Le estensioni sono disattivate
nel processo RPC della GUI e restano disponibili in **PI completo**.

## Quando qualcosa non funziona

| Sintomo | Causa probabile e rimedio |
|---|---|
| Nessun modello | avvia il server locale o digita `/login` nella GUI |
| Modello locale assente | caricalo in LM Studio/Ollama e avvia il relativo server |
| Istruzioni appena modificate ignorate | digita `/reload` nella GUI |
| Contesto quasi pieno | usa **Comprimi conversazione** o un modello con più contesto |
| Cronologia oltre 128 MB | usa **Continua questa conversazione nel terminale**; la compattazione non accorcia il JSONL append-only |
| Serve un'estensione o una personalizzazione TUI | usa **Apri PI completo nel terminale** |
| Il bridge si scollega | la bozza testuale resta associata alla scheda; riapri l'app e riprova |

Su Windows un server o daemon intenzionalmente staccato dalla shell che lo ha
creato può restare attivo anche dopo la chiusura di `pi`. Chiudilo esplicitamente:
la garanzia assoluta sull'intero albero richiederebbe un Job Object nativo.

## Dove sono i dati

| Cosa | Percorso predefinito |
|---|---|
| Impostazioni | `%USERPROFILE%\.pi\agent\settings.json` |
| Regole globali | `%USERPROFILE%\.pi\agent\AGENTS.md` |
| Modelli personalizzati | `%USERPROFILE%\.pi\agent\models.json` |
| Credenziali | `%USERPROFILE%\.pi\agent\auth.json` |
| Conversazioni | `%USERPROFILE%\.pi\agent\sessions\` |
| Libreria con cartella | `<cartella>\raw\<categoria>\` e `<cartella>\.ingest-index.json` |
| Libreria senza cartella | `%USERPROFILE%\.pi\gui\libreria\` |
| Lavori del consiglio | `%USERPROFILE%\.pi\gui\consigli\` |
| Schede fonte, se la directory esiste | `<cartella>\wiki\sources\` |

La libreria non scade e non viene rimossa dalla pulizia degli allegati
temporanei. I riferimenti della richiesta sono salvati insieme alla bozza.

I lavori del consiglio restano salvati in chiaro, con richiesta, istruzioni e
contributi, e vengono eliminati dopo trenta giorni.

Nell'app installata la documentazione originale è inclusa nelle risorse, sotto
`runtime\pi\docs\`. Nel percorso browser/portable si trova invece dentro il
package `@earendil-works/pi-coding-agent` usato da quella installazione di Node.
