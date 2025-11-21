use crate::translation_db::{FormIdentifier, Translation, TranslationDB, TranslationStats};
use serde::Serialize;
use std::sync::Mutex;
use tauri::Emitter;

/// 翻译进度通知 Payload
#[derive(Debug, Clone, Serialize)]
pub struct TranslationProgressPayload {
    pub session_id: String,
    pub current: usize,
    pub total: usize,
    pub percentage: f64,
}

/// 保存单条翻译
#[tauri::command]
pub fn save_translation(
    db: tauri::State<Mutex<TranslationDB>>,
    translation: Translation,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.save_translation(translation)
        .map_err(|e| format!("保存翻译失败: {}", e))
}

/// 批量保存翻译
#[tauri::command]
pub fn batch_save_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    translations: Vec<Translation>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.batch_save_translations(translations)
        .map_err(|e| format!("批量保存翻译失败: {}", e))
}

/// 查询单条翻译
#[tauri::command]
pub fn get_translation(
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
pub fn batch_query_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    forms: Vec<FormIdentifier>,
) -> Result<Vec<Translation>, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.batch_query_translations(forms)
        .map_err(|e| format!("批量查询翻译失败: {}", e))
}

/// 批量查询翻译（带进度通知）
#[tauri::command]
pub fn batch_query_translations_with_progress(
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
pub fn get_translation_statistics(
    db: tauri::State<Mutex<TranslationDB>>,
) -> Result<TranslationStats, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_statistics()
        .map_err(|e| format!("获取统计信息失败: {}", e))
}

/// 清除指定插件的翻译
#[tauri::command]
pub fn clear_plugin_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    plugin_name: String,
) -> Result<usize, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.clear_plugin_translations(&plugin_name)
        .map_err(|e| format!("清除插件翻译失败: {}", e))
}

/// 清除所有翻译（慎用）
#[tauri::command]
pub fn clear_all_translations(db: tauri::State<Mutex<TranslationDB>>) -> Result<usize, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.clear_all_translations()
        .map_err(|e| format!("清除所有翻译失败: {}", e))
}

/// 清除基础词典数据（9个官方插件）
#[tauri::command]
pub fn clear_base_dictionary(db: tauri::State<Mutex<TranslationDB>>) -> Result<usize, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.clear_base_dictionary()
        .map_err(|e| format!("清除基础词典失败: {}", e))
}

/// 查询单词翻译（用于编辑器参考）
#[tauri::command]
pub fn query_word_translations(
    db: tauri::State<Mutex<TranslationDB>>,
    text: String,
    limit: usize,
) -> Result<Vec<Translation>, String> {
    let db = db.lock().map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.query_by_text(&text, limit)
        .map_err(|e| format!("查询单词翻译失败: {}", e))
}
