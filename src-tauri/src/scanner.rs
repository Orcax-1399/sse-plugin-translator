use serde::Serialize;
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::fs;
use walkdir::WalkDir;

/// 插件信息结构
#[derive(Debug, Serialize, Clone)]
pub struct PluginInfo {
    /// 插件文件名（不含路径）
    pub name: String,
    /// 插件完整路径
    pub path: String,
}

/// 验证路径是否有效（支持文件夹或单个插件文件）
///
/// - 如果是文件：检查是否为 .esp/.esm/.esl 插件文件
/// - 如果是文件夹：检查 {path}/Data/Skyrim.esm 是否存在
pub fn validate_game_path(path: &str) -> Result<bool, String> {
    let game_path = PathBuf::from(path);

    if !game_path.exists() {
        return Ok(false);
    }

    // 情况1：路径是单个插件文件
    if game_path.is_file() {
        if let Some(ext) = game_path.extension() {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            // 验证是否为有效的插件文件扩展名
            return Ok(ext_lower == "esp" || ext_lower == "esm" || ext_lower == "esl");
        }
        return Ok(false);
    }

    // 情况2：路径是游戏目录
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

/// 检测 Skyrim 版本（SE 或 VR）
fn detect_skyrim_version(game_path: &Path) -> Option<&'static str> {
    // 检查 SkyrimSE.exe
    if find_file_case_insensitive(game_path, "SkyrimSE.exe").is_some() {
        return Some("Skyrim Special Edition");
    }

    // 检查 SkyrimVR.exe
    if find_file_case_insensitive(game_path, "SkyrimVR.exe").is_some() {
        return Some("Skyrim VR");
    }

    None
}

/// 获取 loadorder.txt 文件路径
fn get_loadorder_path(version: &str) -> Option<PathBuf> {
    // 获取 %LOCALAPPDATA% 环境变量
    let local_appdata = std::env::var("LOCALAPPDATA").ok()?;
    let mut path = PathBuf::from(local_appdata);

    // 根据版本选择文件夹
    path.push(version);
    path.push("loadorder.txt");

    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// 读取并解析 loadorder.txt
/// 返回插件名称列表（按加载顺序）
fn parse_loadorder(loadorder_path: &Path) -> Result<Vec<String>, String> {
    let content = fs::read_to_string(loadorder_path)
        .map_err(|e| format!("读取 loadorder.txt 失败: {}", e))?;

    let plugins: Vec<String> = content
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#')) // 跳过注释和空行
        .map(|line| line.to_string())
        .collect();

    Ok(plugins)
}

/// 读取 loadorder.txt（如果存在）并返回插件名称列表
pub fn read_loadorder(game_path: &Path, log: bool) -> Option<Vec<String>> {
    if !game_path.is_dir() {
        return None;
    }

    let version = detect_skyrim_version(game_path);

    if let Some(version) = version {
        if let Some(loadorder_path) = get_loadorder_path(version) {
            match parse_loadorder(&loadorder_path) {
                Ok(order) => {
                    if log {
                        println!("✓ 成功读取 loadorder.txt ({} 个插件)", order.len());
                    }
                    Some(order)
                }
                Err(e) => {
                    if log {
                        println!("⚠ 读取 loadorder.txt 失败: {}", e);
                    }
                    None
                }
            }
        } else {
            if log {
                println!("⚠ 未找到 loadorder.txt ({})", version);
            }
            None
        }
    } else {
        if log {
            println!("⚠ 无法检测 Skyrim 版本，使用字母顺序");
        }
        None
    }
}

/// 扫描插件文件（支持文件夹或单个文件）
///
/// - 如果是单个插件文件：直接返回该文件
/// - 如果是游戏目录：返回所有 .esp, .esm, .esl 文件，按照 loadorder.txt 的顺序排列
pub fn scan_plugins(game_path: &str) -> Result<Vec<PluginInfo>, String> {
    let game_path = PathBuf::from(game_path);

    // 情况1：路径是单个插件文件
    if game_path.is_file() {
        if let Some(ext) = game_path.extension() {
            let ext_lower = ext.to_string_lossy().to_lowercase();

            if ext_lower == "esp" || ext_lower == "esm" || ext_lower == "esl" {
                let name = game_path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                let full_path = game_path
                    .to_string_lossy()
                    .to_string();

                println!("✓ 单文件模式: {}", name);

                return Ok(vec![PluginInfo {
                    name,
                    path: full_path,
                }]);
            }
        }
        return Err("不是有效的插件文件".to_string());
    }

    // 情况2：路径是游戏目录，扫描所有插件
    // 查找 Data 目录
    let data_dir = find_data_dir(&game_path)?
        .ok_or_else(|| "未找到 Data 目录".to_string())?;

    // 1. 收集所有插件文件
    let mut all_plugins = HashMap::new();

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

                all_plugins.insert(name.clone(), PluginInfo {
                    name,
                    path: full_path,
                });
            }
        }
    }

    // 2. 检测 Skyrim 版本并读取 loadorder.txt
    let loadorder = read_loadorder(&game_path, true);

    // 3. 按照 loadorder.txt 的顺序排列插件
    let mut result = Vec::new();
    let mut used_plugins = std::collections::HashSet::new();

    if let Some(loadorder) = loadorder {
        // 先按 loadorder.txt 的顺序添加插件
        for plugin_name in loadorder {
            if let Some(plugin_info) = all_plugins.get(&plugin_name) {
                result.push(plugin_info.clone());
                used_plugins.insert(plugin_name);
            }
        }
    }

    // 添加不在 loadorder.txt 中的插件（按字母顺序）
    let mut remaining: Vec<_> = all_plugins
        .into_iter()
        .filter(|(name, _)| !used_plugins.contains(name))
        .map(|(_, info)| info)
        .collect();

    remaining.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result.extend(remaining);

    Ok(result)
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
