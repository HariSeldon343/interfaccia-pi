# Eval — parita con Pi da terminale

Obiettivo: la GUI deve offrire la stessa superficie operativa del Pi 0.84.2
incluso nell'installazione, adattando al desktop i controlli che nel terminale
sono resi dalla TUI. Il runtime e la documentazione locale di Pi restano la
fonte autorevole; nessuna credenziale viene gestita da codice parallelo.

## Autenticazione

- [x] `/login` presenta prima `account` oppure `chiave API`, nello stesso ordine
      concettuale della TUI.
- [x] Il ramo account mostra una sola volta i soli provider OAuth/subscription.
- [x] `OpenAI (ChatGPT Plus/Pro)` usa `openai-codex` e non richiede una chiave API.
- [x] Il ramo API mostra `openai` e gli altri provider con chiave, senza confonderli
      con i rispettivi account.
- [x] I dialoghi secondari del provider (browser/device code, input, select,
      conferma) passano attraverso il protocollo RPC di Pi.
- [x] I pulsanti di accesso aprono il browser predefinito tramite il ponte
      desktop anche nella WebView nativa; copia del collegamento sempre presente.
- [x] Il fallback codice/redirect dell'OAuth resta disponibile mentre il browser
      lavora, ma viene chiuso automaticamente alla risposta finale di Pi e non
      viene scambiato per un annullamento dell'utente.
- [x] Un prompt sensibile per chiave API, incluso Z.AI, resta un campo password
      del provider e non viene scambiato per il fallback codice/redirect OAuth.
- [x] I token restano nell'archivio `~/.pi/agent/auth.json` gestito da Pi.
- [x] Se la sessione parte da modello sconosciuto, dopo il login la GUI usa il
      modello predefinito dichiarato dal runtime Pi, come la TUI.
- [x] `/logout` mostra soltanto i provider realmente connessi.

## Comandi e superfici

- [x] Tutti i 22 comandi built-in del Pi incluso hanno una strategia GUI:
      `settings`, `model`, `scoped-models`, `export`, `import`, `share`, `copy`,
      `name`, `session`, `changelog`, `hotkeys`, `fork`, `clone`, `tree`, `trust`,
      `login`, `logout`, `new`, `compact`, `resume`, `reload`, `quit`.
- [x] L'estensione inline integrata `/llama` usa ora i dialoghi RPC della GUI.
- [x] Skill e prompt template restano invocabili dalla palette `/`.
- [x] Chat in streaming, strumenti, immagini, comandi shell `!`/`!!`, coda,
      ragionamento, modelli e statistiche sono disponibili nella GUI.
- [x] Il ragionamento resta compresso anche durante lo streaming e si espande
      soltanto su richiesta; una scelta esplicita dell'utente non viene annullata
      alla fine del blocco thinking.
- [x] La safety-copy di un normale prompt corrente non appare come errore: il
      pannello di verifica si mostra soltanto dopo reload o consegna incerta.
- [x] Le conversazioni funzionano con o senza cartella; senza cartella i tool
      file richiedono percorsi assoluti espliciti.

## Confine residuo esplicito

Le estensioni di terze parti arbitrarie restano instradate a `Pi completo` nel
terminale. In Pi 0.84.x un'estensione puo cambiare sessione senza comunicare il
cambio al protocollo RPC: abilitarla in parallelo nella GUI potrebbe far aprire
lo stesso JSONL a due processi. Questo e un limite del confine RPC verificato,
non una funzione standard nascosta. La sola estensione inline `/llama` e
consentita perche fa parte del runtime pin-nato e usa primitive dialogo note.

## Esito 2026-08-24

PASS per autenticazione, apertura browser di sistema, 22/22 built-in, `/llama`,
ragionamento compresso e distinzione fra invio corrente e recupero incerto.
Verifica richiesta prima del rilascio: test automatici, smoke con il runtime
incluso e controllo visivo del percorso `/login` senza completare accessi reali
o leggere segreti. La regressione Z.AI e coperta distinguendo esplicitamente i
prompt `sensitive` dai prompt manuali OAuth che contengono indizi di callback o
codice di autorizzazione.
