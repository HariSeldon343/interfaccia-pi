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

1. Premi **Apri una cartella**.
2. Scegli l'unità o la cartella, oppure incolla il percorso completo.
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
| `/reload` | ricarica istruzioni, skill ed estensioni; nel pannello Skills corrisponde a **Aggiorna skill** |
| `/settings` | apre le impostazioni interattive |
| `/hotkeys` | mostra le scorciatoie disponibili |

La palette comprende inoltre `/scoped-models`, `/import`, `/share`, `/name`,
`/session`, `/changelog`, `/clone`, `/trust` e `/quit`: sono tutti i 22 comandi
incorporati dichiarati da `pi` 0.84.2. Alcuni aprono un selettore o una finestra
grafica, altri inviano direttamente l'operazione RPC equivalente.

L'eccezione sono i comandi forniti da estensioni arbitrarie. Una estensione può
eseguire codice e cambiare conversazione senza passare dal coordinamento della
GUI; per questo la palette li identifica ma li indirizza a **PI completo nel
terminale**. Prompt template e skill non sono estensioni e funzionano invece
normalmente nella GUI.

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

Nell'app installata la documentazione originale è inclusa nelle risorse, sotto
`runtime\pi\docs\`. Nel percorso browser/portable si trova invece dentro il
package `@earendil-works/pi-coding-agent` usato da quella installazione di Node.
