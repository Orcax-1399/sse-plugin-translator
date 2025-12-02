use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// DSD (Dynamic String Distributor) JSON 条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DsdEntry {
    pub form_id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub string: String,
}

/// 按约定构建 DSD JSON 文件路径
///
/// - 当 `base_dir_override` 存在时：`<base_dir_override>/SKSE/DynamicStringDistributor/<plugin_filename>/<plugin_stem>.json`
/// - 否则：使用插件所在目录作为 base dir
pub fn build_dsd_json_path(
    plugin_path: &Path,
    base_dir_override: Option<&Path>,
) -> Result<PathBuf, String> {
    let base_dir = if let Some(dir) = base_dir_override {
        dir.to_path_buf()
    } else {
        plugin_path
            .parent()
            .ok_or_else(|| "无法获取插件所在目录".to_string())?
            .to_path_buf()
    };

    let plugin_name_with_ext = plugin_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无法获取插件文件名".to_string())?;
    let plugin_name_without_ext = plugin_path
        .file_stem()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无法获取插件名称".to_string())?;

    Ok(base_dir
        .join("SKSE")
        .join("DynamicStringDistributor")
        .join(plugin_name_with_ext)
        .join(format!("{}.json", plugin_name_without_ext)))
}

/// 载入 DSD JSON 覆盖内容（若存在）。MO2 环境下直接读取插件所在目录旁的 SKSE/DynamicStringDistributor/<插件名>/ 下的所有 JSON。
pub fn load_dsd_overrides(plugin_path: &Path) -> Result<Option<HashMap<String, String>>, String> {
    let plugin_dir = plugin_path
        .parent()
        .ok_or_else(|| "无法获取插件所在目录".to_string())?;
    let plugin_name_with_ext = plugin_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无法获取插件文件名".to_string())?;

    let dsd_dir = plugin_dir
        .join("SKSE")
        .join("DynamicStringDistributor")
        .join(plugin_name_with_ext);

    if !dsd_dir.exists() || !dsd_dir.is_dir() {
        return Ok(None);
    }

    let mut overrides = HashMap::new();
    let mut processed_files = 0;

    for entry in fs::read_dir(&dsd_dir)
        .map_err(|e| format!("读取 DSD 目录失败 ({}): {}", dsd_dir.display(), e))?
    {
        let entry = entry.map_err(|e| format!("遍历 DSD 目录失败: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_json = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        if !is_json {
            continue;
        }

        processed_files += 1;
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("读取 DSD 文件失败 ({}): {}", path.display(), e))?;
        let entries: Vec<DsdEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("解析 DSD 文件失败 ({}): {}", path.display(), e))?;

        for entry in entries {
            if let Some((record_type, subrecord_type)) = parse_entry_type(&entry.entry_type) {
                let key = make_record_key(&entry.form_id, &record_type, &subrecord_type);
                overrides.insert(key, entry.string);
            } else {
                eprintln!(
                    "⚠️ 无法解析 DSD 类型字段: '{}' (form_id={}; 文件:{})",
                    entry.entry_type,
                    entry.form_id,
                    path.display()
                );
            }
        }
    }

    if processed_files == 0 {
        return Ok(None);
    }

    Ok(Some(overrides))
}

/// 构建唯一 key，供 hashmap 使用
pub fn make_record_key(form_id: &str, record_type: &str, subrecord_type: &str) -> String {
    format!("{}|{}|{}", form_id, record_type, subrecord_type)
}

/// 将 DSD 条目导出为 JSON 文件，并返回最终文件路径
pub fn export_dsd_entries(
    plugin_path: &Path,
    entries: &[DsdEntry],
    base_dir_override: Option<&Path>,
) -> Result<PathBuf, String> {
    let output_file = build_dsd_json_path(plugin_path, base_dir_override)?;
    let parent_dir = output_file
        .parent()
        .ok_or_else(|| "无法确定 DSD 输出目录".to_string())?;

    fs::create_dir_all(parent_dir)
        .map_err(|e| format!("创建目录失败 ({}): {}", parent_dir.display(), e))?;

    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("序列化 JSON 失败: {}", e))?;

    fs::write(&output_file, json)
        .map_err(|e| format!("写入 DSD 文件失败 ({}): {}", output_file.display(), e))?;

    Ok(output_file)
}

fn parse_entry_type(entry_type: &str) -> Option<(String, String)> {
    let mut parts = entry_type.split_whitespace();
    let record_type = parts.next()?;
    let subrecord_type = parts.next()?;
    Some((record_type.to_string(), subrecord_type.to_string()))
}
