use crate::bsa_logger::log_bsa_presence;
use esp_extractor::{DefaultEspWriter, ExtractedString, LoadedPlugin, PluginEditor};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

/// 字符串记录（前端显示用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StringRecord {
    pub form_id: String,
    pub editor_id: Option<String>,
    pub record_type: String,
    pub subrecord_type: String,
    pub index: u32,
    pub original_text: String,
    pub translated_text: String, // 初始复制 original_text
    #[serde(default = "default_translation_status")]
    pub translation_status: String, // 翻译状态：untranslated/manual/ai
}

/// 默认翻译状态（用于向后兼容）
fn default_translation_status() -> String {
    "untranslated".to_string()
}

/// DSD (Dynamic String Distributor) 导出条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DsdEntry {
    pub form_id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub string: String,
}

/// 插件 Session（使用 Arc 共享数据，减少克隆开销）
pub struct PluginSession {
    pub plugin_name: String,
    pub plugin_path: PathBuf,
    pub strings: Arc<Vec<StringRecord>>,
    pub loaded_at: Instant,
    // Store the loaded plugin to avoid reloading from disk
    // Wrapped in Option because we need to take ownership when applying translations
    pub loaded_plugin: Option<LoadedPlugin>,
}

/// Session 信息（用于列表返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub plugin_name: String,
    pub string_count: usize,
    pub loaded_at: u64, // 使用 u64 因为 Instant 不能序列化
}

/// 加载插件返回的完整响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginStringsResponse {
    pub session_id: String,
    pub plugin_name: String,
    pub plugin_path: String,
    pub strings: Vec<StringRecord>,
    pub total_count: usize,
}

/// Session 管理器
pub struct PluginSessionManager {
    sessions: HashMap<String, PluginSession>,
}

impl PluginSessionManager {
    /// 创建新的 Session 管理器
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// 获取或加载插件 Session
    ///
    /// # 参数
    /// * `plugin_path` - 插件文件的完整路径
    ///
    /// # 返回
    /// * `Ok(PluginStringsResponse)` - Session ID 和字符串数据
    /// * `Err(String)` - 错误信息
    pub fn get_or_load(&mut self, plugin_path: PathBuf) -> Result<PluginStringsResponse, String> {
        // 提取插件名称作为 session_id
        let plugin_name = plugin_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("无效的插件路径")?
            .to_string();

        // 检查缓存
        if let Some(session) = self.sessions.get(&plugin_name) {
            println!("✓ 使用缓存的 Session: {}", plugin_name);
            // ✅ 只克隆 Arc 指向的数据（引用计数增加，不深度复制）
            return Ok(PluginStringsResponse {
                session_id: plugin_name.clone(),
                plugin_name: plugin_name.clone(),
                plugin_path: plugin_path.to_string_lossy().to_string(),
                strings: (*session.strings).clone(), // 只在这里克隆一次
                total_count: session.strings.len(),
            });
        }

        println!("⏳ 加载新的插件 Session: {}", plugin_name);

        // 加载插件（使用智能自动加载）
        log_bsa_presence(&plugin_path, Some("english"));
        let loaded = LoadedPlugin::load_auto(plugin_path.clone(), Some("english"))
            .map_err(|e| format!("加载插件失败: {}", e))?;

        // 提取字符串
        let extracted = loaded.extract_strings();
        println!("✓ 提取到 {} 条字符串", extracted.len());

        // 转换为 StringRecord
        let strings: Vec<StringRecord> = extracted
            .into_iter()
            .map(|s| StringRecord {
                form_id: s.form_id,
                editor_id: s.editor_id,
                record_type: s.record_type,
                subrecord_type: s.subrecord_type,
                index: s.index as u32,
                original_text: s.text.clone(),
                translated_text: s.text, // 初始复制 original_text
                translation_status: "untranslated".to_string(), // 初始状态：未翻译
            })
            .collect();

        let total_count = strings.len();

        // ✅ 将 strings 包装在 Arc 中，支持共享
        let strings_arc = Arc::new(strings);

        // 创建 Session
        let session = PluginSession {
            plugin_name: plugin_name.clone(),
            plugin_path: plugin_path.clone(),
            strings: Arc::clone(&strings_arc),
            loaded_at: Instant::now(),
            loaded_plugin: Some(loaded),
        };

        // 缓存 Session
        self.sessions.insert(plugin_name.clone(), session);
        println!("✓ Session 已缓存: {}", plugin_name);

        Ok(PluginStringsResponse {
            session_id: plugin_name.clone(),
            plugin_name,
            plugin_path: plugin_path.to_string_lossy().to_string(),
            strings: (*strings_arc).clone(), // 只在返回时克隆一次
            total_count,
        })
    }

