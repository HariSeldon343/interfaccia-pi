// Interfaccia grafica per l'agente pi.
//
// L'applicazione avvia il ponte (un piccolo server Node che parla con pi in
// modalità RPC), attende che risponda e solo allora mostra la finestra.
// Il ponte e condivisibile fra piu finestre e si spegne da solo quando
// l'ultima interfaccia resta disconnessa per il periodo di grazia.

use std::io::{Error, ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;

const PORTA: u16 = 4666;
const INDIRIZZO: &str = "127.0.0.1:4666";

/// Annota cosa succede durante l'avvio, in un file accanto all'eseguibile.
/// Serve a capire i problemi quando l'applicazione non ha una console.
fn annota(messaggio: &str) {
    if let Ok(mut percorso) = std::env::current_exe() {
        percorso.pop();
        percorso.push("avvio.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(percorso)
        {
            let _ = writeln!(file, "{}", messaggio);
        }
    }
}

/// Conserva l'handle mentre l'app e aperta. Il drop di Child non termina il
/// processo: il bridge gestisce autonomamente l'arresto quando non ha client.
struct Ponte(Mutex<Option<Child>>);

/// Runtime autocontenuto dell'installer. PI resta fuori da `node_modules` a
/// livello dell'entrypoint: il suo comando `update --self` non puo scambiare
/// questa risorsa immutabile per un'installazione npm globale. I pacchetti
/// aggiunti dall'utente continuano invece a vivere nella sua cartella `.pi`.
#[derive(Clone, Debug, Eq, PartialEq)]
struct RuntimePi {
    node: PathBuf,
    cli: PathBuf,
    tools: Option<PathBuf>,
}

fn risposta_ponte_valida(risposta: &[u8]) -> bool {
    let testo = match std::str::from_utf8(risposta) {
        Ok(testo) => testo,
        Err(_) => return false,
    };
    let (intestazioni, corpo) = match testo.split_once("\r\n\r\n") {
        Some(parti) => parti,
        None => return false,
    };
    let stato = intestazioni.lines().next().unwrap_or_default();
    if !(stato.starts_with("HTTP/1.1 200 ") || stato.starts_with("HTTP/1.0 200 ")) {
        return false;
    }
    let dati: serde_json::Value = match serde_json::from_str(corpo) {
        Ok(dati) => dati,
        Err(_) => return false,
    };
    dati.get("servizio").and_then(|v| v.as_str()) == Some("pi-gui-bridge")
        && dati.get("versione").and_then(|v| v.as_u64()).unwrap_or(0) == 6
}

fn leggi_risposta_ponte(stream: &mut TcpStream, limite: Duration) -> bool {
    let scadenza = Instant::now() + limite;
    let mut risposta = Vec::with_capacity(2048);
    let mut pezzo = [0_u8; 1024];
    loop {
        let ora = Instant::now();
        if ora >= scadenza {
            return false;
        }
        let attesa = scadenza
            .saturating_duration_since(ora)
            .min(Duration::from_millis(100));
        let _ = stream.set_read_timeout(Some(attesa));
        match stream.read(&mut pezzo) {
            Ok(0) => return risposta_ponte_valida(&risposta),
            Ok(letti) => {
                if risposta.len() + letti > 8192 {
                    return false;
                }
                risposta.extend_from_slice(&pezzo[..letti]);
                if risposta_ponte_valida(&risposta) {
                    return true;
                }
            }
            Err(errore)
                if errore.kind() == ErrorKind::WouldBlock
                    || errore.kind() == ErrorKind::TimedOut => {}
            Err(_) => return false,
        }
    }
}

/// Sulla porta risponde proprio il nostro ponte (non un servizio qualunque)?
fn ponte_attivo() -> bool {
    let mut stream = match TcpStream::connect_timeout(
        &INDIRIZZO.parse().expect("indirizzo locale valido"),
        Duration::from_millis(400),
    ) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(700)));
    if stream
        .write_all(
            b"GET /api/salute HTTP/1.1\r\nHost: 127.0.0.1:4666\r\nX-Pi-Gui-Client: launcher-tauri\r\nConnection: close\r\n\r\n",
        )
        .is_err()
    {
        return false;
    }
    leggi_risposta_ponte(&mut stream, Duration::from_millis(900))
}

