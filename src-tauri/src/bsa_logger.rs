use std::path::Path;

const OFFICIAL_MASTER_FILES: [&str; 5] = ["skyrim", "update", "dawnguard", "dragonborn", "hearthfires"];

/// 在调试模式下输出与 BSA fallback 相关的路径信息
pub fn log_bsa_presence(plugin_path: &Path, language: Option<&str>) {
    #[cfg(debug_assertions)]
    {
        let language = language.unwrap_or("english");

        let Some(plugin_dir) = plugin_path.parent() else {
            eprintln!(
                "[BSA] 无法获取插件目录，path = {:?}",
                plugin_path
            );
            return;
        };

        let Some(plugin_name) = plugin_path
            .file_stem()
            .and_then(|s| s.to_str())
        else {
            eprintln!(
                "[BSA] 无法解析插件名称，path = {:?}",
                plugin_path
            );
            return;
        };

        let plugin_name_lower = plugin_name.to_lowercase();
        let is_official = OFFICIAL_MASTER_FILES
            .iter()
            .any(|name| plugin_name_lower == *name);

        let bsa_path = if is_official {
            plugin_dir.join("Skyrim - Interface.bsa")
        } else {
            plugin_dir.join(format!("{}.bsa", plugin_name))
        };

        eprintln!(
            "[BSA] 插件: {} | 语言: {} | 目录: {}",
            plugin_name,
            language,
            plugin_dir.display()
        );
        eprintln!(
            "[BSA] 预期 BSA: {} | 存在: {}",
            bsa_path.display(),
            if bsa_path.exists() { "是" } else { "否" }
        );
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = (plugin_path, language);
    }
}
