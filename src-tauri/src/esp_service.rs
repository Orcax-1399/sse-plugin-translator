use esp_extractor::LoadedPlugin;
use crate::translation_db::Translation;
use std::path::Path;
use serde::{Serialize, Deserialize};

/// 基础插件列表常量
const BASE_PLUGINS: &[&str] = &[
    "Skyrim.esm",
    "Update.esm",
    "HearthFires.esm",
    "Dragonborn.esm",
    "Dawnguard.esm",
    "ccQDRSSE001-SurvivalMode.esl",
    "ccBGSSSE037-Curios.esl",
    "ccBGSSSE025-AdvDSGS.esm",
    "ccBGSSSE001-Fish.esm",
];

/// 提取统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionStats {
    /// 总文件数
    pub total_files: usize,
    /// 成功提取的文件数
    pub successful_files: usize,
    /// 失败的文件数
    pub failed_files: usize,
    /// 提取的总字符串数
    pub total_strings: usize,
    /// 跳过的文件列表（未找到）
    pub skipped_files: Vec<String>,
    /// 错误信息列表
    pub errors: Vec<String>,
}

impl ExtractionStats {
    fn new(total_files: usize) -> Self {
        Self {
            total_files,
            successful_files: 0,
            failed_files: 0,
            total_strings: 0,
            skipped_files: Vec::new(),
            errors: Vec::new(),
        }
    }
}

/// 获取基础插件列表
pub fn get_base_plugins() -> Vec<String> {
    BASE_PLUGINS.iter().map(|s| s.to_string()).collect()
}

/// 从单个插件文件提取字符串
///
/// # 参数
/// * `plugin_path` - 插件文件的完整路径
///
/// # 返回
/// * `Ok(Vec<Translation>)` - 成功提取的翻译记录列表
/// * `Err(String)` - 错误信息
pub fn extract_plugin_strings(plugin_path: &Path) -> Result<Vec<Translation>, String> {
    // 使用智能自动加载（自动处理本地化插件）
    let loaded = LoadedPlugin::load_auto(plugin_path.to_path_buf(), Some("chinese"))
        .map_err(|e| format!("加载插件失败: {}", e))?;

    // 提取字符串
    let extracted_strings = loaded.extract_strings();

    // 获取当前时间戳
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    // 提取插件名称
    let plugin_name = plugin_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());

    // 转换为 Translation 结构
    let translations: Vec<Translation> = extracted_strings
        .into_iter()
        .map(|s| Translation {
            form_id: s.form_id,
            record_type: s.record_type,
            subrecord_type: s.subrecord_type,
            editor_id: s.editor_id,
            original_text: s.original_text.clone(),
            // 用户说明 translated_text 是 deprecated 字段，暂时填充相同值以满足 NOT NULL 约束
            translated_text: s.original_text,
            plugin_name: plugin_name.clone(),
            created_at: now,
            updated_at: now,
        })
        .collect();

    Ok(translations)
}

/// 从游戏 Data 目录提取基础插件字典
///
/// # 参数
/// * `data_dir` - 游戏 Data 目录路径
///
/// # 返回
/// * `Ok(ExtractionStats)` - 提取统计信息
/// * `Err(String)` - 致命错误信息
pub fn extract_base_dictionary(data_dir: &Path) -> Result<(Vec<Translation>, ExtractionStats), String> {
    let mut stats = ExtractionStats::new(BASE_PLUGINS.len());
    let mut all_translations = Vec::new();

    for plugin_name in BASE_PLUGINS {
        let plugin_path = data_dir.join(plugin_name);

        // 检查文件是否存在
        if !plugin_path.exists() {
            stats.skipped_files.push(plugin_name.to_string());
            continue;
        }

        // 尝试提取字符串
        match extract_plugin_strings(&plugin_path) {
            Ok(translations) => {
                let count = translations.len();
                stats.successful_files += 1;
                stats.total_strings += count;
                all_translations.extend(translations);

                println!("✅ {} - 提取 {} 条记录", plugin_name, count);
            }
            Err(e) => {
                stats.failed_files += 1;
                let error_msg = format!("{}: {}", plugin_name, e);
                stats.errors.push(error_msg.clone());
                eprintln!("❌ {}", error_msg);
            }
        }
    }

    Ok((all_translations, stats))
}
