mod settings;
mod scanner;

use settings::{Settings, read_settings, write_settings};
use scanner::{PluginInfo, validate_game_path, scan_plugins};

/// 获取应用配置
#[tauri::command]
fn get_settings() -> Result<Settings, String> {
    read_settings()
}

/// 设置游戏路径
#[tauri::command]
fn set_game_path(path: String) -> Result<(), String> {
    let mut settings = read_settings()?;
    settings.game = Some(path);
    write_settings(&settings)?;
    Ok(())
}

/// 验证游戏目录是否有效
#[tauri::command]
fn validate_game_directory(path: String) -> Result<bool, String> {
    validate_game_path(&path)
}

/// 获取插件列表
#[tauri::command]
fn get_plugin_list() -> Result<Vec<PluginInfo>, String> {
    let settings = read_settings()?;

    match settings.game {
        Some(game_path) => scan_plugins(&game_path),
        None => Err("未设置游戏路径".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_game_path,
            validate_game_directory,
            get_plugin_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
