//! Updater Tauri controllato dall'utente.
//!
//! La build pilota non contiene la configurazione `plugins.updater` e resta
//! quindi esplicitamente disabilitata. La build production registra il plugin
//! soltanto dopo che endpoint HTTPS e chiave pubblica sono stati convalidati.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const FASE_DISABILITATO: &str = "disabled";
const FASE_PRONTO: &str = "ready";
const FASE_CONTROLLO: &str = "checking";
const FASE_CORRENTE: &str = "current";
const FASE_DISPONIBILE: &str = "available";
const FASE_DOWNLOAD: &str = "downloading";
const FASE_SCARICATO: &str = "downloaded";
const FASE_INSTALLAZIONE: &str = "installing";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSnapshot {
    enabled: bool,
    phase: String,
    current_version: String,
    available_version: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    error: Option<String>,
}

struct UpdaterData {
    enabled: bool,
    phase: &'static str,
    sequence: u64,
    pending: Option<Update>,
    package: Option<Vec<u8>>,
    available_version: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    error: Option<String>,
}

pub struct UpdaterControl(Mutex<UpdaterData>);

impl UpdaterControl {
    pub fn new(enabled: bool) -> Self {
        Self(Mutex::new(UpdaterData {
            enabled,
            phase: if enabled {
                FASE_PRONTO
            } else {
                FASE_DISABILITATO
            },
            sequence: 0,
            pending: None,
            package: None,
            available_version: None,
            notes: None,
            published_at: None,
            downloaded_bytes: 0,
            total_bytes: None,
            error: None,
        }))
    }

    fn snapshot(&self, current_version: String) -> UpdaterSnapshot {
        let dati = self.0.lock().expect("stato updater");
        UpdaterSnapshot {
            enabled: dati.enabled,
            phase: dati.phase.to_string(),
            current_version,
            available_version: dati.available_version.clone(),
            notes: dati.notes.clone(),
            published_at: dati.published_at.clone(),
            downloaded_bytes: dati.downloaded_bytes,
            total_bytes: dati.total_bytes,
            error: dati.error.clone(),
        }
    }
}

fn errore_configurazione(messaggio: &str) -> tauri::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("Configurazione updater production rifiutata: {messaggio}"),
    )
    .into()
}

/// Distingue la build pilota (nessuna sezione updater) dalla production e
/// applica un secondo controllo fail-closed prima di registrare il plugin.
pub fn configurazione_production_valida(app: &tauri::App) -> tauri::Result<bool> {
    let Some(configurazione) = app.config().plugins.0.get("updater") else {
        return Ok(false);
    };
    let oggetto = configurazione
        .as_object()
        .ok_or_else(|| errore_configurazione("la sezione deve essere un oggetto"))?;
    let chiave = oggetto
        .get("pubkey")
        .and_then(|valore| valore.as_str())
        .map(str::trim)
        .filter(|valore| {
            !valore.is_empty()
                && !valore.contains("CONTENT FROM")
                && !valore.contains("PLACEHOLDER")
        })
        .ok_or_else(|| errore_configurazione("chiave pubblica assente o placeholder"))?;
    if !chiave.contains("minisign public key") {
        return Err(errore_configurazione(
            "la chiave pubblica non ha il formato Minisign previsto da Tauri",
        ));
    }
    let endpoints = oggetto
        .get("endpoints")
        .and_then(|valore| valore.as_array())
        .filter(|valori| !valori.is_empty() && valori.len() <= 3)
        .ok_or_else(|| errore_configurazione("servono da uno a tre endpoint"))?;
    for endpoint in endpoints {
        let testo = endpoint
            .as_str()
            .ok_or_else(|| errore_configurazione("endpoint non testuale"))?;
        let url =
            tauri::Url::parse(testo).map_err(|_| errore_configurazione("endpoint non valido"))?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.host_str().is_none()
            || url.fragment().is_some()
        {
            return Err(errore_configurazione(
                "ogni endpoint deve essere HTTPS, senza credenziali o frammenti",
            ));
        }
    }
    for opzione_pericolosa in [
        "dangerousInsecureTransportProtocol",
        "dangerousAcceptInvalidCerts",
        "dangerousAcceptInvalidHostnames",
    ] {
        if oggetto
            .get(opzione_pericolosa)
            .and_then(|valore| valore.as_bool())
            == Some(true)
        {
            return Err(errore_configurazione(
                "le deroghe TLS non sono consentite in production",
            ));
        }
    }
    Ok(true)
}

