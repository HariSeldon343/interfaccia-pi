import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const LINK = require("../public/link-core.js");

test("il classificatore distingue web, file, assoluti e relativi espliciti", () => {
  assert.deepEqual(LINK.destinazioneLinkGui("https://example.com/documento"), {
    target: "https://example.com/documento",
    tipo: "web",
  });
  assert.equal(LINK.destinazioneLinkGui("javascript:alert(1)"), null);
  assert.equal(LINK.destinazioneLinkGui("documento finale.xlsx"), null);
  assert.deepEqual(
    LINK.destinazioneLinkGui("documento finale.xlsx", { consentiRelativo: true }),
    { target: "documento finale.xlsx", tipo: "locale" },
  );
  assert.deepEqual(LINK.destinazioneLinkGui(String.raw`C:\Dati condivisi\file.xlsx`), {
    target: String.raw`C:\Dati condivisi\file.xlsx`,
    tipo: "locale",
  });
  assert.deepEqual(LINK.destinazioneLinkGui("mailto:a@example.com?subject=100%25"), {
    target: "mailto:a@example.com?subject=100%25",
    tipo: "web",
  });
  assert.equal(LINK.destinazioneLinkGui("mailto:a@example.com?subject=x%250d%250aBcc:b@example.com"), null);
  assert.equal(LINK.destinazioneLinkGui("mailto:a@example.com?subject=x%25%30%64Bcc:b@example.com"), null);
});

test("l'autolink semplice non ingloba la prosa e separa due percorsi", () => {
  const conProsa = String.raw`Apri C:\Dati\uno.xlsx e poi continua con il controllo`;
  const primo = LINK.prossimaDestinazioneAutomatica(conProsa);
  assert.equal(primo.target, String.raw`C:\Dati\uno.xlsx`);
  assert.equal(conProsa.slice(primo.fine), " e poi continua con il controllo");

  const duePercorsi = String.raw`Confronta C:\Dati\uno.xlsx C:\Dati\due.xlsx`;
  const uno = LINK.prossimaDestinazioneAutomatica(duePercorsi);
  const due = LINK.prossimaDestinazioneAutomatica(duePercorsi, uno.fine);
  assert.equal(uno.target, String.raw`C:\Dati\uno.xlsx`);
  assert.equal(due.target, String.raw`C:\Dati\due.xlsx`);
  assert.ok(uno.fine <= due.inizio);

  const conSpazi = String.raw`C:\Dati condivisi\file finale.xlsx`;
  assert.equal(LINK.prossimaDestinazioneAutomatica(conSpazi).target, String.raw`C:\Dati`);
});

test("il parser Markdown conserva target angolari, spazi e parentesi bilanciate", () => {
  const casi = [
    [
      String.raw`[Checklist](<C:\Dati condivisi\Checklist finale.xlsx>)`,
      String.raw`<C:\Dati condivisi\Checklist finale.xlsx>`,
    ],
    ["[Pagina](https://example.com/a_(b_(c)))", "https://example.com/a_(b_(c))"],
  ];
  for (const [testo, target] of casi) {
    const token = [...testo.matchAll(LINK.creaEspressioneInline())][0]?.[0];
    assert.equal(token, testo);
    assert.deepEqual(LINK.analizzaTokenCollegamento(token), {
      etichetta: testo.slice(1, testo.indexOf("](")),
      target,
    });
  }
});
