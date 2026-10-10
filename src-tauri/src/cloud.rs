use std::sync::atomic::{AtomicBool, Ordering};
pub static SETTINGS_DIRTY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_settings_dirty(dirty: bool) { SETTINGS_DIRTY.store(dirty, Ordering::SeqCst); }

#[tauri::command]
pub fn finish_exit(app: tauri::AppHandle) {
    SETTINGS_DIRTY.store(false, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
pub fn native_cloud_storage() -> bool {
    cfg!(target_os = "macos")
}

#[tauri::command]
pub async fn cloud_storage(command: String, args: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            use std::ffi::{CStr, CString};
            extern "C" {
                fn vibe_cloud_request(request: *const std::os::raw::c_char) -> *mut std::os::raw::c_char;
                fn vibe_cloud_free(response: *mut std::os::raw::c_char);
            }
            let request = CString::new(serde_json::json!({"command": command, "args": args}).to_string())
                .map_err(|e| e.to_string())?;
            // Swift returns an allocated C string, freed exactly once after copying.
            let response = unsafe {
                let ptr = vibe_cloud_request(request.as_ptr());
                if ptr.is_null() { return Err("原生存储未返回结果".to_string()); }
                let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
                vibe_cloud_free(ptr);
                value
            };
            let mut result: serde_json::Value = serde_json::from_str(&response).map_err(|e| e.to_string())?;
            if let Some(error) = result.get("error").and_then(|v| v.as_str()) { return Err(error.to_owned()); }
            Ok(result["value"].take())
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = (command, args); Err("iCloud 仅支持 macOS".into()) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn legacy_review_difficulty_survives_json_bridge() {
        // Native FSRS migration of fizzle out (interval 4) and essence (interval 13).
        // Without float_roundtrip the parser changes each difficulty by one ULP,
        // causing native review-context equality to reject every rating.
        for difficulty in [7.960180622266602_f64, 7.300631901690489_f64] {
            let response =
                format!(r#"{{"value":{{"progress":{{"fsrs":{{"difficulty":{difficulty}}}}}}}}}"#);
            let mut parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
            let state = parsed["value"].take();
            assert_eq!(
                state["progress"]["fsrs"]["difficulty"]
                    .as_f64()
                    .unwrap()
                    .to_bits(),
                difficulty.to_bits()
            );

            let request = serde_json::json!({"command": "review", "args": {"context": {"before": state["progress"]}}}).to_string();
            let decoded: serde_json::Value = serde_json::from_str(&request).unwrap();
            assert_eq!(
                decoded["args"]["context"]["before"]["fsrs"]["difficulty"]
                    .as_f64()
                    .unwrap()
                    .to_bits(),
                difficulty.to_bits()
            );
        }
    }
}
