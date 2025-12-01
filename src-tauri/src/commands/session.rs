use crate::plugin_session::{PluginSessionManager, PluginStringsResponse, SessionInfo, StringRecord};
use crate::settings::read_settings;
use std::path::PathBuf;
use std::sync::Mutex;

/// 加载插件 Session（自动缓存复用）
#[tauri::command]
pub fn load_plugin_session(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
    plugin_path: String,
) -> Result<PluginStringsResponse, String> {
    let mut manager = session_manager
        .lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    manager.get_or_load(PathBuf::from(plugin_path))
}

/// 关闭插件 Session
#[tauri::command]
pub fn close_plugin_session(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = session_manager
        .lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    manager.close(&session_id)
}

/// 列出所有活跃的 Session
#[tauri::command]
pub fn list_plugin_sessions(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
) -> Result<Vec<SessionInfo>, String> {
    let manager = session_manager
        .lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    Ok(manager.list_sessions())
}

/// 应用翻译到插件文件
#[tauri::command]
pub fn apply_translations(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
    session_id: String,
    translations: Vec<StringRecord>,
    save_as: Option<String>,
) -> Result<String, String> {
    let mut manager = session_manager
        .lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    manager.apply_translations(&session_id, translations, save_as)
}

/// 导出 DSD (Dynamic String Distributor) 格式
#[tauri::command]
pub fn export_dsd(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
    session_id: String,
    records: Vec<StringRecord>,
) -> Result<String, String> {
    let manager = session_manager
        .lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    // 读取设置获取自定义导出目录
    let output_base_dir = read_settings()
        .ok()
        .and_then(|s| s.dsd_output_dir);

    manager.export_dsd(&session_id, records, output_base_dir)
}