/// Trova il file del ponte, sia durante lo sviluppo sia una volta installato.
fn percorso_ponte(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Una volta installato, il ponte sta fra le risorse dell'applicazione.
    if let Ok(risorse) = app.path().resource_dir() {
        let candidato = risorse.join("app").join("server.mjs");
        if candidato.exists() {
            return Some(candidato);
        }
    }

    // I fallback nel progetto servono solo allo sviluppo. Una build release
    // deve eseguire esclusivamente la risorsa inclusa e verificata nel bundle.
    #[cfg(debug_assertions)]
    {
        // Durante lo sviluppo il ponte sta più in alto nell'albero del progetto.
        // Si risale a partire dall'eseguibile, non dalla cartella di lavoro:
        // quest'ultima dipende da dove l'applicazione è stata lanciata.
        if let Ok(mut qui) = std::env::current_exe() {
            qui.pop(); // togliamo il nome del file
            for _ in 0..6 {
                let candidato = qui.join("app").join("server.mjs");
                if candidato.exists() {
                    return Some(candidato);
                }
                if !qui.pop() {
                    break;
                }
            }
        }

        // Ultimo tentativo: la cartella di lavoro corrente.
        let mut qui = std::env::current_dir().ok()?;
        for _ in 0..4 {
            let candidato = qui.join("app").join("server.mjs");
            if candidato.exists() {
                return Some(candidato);
            }
            if !qui.pop() {
                break;
            }
        }
    }
    None
}

/// Risolve soltanto i due file pubblicati dal bundle, a partire dalla cartella
/// risorse gia determinata da Tauri. Non consulta PATH ne cartelle dell'utente.
fn runtime_pi_bundled_da(risorse: &Path) -> Option<RuntimePi> {
    let nome_node = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let node = risorse.join("runtime").join("node").join(nome_node);
    let cli = risorse
        .join("runtime")
        .join("pi")
        .join("dist")
        .join("cli.js");
    let tools = risorse.join("runtime").join("tools");
    if node.is_file()
        && cli.is_file()
        && tools.join("fd.exe").is_file()
        && tools.join("rg.exe").is_file()
    {
        Some(RuntimePi {
            node,
            cli,
            tools: Some(tools),
        })
    } else {
        None
    }
}

/// Una release installata accetta esclusivamente il runtime vendorizzato. I
/// fallback globali sono compilati solo in debug, per non trasformare per
/// errore una build distribuita in un semplice wrapper dell'ambiente locale.
fn trova_runtime_pi(app: &tauri::AppHandle) -> Option<RuntimePi> {
    if let Ok(risorse) = app.path().resource_dir() {
        if let Some(runtime) = runtime_pi_bundled_da(&risorse) {
            return Some(runtime);
        }
    }

    #[cfg(debug_assertions)]
    {
        return runtime_pi_sviluppo();
    }

    #[cfg(not(debug_assertions))]
    None
}

/// Toglie il prefisso dei percorsi estesi di Windows (`\\?\`).
/// Node non lo digerisce quando deve caricare un modulo, e fallisce in
/// silenzio: il processo parte e muore subito senza dire niente.
fn percorso_semplice(percorso: &Path) -> PathBuf {
    let testo = percorso.to_string_lossy();
    if let Some(pulito) = testo.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", pulito));
    }
    match testo.strip_prefix(r"\\?\") {
        Some(pulito) => PathBuf::from(pulito),
        None => percorso.to_path_buf(),
    }
}

