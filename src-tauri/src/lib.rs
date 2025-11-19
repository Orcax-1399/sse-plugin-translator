mod api_manage;
mod atomic_db;
mod esp_service;
mod plugin_session;
mod scanner;
mod settings;
mod translation_db;

use api_manage::{ApiConfig, ApiConfigDB};
use atomic_db::{AtomSource, AtomTranslation, AtomicDB};
use esp_service::{extract_base_dictionary, get_base_plugins, ExtractionStats};
use plugin_session::{PluginSessionManager, PluginStringsResponse, SessionInfo, StringRecord};
use scanner::{scan_plugins, validate_game_path, PluginInfo};
use serde::Serialize;
use settings::{read_settings, write_settings, Settings};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use translation_db::{FormIdentifier, Translation, TranslationDB, TranslationStats};

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
    index: u32,
) -> Result<Option<Translation>, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_translation(&form_id, &record_type, &subrecord_type, index)
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
fn clear_all_translations(db: tauri::State<Mutex<TranslationDB>>) -> Result<usize, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.clear_all_translations()
        .map_err(|e| format!("清除所有翻译失败: {}", e))
}

/// 清除基础词典数据（9个官方插件）
#[tauri::command]
fn clear_base_dictionary(db: tauri::State<Mutex<TranslationDB>>) -> Result<usize, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.clear_base_dictionary()
        .map_err(|e| format!("清除基础词典失败: {}", e))
}

// ==================== 插件 Session 管理命令 ====================

/// 加载插件 Session（自动缓存复用）
#[tauri::command]
fn load_plugin_session(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
    plugin_path: String,
) -> Result<PluginStringsResponse, String> {
    use std::path::PathBuf;

    let mut manager = session_manager
        .lock()
        .map_err(|e| format!("Session 管理器锁定失败: {}", e))?;

    manager.get_or_load(PathBuf::from(plugin_path))
}

/// 关闭插件 Session
#[tauri::command]
fn close_plugin_session(
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
fn list_plugin_sessions(
    session_manager: tauri::State<Mutex<PluginSessionManager>>,
) -> Result<Vec<SessionInfo>, String> {
    let manager = session_manager
        .lock()
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

// ==================== 编辑窗口相关命令 ====================

/// 打开编辑窗口
#[tauri::command]
async fn open_editor_window(
    app: tauri::AppHandle,
    editor_data_store: tauri::State<'_, Mutex<HashMap<String, StringRecord>>>,
    record: StringRecord,
) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    // 生成唯一的窗口标签（使用时间戳）
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let window_label = format!("editor-{}", timestamp);

    println!("→ 准备创建编辑窗口: {}", window_label);
    println!("  form_id: {}", record.form_id);

    // ✅ 先存储数据
    {
        match editor_data_store.lock() {
            Ok(mut store) => {
                store.insert(window_label.clone(), record.clone());
                println!("  ✓ 数据已存储到内存");
            }
            Err(e) => {
                println!("  ❌ 锁定数据存储失败: {}", e);
                return Err(format!("锁定数据存储失败: {}", e));
            }
        }
    }

    println!("  → 开始异步创建窗口...");

    // ✅ 直接在异步上下文中创建窗口
    let builder = WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App("/editor".into()))
        .title("编辑翻译")
        .inner_size(900.0, 600.0)
        .resizable(true)
        .center();

    // ✅ 使用 ? 操作符，但立即返回，不阻塞
    match builder.build() {
        Ok(_) => {
            println!("  ✓ 编辑窗口创建成功: {}", window_label);
            Ok(window_label)
        }
        Err(e) => {
            println!("  ❌ 编辑窗口创建失败: {}", e);

            // 清理已存储的数据
            if let Ok(mut store) = editor_data_store.lock() {
                store.remove(&window_label);
            }

            Err(format!("创建编辑窗口失败: {}", e))
        }
    }
}

