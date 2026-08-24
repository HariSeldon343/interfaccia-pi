(function pubblicaCollegamenti(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiLinkCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaCollegamenti() {
  "use strict";

  const LINK_MARKDOWN = String.raw`\[[^\]\n]+\]\((?:<[^>\n]+>|[^()\n]|\((?:[^()\n]|\([^()\n]*\))*\))+\)`;

  function contieneControlliUri(valore) {
    let decodificato = String(valore || "");
    for (let passaggio = 0; passaggio < 3; passaggio += 1) {
      if (
        /[\0\r\n]/.test(decodificato)
        || /%(?:25)*(?:00|0a|0d)/i.test(decodificato)
      ) return true;
      let successivo;
      try {
        successivo = decodeURIComponent(decodificato);
      } catch {
        return false;
      }
      if (successivo === decodificato) return false;
      decodificato = successivo;
    }
    return /[\0\r\n]/.test(decodificato) || /%(?:25)*(?:00|0a|0d)/i.test(decodificato);
  }

  function destinazioneLinkGui(valore, { consentiRelativo = false } = {}) {
    let target = String(valore || "").trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1).trim();
    if (
      !target
      || target.length > 8192
      || /[\0\r\n]/.test(target)
      || /%(?:25)*(?:00|0a|0d)/i.test(target)
    ) return null;
    try {
      const url = new URL(target);
      if (["http:", "https:", "mailto:"].includes(url.protocol)) {
        if (["http:", "https:"].includes(url.protocol) && (!url.hostname || url.username || url.password)) {
          return null;
        }
        if (url.protocol === "mailto:" && contieneControlliUri(url.href)) return null;
        return { target: url.href, tipo: "web" };
      }
      if (
        url.protocol === "file:"
        && !url.username
        && !url.password
        && !url.hostname
        && !url.search
        && !url.hash
      ) {
        return { target: url.href, tipo: "locale" };
      }
    } catch {
      // I percorsi Windows non sono URL standard e vengono classificati sotto.
    }
    if (/^[A-Za-z]:[\\/]/.test(target) || /^\/(?!\/)/.test(target)) {
      return { target, tipo: "locale" };
    }
    if (
      consentiRelativo
      && !/^(?:[?#]|[\\/]{2})/.test(target)
      && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
    ) {
      return { target, tipo: "locale" };
    }
    return null;
  }

  function rimuoviPunteggiaturaLinkFinale(valore) {
    let risultato = valore;
    while (/[.,;!?]$/.test(risultato)) risultato = risultato.slice(0, -1);
    while (
      risultato.endsWith(")")
      && (risultato.match(/\(/g)?.length || 0) < (risultato.match(/\)/g)?.length || 0)
    ) risultato = risultato.slice(0, -1);
    return risultato;
  }

  function prossimaDestinazioneAutomatica(riga, da = 0) {
    const ricerca = /(https?:\/\/|file:\/{3}|[A-Za-z]:[\\/])/gi;
    ricerca.lastIndex = da;
    for (;;) {
      const trovata = ricerca.exec(riga);
      if (!trovata) return null;
      const inizio = trovata.index;
      // Un target in testo semplice termina sempre al primo spazio. I percorsi
      // con spazi richiedono il Markdown esplicito, che elimina ogni ambiguita
      // fra nome del file e prosa successiva.
      const grezzo = riga.slice(inizio).match(/^[^\s<>"']+/)?.[0] || "";
      const target = rimuoviPunteggiaturaLinkFinale(grezzo);
      if (target && destinazioneLinkGui(target)) {
        return { inizio, fine: inizio + target.length, target };
      }
      ricerca.lastIndex = inizio + trovata[0].length;
    }
  }

  function creaEspressioneInline() {
    return new RegExp(
      String.raw`(` + "`[^`\\n]+`" + String.raw`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|${LINK_MARKDOWN})`,
      "g",
    );
  }

  function analizzaTokenCollegamento(token) {
    if (!new RegExp(`^${LINK_MARKDOWN}$`).test(String(token || ""))) return null;
    const separatore = token.indexOf("](");
    return {
      etichetta: token.slice(1, separatore),
      target: token.slice(separatore + 2, -1),
    };
  }

  return Object.freeze({
    analizzaTokenCollegamento,
    creaEspressioneInline,
    destinazioneLinkGui,
    prossimaDestinazioneAutomatica,
  });
});
