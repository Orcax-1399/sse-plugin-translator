use crate::bsa_logger::log_bsa_presence;
use crate::constants::BASE_PLUGINS;
use crate::translation_db::Translation;
use esp_extractor::{extract_strings_from_file_fast, ExtractedString};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

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

pub fn extract_strings_for_language(
    plugin_path: &Path,
    language: Option<&str>,
) -> Result<Vec<ExtractedString>, String> {
    extract_strings_from_file_fast(plugin_path.to_path_buf(), language).map_err(|e| e.to_string())
}

/// 从单个插件文件提取字符串（双语版本：英文 + 中文对比）
///
/// # 工作原理
/// 1. 加载英文版（Strings/XXX_English.STRINGS）提取所有字符串作为 original_text
/// 2. 加载中文版（Strings/XXX_Chinese.STRINGS）提取所有字符串作为 translated_text
/// 3. 根据 (form_id, record_type, subrecord_type) 进行匹配
/// 4. 如果中文版没有对应记录，则 translated_text 使用英文（未本地化的情况）
///
/// # 参数
/// * `plugin_path` - 插件文件的完整路径
///
/// # 返回
/// * `Ok(Vec<Translation>)` - 成功提取的翻译记录列表
/// * `Err(String)` - 错误信息
pub fn extract_plugin_strings(plugin_path: &Path) -> Result<Vec<Translation>, String> {
    // 1. 加载英文版
    log_bsa_presence(plugin_path, Some("english"));
    let english_strings = extract_strings_for_language(plugin_path, Some("english"))
        .map_err(|e| format!("加载英文版插件失败: {}", e))?;

    println!("  📖 英文版提取 {} 条记录", english_strings.len());

    // 2. 加载中文版
    log_bsa_presence(plugin_path, Some("chinese"));
    let chinese_strings = extract_strings_for_language(plugin_path, Some("chinese"))
        .map_err(|e| format!("加载中文版插件失败: {}", e))?;

    println!("  📖 中文版提取 {} 条记录", chinese_strings.len());

    // 3. 建立中文映射表 (form_id|record_type|subrecord_type -> chinese_text)
    let mut chinese_map: HashMap<String, String> = HashMap::new();
    for s in chinese_strings {
        let key = format!(
            "{}|{}|{}|{}",
            s.form_id, s.record_type, s.subrecord_type, s.index
        );
        chinese_map.insert(key, s.text);
    }

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

    // 4. 遍历英文记录，查找对应的中文翻译
    let translations: Vec<Translation> = english_strings
        .into_iter()
        .map(|s| {
            let key = format!(
                "{}|{}|{}|{}",
                s.form_id, s.record_type, s.subrecord_type, s.index
            );

            // 查找对应的中文翻译
            let translated_text = chinese_map
                .get(&key)
                .cloned()
                .unwrap_or_else(|| s.text.clone());

            Translation {
                form_id: s.form_id,
                record_type: s.record_type,
                subrecord_type: s.subrecord_type,
                index: s.index as u32,
                editor_id: s.editor_id,
                original_text: s.text, // 英文原文
                translated_text,       // 中文翻译或英文回退
                plugin_name: plugin_name.clone(),
                created_at: now,
                updated_at: now,
            }
        })
        .collect();

    // 统计匹配情况
    let matched_count = translations
        .iter()
        .filter(|t| t.original_text != t.translated_text)
        .count();
    let unmatched_count = translations.len() - matched_count;

    println!(
        "  ✅ 匹配成功 {} 条，未匹配 {} 条",
        matched_count, unmatched_count
    );

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
pub fn extract_base_dictionary(
    data_dir: &Path,
) -> Result<(Vec<Translation>, ExtractionStats), String> {
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
