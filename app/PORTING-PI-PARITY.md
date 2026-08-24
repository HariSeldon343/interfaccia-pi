# Porting note — login e parita Pi 0.84.2

Questa correzione e stata applicata alla build installata perche il repository
sorgente usato sull'altro PC non e presente su questa macchina. Quando il
repository torna disponibile, portare insieme questi file:

- `public/auth-flow-core.js`
- `public/app.js`
- `public/index.html`
- `server.mjs`
- `tests/pi-parity.test.mjs`
- `tests/external-link.test.mjs`
- aggiornamento di `tests/real-pi-smoke.mjs`
- `EVAL-PI-PARITY.md`

## Decisioni da conservare

1. Il primo livello di `/login` e il metodo (`oauth` account oppure `api_key`),
   non il provider. Questo replica la TUI e impedisce provider duplicati.
2. `openai-codex` e l'accesso ChatGPT Plus/Pro; `openai` e la chiave API.
3. Tutti i prompt e i token di autenticazione restano nel runtime Pi/RPC.
4. Dopo il primo login si legge `defaultModelPerProvider` dal runtime pin-nato e
   si seleziona il default soltanto se il modello precedente era sconosciuto.
5. `/llama` e consentito come estensione inline integrata; le estensioni esterne
   arbitrarie restano nel terminale finche il protocollo RPC non espone in modo
   affidabile ogni cambio di sessione.
6. I link esterni non dipendono da `target="_blank"`: la WebView li delega al
   bridge `/api/apri-url`, che accetta soltanto `http`, `https` e `mailto`,
   richiede un clic esplicito e avvia il browser senza shell.
7. Le richieste `manual_code` dell'OAuth OpenAI sono concorrenti al callback
   locale: la GUI le mostra come fallback, le chiude senza inviare `cancelled`
   quando `login_provider` termina e il bridge elimina i dialoghi pendenti dello
   stesso `loginCommandId` per impedirne il replay dopo una riconnessione.
8. Non basta usare `method=input` e `authEvent.type=prompt` per riconoscere il
   fallback OAuth: anche Z.AI usa quella forma per chiedere la chiave API. Un
   fallback OAuth deve essere non sensibile e contenere un riferimento a codice
   di autorizzazione, redirect URL o `auth/callback`; i prompt `sensitive` devono
   conservare titolo e campo password originari del provider.
9. I blocchi `thinking` sono `details` chiusi per default anche durante lo
   streaming. A fine thinking cambia soltanto l'etichetta: se l'utente li ha
   aperti, la sua scelta resta invariata.
10. Ogni prompt conserva subito una safety-copy persistente, ma il suo ID viene
    nascosto soltanto in RAM nella pagina che lo ha appena inviato. Il pannello
    giallo appare dopo reload o dopo un errore a esito ignoto, non durante la
    normale elaborazione. Non persistere l'insieme degli ID nascosti: altrimenti
    un crash renderebbe invisibile proprio la copia che deve consentire il recupero.
11. Il cambio modello resta disponibile a caldo. Se il contesto corrente supera
    la finestra del nuovo modello, la lista e il toast avvisano che il primo invio
    avviera una compattazione e potra richiedere alcuni minuti.
12. `compaction_start` e `compaction_end` sono uno stato GUI vero: durante il
    riassunto la testata mostra `sta liberando spazio…`, composer e cambio modello
    sono disabilitati e il contatore del contesto non mostra la fotografia ormai
    obsoleta. Le statistiche vengono ricalcolate a fine turno.
13. Il timeout ordinario del prompt viene esteso mentre Pi compatta prima
    dell'ack. Questo evita falsi `esito da verificare` e safety-copy gialle quando
    il prompt e gia stato ricevuto. Resta un watchdog massimo di 15 minuti.
14. Un secondo clic sulla stessa bozza, con la stessa `lineageId`, viene bloccato
    finche la prima safety-copy non e riconciliata o verificata. Se vecchi retry
    equivalenti condividono la lineage, una singola prova nel JSONL li risolve
    insieme senza nascondere invii realmente distinti.
15. Le sequenze consecutive di ragionamenti e tool (`read`, `bash`, `edit`, ecc.)
    vivono in un solo `details.gruppo-attivita`, chiuso per default. Il summary
    mostra conteggio e stato (`in corso`, `completate`, `errori`); aprendolo si
    ritrovano i singoli dettagli originali. Le risposte testuali interrompono il
    gruppo per conservare l'ordine cronologico, e un gruppo aperto dall'utente
    resta aperto dopo la risincronizzazione quando contiene tool con ID stabile.
16. Se la GUI viene ricaricata mentre Pi sta lavorando, non presenta una falsa
    conversazione vuota: spiega che il JSONL gia salvato resta integro e che la
    cronologia viene ricostruita automaticamente a `agent_settled`. Nell'elenco
    delle conversazioni, un JSONL gia aperto e marcato esplicitamente e porta
    alla scheda esistente senza tentare una seconda apertura.

## Accoppiamento di versione

Il bridge verifica Pi `0.84.2` prima di importare:

- `core/slash-commands.js`
- `core/model-resolver.js`
- `core/trust-manager.js`

Un aggiornamento del runtime deve quindi aggiornare il pin e rieseguire la
matrice di parita; non bisogna mantenere a mano una copia dei modelli default.

## Gate di rilascio

```powershell
runtime\node\node.exe --check app\public\app.js
runtime\node\node.exe --check app\public\auth-flow-core.js
runtime\node\node.exe --check app\server.mjs
runtime\node\node.exe --test app\tests\*.test.mjs
runtime\node\node.exe --test app\tests\real-pi-smoke.mjs
```

Il controllo browser deve fermarsi alla lista provider account oppure, per il
ramo API, verificare soltanto titolo e tipo password del campo: non inserire una
chiave reale, non completare accessi reali e non ispezionare `auth.json`.
