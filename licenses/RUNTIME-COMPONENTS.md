# Componenti del runtime distribuito

L'installer Windows contiene un runtime dedicato all'applicazione. Non copia
la configurazione dell'utente e, dopo l'installazione, non richiede una copia
globale di Node.js o di PI.

Il codice di Interfaccia pi è distribuito con licenza ISC, riportata nel file
`INTERFACCIA-PI-ISC.txt`. Le licenze riportate sotto riguardano i componenti
del runtime inclusi nell'installer.

## Node.js

- versione: `24.18.0`, Windows x64;
- sorgente ufficiale: <https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip>;
- SHA-256: `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`;
- licenza e componenti di terze parti: file `LICENSE` incluso nell'archivio
  ufficiale e conservato in `runtime/node/LICENSE`.

L'intero archivio ufficiale viene mantenuto, compresi npm e Corepack, affinché
anche il PI interattivo aperto nel terminale disponga del proprio runtime.

## PI

- package: `@earendil-works/pi-coding-agent`;
- versione: `0.84.2`;
- sorgente: registry npm pubblico;
- integrità npm:
  `sha512-l4E+B7hgXKWddRo8bC/eSue2aWZjEgJ9xIpf5p0Og+lq8a2TArCwJ0HCoCPCgaBP/tN4zbYH/wOwvx9pJpeLCA==`;
- licenza: MIT, riportata in `PI-MIT.txt`.

Le dipendenze vengono installate con l'`npm-shrinkwrap.json` pubblicato nel
tarball di PI e con `--ignore-scripts`. Sei pacchetti workspace PI il cui lock
pubblicato omette `integrity` ricevono una allowlist SRI SHA-512 fissata nello
script; qualunque altra voce risolta senza digest blocca la build. Il file generato
`runtime/THIRD-PARTY-NOTICES.txt` riporta pacchetti, versioni, licenze, autori e
testi di licenza disponibili nei tarball.

Dopo `npm ci` e prima degli smoke test, lo script applica la patch locale
`PI_GUI_RPC_ADAPTER_V1` esclusivamente a
`pi/dist/modes/rpc/rpc-mode.js`. La patch aggiunge i comandi RPC
`set_scoped_models`, `refresh_models`, `get_rpc_settings`, `set_rpc_setting`,
`export_jsonl`, `import_jsonl`, `navigate_tree`, `abort_branch_summary`,
`set_label`, `reload`, `get_auth_providers`, `login_provider`,
`abort_login_provider` e `logout_provider`, senza cambiare la versione o la
licenza di PI. L'accesso usa un `AbortController` posseduto dall'host, correlato
dal `loginCommandId`: il bridge puo interrompere in modo cooperativo anche un
flusso OAuth o API-key rimasto in attesa. Il refresh dei modelli ha timeout
autorevole di 15 secondi e rilegge anche `models.json`; l'import usa una copia
esclusiva e rifiuta collisioni senza sovrascrivere sessioni correnti o archiviate.

Le impostazioni RPC sono una allowlist delle sole opzioni che influenzano
l'agente: compattazione e retry automatici, modalità steering/follow-up,
blocco e ridimensionamento immagini, comandi skill, trasporto e timeout HTTP.
Tema, cursore, padding e le altre preferenze di rendering restano proprie del
TUI e non vengono esposte dalla GUI. La build accetta soltanto questi digest:

`set_scoped_models` replica inoltre la persistenza del TUI: i modelli scelti
sono salvati nelle impostazioni globali come `provider/model`, senza livello di
ragionamento; quando tutti i modelli sono abilitati la proprietà
`enabledModels` viene rimossa usando `undefined`.

- upstream PI 0.84.2:
  `b8056af06447a3b89b680519bae1ce1d9063a266d827c3ca92f2dcd57c5ffd2b`;
- file dopo la patch:
  `fd50d795ef19913814570f2ee8a7cb946b27c303290201cb6d7d127d2086d408`.

Oltre al digest, ogni hunk verifica esattamente il contesto upstream e la
presenza unica delle sentinelle attese. Un cambiamento della sorgente o della
patch interrompe il vendoring invece di applicare una modifica fuzzy.

PI individua `fd` e `ripgrep` all'avvio e li usa per gli strumenti di ricerca;
se assenti tenta di scaricare la release GitHub corrente. Per evitare quel
download non bloccato, il bundle include invece:

- `fd` 10.4.2, SHA-256
  `b2816e506390a89941c63c9187d58a3cc10e9a55f2ef0685f9ea0eccaf7c98c8`,
  licenza MIT oppure Apache-2.0;
- `ripgrep` 15.2.0, SHA-256
  `71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5`,
  licenza MIT oppure Unlicense.

I file provengono dagli archivi ufficiali delle rispettive release GitHub. Le
licenze presenti negli archivi sono conservate sotto `runtime/tools/licenses`.
La cartella `runtime/tools` precede il `PATH` ereditato, insieme a Node.

## Procedura di build

Da PowerShell nella radice del progetto:

```powershell
npm run vendor:pi
npm run vendor:pi:check
npm run build:desktop:offline
```

`vendor:pi` non riscarica nulla se l'inventario esistente supera la verifica.
`vendor:pi:force` forza invece una ricostruzione completa. La build offline
rifiuta un runtime assente, modificato o con versioni diverse dai pin.

Il runtime generato si trova in `vendor/pi-runtime`. Il suo `manifest.json`
contiene l'inventario SHA-256 di ogni file. La directory è materiale di build e
non deve incorporare configurazioni dell'utente (`.pi`, `.env`,
`settings.json`, `.npmrc` personali o credenziali). L'eventuale `.npmrc` vuoto
incluso nel pacchetto npm ufficiale appartiene alla distribuzione verificata e
non contiene impostazioni del profilo locale.

Il comando `pi update --self` è intenzionalmente indisponibile: il core PI è
una risorsa dell'applicazione e si aggiorna installando una nuova versione di
Interfaccia pi. `pi install`, `pi remove` e gli aggiornamenti dei pacchetti
utente restano disponibili e usano l'npm incluso, scrivendo nella cartella PI
dell'utente e non nel runtime vendorizzato.
