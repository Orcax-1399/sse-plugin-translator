use crate::bsa_logger::log_bsa_presence;
use crate::plugin_session::PluginSessionManager;
use esp_extractor::LoadedPlugin;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;

/// 参考记录（ESP 对照的单条翻译）
#[derive(Debug, Clone, Serialize)]
pub struct ReferenceRecord {
    pub form_id: String,
    pub record_type: String,
    pub subrecord_type: String,
    pub index: i32,
    pub original_text: String,
    pub translated_text: String,
}

/// ESP 对照加载成功的 Payload
#[derive(Debug, Clone, Serialize)]
pub struct EspReferencePayload {
    pub session_id: String,
    pub source_plugin_name: String,
    pub total_count: usize,
    pub matched_count: usize,
    pub records: Vec<ReferenceRecord>,
}

/// ESP 对照加载失败的 Payload
#[derive(Debug, Clone, Serialize)]
pub struct EspReferenceErrorPayload {
    pub session_id: String,
    pub error: String,
}

/// 加载 ESP 对照文件
///
/// 从已翻译的 ESP/ESM/ESL 文件中提取翻译，与当前 session 匹配后通过事件返回
///
/// # 参数
/// * `app` - Tauri AppHandle，用于发送事件
/// * `session_manager` - Session 管理器状态
/// * `reference_path` - 参考 ESP 文件路径
/// * `session_id` - 当前 Session ID
#[tauri::command(rename_all = "camelCase")]
pub async fn load_esp_reference(
    app: tauri::AppHandle,
    session_manager: tauri::State<'_, Mutex<PluginSessionManager>>,
    reference_path: String,
    session_id: String,
) -> Result<(), String> {
    println!(
        "⏳ 开始加载 ESP 对照: {} -> {}",
        reference_path, session_id
    );

    // 1. 验证 session 存在
    {
        let manager = session_manager
            .lock()
            .map_err(|e| format!("获取 Session 管理器锁失败: {}", e))?;

        let sessions = manager.list_sessions();
        if !sessions.iter().any(|s| s.session_id == session_id) {
            let error_payload = EspReferenceErrorPayload {
                session_id: session_id.clone(),
                error: format!("Session {} 不存在", session_id),
            };
            let _ = app.emit("esp-reference-error", error_payload);
            return Err(format!("Session {} 不存在", session_id));
        }
    }

    // 2. 加载参考 ESP 文件（英文版 + 中文版）
    let ref_path = PathBuf::from(&reference_path);

    // 获取参考文件名
    let source_plugin_name = ref_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // 加载英文版（原文）
    log_bsa_presence(&ref_path, Some("english"));
    let loaded_en = match LoadedPlugin::load_auto(ref_path.clone(), Some("english")) {
        Ok(p) => p,
        Err(e) => {
            let error_payload = EspReferenceErrorPayload {
                session_id: session_id.clone(),
                error: format!("加载英文版失败: {}", e),
            };
            let _ = app.emit("esp-reference-error", error_payload);
            return Err(format!("加载英文版失败: {}", e));
        }
    };
    let english_strings = loaded_en.extract_strings();
    println!("✓ 英文版提取 {} 条字符串", english_strings.len());

    // 加载中文版（译文）
    log_bsa_presence(&ref_path, Some("chinese"));
    let loaded_zh = match LoadedPlugin::load_auto(ref_path.clone(), Some("chinese")) {
        Ok(p) => p,
        Err(e) => {
            let error_payload = EspReferenceErrorPayload {
                session_id: session_id.clone(),
                error: format!("加载中文版失败: {}", e),
            };
            let _ = app.emit("esp-reference-error", error_payload);
            return Err(format!("加载中文版失败: {}", e));
        }
    };
    let chinese_strings = loaded_zh.extract_strings();
    println!("✓ 中文版提取 {} 条字符串", chinese_strings.len());

    // 3. 构建映射：key -> (original, translated)
    // key = form_id|record_type|subrecord_type|index
    let mut english_map: HashMap<String, String> = HashMap::new();
    for s in english_strings {
        let key = format!(
            "{}|{}|{}|{}",
            s.form_id, s.record_type, s.subrecord_type, s.index
        );
        english_map.insert(key, s.text);
    }

    let mut records: Vec<ReferenceRecord> = Vec::new();
    for s in chinese_strings {
        let key = format!(
            "{}|{}|{}|{}",
            s.form_id, s.record_type, s.subrecord_type, s.index
        );

        // 获取对应的英文原文
        let original_text = english_map.get(&key).cloned().unwrap_or_default();

        // 只保留有实际翻译的记录（中英文不同）
        if !original_text.is_empty() && s.text != original_text {
            records.push(ReferenceRecord {
                form_id: s.form_id,
                record_type: s.record_type,
                subrecord_type: s.subrecord_type,
                index: s.index,
                original_text,
                translated_text: s.text,
            });
        }
    }

    let total_count = records.len();
    let matched_count = records.len(); // 暂时全部返回，前端根据 session 筛选

    println!(
        "✓ 找到 {} 条有效翻译，准备发送到前端",
        total_count
    );

    // 4. 发送成功事件
    let payload = EspReferencePayload {
        session_id,
        source_plugin_name,
        total_count,
        matched_count,
        records,
    };

    app.emit("esp-reference-loaded", payload)
        .map_err(|e| format!("发送事件失败: {}", e))?;

    Ok(())
}
