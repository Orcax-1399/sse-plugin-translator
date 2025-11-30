mod api_manage;
mod atomic_db;
mod bsa_logger;
mod commands;
mod constants;
mod coverage_db;
mod esp_service;
mod plugin_session;
mod scanner;
mod search_history;
mod settings;
mod translation_db;
mod utils;

use api_manage::ApiConfigDB;
use atomic_db::AtomicDB;
use coverage_db::CoverageDB;
use plugin_session::{PluginSessionManager, StringRecord};
use search_history::SearchHistoryDB;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use translation_db::TranslationDB;
use utils::paths::{
    get_api_db_path, get_atomic_db_path, get_coverage_db_path, get_db_path, get_search_history_db_path,
};

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

    // 初始化搜索历史数据库
    let search_history_db_path = get_search_history_db_path();
    let search_history_db =
        SearchHistoryDB::new(search_history_db_path.to_str().expect("路径转换失败"))
            .expect("无法初始化搜索历史数据库");

    // 初始化覆盖关系数据库 (使用 Arc 以便在后台任务中共享)
    let coverage_db_path = get_coverage_db_path();
    let coverage_db = Arc::new(Mutex::new(
        CoverageDB::new(coverage_db_path).expect("无法初始化覆盖关系数据库"),
    ));

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
        .manage(Mutex::new(search_history_db))
        .manage(coverage_db)
        .manage(Mutex::new(session_manager))
        .manage(editor_data_store)
        .setup(|app| {
            // 创建主窗口
            let window_builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("sse-plugin-translator")
                    .inner_size(1280.0, 800.0)
                    .resizable(true)
                    .center()
                    .additional_browser_args("--disable-gpu --disable-d3d11");

            let _ = window_builder.build();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 配置管理
            commands::get_settings,
            commands::set_game_path,
            commands::clear_game_path,
            // 插件扫描
            commands::validate_game_directory,
            commands::get_plugin_list,
            // 翻译数据库
            commands::save_translation,
            commands::batch_save_translations,
            commands::get_translation,
            commands::batch_query_translations,
            commands::batch_query_translations_with_progress,
            commands::get_translation_statistics,
            commands::clear_plugin_translations,
            commands::clear_all_translations,
            commands::clear_base_dictionary,
            commands::query_word_translations,
            // Session 管理
            commands::load_plugin_session,
            commands::close_plugin_session,
            commands::list_plugin_sessions,
            commands::apply_translations,
            // ESP 对照
            commands::load_esp_reference,
            // ESP 提取
            commands::get_base_plugins_list,
            commands::extract_dictionary,
            // 编辑窗口
            commands::open_editor_window,
            commands::get_editor_data,
            // 原子数据库
            commands::open_atomic_db_window,
            commands::get_all_atoms,
            commands::add_atom_translation,
            commands::delete_atom_translation,
            commands::update_atom_translation,
            commands::replace_text_with_atoms,
            // API 配置
            commands::get_api_configs,
            commands::create_api_config,
            commands::update_api_config,
            commands::delete_api_config,
            commands::activate_api_config,
            commands::get_current_api,
            // 搜索历史
            commands::save_search_history,
            commands::get_search_history,
            commands::delete_search_history_entry,
            // 覆盖关系
            commands::open_coverage_window,
            commands::get_coverage_status,
            commands::run_coverage_extraction,
            commands::search_coverage_entries
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
