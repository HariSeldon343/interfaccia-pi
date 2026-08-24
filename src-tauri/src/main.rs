// Punto di ingresso dell'applicazione.
// La logica vera sta in lib.rs, cosi' e' condivisa con le altre piattaforme.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    interfaccia_pi_lib::run()
}
