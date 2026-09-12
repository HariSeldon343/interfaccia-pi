import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { PALETTE, risolviTema, applicaTema, contrasto } = require("../app/public/tema-core.js");
const valore = (palette, nome, visitati = new Set()) => {
  assert.ok(!visitati.has(nome), "Alias circolare: " + nome);
  assert.ok(Object.hasOwn(palette, nome), "Gettone mancante: " + nome);
  const alias = /^var\(--([\w-]+)\)$/u.exec(palette[nome]);
  return alias ? valore(palette, alias[1], new Set([...visitati, nome])) : palette[nome];
};

test("le tre scelte risolvono i due schemi del sistema", () => {
  for (const [scelta, schema, atteso] of [
    ["caldo", "light", "caldo"], ["caldo", "dark", "caldo"],
    ["notte", "light", "notte"], ["notte", "dark", "notte"],
    ["automatico", "light", "caldo"], ["automatico", "dark", "notte"],
  ]) assert.equal(risolviTema(scelta, schema), atteso, scelta + "/" + schema);
});

test("scelte sconosciute e schema sconosciuto tornano a Caldo", () => {
  for (const scelta of [undefined, null, "", "CALDO", "scuro", 1, {}]) {
    assert.equal(risolviTema(scelta, "light"), "caldo");
    assert.equal(risolviTema(scelta, "dark"), "caldo");
  }
  for (const schema of [undefined, null, "", "DARK", true]) {
    assert.equal(risolviTema("automatico", schema), "caldo");
  }
});

test("applicaTema aggiorna radice e controlli nativi senza richiedere un DOM globale", () => {
  const attributi = {};
  const documento = { documentElement: {
    setAttribute: (nome, contenuto) => { attributi[nome] = contenuto; }, style: {},
  } };
  assert.equal(applicaTema(documento, "notte"), "notte");
  assert.equal(attributi["data-tema"], "notte");
  assert.equal(documento.documentElement.style.colorScheme, "dark");
  assert.equal(applicaTema(documento, "caldo"), "caldo");
  assert.equal(attributi["data-tema"], "caldo");
  assert.equal(documento.documentElement.style.colorScheme, "light");
  applicaTema(documento, "sconosciuto");
  assert.equal(attributi["data-tema"], "caldo");
  assert.equal(applicaTema(null, "notte"), "notte");
  assert.equal(applicaTema({}, "caldo"), "caldo");
});

test("il contrasto WCAG usa la luminanza lineare e i sei canali esadecimali", () => {
  assert.equal(contrasto("#000000", "#FFFFFF"), 21);
  assert.equal(contrasto("FFFFFF", "000000"), 21);
  assert.equal(contrasto("#123456", "#123456"), 1);
  assert.ok(Math.abs(contrasto("#777777", "#FFFFFF") - 4.478089453577214) < 1e-12);
  assert.ok(Math.abs(contrasto("#FF0000", "#FFFFFF") - 3.9984767707539985) < 1e-12);
  assert.equal(contrasto("#abcdef", "#123456"), contrasto("#123456", "#ABCDEF"));
  for (const colore of ["#fff", "#12345678", "rgb(0,0,0)", "#zzzzzz", "", null]) {
    assert.throws(() => contrasto(colore, "#FFFFFF"), TypeError);
  }
});

test("applicaTema segue lo schema di sistema in Automatico, anche senza DOM", () => {
  const attributi = {};
  const documento = { documentElement: {
    setAttribute: (nome, contenuto) => { attributi[nome] = contenuto; }, style: {},
  } };
  for (const [schema, atteso] of [["dark", "notte"], ["light", "caldo"], ["dark", "notte"]]) {
    assert.equal(applicaTema(documento, "automatico", schema), atteso);
    assert.equal(attributi["data-tema"], atteso);
    assert.equal(documento.documentElement.style.colorScheme, schema);
    assert.equal(applicaTema(null, "automatico", schema), atteso);
  }
});

