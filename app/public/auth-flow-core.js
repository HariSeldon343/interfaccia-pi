(function pubblicaFlussoAutenticazione(radice, fabbrica) {
  const api = fabbrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else radice.PiGuiAuthFlowCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function creaFlussoAutenticazione() {
  "use strict";

  const NOMI_ACCOUNT = Object.freeze({
    anthropic: "Anthropic (Claude Pro/Max)",
    "openai-codex": "OpenAI (ChatGPT Plus/Pro)",
    xai: "xAI (Grok/X)",
  });

  function testoRicerca(valore) {
    return String(valore || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("it")
      .trim();
  }

  function metodiProvider(provider) {
    const metodi = [];
    if (provider?.methods?.oauth) metodi.push("oauth");
    if (provider?.methods?.apiKey) metodi.push("api_key");
    return metodi;
  }

  function scelteMetodo(provider = null) {
    const disponibili = provider ? new Set(metodiProvider(provider)) : new Set(["oauth", "api_key"]);
    return [
      {
        id: "oauth",
        titolo: "Accedi con un account",
        descrizione: "Usa il tuo abbonamento o account del fornitore. Non serve incollare una chiave API.",
      },
      {
        id: "api_key",
        titolo: "Accedi con una chiave API",
        descrizione: "Usa una chiave tecnica del fornitore e salvala nell'archivio protetto di Pi.",
      },
    ].filter((voce) => disponibili.has(voce.id));
  }

  function nomeProvider(provider, authType = null) {
    if (authType === "oauth" && NOMI_ACCOUNT[provider?.id]) return NOMI_ACCOUNT[provider.id];
    return String(provider?.name || provider?.id || "Fornitore");
  }

  function notaProvider(provider, authType) {
    if (authType === "oauth") {
      return provider?.id === "openrouter"
        ? "Accesso con account OpenRouter · nessuna chiave da incollare"
        : "Accesso con account · nessuna chiave API";
    }
    if (authType === "api_key") return "Inserisci una chiave API";
    return "";
  }

  function trovaProviderEsatto(providers, riferimento) {
    const cercato = testoRicerca(riferimento);
    if (!cercato) return null;
    return (Array.isArray(providers) ? providers : []).find((provider) =>
      [provider?.id, provider?.name, nomeProvider(provider, "oauth")]
        .some((valore) => testoRicerca(valore) === cercato)) || null;
  }

  function filtraProvider(providers, { authType, filtro = "", soloConnessi = false } = {}) {
    const cercato = testoRicerca(filtro);
    const visti = new Set();
    return (Array.isArray(providers) ? providers : [])
      .filter((provider) => {
        if (!provider || typeof provider !== "object" || !String(provider.id || "").trim()) return false;
        if (visti.has(provider.id)) return false;
        if (soloConnessi && !provider.credentialType) return false;
        if (authType && !metodiProvider(provider).includes(authType)) return false;
        if (cercato && ![provider.id, provider.name, nomeProvider(provider, authType)]
          .some((valore) => testoRicerca(valore).includes(cercato))) return false;
        visti.add(provider.id);
        return true;
      })
      .sort((a, b) => nomeProvider(a, authType).localeCompare(nomeProvider(b, authType), "it"));
  }

  function loginCommandIdEvento(evento) {
    return String(
      evento?.authEvent?.loginCommandId
      ?? evento?.loginCommandId
      ?? "",
    ).trim();
  }

  function eventoDelLogin(evento, loginCommandId) {
    const atteso = String(loginCommandId || "").trim();
    return Boolean(atteso) && loginCommandIdEvento(evento) === atteso;
  }

  function richiestaFallbackOAuth(evento) {
    if (
      !loginCommandIdEvento(evento)
      || evento?.method !== "input"
      || evento?.sensitive === true
      || evento?.authEvent?.type !== "prompt"
    ) return false;
    const indizi = [evento?.title, evento?.message, evento?.placeholder]
      .map((valore) => String(valore || ""))
      .join("\n");
    return /authorization code|redirect url|auth\/callback|codice di autorizzazione/i.test(indizi);
  }

  return Object.freeze({
    eventoDelLogin,
    filtraProvider,
    loginCommandIdEvento,
    metodiProvider,
    nomeProvider,
    notaProvider,
    richiestaFallbackOAuth,
    scelteMetodo,
    trovaProviderEsatto,
  });
});
