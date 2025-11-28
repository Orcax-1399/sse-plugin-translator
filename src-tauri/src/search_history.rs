use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// 搜索历史记录（用于AI学习）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHistoryEntry {
    pub term: String,
    /// 候选翻译列表，JSON序列化存储
    pub candidates: Vec<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// 搜索历史数据库管理器
pub struct SearchHistoryDB {
    conn: Arc<Mutex<Connection>>,
}

impl SearchHistoryDB {
    /// 初始化数据库连接
    pub fn new(db_path: &str) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;

        // 启用WAL模式以支持并发
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;"
        )?;

        let db = SearchHistoryDB {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.init_tables()?;
        Ok(db)
    }

    /// 创建表
    fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS search_history (
                term TEXT PRIMARY KEY,
                candidates TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        Ok(())
    }

    /// 批量保存搜索历史（UPSERT）
    pub fn batch_upsert(&self, entries: Vec<SearchHistoryEntry>) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        for entry in entries {
            let candidates_json = serde_json::to_string(&entry.candidates)
                .unwrap_or_else(|_| "[]".to_string());

            conn.execute(
                "INSERT INTO search_history (term, candidates, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(term) DO UPDATE SET
                    candidates = excluded.candidates,
                    updated_at = excluded.updated_at",
                params![entry.term, candidates_json, now],
            )?;
        }

        Ok(())
    }

    /// 获取所有搜索历史
    pub fn get_all(&self) -> SqliteResult<Vec<SearchHistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT term, candidates, updated_at FROM search_history ORDER BY updated_at DESC"
        )?;

        let entries = stmt.query_map([], |row| {
            let candidates_json: String = row.get(1)?;
            let candidates: Vec<String> = serde_json::from_str(&candidates_json)
                .unwrap_or_default();

            Ok(SearchHistoryEntry {
                term: row.get(0)?,
                candidates,
                updated_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    /// 删除单条搜索历史记录
    pub fn delete_entry(&self, term: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM search_history WHERE term = ?1",
            params![term],
        )?;
        Ok(())
    }
}
