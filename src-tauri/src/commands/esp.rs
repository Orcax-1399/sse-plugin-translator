use crate::esp_service::{extract_base_dictionary, get_base_plugins, ExtractionStats};
use crate::translation_db::TranslationDB;
use std::path::Path;
use std::sync::Mutex;

/// 获取基础插件列表
#[tauri::command]
pub fn get_base_plugins_list() -> Vec<String> {
    get_base_plugins()
}

/// 从游戏 Data 目录提取基础字典
#[tauri::command]
pub fn extract_dictionary(
    db: tauri::State<Mutex<TranslationDB>>,
    data_dir: String,
) -> Result<ExtractionStats, String> {
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