fn errore_utente(
    controllo: &UpdaterControl,
    fase: &'static str,
    messaggio: impl Into<String>,
) -> String {
    let messaggio = messaggio.into();
    let mut dati = controllo.0.lock().expect("stato updater");
    dati.phase = fase;
    dati.error = Some(messaggio.clone());
    messaggio
}

fn verifica_attivo(dati: &UpdaterData) -> Result<(), String> {
    if dati.enabled {
        Ok(())
    } else {
        Err("Gli aggiornamenti integrati sono disattivati in questa build pilota.".to_string())
    }
}

fn verifica_non_occupato(dati: &UpdaterData) -> Result<(), String> {
    if matches!(
        dati.phase,
        FASE_CONTROLLO | FASE_DOWNLOAD | FASE_INSTALLAZIONE
    ) {
        Err("Un'operazione di aggiornamento e gia in corso.".to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn updater_status(app: AppHandle, controllo: State<'_, UpdaterControl>) -> UpdaterSnapshot {
    controllo.snapshot(app.package_info().version.to_string())
}

#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    controllo: State<'_, UpdaterControl>,
) -> Result<UpdaterSnapshot, String> {
    let sequenza = {
        let mut dati = controllo.0.lock().expect("stato updater");
        verifica_attivo(&dati)?;
        verifica_non_occupato(&dati)?;
        dati.sequence += 1;
        dati.phase = FASE_CONTROLLO;
        dati.pending = None;
        dati.package = None;
        dati.available_version = None;
        dati.notes = None;
        dati.published_at = None;
        dati.downloaded_bytes = 0;
        dati.total_bytes = None;
        dati.error = None;
        dati.sequence
    };

    let esito = async {
        let updater = app
            .updater_builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|errore| errore.to_string())?;
        updater.check().await.map_err(|errore| errore.to_string())
    }
    .await;

    match esito {
        Ok(aggiornamento) => {
            let mut dati = controllo.0.lock().expect("stato updater");
            if dati.sequence != sequenza {
                return Err(
                    "Il controllo e stato superato da una richiesta pi recente.".to_string()
                );
            }
            if let Some(aggiornamento) = aggiornamento {
                dati.phase = FASE_DISPONIBILE;
                dati.available_version = Some(aggiornamento.version.clone());
                dati.notes = aggiornamento
                    .body
                    .clone()
                    .map(|testo| testo.chars().take(10_000).collect());
                dati.published_at = aggiornamento.date.map(|data| data.to_string());
                dati.pending = Some(aggiornamento);
            } else {
                dati.phase = FASE_CORRENTE;
            }
            dati.error = None;
        }
        Err(errore) => {
            return Err(errore_utente(
                &controllo,
                FASE_PRONTO,
                format!("Controllo aggiornamenti non riuscito: {errore}"),
            ));
        }
    }
    Ok(controllo.snapshot(app.package_info().version.to_string()))
}

#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    controllo: State<'_, UpdaterControl>,
) -> Result<UpdaterSnapshot, String> {
    let (sequenza, aggiornamento) = {
        let mut dati = controllo.0.lock().expect("stato updater");
        verifica_attivo(&dati)?;
        verifica_non_occupato(&dati)?;
        let aggiornamento = dati
            .pending
            .clone()
            .ok_or_else(|| "Controlla prima se esiste un aggiornamento.".to_string())?;
        dati.sequence += 1;
        dati.phase = FASE_DOWNLOAD;
        dati.package = None;
        dati.downloaded_bytes = 0;
        dati.total_bytes = None;
        dati.error = None;
        (dati.sequence, aggiornamento)
    };

    let esito = aggiornamento
        .download(
            |lunghezza, totale| {
                let mut dati = controllo.0.lock().expect("stato updater");
                if dati.sequence == sequenza && dati.phase == FASE_DOWNLOAD {
                    dati.downloaded_bytes = dati
                        .downloaded_bytes
                        .saturating_add(u64::try_from(lunghezza).unwrap_or(u64::MAX));
                    dati.total_bytes = totale;
                }
            },
            || {},
        )
        .await;

    match esito {
        Ok(pacchetto) => {
            let mut dati = controllo.0.lock().expect("stato updater");
            if dati.sequence != sequenza {
                return Err("Il download e stato superato da una richiesta pi recente.".to_string());
            }
            dati.downloaded_bytes = u64::try_from(pacchetto.len()).unwrap_or(u64::MAX);
            dati.total_bytes = Some(dati.downloaded_bytes);
            dati.package = Some(pacchetto);
            dati.phase = FASE_SCARICATO;
            dati.error = None;
        }
        Err(errore) => {
            return Err(errore_utente(
                &controllo,
                FASE_DISPONIBILE,
                format!("Download o verifica della firma non riusciti: {errore}"),
            ));
        }
    }
    Ok(controllo.snapshot(app.package_info().version.to_string()))
}

