use crate::coverage_db::{CoverageDB, CoverageEntry};
use crate::scanner::{read_loadorder, scan_plugins};
use crate::settings::read_settings;
use crate::utils::load_order::{
    extract_and_store, CoverageExtractionStats, CoverageProgressUpdate,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

// ============================================
// 数据结构定义
// ============================================

#[derive(Debug, Clone, Serialize)]
pub struct LoadOrderDiffItem {
    pub plugin_name: String,
    pub snapshot_position: Option<i64>,
    pub current_position: Option<usize>,
    pub plugin_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoverageStatus {
    pub has_snapshot: bool,
    pub load_order_available: bool,
    pub in_sync: bool,
    pub snapshot_timestamp: Option<i64>,
    pub snapshot_count: usize,
    pub current_count: usize,
    pub missing_plugins: Vec<LoadOrderDiffItem>,
    pub extra_plugins: Vec<LoadOrderDiffItem>,
}

// ============================================
// 事件 Payload 定义
// ============================================

/// 进度事件 payload
#[derive(Debug, Clone, Serialize)]
pub struct CoverageProgressPayload {
    pub current_mod: String,
    pub current_progress: usize,
    pub total: usize,
}

/// 完成事件 payload
#[derive(Debug, Clone, Serialize)]
pub struct CoverageCompletePayload {
    pub success: bool,
    pub stats: Option<CoverageExtractionStats>,
    pub error: Option<String>,
}

// ============================================
// Tauri 命令
// ============================================

/// 打开覆盖数据库管理窗口
#[tauri::command]
pub async fn open_coverage_window(app: tauri::AppHandle) -> Result<String, String> {
    let window_label = "coverage-window";

    // 检查窗口是否已经打开
    if let Some(window) = app.get_webview_window(window_label) {
        window
            .set_focus()
            .map_err(|e| format!("窗口聚焦失败: {}", e))?;
        return Ok(window_label.to_string());
    }

    // 创建新窗口
    let builder =
        WebviewWindowBuilder::new(&app, window_label, WebviewUrl::App("/coverage".into()))
            .title("覆盖数据库管理")
            .inner_size(1200.0, 800.0)
            .resizable(true)
            .additional_browser_args("--disable-gpu --disable-d3d11")
            .center();

    match builder.build() {
        Ok(_) => Ok(window_label.to_string()),
        Err(e) => Err(format!("创建覆盖数据库窗口失败: {}", e)),
    }
}

/// 获取覆盖状态
#[tauri::command]
pub fn get_coverage_status(
    coverage_db: tauri::State<Arc<Mutex<CoverageDB>>>,
) -> Result<CoverageStatus, String> {
    let settings = read_settings()?;
    let game_path = settings
        .game
        .ok_or_else(|| "请先在设置中指定游戏路径".to_string())?;
    let load_order_available = read_loadorder(Path::new(&game_path), false).is_some();
    let current_plugins = scan_plugins(&game_path)?;

    let db = coverage_db
        .lock()
        .map_err(|e| format!("覆盖数据库锁定失败: {}", e))?;

    let snapshot = db
        .get_load_order_snapshot()
        .map_err(|e| format!("读取覆盖数据库快照失败: {}", e))?;
    let snapshot_timestamp = db
        .get_last_snapshot_timestamp()
        .map_err(|e| format!("读取快照时间失败: {}", e))?;

    let mut snapshot_map = HashMap::new();
    for entry in &snapshot {
        snapshot_map.insert(
            entry.plugin_name.clone(),
            (entry.position, entry.plugin_path.clone()),
        );
    }

    let mut current_map = HashMap::new();
    for (idx, plugin) in current_plugins.iter().enumerate() {
        current_map.insert(plugin.name.clone(), (idx, plugin.path.clone()));
    }

    let mut missing_plugins = Vec::new();
    for entry in &snapshot {
        if !current_map.contains_key(&entry.plugin_name) {
            missing_plugins.push(LoadOrderDiffItem {
                plugin_name: entry.plugin_name.clone(),
                snapshot_position: Some(entry.position),
                current_position: None,
                plugin_path: entry.plugin_path.clone(),
            });
        }
    }

    let mut extra_plugins = Vec::new();
    for (name, (idx, path)) in &current_map {
        if !snapshot_map.contains_key(name) {
            extra_plugins.push(LoadOrderDiffItem {
                plugin_name: name.clone(),
                snapshot_position: None,
                current_position: Some(*idx),
                plugin_path: Some(path.clone()),
            });
        }
    }

    let has_snapshot = !snapshot.is_empty();
    let in_sync = has_snapshot
        && missing_plugins.is_empty()
        && extra_plugins.is_empty()
        && snapshot.len() == current_plugins.len();

    Ok(CoverageStatus {
        has_snapshot,
        load_order_available,
        in_sync,
        snapshot_timestamp,
        snapshot_count: snapshot.len(),
        current_count: current_plugins.len(),
        missing_plugins,
        extra_plugins,
    })
}

/// 启动覆盖提取 (异步后台任务，通过事件通知进度)
#[tauri::command]
pub async fn run_coverage_extraction(
    app: tauri::AppHandle,
    coverage_db: tauri::State<'_, Arc<Mutex<CoverageDB>>>,
) -> Result<(), String> {
    // 预检查
    let settings = read_settings()?;
    let game_path = settings
        .game
        .ok_or_else(|| "请先在设置中指定游戏路径".to_string())?;

    if read_loadorder(Path::new(&game_path), false).is_none() {
        return Err(
            "未检测到 loadorder.txt，无法按加载顺序提取。\n请在 Mod 管理器中生成 loadorder.txt 后重试。".to_string(),
        );
    }

    let plugins = scan_plugins(&game_path)?;
    if plugins.is_empty() {
        return Err("未检测到任何插件，无法执行覆盖提取".to_string());
    }

    // 克隆 Arc 以便在后台任务中使用
    let db_arc = coverage_db.inner().clone();

    // 启动后台任务
    tauri::async_runtime::spawn(async move {
        // 在阻塞线程中执行提取
        let result = tauri::async_runtime::spawn_blocking(move || {
            let db = match db_arc.lock() {
                Ok(guard) => guard,
                Err(e) => {
                    return Err(format!("覆盖数据库锁定失败: {}", e));
                }
            };

            // 创建进度回调，通过事件发送
            let app_clone = app.clone();
            let callback = move |update: CoverageProgressUpdate| {
                let result = app_clone.emit(
                    "coverage_progress",
                    CoverageProgressPayload {
                        current_mod: update.current_mod.clone(),
                        current_progress: update.current_progress,
                        total: update.total,
                    },
                );
                eprintln!("[DEBUG] coverage_progress emit result: {:?}, mod: {}", result, update.current_mod);
            };

            // 执行提取
            let stats_result = extract_and_store(&db, &plugins, callback);

            // 发送完成事件
            match stats_result {
                Ok(stats) => {
                    let result = app.emit(
                        "coverage_complete",
                        CoverageCompletePayload {
                            success: true,
                            stats: Some(stats),
                            error: None,
                        },
                    );
                    eprintln!("[DEBUG] coverage_complete (success) emit result: {:?}", result);
                    Ok(())
                }
                Err(e) => {
                    let result = app.emit(
                        "coverage_complete",
                        CoverageCompletePayload {
                            success: false,
                            stats: None,
                            error: Some(e.clone()),
                        },
                    );
                    eprintln!("[DEBUG] coverage_complete (error) emit result: {:?}", result);
                    Err(e)
                }
            }
        })
        .await;

        // 处理 spawn_blocking 的 JoinError
        if let Err(e) = result {
            eprintln!("覆盖提取任务异常: {:?}", e);
        }
    });

    // 命令立即返回，不等待提取完成
    Ok(())
}

/// 搜索覆盖记录
#[tauri::command]
pub fn search_coverage_entries(
    coverage_db: tauri::State<Arc<Mutex<CoverageDB>>>,
    form_id_query: Option<String>,
    text_query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<CoverageEntry>, String> {
    let db = coverage_db
        .lock()
        .map_err(|e| format!("覆盖数据库锁定失败: {}", e))?;
    let limit = limit.unwrap_or(200).max(1);

    db.search_entries(form_id_query.as_deref(), text_query.as_deref(), limit)
        .map_err(|e| format!("搜索覆盖数据库失败: {}", e))
}
