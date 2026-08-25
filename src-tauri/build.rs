fn main() {
    const COMMANDS: &[&str] = &[
        "updater_status",
        "updater_check",
        "updater_download",
        "updater_install",
    ];

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("configurazione Tauri non valida")
}