/// 获取编辑窗口数据（前端准备好后调用）
#[tauri::command]
fn get_editor_data(
    window_label: String,
    editor_data_store: tauri::State<Mutex<HashMap<String, StringRecord>>>,
) -> Result<StringRecord, String> {
    println!("→ 前端请求编辑数据: {}", window_label);

    let record = {
        match editor_data_store.lock() {
            Ok(mut store) => {
                println!("  ✓ 成功锁定数据存储");
                println!("  当前存储的窗口数: {}", store.len());

                // 取出数据并移除（避免内存泄漏）
                match store.remove(&window_label) {
                    Some(rec) => {
                        println!("  ✓ 找到数据 (form_id: {})", rec.form_id);
                        Ok(rec)
                    }
                    None => {
                        println!("  ❌ 未找到窗口数据");
                        println!("  可用的窗口标签: {:?}", store.keys().collect::<Vec<_>>());
                        Err(format!("未找到窗口数据: {}", window_label))
                    }
                }
            }
            Err(e) => {
                println!("  ❌ 锁定数据存储失败: {}", e);
                Err(format!("锁定数据存储失败: {}", e))
            }
        }
    }?;

    println!("✓ 编辑数据已返回: {}", window_label);

    Ok(record)
}

/// 查询单词翻译（用于编辑器参考）
#[tauri::command]
fn query_word_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    text: String,
    limit: usize,
) -> Result<Vec<Translation>, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.query_by_text(&text, limit)
        .map_err(|e| format!("查询单词翻译失败: {}", e))
}

// ==================== 原子数据库相关命令 ====================

/// 打开原子数据库管理窗口
#[tauri::command]
async fn open_atomic_db_window(app: tauri::AppHandle) -> Result<String, String> {
    let window_label = "atomic-db-window";

    // 检查窗口是否已经打开
    if let Some(window) = app.get_webview_window(window_label) {
        // 窗口已存在，聚焦它
        window
            .set_focus()
            .map_err(|e| format!("窗口聚焦失败: {}", e))?;
        return Ok(window_label.to_string());
    }

    // 创建新窗口
    let builder =
        WebviewWindowBuilder::new(&app, window_label, WebviewUrl::App("/atomic-db".into()))
            .title("原子数据库管理")
            .inner_size(1200.0, 800.0)
            .resizable(true)
            .center();

    match builder.build() {
        Ok(_) => Ok(window_label.to_string()),
        Err(e) => Err(format!("创建原子数据库窗口失败: {}", e)),
    }
}

/// 获取所有原子翻译
#[tauri::command]
fn get_all_atoms(atomic_db: tauri::State<Mutex<AtomicDB>>) -> Result<Vec<AtomTranslation>, String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_all_atoms()
        .map_err(|e| format!("获取原子翻译失败: {}", e))
}

/// 添加原子翻译
#[tauri::command]
fn add_atom_translation(
    atomic_db: tauri::State<Mutex<AtomicDB>>,
    original: String,
    translated: String,
    source: String,
) -> Result<(), String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;

    let atom_source = match source.as_str() {
        "base" => AtomSource::Base,
        "ai" => AtomSource::AI,
        _ => AtomSource::Manual,
    };

    db.upsert_atom(&original, &translated, atom_source)
        .map_err(|e| format!("添加原子翻译失败: {}", e))
}

/// 删除原子翻译
#[tauri::command]
fn delete_atom_translation(
    atomic_db: tauri::State<Mutex<AtomicDB>>,
    original: String,
) -> Result<(), String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.delete_atom(&original)
        .map_err(|e| format!("删除原子翻译失败: {}", e))
}

/// 使用原子库替换文本
#[tauri::command]
fn replace_text_with_atoms(
    atomic_db: tauri::State<Mutex<AtomicDB>>,
    text: String,
) -> Result<String, String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    Ok(db.replace_with_atoms(&text))
}

