use esp_extractor::LoadedPlugin;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

/// 插件 Session（使用 Arc 共享数据，减少克隆开销）
pub struct PluginSession {
    pub plugin_name: String,
    pub plugin_path: PathBuf,
    pub strings: Arc<Vec<StringRecord>>,
    pub loaded_at: Instant,
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
        let loaded = LoadedPlugin::load_auto(plugin_path.clone(), Some("chinese"))
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
}
