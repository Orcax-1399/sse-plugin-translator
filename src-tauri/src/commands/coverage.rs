use crate::coverage_db::{CoverageDB, CoverageEntry};
use crate::utils::load_order::{
    extract_and_store, CoverageExtractionStats, CoverageProgressUpdate,
};
use crate::scanner::{read_loadorder, scan_plugins};
use crate::settings::read_settings;
use serde::Serialize;
use std::path::Path;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 打开覆盖数据库管理窗口
#[tauri::command]
pub async fn open_coverage_window(app: tauri::AppHandle) -> Result<String, String> {
    let window_label = "coverage-window";

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

#[derive(Debug, Clone, Serialize, Default)]
pub struct CoverageExtractionProgress {
    pub current_mod: Option<String>,
    pub current_progress: usize,
    pub total: usize,
    pub completed: bool,
}

#[tauri::command]
pub fn get_coverage_status(
    coverage_db: tauri::State<Mutex<CoverageDB>>,
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
        snapshot_map.insert(entry.plugin_name.clone(), (entry.position, entry.plugin_path.clone()));
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

#[tauri::command]
pub fn run_coverage_extraction(
    coverage_db: tauri::State<Mutex<CoverageDB>>,
    progress_state: tauri::State<Mutex<CoverageExtractionProgress>>,
) -> Result<CoverageExtractionStats, String> {
    let settings = read_settings()?;
    let game_path = settings
        .game
        .ok_or_else(|| "请先在设置中指定游戏路径".to_string())?;
    if read_loadorder(Path::new(&game_path), false).is_none() {
        return Err("未检测到 loadorder.txt，无法按加载顺序提取。\n请在 Mod 管理器中生成 loadorder.txt 后重试。".to_string());
    }
    let plugins = scan_plugins(&game_path)?;

    if plugins.is_empty() {
        return Err("未检测到任何插件，无法执行覆盖提取".to_string());
    }

    {
        let mut state = progress_state
            .lock()
            .map_err(|e| format!("进度状态锁定失败: {}", e))?;
        state.total = plugins.len();
        state.current_progress = 0;
        state.current_mod = None;
        state.completed = false;
    }

    let db = coverage_db
        .lock()
        .map_err(|e| format!("覆盖数据库锁定失败: {}", e))?;

    let progress_mutex = progress_state.inner();
    let result = extract_and_store(&db, &plugins, |update: CoverageProgressUpdate| {
        if let Ok(mut state) = progress_mutex.lock() {
            state.current_mod = Some(update.current_mod);
            state.current_progress = update.current_progress;
            state.total = update.total;
            state.completed = false;
        }
    });

    {
        let mut state = progress_mutex
            .lock()
            .map_err(|e| format!("进度状态锁定失败: {}", e))?;
        state.current_mod = None;
        state.current_progress = state.total;
        state.completed = true;
    }

    result
}

#[tauri::command]
pub fn search_coverage_entries(
    coverage_db: tauri::State<Mutex<CoverageDB>>,
    form_id_query: Option<String>,
    text_query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<CoverageEntry>, String> {
    let db = coverage_db
        .lock()
        .map_err(|e| format!("覆盖数据库锁定失败: {}", e))?;
    let limit = limit.unwrap_or(200).max(1);

    db.search_entries(
        form_id_query.as_deref(),
        text_query.as_deref(),
        limit,
    )
    .map_err(|e| format!("搜索覆盖数据库失败: {}", e))
}

#[tauri::command]
pub fn get_coverage_extraction_progress(
    progress_state: tauri::State<Mutex<CoverageExtractionProgress>>,
) -> Result<CoverageExtractionProgress, String> {
    let state = progress_state
        .lock()
        .map_err(|e| format!("进度状态锁定失败: {}", e))?;
    Ok(state.clone())
}
