use serde::Serialize;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// 插件信息结构
#[derive(Debug, Serialize, Clone)]
pub struct PluginInfo {
    /// 插件文件名（不含路径）
    pub name: String,
    /// 插件完整路径
    pub path: String,
}

/// 验证游戏目录是否有效
/// 检查 {path}/Data/Skyrim.esm 是否存在（大小写不敏感）
pub fn validate_game_path(path: &str) -> Result<bool, String> {
    let game_path = PathBuf::from(path);

    if !game_path.exists() {
        return Ok(false);
    }

    // 检查 Data 目录（大小写不敏感）
    let data_dir = find_data_dir(&game_path)?;

    if data_dir.is_none() {
        return Ok(false);
    }

    let data_dir = data_dir.unwrap();

    // 检查 Skyrim.esm 文件（大小写不敏感）
    let skyrim_esm = find_file_case_insensitive(&data_dir, "Skyrim.esm");

    Ok(skyrim_esm.is_some())
}

/// 扫描插件文件
/// 返回所有 .esp, .esm, .esl 文件
pub fn scan_plugins(game_path: &str) -> Result<Vec<PluginInfo>, String> {
    let game_path = PathBuf::from(game_path);

    // 查找 Data 目录
    let data_dir = find_data_dir(&game_path)?
        .ok_or_else(|| "未找到 Data 目录".to_string())?;

    let mut plugins = Vec::new();

    // 遍历 Data 目录，查找插件文件
    for entry in WalkDir::new(&data_dir)
        .max_depth(1) // 只扫描一级目录
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // 检查文件扩展名
        if let Some(ext) = path.extension() {
            let ext_lower = ext.to_string_lossy().to_lowercase();

            if ext_lower == "esp" || ext_lower == "esm" || ext_lower == "esl" {
                let name = path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                let full_path = path
                    .to_string_lossy()
                    .to_string();

                plugins.push(PluginInfo {
                    name,
                    path: full_path,
                });
            }
        }
    }

    // 按文件名排序
    plugins.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(plugins)
}

/// 查找 Data 目录（大小写不敏感）
fn find_data_dir(base_path: &Path) -> Result<Option<PathBuf>, String> {
    if !base_path.is_dir() {
        return Ok(None);
    }

    // 尝试直接读取目录
    let entries = std::fs::read_dir(base_path)
        .map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            if let Some(dir_name) = path.file_name() {
                if dir_name.to_string_lossy().to_lowercase() == "data" {
                    return Ok(Some(path));
                }
            }
        }
    }

    Ok(None)
}

/// 在目录中查找指定文件（大小写不敏感）
fn find_file_case_insensitive(dir: &Path, file_name: &str) -> Option<PathBuf> {
    let file_name_lower = file_name.to_lowercase();

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    if name.to_string_lossy().to_lowercase() == file_name_lower {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_info_creation() {
        let plugin = PluginInfo {
            name: "TestPlugin.esp".to_string(),
            path: "C:/Games/Skyrim/Data/TestPlugin.esp".to_string(),
        };

        assert_eq!(plugin.name, "TestPlugin.esp");
        assert!(plugin.path.contains("TestPlugin.esp"));
    }
}
