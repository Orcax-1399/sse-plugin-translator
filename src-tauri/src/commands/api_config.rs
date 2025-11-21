use crate::api_manage::{ApiConfig, ApiConfigDB};
use std::sync::Mutex;

/// 获取所有API配置
#[tauri::command]
pub fn get_api_configs(api_db: tauri::State<Mutex<ApiConfigDB>>) -> Result<Vec<ApiConfig>, String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_all_configs()
        .map_err(|e| format!("获取API配置失败: {}", e))
}

/// 创建新的API配置
#[tauri::command]
pub fn create_api_config(
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
pub fn update_api_config(
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
pub fn delete_api_config(api_db: tauri::State<Mutex<ApiConfigDB>>, id: i64) -> Result<(), String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.delete_config(id)
        .map_err(|e| format!("删除API配置失败: {}", e))
}

/// 激活指定的API配置
#[tauri::command]
pub fn activate_api_config(api_db: tauri::State<Mutex<ApiConfigDB>>, id: i64) -> Result<(), String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.activate_config(id)
        .map_err(|e| format!("激活API配置失败: {}", e))
}

/// 获取当前激活的API配置
#[tauri::command]
pub fn get_current_api(api_db: tauri::State<Mutex<ApiConfigDB>>) -> Result<Option<ApiConfig>, String> {
    let db = api_db
        .lock()
        .map_err(|e| format!("数据库锁定失败: {}", e))?;
    db.get_current_config()
        .map_err(|e| format!("获取当前API配置失败: {}", e))
}
