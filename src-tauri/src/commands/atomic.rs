use crate::atomic_db::{AtomSource, AtomTranslation, AtomicDB};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 打开原子数据库管理窗口
#[tauri::command]
pub async fn open_atomic_db_window(app: tauri::AppHandle) -> Result<String, String> {
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
            .additional_browser_args("--disable-gpu --disable-d3d11")
            .center();

    match builder.build() {
        Ok(_) => Ok(window_label.to_string()),
        Err(e) => Err(format!("创建原子数据库窗口失败: {}", e)),
    }
}

/// 获取所有原子翻译
#[tauri::command]
pub fn get_all_atoms(atomic_db: tauri::State<Mutex<AtomicDB>>) -> Result<Vec<AtomTranslation>, String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_all_atoms()
        .map_err(|e| format!("获取原子翻译失败: {}", e))
}

/// 添加原子翻译
#[tauri::command]
pub fn add_atom_translation(
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
pub fn delete_atom_translation(
    atomic_db: tauri::State<Mutex<AtomicDB>>,
    original: String,
) -> Result<(), String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.delete_atom(&original)
        .map_err(|e| format!("删除原子翻译失败: {}", e))
}

/// 更新原子翻译（根据ID更新译文和来源）
#[tauri::command]
pub fn update_atom_translation(
    atomic_db: tauri::State<Mutex<AtomicDB>>,
    id: i64,
    translated: String,
    source: String,
) -> Result<(), String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;

    let atom_source = match source.as_str() {
        "base" | "Base" => AtomSource::Base,
        "ai" | "AI" => AtomSource::AI,
        _ => AtomSource::Manual,
    };

    db.update_atom(id, &translated, atom_source)
        .map_err(|e| format!("更新原子翻译失败: {}", e))
}

/// 使用原子库替换文本
#[tauri::command]
pub fn replace_text_with_atoms(
    atomic_db: tauri::State<Mutex<AtomicDB>>,
    text: String,
) -> Result<String, String> {
    let db = atomic_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    Ok(db.replace_with_atoms(&text))
}
