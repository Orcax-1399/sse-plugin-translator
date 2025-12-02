use crate::coverage_db::{CoverageDB, CoverageEntry, LoadOrderEntry};
use crate::dsd::{load_dsd_overrides, make_record_key};
use crate::esp_service::extract_plugin_strings;
use crate::scanner::PluginInfo;
use crate::translation_db::Translation;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageExtractionStats {
    pub total_plugins: usize,
    pub processed_plugins: usize,
    pub failed_plugins: usize,
    pub total_records: usize,
    pub errors: Vec<String>,
}

impl CoverageExtractionStats {
    pub fn new(total_plugins: usize) -> Self {
        Self {
            total_plugins,
            processed_plugins: 0,
            failed_plugins: 0,
            total_records: 0,
            errors: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageProgressUpdate {
    pub current_mod: String,
    pub current_progress: usize,
    pub total: usize,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn apply_dsd_overrides_to_translations(
    translations: &mut [Translation],
    overrides: &HashMap<String, String>,
) -> usize {
    let mut applied = 0;
    for translation in translations.iter_mut() {
        let key = make_record_key(
            &translation.form_id,
            &translation.record_type,
            &translation.subrecord_type,
        );
        if let Some(new_value) = overrides.get(&key) {
            if translation.translated_text != *new_value {
                translation.translated_text = new_value.clone();
                applied += 1;
            }
        }
    }
    applied
}

/// 按 load order 依次解包并写入覆盖关系数据库，并在提取后套用 DSD JSON 覆盖
pub fn extract_and_store<F>(
    coverage_db: &CoverageDB,
    plugins: &[PluginInfo],
    mut progress_callback: F,
) -> Result<CoverageExtractionStats, String>
where
    F: FnMut(CoverageProgressUpdate),
{
    coverage_db
        .clear_entries()
        .map_err(|e| format!("清空覆盖数据库失败: {}", e))?;

    let mut stats = CoverageExtractionStats::new(plugins.len());
    let snapshot_ts = now_ts();
    let total_plugins = plugins.len();

    for (idx, plugin) in plugins.iter().enumerate() {
        progress_callback(CoverageProgressUpdate {
            current_mod: plugin.name.clone(),
            current_progress: idx + 1,
            total: total_plugins,
        });
        let path = Path::new(&plugin.path);
        match extract_plugin_strings(path) {
            Ok(mut translations) => {
                if let Some(overrides) = load_dsd_overrides(path)? {
                    let applied =
                        apply_dsd_overrides_to_translations(&mut translations, &overrides);
                    if applied > 0 {
                        println!("✓ {} 套用 {} 条 DSD 覆盖", plugin.name, applied);
                    }
                }

                let load_order_pos = idx as i64;
                let entries: Vec<CoverageEntry> = translations
                    .into_iter()
                    .map(|t| CoverageEntry {
                        form_id: t.form_id,
                        record_type: t.record_type,
                        subrecord_type: t.subrecord_type,
                        index: t.index,
                        text: t.translated_text,
                        source_mod: t
                            .plugin_name
                            .clone()
                            .unwrap_or_else(|| plugin.name.clone()),
                        load_order_pos,
                        extracted_at: snapshot_ts,
                    })
                    .collect();

                let entry_count = entries.len();

                coverage_db
                    .batch_upsert_entries(entries)
                    .map_err(|e| format!("写入覆盖数据库失败: {}", e))?;

                stats.processed_plugins += 1;
                stats.total_records += entry_count;
            }
            Err(err) => {
                stats.failed_plugins += 1;
                stats
                    .errors
                    .push(format!("{}: {}", plugin.name, err));
            }
        }
    }

    let snapshot_entries: Vec<LoadOrderEntry> = plugins
        .iter()
        .enumerate()
        .map(|(idx, plugin)| LoadOrderEntry {
            position: idx as i64,
            plugin_name: plugin.name.clone(),
            plugin_path: Some(plugin.path.clone()),
            checksum: None,
            extracted_at: snapshot_ts,
        })
        .collect();

    coverage_db
        .replace_load_order_snapshot(&snapshot_entries)
        .map_err(|e| format!("更新LoadOrder快照失败: {}", e))?;

    Ok(stats)
}
