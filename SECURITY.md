# Sicurezza

## Segnalazioni

Non pubblicare credenziali, file di sessione Pi o dettagli sfruttabili in una
segnalazione pubblica. Quando il repository GitHub sara attivo, usare una
segnalazione privata di sicurezza oppure contattare direttamente il manutentore.

Indicare versione, Windows, passaggi minimi per riprodurre il problema e impatto
osservato. Allegare soltanto log ripuliti da percorsi personali, prompt,
risposte, token OAuth e chiavi API.

## Confine di sicurezza

Il bridge ascolta esclusivamente su `127.0.0.1` e protegge le mutazioni con un
token per avvio e controlli di origine. Non e una sandbox contro programmi o
utenti locali ostili. Pi, gli strumenti e i comandi approvati operano con i
permessi dell'account Windows.

Le release e gli aggiornamenti non devono incorporare `.pi`, file JSONL,
credenziali, certificati o chiavi private. I segreti di firma appartengono al
gestore sicuro della CI e non al repository.