#[tauri::command]
pub async fn updater_install(
    app: AppHandle,
    controllo: State<'_, UpdaterControl>,
) -> Result<UpdaterSnapshot, String> {
    let (sequenza, aggiornamento, pacchetto) = {
        let mut dati = controllo.0.lock().expect("stato updater");
        verifica_attivo(&dati)?;
        verifica_non_occupato(&dati)?;
        let aggiornamento = dati
            .pending
            .clone()
            .ok_or_else(|| "Nessun aggiornamento verificato e pronto.".to_string())?;
        let pacchetto = dati
            .package
            .clone()
            .ok_or_else(|| "Scarica e verifica prima il pacchetto di aggiornamento.".to_string())?;
        dati.sequence += 1;
        dati.phase = FASE_INSTALLAZIONE;
        dati.error = None;
        (dati.sequence, aggiornamento, pacchetto)
    };

    let app_per_arresto = app.clone();
    let arresto = tauri::async_runtime::spawn_blocking(move || {
        super::prepara_ponte_per_aggiornamento(&app_per_arresto)
    })
    .await
    .map_err(|errore| format!("Preparazione del bridge interrotta: {errore}"))?;
    if let Err(errore) = arresto {
        return Err(errore_utente(&controllo, FASE_SCARICATO, errore));
    }

    // Su Windows `install` avvia l'installer e termina il processo. Se ritorna
    // con errore conserviamo il pacchetto verificato per un nuovo tentativo.
    if let Err(errore) = aggiornamento.install(&pacchetto) {
        return Err(errore_utente(
            &controllo,
            FASE_SCARICATO,
            format!("Avvio dell'installer non riuscito: {errore}"),
        ));
    }

    {
        let mut dati = controllo.0.lock().expect("stato updater");
        if dati.sequence == sequenza {
            dati.phase = FASE_SCARICATO;
            dati.error = Some(
                "Pacchetto installato: riavvia l'applicazione per usare la nuova versione."
                    .to_string(),
            );
        }
    }
    Ok(controllo.snapshot(app.package_info().version.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{UpdaterControl, FASE_DISABILITATO, FASE_PRONTO};

    #[test]
    fn la_build_pilota_nasce_disabilitata() {
        let controllo = UpdaterControl::new(false);
        let dati = controllo.0.lock().expect("stato updater");
        assert!(!dati.enabled);
        assert_eq!(dati.phase, FASE_DISABILITATO);
    }

    #[test]
    fn la_build_production_non_avvia_controlli_automatici() {
        let controllo = UpdaterControl::new(true);
        let dati = controllo.0.lock().expect("stato updater");
        assert!(dati.enabled);
        assert_eq!(dati.phase, FASE_PRONTO);
        assert!(dati.pending.is_none());
        assert!(dati.package.is_none());
    }
}
