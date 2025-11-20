// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Simple file logger for debugging startup issues
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("startup.log")
    {
        let _ = writeln!(file, "========== Starting app ==========");
    }

    sse_plugin_translator_lib::run()
}
