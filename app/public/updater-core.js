(function pubblicaUpdaterCore(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PI_GUI_UPDATER = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaUpdaterCore() {
  "use strict";

  function byteLeggibili(valore) {
    const byte = Number(valore || 0);
    if (!Number.isFinite(byte) || byte <= 0) return "0 B";
    const unita = ["B", "KiB", "MiB", "GiB"];
    const indice = Math.min(Math.floor(Math.log(byte) / Math.log(1024)), unita.length - 1);
    const numero = byte / (1024 ** indice);
    return `${numero.toFixed(indice === 0 ? 0 : 1)} ${unita[indice]}`;
  }

  function presenta(stato) {
    const fase = String(stato?.phase || "unavailable");
    const versione = String(stato?.currentVersion || "sconosciuta");
    const disponibile = stato?.availableVersion ? String(stato.availableVersion) : null;
    const errore = stato?.error ? String(stato.error) : null;
    const risultato = {
      phase: fase,
      title: "Aggiornamenti di Interfaccia pi",
      status: `Versione installata: ${versione}`,
      detail: "Il controllo parte soltanto quando lo richiedi.",
      busy: false,
      canCheck: false,
      canDownload: false,
      canInstall: false,
      error: errore,
    };

    if (stato?.enabled === false || fase === "disabled") {
      risultato.status = `Versione installata: ${versione} · build pilota`;
      risultato.detail = "Gli aggiornamenti integrati sono disattivati. Installa manualmente una release verificata.";
    } else if (fase === "ready") {
      risultato.canCheck = true;
    } else if (fase === "checking") {
      risultato.busy = true;
      risultato.detail = "Controllo il canale production firmato…";
    } else if (fase === "current") {
      risultato.canCheck = true;
      risultato.detail = "Questa e la versione piu recente disponibile nel canale configurato.";
    } else if (fase === "available") {
      risultato.canCheck = true;
      risultato.canDownload = true;
      risultato.status = `Disponibile: ${disponibile || "nuova versione"} · installata: ${versione}`;
      risultato.detail = "Il download non parte automaticamente. La firma verra verificata prima di abilitare l'installazione.";
    } else if (fase === "downloading") {
      risultato.busy = true;
      risultato.status = `Scarico ${disponibile || "l'aggiornamento"}: ${byteLeggibili(stato?.downloadedBytes)}`;
      risultato.detail = stato?.totalBytes
        ? `Totale previsto: ${byteLeggibili(stato.totalBytes)}. La firma viene verificata al termine.`
        : "Dimensione totale non comunicata. La firma viene verificata al termine.";
    } else if (fase === "downloaded") {
      risultato.canCheck = true;
      risultato.canInstall = true;
      risultato.status = `${disponibile || "Aggiornamento"} scaricato e firma verificata`;
      risultato.detail = "Per installare devi chiudere tutte le conversazioni, i terminali e le altre finestre dell'app.";
    } else if (fase === "installing") {
      risultato.busy = true;
      risultato.status = "Preparo l'installazione…";
      risultato.detail = "Verifico che il bridge e i backend possano arrestarsi senza perdere lavoro.";
    } else {
      risultato.detail = "L'updater nativo e disponibile soltanto nell'app desktop.";
    }
    return risultato;
  }

  return Object.freeze({ byteLeggibili, presenta });
});
