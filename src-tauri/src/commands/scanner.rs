use crate::scanner::{scan_plugins, validate_game_path, PluginInfo};
use crate::settings::read_settings;

/// 验证游戏目录是否有效
#[tauri::command]
pub fn validate_game_directory(path: String) -> Result<bool, String> {
    validate_game_path(&path)
}

/// 获取插件列表
#[tauri::command]
pub fn get_plugin_list() -> Result<Vec<PluginInfo>, String> {
    let settings = read_settings()?;

    match settings.game {
        Some(game_path) => scan_plugins(&game_path),
        None => Err("未设置游戏路径".to_string()),
    }
}