test("Caldo dichiara tutte le coppie testo/fondo e ne rispetta il contrasto", () => {
  for (const fondo of ["fondo", "fondo-lato", "fondo-alto", "fondo-campo"]) {
    for (const testo of ["testo", "testo-tenue", "testo-debole"]) {
      assert.ok(PALETTE.coppie.some((coppia) => coppia.testo === testo && coppia.fondo === fondo),
        "Coppia richiesta assente: " + testo + "/" + fondo);
    }
  }
  assert.ok(PALETTE.coppie.some((coppia) => coppia.testo === "accento" && coppia.fondo === "fondo"));
  // Queste combinazioni compaiono nei controlli e negli stati, anche al passaggio del puntatore.
  for (const [testo, fondo] of [
    ["stato-lavoro-testo", "azzurro-fondo"], ["stato-errore-testo", "azzurro-fondo"],
    ["stato-lavoro-testo", "ambra-fondo"], ["stato-lavoro-testo", "selezione"],
    ["testo-su-riempimento", "selezione"], ["testo-su-riempimento", "azzurro-fondo"],
    ["testo-su-riempimento", "ambra-fondo"], ["modello-testo-etichetta", "selezione"],
    ["modello-testo-etichetta", "modello-hover"], ["voce-attiva-secondario", "selezione"],
    ["accento", "stato-fondo-hover"],
    ["riepilogo-icona-testo", "riepilogo-icona-fondo"],
  ]) {
    assert.ok(PALETTE.coppie.some((coppia) => coppia.testo === testo && coppia.fondo === fondo),
      "Coppia funzionale assente: " + testo + "/" + fondo);
  }
  for (const coppia of PALETTE.coppie) {
    const rapporto = contrasto(valore(PALETTE.caldo, coppia.testo), valore(PALETTE.caldo, coppia.fondo));
    assert.ok([3, 4.5].includes(coppia.minimo), "Soglia non prevista: " + coppia.minimo);
    assert.equal(coppia.uso, coppia.minimo === 3 ? "solo decorativo" : "testo");
    assert.ok(rapporto >= coppia.minimo,
      coppia.testo + "/" + coppia.fondo + ": " + rapporto + " < " + coppia.minimo);
  }
});

test("il glifo del riepilogo usa la coppia sorvegliata e conserva i colori di Notte", async () => {
  const css = await readFile(new URL("../app/public/stile.css", import.meta.url), "utf8");
  const blocco = /\.riepilogo-contesto-icona\s*\{([^}]+)\}/u.exec(css)?.[1];
  assert.ok(blocco);
  assert.match(blocco, /color:\s*var\(--riepilogo-icona-testo\);/u);
  assert.match(blocco, /background:\s*var\(--riepilogo-icona-fondo\);/u);
  assert.equal(valore(PALETTE.notte, "riepilogo-icona-testo"), "#c9b5fa");
  assert.equal(valore(PALETTE.notte, "riepilogo-icona-fondo"), "#29262f");
});

test("i gettoni pubblicati coincidono con il CSS e gli alias esistono in entrambi i temi", async () => {
  const css = await readFile(new URL("../app/public/stile.css", import.meta.url), "utf8");
  const blocchi = [...css.matchAll(/(?:^|\n)(:root, \[data-tema="notte"\]|\[data-tema="caldo"\]) \{([^}]+)\}/gu)];
  assert.equal(blocchi.length, 2);
  for (const [indice, nome] of ["notte", "caldo"].entries()) {
    const dichiarati = Object.fromEntries([...blocchi[indice][2].matchAll(/--([\w-]+):\s*([^;]+);/gu)]
      .map((corrispondenza) => [corrispondenza[1], corrispondenza[2]]));
    assert.deepEqual(dichiarati, PALETTE[nome]);
    for (const gettone of Object.keys(PALETTE[nome])) valore(PALETTE[nome], gettone);
  }
  assert.deepEqual(Object.keys(PALETTE.caldo), Object.keys(PALETTE.notte));
  for (const riferimento of css.matchAll(/var\(--([\w-]+)\)/gu)) {
    assert.ok(Object.hasOwn(PALETTE.caldo, riferimento[1]), "Gettone CSS ignoto: " + riferimento[1]);
  }
});

test("il modulo browser è puro e pubblica PiGuiTemaCore senza documento", async () => {
  const codice = await readFile(new URL("../app/public/tema-core.js", import.meta.url), "utf8");
  const contesto = vm.createContext({});
  vm.runInContext(codice, contesto);
  assert.equal(contesto.PiGuiTemaCore.risolviTema("automatico", "dark"), "notte");
  assert.equal(contesto.PiGuiTemaCore.contrasto("#000000", "#FFFFFF"), 21);
  assert.equal("document" in contesto, false);
  assert.ok(Object.isFrozen(contesto.PiGuiTemaCore.PALETTE.caldo));
});
