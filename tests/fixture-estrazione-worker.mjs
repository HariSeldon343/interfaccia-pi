import { parentPort, workerData } from "node:worker_threads";

if (workerData.nome === "errore") throw new Error("Errore di estrazione simulato");
if (workerData.nome === "uscita") process.exit(0);
const inizio = Date.now();
while (Date.now() - inizio < 60000) { /* Simula un parser occupato senza bloccare il ponte. */ }
parentPort.postMessage({stato: "ok", testo: "fine", contenuto: "fine", caratteri: 4, pagine: 0, parser: "fixture", motivo: ""});
