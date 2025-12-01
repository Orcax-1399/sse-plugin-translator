use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 应用配置结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    /// 游戏路径（可选）
    pub game: Option<String>,
    /// DSD 导出目录（可选，如果未设置则使用源文件所在目录）
    #[serde(default)]
    pub dsd_output_dir: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            game: None,
            dsd_output_dir: None,
        }
    }
}

/// 获取settings.json文件路径
/// 开发模式：项目根目录
/// 生产模式：可执行文件同级目录
fn get_settings_path() -> Result<PathBuf, String> {
    // 获取当前可执行文件路径
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("无法获取可执行文件路径: {}", e))?;

    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "无法获取可执行文件目录".to_string())?;

    // 开发模式检测：如果在 target/debug 或 target/release 目录下，则使用项目根目录
    let settings_dir = if exe_dir.ends_with("debug") || exe_dir.ends_with("release") {
        // 向上两级：target/debug -> target -> project_root
        exe_dir
            .parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| "无法定位项目根目录".to_string())?
    } else {
        // 生产模式：直接使用可执行文件目录
        exe_dir
    };

    Ok(settings_dir.join("settings.json"))
}

/// 读取配置文件
pub fn read_settings() -> Result<Settings, String> {
    let settings_path = get_settings_path()?;

    if !settings_path.exists() {
        // 如果文件不存在，返回默认配置
        return Ok(Settings::default());
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let settings: Settings = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(settings)
}

/// 写入配置文件
pub fn write_settings(settings: &Settings) -> Result<(), String> {
    let settings_path = get_settings_path()?;

    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&settings_path, content)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_default() {
        let settings = Settings::default();
        assert_eq!(settings.game, None);
    }

    #[test]
    fn test_settings_serialization() {
        let settings = Settings {
            game: Some("C:/Games/Skyrim".to_string()),
        };

        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: Settings = serde_json::from_str(&json).unwrap();

        assert_eq!(settings.game, deserialized.game);
    }
}
