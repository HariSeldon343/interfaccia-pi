// Processo di prova che resta vivo anche dopo la chiusura di stdin. Serve a
// verificare che il ponte non dimentichi una sessione se l'arresto di sistema
// fallisce: il file deve restare riservato finche il PID esiste davvero.

process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => {});

setInterval(() => {}, 1000);
