use crate::settings::{read_settings, write_settings, Settings};

/// 获取应用配置
#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    read_settings()
}

/// 设置游戏路径
#[tauri::command]
pub fn set_game_path(path: String) -> Result<(), String> {
    let mut settings = read_settings()?;
    settings.game = Some(path);
    write_settings(&settings)?;
    Ok(())
}

/// 清除游戏路径
#[tauri::command]
pub fn clear_game_path() -> Result<(), String> {
    let mut settings = read_settings()?;
    settings.game = None;
    write_settings(&settings)?;
    Ok(())
}