/// Avvia il ponte come processo figlio, senza finestra nera a video.
fn avvia_ponte(percorso: &PathBuf, runtime: &RuntimePi) -> std::io::Result<Child> {
    let pulito = percorso_semplice(percorso);
    let node = percorso_semplice(&runtime.node);
    let cli = percorso_semplice(&runtime.cli);
    if !node.is_file() || !cli.is_file() {
        return Err(Error::new(
            ErrorKind::NotFound,
            "Runtime Node.js o PI non trovato fra le risorse verificate",
        ));
    }
    let mut comando = Command::new(&node);
    comando.arg(&pulito);
    // La finestra Tauri e configurata su 4666: non ereditiamo un override
    // esterno che farebbe ascoltare il figlio su un'altra porta.
    comando.env("PI_GUI_PORT", PORTA.to_string());
    comando.env("PI_GUI_AUTO_STOP_MS", "45000");
    comando.env("PI_GUI_NODE", &node);
    comando.env("PI_GUI_PI_CLI", &cli);
    comando.env("PI_GUI_RUNTIME_BUNDLED", "1");

    // PI completo usa npm per installare i pacchetti nella cartella utente.
    // Preponiamo quindi la directory Node ufficiale inclusa, senza eliminare
    // gli strumenti di sistema o quelli esplicitamente configurati dall'utente.
    if let Some(cartella_node) = node.parent() {
        let mut cartelle = vec![cartella_node.to_path_buf()];
        if let Some(tools) = runtime.tools.as_ref() {
            cartelle.push(percorso_semplice(tools));
        }
        if let Some(path) = std::env::var_os("PATH") {
            cartelle.extend(std::env::split_paths(&path).filter(|voce| voce.is_absolute()));
        }
        if let Ok(path) = std::env::join_paths(cartelle) {
            comando.env("PATH", path);
        }
    }

    if let Some(cartella) = pulito.parent().and_then(|p| p.parent()) {
        comando.current_dir(cartella);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const SENZA_FINESTRA: u32 = 0x0800_0000; // CREATE_NO_WINDOW
        comando.creation_flags(SENZA_FINESTRA);
    }

    comando.spawn()
}

/// Fallback esplicito per `tauri dev` e test locali. Questa funzione non viene
/// compilata nella release installabile.
#[cfg(debug_assertions)]
fn runtime_pi_sviluppo() -> Option<RuntimePi> {
    let node_esplicito = std::env::var("PI_GUI_NODE").ok().map(PathBuf::from);
    let cli_esplicita = std::env::var("PI_GUI_PI_CLI").ok().map(PathBuf::from);
    if let (Some(node), Some(cli)) = (node_esplicito, cli_esplicita) {
        if node.is_absolute() && node.is_file() && cli.is_absolute() && cli.is_file() {
            return Some(RuntimePi {
                node,
                cli,
                tools: None,
            });
        }
    }

    let node = trova_node_sviluppo()?;
    let relativo_cli = PathBuf::from("node_modules")
        .join("@earendil-works")
        .join("pi-coding-agent")
        .join("dist")
        .join("cli.js");
    let mut candidati_cli = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidati_cli.push(PathBuf::from(appdata).join("npm").join(&relativo_cli));
    }
    if let Ok(profilo) = std::env::var("USERPROFILE") {
        let profilo = PathBuf::from(profilo);
        candidati_cli.push(profilo.join(".npm-global").join("lib").join(&relativo_cli));
        candidati_cli.push(profilo.join(".local").join("lib").join(&relativo_cli));
    }
    let cli = candidati_cli
        .into_iter()
        .find(|percorso| percorso.is_file())?;
    Some(RuntimePi {
        node,
        cli,
        tools: None,
    })
}

#[cfg(debug_assertions)]
fn trova_node_sviluppo() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut candidati = Vec::new();
        if let Ok(programmi) = std::env::var("ProgramFiles") {
            candidati.push(PathBuf::from(programmi).join("nodejs").join("node.exe"));
        }
        if let Ok(locale) = std::env::var("LOCALAPPDATA") {
            candidati.push(
                PathBuf::from(locale)
                    .join("Programs")
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
        if let Some(trovato) = candidati.into_iter().find(|percorso| percorso.exists()) {
            return Some(trovato);
        }
    }

    let nome = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    if let Some(path) = std::env::var_os("PATH") {
        for cartella in std::env::split_paths(&path).filter(|voce| voce.is_absolute()) {
            let candidato = cartella.join(nome);
            if candidato.is_file() {
                return Some(candidato);
            }
        }
    }
    None
}

