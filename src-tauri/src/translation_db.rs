use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// 翻译记录数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Translation {
    pub form_id: String,
    pub record_type: String,
    pub subrecord_type: String,
    pub editor_id: Option<String>,
    pub original_text: String,
    pub translated_text: String,
    pub plugin_name: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 翻译统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationStats {
    pub total_count: i64,
    pub plugin_counts: Vec<PluginCount>,
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCount {
    pub plugin_name: String,
    pub count: i64,
}

/// Form标识符，用于批量查询
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormIdentifier {
    pub form_id: String,
    pub record_type: String,
    pub subrecord_type: String,
}

/// 翻译数据库管理器
pub struct TranslationDB {
    conn: Arc<Mutex<Connection>>,
}

impl TranslationDB {
    /// 初始化数据库连接
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // 启用WAL模式以支持并发（使用 execute_batch 避免返回结果的问题）
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;"
        )?;

        let db = TranslationDB {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.init_tables()?;
        Ok(db)
    }

    /// 创建表和索引
    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // 创建translations表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS translations (
                form_id TEXT NOT NULL,
                record_type TEXT NOT NULL,
                subrecord_type TEXT NOT NULL,
                editor_id TEXT,
                original_text TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                plugin_name TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (form_id, record_type, subrecord_type)
            )",
            [],
        )?;

        // 创建索引以优化查询性能
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_plugin_name ON translations(plugin_name)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_updated_at ON translations(updated_at)",
            [],
        )?;

        Ok(())
    }

    /// 保存单条翻译（UPSERT）
    pub fn save_translation(&self, translation: Translation) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO translations
                (form_id, record_type, subrecord_type, editor_id, original_text,
                 translated_text, plugin_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(form_id, record_type, subrecord_type)
             DO UPDATE SET
                translated_text = excluded.translated_text,
                updated_at = excluded.updated_at
                -- ⚠️ 注意：original_text 不被更新，防止已汉化源文件污染英文原文",
            params![
                translation.form_id,
                translation.record_type,
                translation.subrecord_type,
                translation.editor_id,
                translation.original_text,
                translation.translated_text,
                translation.plugin_name,
                translation.created_at,
                translation.updated_at,
            ],
        )?;

        Ok(())
    }

    /// 批量保存翻译（使用事务）
    pub fn batch_save_translations(&self, translations: Vec<Translation>) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        let tx = conn.unchecked_transaction()?;

        for translation in translations {
            tx.execute(
                "INSERT INTO translations
                    (form_id, record_type, subrecord_type, editor_id, original_text,
                     translated_text, plugin_name, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(form_id, record_type, subrecord_type)
                 DO UPDATE SET
                    translated_text = excluded.translated_text,
                    updated_at = excluded.updated_at
                    -- ⚠️ 注意：original_text 不被更新，防止已汉化源文件污染英文原文",
                params![
                    translation.form_id,
                    translation.record_type,
                    translation.subrecord_type,
                    translation.editor_id,
                    translation.original_text,
                    translation.translated_text,
                    translation.plugin_name,
                    translation.created_at,
                    translation.updated_at,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// 查询单条翻译
    pub fn get_translation(&self, form_id: &str, record_type: &str, subrecord_type: &str) -> Result<Option<Translation>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT form_id, record_type, subrecord_type, editor_id, original_text,
                    translated_text, plugin_name, created_at, updated_at
             FROM translations
             WHERE form_id = ?1 AND record_type = ?2 AND subrecord_type = ?3"
        )?;

        let result = stmt.query_row(params![form_id, record_type, subrecord_type], |row| {
            Ok(Translation {
                form_id: row.get(0)?,
                record_type: row.get(1)?,
                subrecord_type: row.get(2)?,
                editor_id: row.get(3)?,
                original_text: row.get(4)?,
                translated_text: row.get(5)?,
                plugin_name: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        });

        match result {
            Ok(translation) => Ok(Some(translation)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 批量查询翻译
    pub fn batch_query_translations(&self, forms: Vec<FormIdentifier>) -> Result<Vec<Translation>> {
        self.batch_query_translations_with_progress(forms, |_, _| {})
    }

    /// 批量查询翻译（带进度回调）
    ///
    /// # 参数
    /// - `forms`: Form标识符列表
    /// - `progress_callback`: 进度回调函数 (当前数量, 总数量)
    pub fn batch_query_translations_with_progress<F>(
        &self,
        forms: Vec<FormIdentifier>,
        mut progress_callback: F,
    ) -> Result<Vec<Translation>>
    where
        F: FnMut(usize, usize),
    {
        if forms.is_empty() {
            return Ok(Vec::new());
        }

        let conn = self.conn.lock().unwrap();
        let mut translations = Vec::new();
        let total = forms.len();
        let mut processed = 0;

        // 分批查询（每批最多1000条）
        for chunk in forms.chunks(1000) {
            let placeholders: Vec<String> = chunk
                .iter()
                .map(|_| "(?, ?, ?)".to_string())
                .collect();
            let placeholders_str = placeholders.join(", ");

            let query = format!(
                "SELECT form_id, record_type, subrecord_type, editor_id, original_text,
                        translated_text, plugin_name, created_at, updated_at
                 FROM translations
                 WHERE (form_id, record_type, subrecord_type) IN ({})",
                placeholders_str
            );

            let mut stmt = conn.prepare(&query)?;

            let params: Vec<&dyn rusqlite::ToSql> = chunk
                .iter()
                .flat_map(|f| {
                    vec![
                        &f.form_id as &dyn rusqlite::ToSql,
                        &f.record_type as &dyn rusqlite::ToSql,
                        &f.subrecord_type as &dyn rusqlite::ToSql,
                    ]
                })
                .collect();

            let rows = stmt.query_map(params.as_slice(), |row| {
                Ok(Translation {
                    form_id: row.get(0)?,
                    record_type: row.get(1)?,
                    subrecord_type: row.get(2)?,
                    editor_id: row.get(3)?,
                    original_text: row.get(4)?,
                    translated_text: row.get(5)?,
                    plugin_name: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?;

            for row in rows {
                translations.push(row?);
            }

            // 更新进度
            processed += chunk.len();
            progress_callback(processed, total);
        }

        Ok(translations)
    }

    /// 获取统计信息
    pub fn get_statistics(&self) -> Result<TranslationStats> {
        let conn = self.conn.lock().unwrap();

        // 获取总数
        let total_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM translations",
            [],
            |row| row.get(0),
        )?;

        // 获取按plugin分组的统计
        let mut stmt = conn.prepare(
            "SELECT plugin_name, COUNT(*) as count
             FROM translations
             GROUP BY plugin_name
             ORDER BY count DESC"
        )?;

        let plugin_counts = stmt
            .query_map([], |row| {
                Ok(PluginCount {
                    plugin_name: row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "Unknown".to_string()),
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // 获取最后更新时间
        let last_updated: i64 = conn
            .query_row(
                "SELECT MAX(updated_at) FROM translations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(TranslationStats {
            total_count,
            plugin_counts,
            last_updated,
        })
    }

    /// 删除指定插件的所有翻译
    pub fn clear_plugin_translations(&self, plugin_name: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "DELETE FROM translations WHERE plugin_name = ?1",
            params![plugin_name],
        )?;
        Ok(count)
    }

    /// 删除所有翻译（慎用）
    pub fn clear_all_translations(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute("DELETE FROM translations", [])?;
        Ok(count)
    }

    /// 删除基础词典数据（9个官方插件）
    ///
    /// # 说明
    /// 只删除基础插件的翻译数据，保留用户手动翻译的其他插件数据
    /// 适用于重新提取基础词典的场景
    pub fn clear_base_dictionary(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();

        // 基础插件列表（与 esp_service.rs 保持一致）
        let base_plugins = vec![
            "Skyrim.esm",
            "Update.esm",
            "HearthFires.esm",
            "Dragonborn.esm",
            "Dawnguard.esm",
            "ccQDRSSE001-SurvivalMode.esl",
            "ccBGSSSE037-Curios.esl",
            "ccBGSSSE025-AdvDSGS.esm",
            "ccBGSSSE001-Fish.esm",
        ];

        // 构造 IN 查询的占位符
        let placeholders = base_plugins.iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");

        let query = format!("DELETE FROM translations WHERE plugin_name IN ({})", placeholders);

        // 转换为 rusqlite 参数
        let params: Vec<&dyn rusqlite::ToSql> = base_plugins.iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();

        let count = conn.execute(&query, rusqlite::params_from_iter(params))?;
        Ok(count)
    }

    /// 按原文模糊匹配查询翻译（用于单词参考）
    ///
    /// # 参数
    /// - `text`: 要查询的原文（不区分大小写，模糊匹配）
    /// - `limit`: 返回结果数量限制
    ///
    /// # 返回
    /// 按原文长度排序（从短到长）的翻译记录
    pub fn query_by_text(&self, text: &str, limit: usize) -> Result<Vec<Translation>> {
        let conn = self.conn.lock().unwrap();

        // 构造LIKE模糊查询参数（小写 + 通配符）
        let search_pattern = format!("%{}%", text.to_lowercase());

        let mut stmt = conn.prepare(
            "SELECT form_id, record_type, subrecord_type, editor_id, original_text,
                    translated_text, plugin_name, created_at, updated_at
             FROM translations
             WHERE LOWER(original_text) LIKE ?1
             ORDER BY LENGTH(original_text) ASC
             LIMIT ?2"
        )?;

        let translations = stmt
            .query_map(params![search_pattern, limit as i64], |row| {
                Ok(Translation {
                    form_id: row.get(0)?,
                    record_type: row.get(1)?,
                    subrecord_type: row.get(2)?,
                    editor_id: row.get(3)?,
                    original_text: row.get(4)?,
                    translated_text: row.get(5)?,
                    plugin_name: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(translations)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn test_translation_db() -> Result<()> {
        // 使用内存数据库进行测试
        let db = TranslationDB::new(":memory:".into())?;

        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // 测试保存翻译
        let translation = Translation {
            form_id: "00012BB7|Skyrim.esm".to_string(),
            record_type: "WEAP".to_string(),
            subrecord_type: "FULL".to_string(),
            editor_id: Some("IronSword".to_string()),
            original_text: "Iron Sword".to_string(),
            translated_text: "铁剑".to_string(),
            plugin_name: Some("Skyrim.esm".to_string()),
            created_at: now,
            updated_at: now,
        };

        db.save_translation(translation.clone())?;

        // 测试查询翻译
        let result = db.get_translation("00012BB7|Skyrim.esm", "WEAP", "FULL")?;
        assert!(result.is_some());
        assert_eq!(result.unwrap().translated_text, "铁剑");

        // 测试更新翻译
        let updated_translation = Translation {
            translated_text: "钢剑".to_string(),
            updated_at: now + 1,
            ..translation
        };
        db.save_translation(updated_translation)?;

        let result = db.get_translation("00012BB7|Skyrim.esm", "WEAP", "FULL")?;
        assert_eq!(result.unwrap().translated_text, "钢剑");

        // 测试统计
        let stats = db.get_statistics()?;
        assert_eq!(stats.total_count, 1);

        Ok(())
    }
}
