use tauri::Emitter;
use std::sync::atomic::Ordering;
#[cfg(any(not(target_os = "macos"), test))]
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod db;
mod cloud;
mod anki;

#[cfg(not(target_os = "macos"))]
use db::DbState;
#[cfg(not(target_os = "macos"))]
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![cloud::native_cloud_storage, cloud::cloud_storage, cloud::set_settings_dirty, cloud::finish_exit, anki::inspect_anki, anki::cancel_anki]);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.manage(DbState(Mutex::new(db::init_db())))
        .invoke_handler(tauri::generate_handler![
            cloud::native_cloud_storage, cloud::cloud_storage, cloud::set_settings_dirty, cloud::finish_exit,
            db::confirm_ai_draft, db::get_cards, db::save_card, db::update_card, db::replace_regenerated_card, db::delete_card,
            db::get_progress, db::save_progress, db::delete_progress,
            db::get_setting, db::set_setting, db::get_all_settings,
            db::increment_daily_stat, db::get_daily_stats,
        ]);
    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if cloud::SETTINGS_DIRTY.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("vibe-exit-requested", ());
                }
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if cloud::SETTINGS_DIRTY.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("vibe-exit-requested", ());
                }
            }
        });
}
