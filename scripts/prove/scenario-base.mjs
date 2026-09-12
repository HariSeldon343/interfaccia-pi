import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function prepara({ home }) {
  const directory = join(home, ".pi", "agent", "skills", "prova-personale");
  await mkdir(directory, { recursive: true });
  const percorso = join(directory, "SKILL.md");
  const testo = "---\nname: prova-personale\ndescription: Risorsa sintetica per la prova isolata\n---\n\nContenuto sintetico della risorsa personale.\n";
  await writeFile(percorso, testo);
  return { percorso, testo, istruzioni: [
    "Apri senza cartella; prova una bozza sintetica, un allegato finto, cambio conversazione e F5.",
    `La risorsa personale deve mostrare origine e testo integrale: ${percorso}`,
    "La risorsa è inizialmente disattivata nell’app. Le preferenze si salvano nel registro della GUI.",
  ] };
}

export async function verifica({ fixture, api }) {
  const stato = await api("/api/estensioni");
  assert.equal(stato.stato, 200);
  const personale = stato.corpo.risorsePersonali.find((r) => r.percorso === fixture.percorso);
  assert.ok(personale);
  assert.equal(personale.attiva, false);
  assert.equal(personale.testo, fixture.testo);
  console.log("PASS: risorsa personale leggibile, origine dichiarata, inizialmente disattivata.");
}
