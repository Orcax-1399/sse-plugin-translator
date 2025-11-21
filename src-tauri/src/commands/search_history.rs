use crate::search_history::{SearchHistoryDB, SearchHistoryEntry};
use std::sync::Mutex;

/// 批量保存搜索历史
#[tauri::command]
pub fn save_search_history(
    search_history_db: tauri::State<Mutex<SearchHistoryDB>>,
    entries: Vec<SearchHistoryEntry>,
) -> Result<(), String> {
    let db = search_history_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.batch_upsert(entries)
        .map_err(|e| format!("保存搜索历史失败: {}", e))
}

/// 获取所有搜索历史
#[tauri::command]
pub fn get_search_history(
    search_history_db: tauri::State<Mutex<SearchHistoryDB>>,
) -> Result<Vec<SearchHistoryEntry>, String> {
    let db = search_history_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_all()
        .map_err(|e| format!("获取搜索历史失败: {}", e))
}