    /// 关闭指定的 Session
    ///
    /// # 参数
    /// * `session_id` - Session ID（即插件名称）
    ///
    /// # 返回
    /// * `Ok(())` - 成功关闭
    /// * `Err(String)` - Session 不存在
    pub fn close(&mut self, session_id: &str) -> Result<(), String> {
        self.sessions
            .remove(session_id)
            .ok_or_else(|| format!("Session {} 不存在", session_id))?;
        println!("✓ Session 已关闭: {}", session_id);
        Ok(())
    }

    /// 列出所有活跃的 Session
    ///
    /// # 返回
    /// * `Vec<SessionInfo>` - Session 信息列表
    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions
            .iter()
            .map(|(name, session)| {
                let elapsed = session.loaded_at.elapsed().as_secs();
                SessionInfo {
                    session_id: name.clone(),
                    plugin_name: session.plugin_name.clone(),
                    string_count: session.strings.len(),
                    loaded_at: elapsed,
                }
            })
            .collect()
    }

    /// 获取指定 Session 的原文映射（key -> original_text）
    pub fn get_original_string_map(&self, session_id: &str) -> Option<HashMap<String, String>> {
        self.sessions.get(session_id).map(|session| {
            session
                .strings
                .iter()
                .map(|record| {
                    (
                        format!(
                            "{}|{}|{}|{}",
                            record.form_id, record.record_type, record.subrecord_type, record.index
                        ),
                        record.original_text.clone(),
                    )
                })
                .collect()
        })
    }

    /// 应用翻译到插件文件
    ///
    /// # 参数
    /// * `session_id` - Session ID
    /// * `translations` - 翻译记录列表
    /// * `save_as` - 另存为路径（可选，如果为 None 则覆盖原文件）
    ///
    /// # 返回
    /// * `Ok(String)` - 保存的路径
    /// * `Err(String)` - 错误信息
    pub fn apply_translations(
        &mut self,
        session_id: &str,
        translations: Vec<StringRecord>,
        save_as: Option<String>,
    ) -> Result<String, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session {} 不存在", session_id))?;

        let plugin_path = session.plugin_path.clone();
        let timestamp = chrono::Local::now().format("%Y_%m_%d_%H_%M_%S").to_string();
        let target_path = if let Some(ref path) = save_as {
            PathBuf::from(path)
        } else {
            // 备份原文件
            let backup_path = format!("{}.{}.bak", plugin_path.to_string_lossy(), timestamp);
            fs::copy(&plugin_path, &backup_path).map_err(|e| format!("备份文件失败: {}", e))?;
            println!("✓ 已备份原文件: {}", backup_path);
            plugin_path.clone()
        };

        // 当覆盖原文件时，先写入临时文件，写入完成后再替换，避免被内存映射锁住
        let temp_output_path = if save_as.is_none() {
            let mut temp = target_path.clone();
            // e.g. plugin.esp -> plugin.esp.<timestamp>.tmp
            let tmp_ext = format!("{}.tmp", timestamp);
            temp.set_extension(tmp_ext);
            Some(temp)
        } else {
            None
        };

        println!("⏳ 正在应用翻译到: {:?}", target_path);

        // 转换为 ExtractedString (并行处理)
        let extracted_strings: Vec<ExtractedString> = translations
            .par_iter()
            .map(|r| ExtractedString {
                form_id: r.form_id.clone(),
                editor_id: r.editor_id.clone(),
                text: r.translated_text.clone(), // 使用翻译后的文本
                record_type: r.record_type.clone(),
                subrecord_type: r.subrecord_type.clone(),
                index: r.index as i32,
            })
            .collect();

        // 获取 LoadedPlugin (优先使用缓存，否则重新加载)
        let loaded = if let Some(loaded) = session.loaded_plugin.take() {
            println!("✓ 使用 Session 缓存的 LoadedPlugin");
            loaded
        } else {
            println!("⚠️ Session 缓存的 LoadedPlugin 已被使用或不存在，重新加载...");
            log_bsa_presence(&plugin_path, Some("english"));
            LoadedPlugin::load_auto(plugin_path.clone(), Some("english"))
                .map_err(|e| format!("加载插件失败: {}", e))?
        };

        // 使用 PluginEditor 应用翻译
        let mut editor = PluginEditor::new(loaded.into_plugin());

        editor
            .apply_translations(extracted_strings)
            .map_err(|e| format!("应用翻译失败: {}", e))?;

        // 先写入临时文件（若存在），避免直接覆盖被映射的原文件
        let output_path = temp_output_path
            .as_ref()
            .unwrap_or(&target_path)
            .clone();

        editor
            .save(&DefaultEspWriter, output_path.as_path())
            .map_err(|e| format!("保存文件失败: {}", e))?;

        drop(editor);

        // 如果写入临时文件，写入完后再替换原文件
        if let Some(temp_path) = temp_output_path {
            if target_path.exists() {
                fs::remove_file(&target_path)
                    .map_err(|e| format!("替换原文件失败: {}", e))?;
            }
            fs::rename(&temp_path, &target_path)
                .map_err(|e| format!("写入翻译文件失败: {}", e))?;
        }

        Ok(target_path.to_string_lossy().to_string())
    }

    /// 导出 DSD (Dynamic String Distributor) 格式的 JSON 文件
    ///
    /// # 参数
    /// * `session_id` - Session ID
    /// * `records` - 要导出的翻译记录（来自前端）
    /// * `output_base_dir` - 自定义输出基础目录（可选，如果为 None 则使用源文件所在目录）
    ///
    /// # 返回
    /// * `Ok(String)` - 生成的文件路径
    /// * `Err(String)` - 错误信息
    pub fn export_dsd(
        &self,
        session_id: &str,
        records: Vec<StringRecord>,
        output_base_dir: Option<String>,
    ) -> Result<String, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session {} 不存在", session_id))?;

        let plugin_path = &session.plugin_path;

        // 确定基础目录：优先使用自定义目录，否则使用源文件所在目录
        let base_dir = if let Some(ref custom_dir) = output_base_dir {
            PathBuf::from(custom_dir)
        } else {
            plugin_path
                .parent()
                .ok_or("无法获取插件所在目录")?
                .to_path_buf()
        };

        // 获取插件名称（带扩展名，用于目录名）
        let plugin_name_with_ext = &session.plugin_name;

        // 获取插件名称（不带扩展名，用于文件名）
        let plugin_name_without_ext = plugin_path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("无法获取插件名称")?;

        // 构建输出目录：<base_dir>/SKSE/DynamicStringDistributor/<plugin_name>/
        let output_dir = base_dir
            .join("SKSE")
            .join("DynamicStringDistributor")
            .join(plugin_name_with_ext);

        // 创建目录（如果不存在）
        fs::create_dir_all(&output_dir)
            .map_err(|e| format!("创建目录失败: {}", e))?;

        // 构建输出文件路径
        let output_file = output_dir.join(format!("{}.json", plugin_name_without_ext));

        // 转换为 DSD 格式
        let dsd_entries: Vec<DsdEntry> = records
            .into_iter()
            .map(|r| DsdEntry {
                form_id: r.form_id,
                entry_type: format!("{} {}", r.record_type, r.subrecord_type),
                string: r.translated_text,
            })
            .collect();

        // 序列化为 JSON
        let json = serde_json::to_string_pretty(&dsd_entries)
            .map_err(|e| format!("序列化 JSON 失败: {}", e))?;

        // 写入文件
        fs::write(&output_file, json)
            .map_err(|e| format!("写入文件失败: {}", e))?;

        println!("✓ DSD 导出成功: {:?}", output_file);

        Ok(output_file.to_string_lossy().to_string())
    }
}
