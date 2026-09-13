import test from "node:test";
import assert from "node:assert/strict";
import { testoLeggibile, titoloBreve, RIGA_MARKER } from "../app/testo-pulito.mjs";

test("i blocchi tecnici chiusi lasciano soltanto il messaggio leggibile", () => {
  assert.equal(testoLeggibile('<skill name="a" location="b"> Refs </skill>\n\nBuongiorno Jarvis'), "Buongiorno Jarvis");
  assert.equal(testoLeggibile("<system-reminder>\nx\n</system-reminder>\nCiao"), "Ciao");
  assert.equal(testoLeggibile('<skill\n name="a"\n location="b">\nRefs\n</skill>'), "");
  assert.equal(testoLeggibile("Prima <contesto><altro>x</altro></contesto> dopo"), "Prima dopo");
  assert.equal(testoLeggibile("<contesto>uno<contesto>due</contesto>tre</contesto> Utile"), "Utile");
});

test("un tag aperto anche incompleto elimina solo da quel punto alla fine", () => {
  assert.equal(testoLeggibile('<skill name="a"'), "");
  assert.equal(testoLeggibile("Ciao <system-reminder>testo tecnico"), "Ciao");
  assert.equal(testoLeggibile("<skill"), "");
  assert.equal(testoLeggibile('Prima <skill name="incompleto'), "Prima");
});

test("un tag autochiuso dentro un blocco non nasconde il messaggio successivo", () => {
  assert.equal(testoLeggibile("<skill><ref /></skill>\nBuongiorno"), "Buongiorno");
  assert.equal(testoLeggibile("<skill>Testo<br/></skill>\nBuongiorno"), "Buongiorno");
  assert.equal(testoLeggibile("Prima <ref /> dopo"), "Prima <ref /> dopo");
});

test("il confronto con un minore isolato e i marker dentro una frase restano intatti", () => {
  for (const testo of ["3 < 5 e 7 > 2", "Un < isolato", "Visita <https://example.test> e dimmi cosa ne pensi", "Il [GOAL] del cliente è chiaro", "orchestrazione: OK, tutto a posto"]) {
    assert.equal(testoLeggibile(testo), testo);
  }
});

test("le righe marker intere spariscono anche in grassetto senza perdere la riga utile", () => {
  for (const marker of ["[GOAL - fino al gate] x", "**[Skill stack]** a; b", "[GSD passo] x", "[Postura QI 190] x", "**[Check finale]** x", "orchestrazione: OK", "`ottimizzazione: ok.`", "__orchestrazione: OK__"]) {
    assert.equal(RIGA_MARKER.test(marker), true, marker);
    assert.equal(testoLeggibile(marker + "\nTesto utile"), "Testo utile");
  }
});

test("spazi e testo vuoto si normalizzano", () => {
  assert.equal(testoLeggibile("  Ciao\n\t mondo  "), "Ciao mondo");
  for (const vuoto of [null, undefined, "", " \n\t"]) assert.equal(testoLeggibile(vuoto), "");
  assert.equal(titoloBreve("<skill>x</skill>"), "");
});

test("un messaggio di 500 caratteri ha un titolo a parole intere entro 120 più ellissi", () => {
  const lungo = "parola ".repeat(72).slice(0, 500);
  const titolo = titoloBreve(lungo);
  assert.ok(titolo.length <= 121);
  assert.match(titolo, /…$/u);
  assert.equal(titolo, Array(17).fill("parola").join(" ") + "…");
  assert.equal(titoloBreve("corto"), "corto");
  assert.equal(titoloBreve("uno due tre", { massimo: 7 }), "uno due…");
  assert.equal(titoloBreve("uno due tre", { massimo: 11 }), "uno due tre");
  assert.equal(titoloBreve("lunghissima", { massimo: 4 }), "…");
});