// ==================== API配置管理相关命令 ====================

/// 获取所有API配置
#[tauri::command]
fn get_api_configs(api_db: tauri::State<Mutex<ApiConfigDB>>) -> Result<Vec<ApiConfig>, String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_all_configs()
        .map_err(|e| format!("获取API配置失败: {}", e))
}

/// 创建新的API配置
#[tauri::command]
fn create_api_config(
    api_db: tauri::State<Mutex<ApiConfigDB>>,
    name: String,
) -> Result<i64, String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.create_config(name)
        .map_err(|e| format!("创建API配置失败: {}", e))
}

/// 更新API配置
#[tauri::command]
fn update_api_config(
    api_db: tauri::State<Mutex<ApiConfigDB>>,
    id: i64,
    config: ApiConfig,
) -> Result<(), String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.update_config(id, &config)
        .map_err(|e| format!("更新API配置失败: {}", e))
}

/// 删除API配置
#[tauri::command]
fn delete_api_config(api_db: tauri::State<Mutex<ApiConfigDB>>, id: i64) -> Result<(), String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.delete_config(id)
        .map_err(|e| format!("删除API配置失败: {}", e))
}

/// 激活指定的API配置
#[tauri::command]
fn activate_api_config(api_db: tauri::State<Mutex<ApiConfigDB>>, id: i64) -> Result<(), String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.activate_config(id)
        .map_err(|e| format!("激活API配置失败: {}", e))
}

/// 获取当前激活的API配置
#[tauri::command]
fn get_current_api(api_db: tauri::State<Mutex<ApiConfigDB>>) -> Result<Option<ApiConfig>, String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_current_config()
        .map_err(|e| format!("获取当前API配置失败: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化翻译数据库
    let db_path = get_db_path();
    let translation_db = TranslationDB::new(db_path).expect("无法初始化翻译数据库");

    // 初始化原子数据库
    let atomic_db_path = get_atomic_db_path();
    let atomic_db = AtomicDB::new(atomic_db_path.to_str().expect("路径转换失败"))
        .expect("无法初始化原子数据库");

    // 初始化API配置数据库
    let api_db_path = get_api_db_path();
    let api_db = ApiConfigDB::new(api_db_path.to_str().expect("路径转换失败"))
        .expect("无法初始化API配置数据库");

    // 初始化插件 Session 管理器
    let session_manager = PluginSessionManager::new();

    // 初始化编辑窗口数据存储（用于窗口间数据传递）
    let editor_data_store: Mutex<HashMap<String, StringRecord>> = Mutex::new(HashMap::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(translation_db))
        .manage(Mutex::new(atomic_db))
        .manage(Mutex::new(api_db))
        .manage(Mutex::new(session_manager))
        .manage(editor_data_store)
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
            clear_base_dictionary,
            load_plugin_session,
            close_plugin_session,
            list_plugin_sessions,
            get_base_plugins_list,
            extract_dictionary,
            open_editor_window,
            get_editor_data,
            query_word_translations,
            open_atomic_db_window,
            get_all_atoms,
            add_atom_translation,
            delete_atom_translation,
            replace_text_with_atoms,
            get_api_configs,
            create_api_config,
            update_api_config,
            delete_api_config,
            activate_api_config,
            get_current_api
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
        std::fs::create_dir_all(&userdata_dir).expect("无法创建userdata目录");
    }

    userdata_dir.join("translations.db")
}

/// 获取原子数据库文件路径
fn get_atomic_db_path() -> std::path::PathBuf {
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
        std::fs::create_dir_all(&userdata_dir).expect("无法创建userdata目录");
    }

    userdata_dir.join("atomic_translations.db")
}

/// 获取API配置数据库文件路径
fn get_api_db_path() -> std::path::PathBuf {
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
        std::fs::create_dir_all(&userdata_dir).expect("无法创建userdata目录");
    }

    userdata_dir.join("api.db")
}
