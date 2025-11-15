use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// API配置数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    pub id: i64,
    pub name: String,
    pub endpoint: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "modelName")]
    pub model_name: String,
    #[serde(rename = "maxTokens")]
    pub max_tokens: i32,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// API配置数据库管理器
pub struct ApiConfigDB {
    conn: Arc<Mutex<Connection>>,
}

impl ApiConfigDB {
    /// 初始化数据库连接
    pub fn new(db_path: &str) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;

        // 启用WAL模式以支持并发
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;"
        )?;

        let db = ApiConfigDB {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.init_tables()?;
        Ok(db)
    }

    /// 创建表和索引
    fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        // 创建api_configs表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS api_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model_name TEXT NOT NULL,
                max_tokens INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // 创建索引以优化查询
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_api_is_active ON api_configs(is_active)",
            [],
        )?;

        Ok(())
    }

    /// 获取所有API配置
    pub fn get_all_configs(&self) -> SqliteResult<Vec<ApiConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, endpoint, api_key, model_name, max_tokens, is_active, created_at, updated_at
             FROM api_configs
             ORDER BY is_active DESC, created_at DESC"
        )?;

        let configs = stmt.query_map([], |row| {
            Ok(ApiConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                endpoint: row.get(2)?,
                api_key: row.get(3)?,
                model_name: row.get(4)?,
                max_tokens: row.get(5)?,
                is_active: row.get::<_, i32>(6)? == 1,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(configs)
    }

    /// 创建新配置（使用默认值）
    pub fn create_config(&self, name: String) -> SqliteResult<i64> {
        let conn = self.conn.lock().unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO api_configs (name, endpoint, api_key, model_name, max_tokens, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
            params![
                name,
                "",  // 默认空端点
                "",  // 默认空API Key
                "",  // 默认空模型名称
                2000,  // 默认Max Tokens
                now
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// 更新配置
    pub fn update_config(&self, id: i64, config: &ApiConfig) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "UPDATE api_configs
             SET name = ?1, endpoint = ?2, api_key = ?3, model_name = ?4, max_tokens = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                config.name,
                config.endpoint,
                config.api_key,
                config.model_name,
                config.max_tokens,
                now,
                id
            ],
        )?;

        Ok(())
    }

    /// 删除配置
    pub fn delete_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM api_configs WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// 激活指定配置（自动取消其他配置的激活状态）
    pub fn activate_config(&self, id: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // 开启事务以确保原子性
        conn.execute("BEGIN TRANSACTION", [])?;

        // 首先取消所有配置的激活状态
        conn.execute("UPDATE api_configs SET is_active = 0", [])?;

        // 然后激活指定配置
        conn.execute(
            "UPDATE api_configs SET is_active = 1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;

        conn.execute("COMMIT", [])?;

        Ok(())
    }

    /// 获取当前激活的配置
    pub fn get_current_config(&self) -> SqliteResult<Option<ApiConfig>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, endpoint, api_key, model_name, max_tokens, is_active, created_at, updated_at
             FROM api_configs
             WHERE is_active = 1
             LIMIT 1"
        )?;

        let mut configs = stmt.query_map([], |row| {
            Ok(ApiConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                endpoint: row.get(2)?,
                api_key: row.get(3)?,
                model_name: row.get(4)?,
                max_tokens: row.get(5)?,
                is_active: row.get::<_, i32>(6)? == 1,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        match configs.next() {
            Some(result) => Ok(Some(result?)),
            None => Ok(None),
        }
    }
}
