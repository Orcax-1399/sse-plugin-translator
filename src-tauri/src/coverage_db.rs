use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Result};
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// 覆盖关系记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageEntry {
    pub form_id: String,
    pub record_type: String,
    pub subrecord_type: String,
    pub index: u32,
    pub text: String,
    pub source_mod: String,
    pub load_order_pos: i64,
    pub extracted_at: i64,
}

/// load order 快照记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadOrderEntry {
    pub position: i64,
    pub plugin_name: String,
    pub plugin_path: Option<String>,
    pub checksum: Option<String>,
    pub extracted_at: i64,
}

/// 覆盖关系数据库
pub struct CoverageDB {
    conn: Arc<Mutex<Connection>>,
}

impl CoverageDB {
    /// 初始化 coverage.db
    pub fn new(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;",
        )?;

        let db = CoverageDB {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS coverage_entries (
                form_id TEXT NOT NULL,
                record_type TEXT NOT NULL,
                subrecord_type TEXT NOT NULL,
                \"index\" INTEGER NOT NULL DEFAULT 0,
                text TEXT NOT NULL,
                source_mod TEXT NOT NULL,
                load_order_pos INTEGER NOT NULL,
                extracted_at INTEGER NOT NULL,
                PRIMARY KEY (form_id, record_type, subrecord_type, \"index\")
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS coverage_load_order (
                position INTEGER PRIMARY KEY,
                plugin_name TEXT NOT NULL UNIQUE,
                plugin_path TEXT,
                checksum TEXT,
                extracted_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS coverage_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        Ok(())
    }

    /// 覆盖插入/更新单条记录
    pub fn upsert_entry(&self, entry: CoverageEntry) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO coverage_entries
                (form_id, record_type, subrecord_type, \"index\", text,
                 source_mod, load_order_pos, extracted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(form_id, record_type, subrecord_type, \"index\")
             DO UPDATE SET
                text = excluded.text,
                source_mod = excluded.source_mod,
                load_order_pos = excluded.load_order_pos,
                extracted_at = excluded.extracted_at",
            params![
                entry.form_id,
                entry.record_type,
                entry.subrecord_type,
                entry.index,
                entry.text,
                entry.source_mod,
                entry.load_order_pos,
                entry.extracted_at
            ],
        )?;
        Ok(())
    }

    /// 事务性批量写入
    pub fn batch_upsert_entries(&self, entries: Vec<CoverageEntry>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;

        for entry in entries {
            tx.execute(
                "INSERT INTO coverage_entries
                    (form_id, record_type, subrecord_type, \"index\", text,
                     source_mod, load_order_pos, extracted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(form_id, record_type, subrecord_type, \"index\")
                 DO UPDATE SET
                    text = excluded.text,
                    source_mod = excluded.source_mod,
                    load_order_pos = excluded.load_order_pos,
                    extracted_at = excluded.extracted_at",
                params![
                    entry.form_id,
                    entry.record_type,
                    entry.subrecord_type,
                    entry.index,
                    entry.text,
                    entry.source_mod,
                    entry.load_order_pos,
                    entry.extracted_at
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// 用新的快照替换 load order 表
    pub fn replace_load_order_snapshot(&self, entries: &[LoadOrderEntry]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;

        tx.execute("DELETE FROM coverage_load_order", [])?;

        for entry in entries {
            tx.execute(
                "INSERT INTO coverage_load_order (position, plugin_name, plugin_path, checksum, extracted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    entry.position,
                    entry.plugin_name,
                    entry.plugin_path,
                    entry.checksum,
                    entry.extracted_at
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// 读取 load order 快照
    pub fn get_load_order_snapshot(&self) -> Result<Vec<LoadOrderEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT position, plugin_name, plugin_path, checksum, extracted_at
             FROM coverage_load_order
             ORDER BY position ASC",
        )?;

        let entries = stmt
            .query_map([], |row| {
                Ok(LoadOrderEntry {
                    position: row.get(0)?,
                    plugin_name: row.get(1)?,
                    plugin_path: row.get(2)?,
                    checksum: row.get(3)?,
                    extracted_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    /// 获取最近一次快照时间
    pub fn get_last_snapshot_timestamp(&self) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let ts: Option<Option<i64>> = conn
            .query_row(
                "SELECT MAX(extracted_at) FROM coverage_load_order",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(ts.flatten())
    }

    /// 搜索覆盖记录
    pub fn search_entries(
        &self,
        form_id_query: Option<&str>,
        text_query: Option<&str>,
        limit: u32,
    ) -> Result<Vec<CoverageEntry>> {
        let conn = self.conn.lock().unwrap();

        let mut conditions = Vec::new();
        let mut values: Vec<Value> = Vec::new();

        if let Some(form_query) = form_id_query.filter(|s| !s.trim().is_empty()) {
            conditions.push("LOWER(form_id) LIKE ?");
            values.push(Value::Text(format!(
                "%{}%",
                form_query.to_lowercase()
            )));
        }

        let mut relevance_patterns: Option<(String, String, String)> = None;

        if let Some(text_query) = text_query.filter(|s| !s.trim().is_empty()) {
            conditions.push("LOWER(text) LIKE ?");
            values.push(Value::Text(format!(
                "%{}%",
                text_query.to_lowercase()
            )));
            let lowered = text_query.to_lowercase();
            relevance_patterns = Some((
                lowered.clone(),
                format!("{}%", lowered),
                format!("%{}%", lowered),
            ));
        }

        let mut sql = "SELECT form_id, record_type, subrecord_type, \"index\", text, source_mod, load_order_pos, extracted_at FROM coverage_entries".to_string();
        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }

        if let Some((exact, prefix, substring)) = relevance_patterns {
            sql.push_str(" ORDER BY CASE WHEN LOWER(text) = ? THEN 4 WHEN LOWER(text) LIKE ? THEN 3 WHEN LOWER(text) LIKE ? THEN 2 ELSE 1 END DESC, load_order_pos DESC, extracted_at DESC LIMIT ?");
            values.push(Value::Text(exact));
            values.push(Value::Text(prefix));
            values.push(Value::Text(substring));
        } else {
            sql.push_str(" ORDER BY extracted_at DESC LIMIT ?");
        }
        values.push(Value::Integer(limit as i64));

        let params = params_from_iter(values.into_iter());
        let mut stmt = conn.prepare(&sql)?;
        let entries = stmt
            .query_map(params, |row| {
                Ok(CoverageEntry {
                    form_id: row.get(0)?,
                    record_type: row.get(1)?,
                    subrecord_type: row.get(2)?,
                    index: row.get(3)?,
                    text: row.get(4)?,
                    source_mod: row.get(5)?,
                    load_order_pos: row.get(6)?,
                    extracted_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }
}