/// Messaggio d'errore mostrato quando manca qualcosa sul computer.
fn pagina_errore(titolo: &str, dettaglio: &str) -> String {
    format!(
        "data:text/html;charset=utf-8,<html><head><meta charset='utf-8'>\
         <title>Interfaccia pi</title></head>\
         <body style='background:%2314161a;color:%23e6e8ec;font-family:Segoe UI,sans-serif;\
         display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>\
         <div style='max-width:480px;text-align:center'>\
         <div style='font-size:44px;color:%234d6ba8'>&%23960;</div>\
         <h1 style='font-size:20px'>{}</h1>\
         <p style='line-height:1.6;color:%239aa1ac'>{}</p>\
         </div></body></html>",
        titolo, dettaglio
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Ponte(Mutex::new(None)))
        .setup(|app| {
            let gestore = app.handle().clone();
            let finestra = app.get_webview_window("main").expect("finestra principale");

            // Se il ponte è già acceso (per esempio avviato a mano), lo riusiamo.
            let mut nostro: Option<Child> = None;

            annota("--- avvio dell'applicazione ---");
            annota(&format!(
                "eseguibile: {:?}",
                std::env::current_exe().unwrap_or_default()
            ));
            let gia_attivo = ponte_attivo();
            annota(&format!("ponte gia attivo: {}", gia_attivo));
            let percorso = if gia_attivo {
                None
            } else {
                let trovato = percorso_ponte(&gestore);
                annota(&format!("percorso del ponte: {:?}", trovato));
                match trovato {
                    Some(percorso) => Some(percorso),
                    None => {
                        let _ = finestra.eval(&format!(
                            "window.location.replace(\"{}\")",
                            pagina_errore(
                                "File del ponte non trovato",
                                "Manca il file app/server.mjs fra le risorse dell'applicazione."
                            )
                        ));
                        let _ = finestra.show();
                        return Ok(());
                    }
                }
            };
            let runtime = if gia_attivo {
                None
            } else {
                let trovato = trova_runtime_pi(&gestore);
                annota(&format!("runtime PI: {:?}", trovato));
                match trovato {
                    Some(runtime) => Some(runtime),
                    None => {
                        let _ = finestra.eval(&format!(
                            "window.location.replace(\"{}\")",
                            pagina_errore(
                                "Runtime PI non trovato",
                                "L'installer e incompleto: mancano Node.js o PI 0.84.2 nelle risorse dell'applicazione. Reinstalla Interfaccia pi con il pacchetto completo."
                            )
                        ));
                        let _ = finestra.show();
                        return Ok(());
                    }
                }
            };

            // Attesa totale di venticinque secondi per un ponte in avvio o una
            // porta che si sta liberando. Una 1.x riconosciuta non viene mai
            // terminata automaticamente: il codice 2 mostra l'istruzione sicura.
            // Se un'altra finestra vince la porta, la riusiamo; se un ponte sta
            // finendo di spegnersi e il figlio termina con EADDRINUSE, ritentiamo.
            let scadenza = Instant::now() + Duration::from_secs(25);
            let mut prossimo_avvio = Instant::now();
            let mut pronto = gia_attivo;
            let mut ponte_legacy_bloccante = false;
            while !pronto && Instant::now() < scadenza {
                if ponte_attivo() {
                    pronto = true;
                    break;
                }

                let terminato = match nostro.as_mut() {
                    Some(figlio) => match figlio.try_wait() {
                        Ok(Some(stato)) => {
                            annota(&format!("ponte terminato durante l'avvio: {}", stato));
                            if stato.code() == Some(2) {
                                ponte_legacy_bloccante = true;
                            }
                            true
                        }
                        Ok(None) => false,
                        Err(errore) => {
                            annota(&format!("errore nel controllo del ponte: {}", errore));
                            // Conserviamo l'handle: se il probe non diventa valido,
                            // il ramo finale potra ancora terminare e attendere il figlio.
                            false
                        }
                    },
                    None => true,
                };
                if terminato {
                    nostro = None;
                }
                if ponte_legacy_bloccante {
                    break;
                }

                if nostro.is_none() && Instant::now() >= prossimo_avvio {
                    match percorso
                        .as_ref()
                        .zip(runtime.as_ref())
                        .map(|(ponte, runtime)| avvia_ponte(ponte, runtime))
                    {
                        Some(Ok(figlio)) => {
                            annota(&format!("ponte avviato, pid {}", figlio.id()));
                            nostro = Some(figlio);
                            prossimo_avvio = Instant::now() + Duration::from_millis(1200);
                        }
                        Some(Err(errore)) => {
                            annota(&format!("ERRORE avvio del ponte: {}", errore));
                            let _ = finestra.eval(&format!(
                                "window.location.replace(\"{}\")",
                                pagina_errore(
                                    "Non riesco ad avviare il ponte",
                                    &format!(
                                        "Il runtime Node.js e PI incluso non e raggiungibile. \
                                         Dettaglio tecnico: {}",
                                        errore
                                    )
                                )
                            ));
                            let _ = finestra.show();
                            return Ok(());
                        }
                        None => break,
                    }
                }
                std::thread::sleep(Duration::from_millis(250));
            }

            // Il ponte puo diventare pronto durante l'ultimo sleep: un probe
            // conclusivo evita di uccidere proprio al confine un figlio sano.
            if !pronto && ponte_attivo() {
                pronto = true;
            }

            if !pronto {
                // Un figlio che non ha mai superato il probe non viene lasciato
                // orfano dietro la pagina di errore. La WebView non e ancora
                // collegata, quindi non puo avere sessioni PI aperte.
                if let Some(mut figlio) = nostro.take() {
                    let _ = figlio.kill();
                    let _ = figlio.wait();
                }
                let _ = finestra.eval(&format!(
                    "window.location.replace(\"{}\")",
                    if ponte_legacy_bloccante {
                        pagina_errore(
                            "Chiudi la vecchia Interfaccia pi",
                            "La versione precedente possiede ancora una sessione o una finestra. \
                             Chiudile e riapri la versione corrente; se la vecchia finestra non esiste più, \
                             riavvia Windows per liberare il ponte senza rischiare la cronologia."
                        )
                    } else {
                        pagina_errore(
                            "Il ponte non risponde",
                            &format!(
                                "Nessuna risposta sulla porta {}. Potrebbe essere occupata da un altro programma.",
                                PORTA
                            )
                        )
                    }
                ));
            } else if let Some(figlio) = nostro {
                *app.state::<Ponte>().0.lock().expect("stato del ponte") = Some(figlio);
            }

            annota(&format!("ponte pronto: {}", pronto));
            if pronto {
                // La finestra parte nascosta su una pagina locale di bootstrap;
                // navighiamo al bridge soltanto dopo averne verificato firma e versione.
                if let Ok(url) = tauri::Url::parse(&format!("http://localhost:{}", PORTA)) {
                    let _ = finestra.navigate(url);
                }
            }
            annota("mostro la finestra");
            let _ = finestra.show();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("avvio dell'applicazione");
}

#[cfg(test)]
mod tests {
    use super::{
        leggi_risposta_ponte, percorso_semplice, risposta_ponte_valida, runtime_pi_bundled_da,
        RuntimePi,
    };
    use std::fs;
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn valida_status_firma_e_versione_del_ponte() {
        let valida = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"servizio\":\"pi-gui-bridge\",\"versione\":6}";
        let vecchia = b"HTTP/1.1 200 OK\r\n\r\n{\"servizio\":\"pi-gui-bridge\",\"versione\":3}";
        let falsa = b"HTTP/1.1 500 Errore\r\n\r\n{\"servizio\":\"pi-gui-bridge\",\"versione\":99}";
        assert!(risposta_ponte_valida(valida));
        assert!(!risposta_ponte_valida(vecchia));
        assert!(!risposta_ponte_valida(falsa));
    }

    #[test]
    fn converte_i_due_formati_di_percorso_esteso_windows() {
        assert_eq!(
            percorso_semplice(Path::new(r"\\?\C:\cartella\server.mjs")),
            PathBuf::from(r"C:\cartella\server.mjs")
        );
        assert_eq!(
            percorso_semplice(Path::new(r"\\?\UNC\server\share\server.mjs")),
            PathBuf::from(r"\\server\share\server.mjs")
        );
    }

    #[test]
    fn il_runtime_bundled_richiede_node_e_cli_nel_layout_dell_installer() {
        let suffisso = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("orologio test")
            .as_nanos();
        let radice = std::env::temp_dir().join(format!(
            "pi-gui-runtime-test-{}-{}",
            std::process::id(),
            suffisso
        ));
        let nome_node = if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        };
        let node = radice.join("runtime").join("node").join(nome_node);
        let cli = radice
            .join("runtime")
            .join("pi")
            .join("dist")
            .join("cli.js");
        let tools = radice.join("runtime").join("tools");
        fs::create_dir_all(node.parent().expect("cartella node")).expect("crea cartella node");
        fs::create_dir_all(cli.parent().expect("cartella cli")).expect("crea cartella cli");
        fs::create_dir_all(&tools).expect("crea cartella tools");

        assert_eq!(runtime_pi_bundled_da(&radice), None);
        fs::write(&node, b"node-test").expect("scrive node test");
        assert_eq!(runtime_pi_bundled_da(&radice), None);
        fs::write(&cli, b"cli-test").expect("scrive cli test");
        assert_eq!(runtime_pi_bundled_da(&radice), None);
        fs::write(tools.join("fd.exe"), b"fd-test").expect("scrive fd test");
        fs::write(tools.join("rg.exe"), b"rg-test").expect("scrive rg test");
        assert_eq!(
            runtime_pi_bundled_da(&radice),
            Some(RuntimePi {
                node: node.clone(),
                cli: cli.clone(),
                tools: Some(tools.clone()),
            })
        );

        fs::remove_dir_all(radice).expect("pulisce runtime test");
    }

    #[test]
    fn il_probe_ha_timeout_totale_e_limite_di_dimensione() {
        let ascoltatore = TcpListener::bind("127.0.0.1:0").expect("porta test");
        let indirizzo = ascoltatore.local_addr().expect("indirizzo test");
        let scrittore = thread::spawn(move || {
            let (mut stream, _) = ascoltatore.accept().expect("connessione test");
            for _ in 0..20 {
                if stream.write_all(b"x").is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(40));
            }
        });
        let mut client = TcpStream::connect(indirizzo).expect("client test");
        let inizio = Instant::now();
        assert!(!leggi_risposta_ponte(
            &mut client,
            Duration::from_millis(140)
        ));
        assert!(inizio.elapsed() < Duration::from_millis(600));
        drop(client);
        scrittore.join().expect("scrittore test");

        let ascoltatore = TcpListener::bind("127.0.0.1:0").expect("porta test");
        let indirizzo = ascoltatore.local_addr().expect("indirizzo test");
        let scrittore = thread::spawn(move || {
            let (mut stream, _) = ascoltatore.accept().expect("connessione test");
            let _ = stream.write_all(&vec![b'x'; 9000]);
        });
        let mut client = TcpStream::connect(indirizzo).expect("client test");
        assert!(!leggi_risposta_ponte(
            &mut client,
            Duration::from_millis(500)
        ));
        scrittore.join().expect("scrittore test");
    }
}
