mod settings;
mod scanner;
mod translation_db;
mod esp_service;
mod plugin_session;

use settings::{Settings, read_settings, write_settings};
use scanner::{PluginInfo, validate_game_path, scan_plugins};
use translation_db::{TranslationDB, Translation, FormIdentifier, TranslationStats};
use esp_service::{ExtractionStats, get_base_plugins, extract_base_dictionary};
use plugin_session::{PluginSessionManager, PluginStringsResponse, SessionInfo};
use std::sync::Mutex;
use serde::Serialize;
use tauri::Emitter;

/// 翻译进度通知 Payload
#[derive(Debug, Clone, Serialize)]
struct TranslationProgressPayload {
    session_id: String,
    current: usize,
    total: usize,
    percentage: f64,
}

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

// ==================== 翻译词典相关命令 ====================

/// 保存单条翻译
#[tauri::command]
fn save_translation(
    db: tauri::State<Mutex<TranslationDB>>,
    translation: Translation,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.save_translation(translation)
        .map_err(|e| format!("保存翻译失败: {}", e))
}

/// 批量保存翻译
#[tauri::command]
fn batch_save_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    translations: Vec<Translation>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.batch_save_translations(translations)
        .map_err(|e| format!("批量保存翻译失败: {}", e))
}

/// 查询单条翻译
#[tauri::command]
fn get_translation(
    db: tauri::State<Mutex<TranslationDB>>,
    form_id: String,
    record_type: String,
    subrecord_type: String,
) -> Result<Option<Translation>, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_translation(&form_id, &record_type, &subrecord_type)
        .map_err(|e| format!("查询翻译失败: {}", e))
}

/// 批量查询翻译
#[tauri::command]
fn batch_query_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    forms: Vec<FormIdentifier>,
) -> Result<Vec<Translation>, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.batch_query_translations(forms)
        .map_err(|e| format!("批量查询翻译失败: {}", e))
}

/// 批量查询翻译（带进度通知）
#[tauri::command]
fn batch_query_translations_with_progress(
    app: tauri::AppHandle,
    db: tauri::State<Mutex<TranslationDB>>,
    session_id: String,
    forms: Vec<FormIdentifier>,
) -> Result<Vec<Translation>, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;

    // 使用闭包捕获 app 和 session_id 来发送进度事件
    let session_id_clone = session_id.clone();
    let result = db.batch_query_translations_with_progress(forms, move |current, total| {
        let percentage = if total > 0 {
            (current as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        let payload = TranslationProgressPayload {
            session_id: session_id_clone.clone(),
            current,
            total,
            percentage,
        };

        // 发送进度事件（忽略发送失败）
        let _ = app.emit("translation_progress", payload);
    });

    result.map_err(|e| format!("批量查询翻译失败: {}", e))
}

/// 获取翻译统计信息
#[tauri::command]
fn get_translation_statistics(
    db: tauri::State<Mutex<TranslationDB>>,
) -> Result<TranslationStats, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_statistics()
        .map_err(|e| format!("获取统计信息失败: {}", e))
}

/// 清除指定插件的翻译
#[tauri::command]
fn clear_plugin_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    plugin_name: String,
) -> Result<usize, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.clear_plugin_translations(&plugin_name)
        .map_err(|e| format!("清除插件翻译失败: {}", e))
}

/// 清除所有翻译（慎用）
#[tauri::command]
fn clear_all_translations(
    db: tauri::State<Mutex<TranslationDB>>,
) -> Result<usize, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.clear_all_translations()
        .map_err(|e| format!("清除所有翻译失败: {}", e))
}

// ==================== 插件 Session 管理命令 ====================

/// 加载插件 Session（自动缓存复用）
#[tauri::command]
fn load_plugin_session(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
    plugin_path: String,
) -> Result<PluginStringsResponse, String> {
    use std::path::PathBuf;

    let mut manager = session_manager.lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    manager.get_or_load(PathBuf::from(plugin_path))
}

/// 关闭插件 Session
#[tauri::command]
fn close_plugin_session(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = session_manager.lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    manager.close(&session_id)
}

/// 列出所有活跃的 Session
#[tauri::command]
fn list_plugin_sessions(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
) -> Result<Vec<SessionInfo>, String> {
    let manager = session_manager.lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    Ok(manager.list_sessions())
}

// ==================== ESP 字典提取相关命令 ====================

/// 获取基础插件列表
#[tauri::command]
fn get_base_plugins_list() -> Vec<String> {
    get_base_plugins()
}

/// 从游戏 Data 目录提取基础字典
#[tauri::command]
fn extract_dictionary(
    db: tauri::State<Mutex<TranslationDB>>,
    data_dir: String,
) -> Result<ExtractionStats, String> {
    use std::path::Path;

    // 提取字符串
    let (translations, stats) = extract_base_dictionary(Path::new(&data_dir))?;

    // 批量保存到数据库
    if !translations.is_empty() {
        let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
        db.batch_save_translations(translations)
            .map_err(|e| format!("保存到数据库失败: {}", e))?;
    }

    Ok(stats)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化翻译数据库
    let db_path = get_db_path();
    let translation_db = TranslationDB::new(db_path)
        .expect("无法初始化翻译数据库");

    // 初始化插件 Session 管理器
    let session_manager = PluginSessionManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(translation_db))
        .manage(Mutex::new(session_manager))
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_game_path,
            validate_game_directory,
            get_plugin_list,
            save_translation,
            batch_save_translations,
            get_translation,
            batch_query_translations,
            batch_query_translations_with_progress,
            get_translation_statistics,
            clear_plugin_translations,
            clear_all_translations,
            load_plugin_session,
            close_plugin_session,
            list_plugin_sessions,
            get_base_plugins_list,
            extract_dictionary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 获取数据库文件路径
fn get_db_path() -> std::path::PathBuf {
    let userdata_dir = if cfg!(debug_assertions) {
        // 开发模式：项目根目录
        std::env::current_dir()
            .expect("无法获取当前目录")
            .join("userdata")
    } else {
        // 生产模式：可执行文件同级目录
        std::env::current_exe()
            .expect("无法获取可执行文件路径")
            .parent()
            .expect("无法获取父目录")
            .join("userdata")
    };

    // 确保userdata目录存在
    if !userdata_dir.exists() {
        std::fs::create_dir_all(&userdata_dir)
            .expect("无法创建userdata目录");
    }

    userdata_dir.join("translations.db")
}
