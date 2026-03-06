use aho_corasick::{AhoCorasick, AhoCorasickBuilder};
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// 原子翻译来源类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AtomSource {
    Base,   // 基础词典
    AI,     // AI学习
    Manual, // 手动添加
}

impl AtomSource {
    fn as_str(&self) -> &'static str {
        match self {
            AtomSource::Base => "base",
            AtomSource::AI => "ai",
            AtomSource::Manual => "manual",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "base" => AtomSource::Base,
            "ai" => AtomSource::AI,
            "manual" => AtomSource::Manual,
            _ => AtomSource::Manual,
        }
    }
}

/// 原子翻译记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtomTranslation {
    pub id: i64,
    pub original: String,    // 原文（存储小写形式）
    pub translated: String,  // 译文
    pub usage_count: i32,    // 使用次数
    pub source: AtomSource,  // 来源
    pub created_at: i64,
    pub updated_at: i64,
}

/// 原子数据库
pub struct AtomicDB {
    conn: Arc<Mutex<Connection>>,
    memory_index: Arc<Mutex<HashMap<String, AtomTranslation>>>,
    matcher: Arc<Mutex<Option<AhoCorasick>>>,
}

impl AtomicDB {
    /// 初始化数据库（自动从SQLite加载到内存）
    pub fn new(db_path: &str) -> SqliteResult<Self> {
        let conn = Connection::open(db_path)?;
        Self::init_schema(&conn)?;

        let db = AtomicDB {
            conn: Arc::new(Mutex::new(conn)),
            memory_index: Arc::new(Mutex::new(HashMap::new())),
            matcher: Arc::new(Mutex::new(None)),
        };

        // 加载所有数据到内存
        db.load_all_to_memory()?;
        db.rebuild_matcher()?;

        Ok(db)
    }

    /// 初始化数据库表结构
    fn init_schema(conn: &Connection) -> SqliteResult<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS atomic_translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_text TEXT NOT NULL UNIQUE,
                translated_text TEXT NOT NULL,
                usage_count INTEGER DEFAULT 0,
                source_type TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // 创建索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_atomic_original ON atomic_translations(original_text)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_atomic_usage ON atomic_translations(usage_count DESC)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_atomic_source ON atomic_translations(source_type)",
            [],
        )?;

        Ok(())
    }

    /// 添加/更新原子翻译（持久化 + 内存）
    pub fn upsert_atom(
        &self,
        original: &str,
        translated: &str,
        source: AtomSource,
    ) -> SqliteResult<()> {
        let original_lower = original.to_lowercase();
        let now = now_timestamp();

        // 1. 持久化到SQLite
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO atomic_translations
             (original_text, translated_text, source_type, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(original_text) DO UPDATE SET
                 translated_text = ?2,
                 source_type = ?3,
                 updated_at = ?4",
            params![&original_lower, translated, source.as_str(), now],
        )?;

        drop(conn); // 释放锁

        // 2. 重新加载到内存（简单实现，后续可优化为增量更新）
        self.load_all_to_memory()?;

        // 3. 重建匹配器
        self.rebuild_matcher()?;

        Ok(())
    }

    /// 删除原子翻译
    pub fn delete_atom(&self, original: &str) -> SqliteResult<()> {
        let original_lower = original.to_lowercase();

        // 1. 从SQLite删除
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM atomic_translations WHERE original_text = ?1",
            params![&original_lower],
        )?;

        drop(conn); // 释放锁

        // 2. 重新加载到内存
        self.load_all_to_memory()?;

        // 3. 重建匹配器
        self.rebuild_matcher()?;

        Ok(())
    }

    /// 根据ID更新原子翻译（仅更新译文和来源）
    pub fn update_atom(&self, id: i64, translated: &str, source: AtomSource) -> SqliteResult<()> {
        let now = now_timestamp();

        // 1. 更新SQLite
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute(
            "UPDATE atomic_translations SET translated_text = ?1, source_type = ?2, updated_at = ?3 WHERE id = ?4",
            params![translated, source.as_str(), now, id],
        )?;

        drop(conn); // 释放锁

        if affected == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        // 2. 重新加载到内存
        self.load_all_to_memory()?;

        // 3. 重建匹配器（译文变化可能影响替换结果）
        self.rebuild_matcher()?;

        Ok(())
    }

    /// 获取所有原子翻译
    pub fn get_all_atoms(&self) -> SqliteResult<Vec<AtomTranslation>> {
        let memory = self.memory_index.lock().unwrap();
        let mut atoms: Vec<AtomTranslation> = memory.values().cloned().collect();

        // 按使用次数降序排序
        atoms.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));

        Ok(atoms)
    }

    /// 🔥 核心功能：替换文本中的原子词
    pub fn replace_with_atoms(&self, text: &str) -> String {
        let matcher_guard = self.matcher.lock().unwrap();
        let matcher = match matcher_guard.as_ref() {
            Some(m) => m,
            None => return text.to_string(), // 无原子词，直接返回
        };

        let memory = self.memory_index.lock().unwrap();
        let text_lower = text.to_lowercase();

        // 使用 Aho-Corasick 找到所有匹配位置
        let mut matches: Vec<_> = matcher.find_iter(&text_lower).collect();

        if matches.is_empty() {
            return text.to_string();
        }

        // 按位置倒序排列，避免替换时位置偏移
        matches.sort_by_key(|m| std::cmp::Reverse(m.start()));

        let mut result = text.to_string();

        // 用于追踪已处理的位置，避免重复替换
        let mut processed_ranges: Vec<(usize, usize)> = Vec::new();

        for mat in matches {
            let start = mat.start();
            let end = mat.end();

            // 检查是否与已处理的范围重叠
            if processed_ranges
                .iter()
                .any(|(ps, pe)| !(end <= *ps || start >= *pe))
            {
                continue; // 跳过重叠的匹配
            }

            let matched_text_lower = &text_lower[start..end];

            // 尝试查找原子翻译（先查原文，再查复数变体）
            let atom_opt = if let Some(a) = memory.get(matched_text_lower) {
                Some(a.clone())
            } else {
                // 尝试词形还原（去除复数）
                self.find_atom_by_normalization(matched_text_lower, &memory)
            };

            if let Some(atom) = atom_opt {
                // 保留原文大小写形式
                let original_case = &text[start..end];
                let replacement = format!("{}({})", original_case, atom.translated);

                // 替换
                result.replace_range(start..end, &replacement);

                // 记录已处理的范围
                processed_ranges.push((start, end));

                // 增加使用计数（异步）
                self.increment_usage_async(&atom.original);
            }
        }

        result
    }

    /// 批量添加原子翻译（用于初始化或导入）
    // ==================== 内部辅助方法 ====================

    /// 从SQLite加载所有数据到内存
    fn load_all_to_memory(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, original_text, translated_text, usage_count, source_type, created_at, updated_at
             FROM atomic_translations",
        )?;

        let mut memory = self.memory_index.lock().unwrap();
        memory.clear();

        let rows = stmt.query_map([], |row| {
            Ok(AtomTranslation {
                id: row.get(0)?,
                original: row.get(1)?,
                translated: row.get(2)?,
                usage_count: row.get(3)?,
                source: AtomSource::from_str(&row.get::<_, String>(4)?),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        for atom in rows {
            let atom = atom?;
            memory.insert(atom.original.clone(), atom);
        }

        Ok(())
    }

    /// 重建 Aho-Corasick 匹配器
    fn rebuild_matcher(&self) -> SqliteResult<()> {
        let memory = self.memory_index.lock().unwrap();

        if memory.is_empty() {
            *self.matcher.lock().unwrap() = None;
            return Ok(());
        }

        // 构建匹配模式列表
        let mut patterns: Vec<String> = memory.keys().cloned().collect();

        // 添加复数形式匹配（为每个模式生成可能的复数形式）
        let mut plural_patterns = Vec::new();
        for pattern in &patterns {
            // 简单复数规则
            if !pattern.ends_with('s') {
                plural_patterns.push(format!("{}s", pattern)); // cats
            }
            if !pattern.ends_with("es") {
                plural_patterns.push(format!("{}es", pattern)); // boxes
            }
        }
        patterns.extend(plural_patterns);

        // 按长度降序排序，优先匹配长词（避免短词优先匹配）
        patterns.sort_by(|a, b| b.len().cmp(&a.len()));

        // 构建 Aho-Corasick 自动机
        let ac = AhoCorasickBuilder::new()
            .ascii_case_insensitive(true) // 大小写不敏感
            .match_kind(aho_corasick::MatchKind::LeftmostLongest) // 最左最长匹配
            .build(&patterns)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        *self.matcher.lock().unwrap() = Some(ac);

        Ok(())
    }

    /// 词形还原匹配（尝试去除复数后缀）
    fn find_atom_by_normalization(
        &self,
        word: &str,
        memory: &HashMap<String, AtomTranslation>,
    ) -> Option<AtomTranslation> {
        // 规则1: 去除 's' (cats -> cat)
        if word.ends_with('s') && word.len() > 2 {
            let stem = &word[..word.len() - 1];
            if let Some(atom) = memory.get(stem) {
                return Some(atom.clone());
            }
        }

        // 规则2: 去除 'es' (boxes -> box)
        if word.ends_with("es") && word.len() > 3 {
            let stem = &word[..word.len() - 2];
            if let Some(atom) = memory.get(stem) {
                return Some(atom.clone());
            }
        }

        // 规则3: 'ies' -> 'y' (berries -> berry)
        if word.ends_with("ies") && word.len() > 4 {
            let stem = &word[..word.len() - 3];
            let singular = format!("{}y", stem);
            if let Some(atom) = memory.get(&singular) {
                return Some(atom.clone());
            }
        }

        None
    }

    /// 异步增加使用计数
    fn increment_usage_async(&self, original: &str) {
        let conn = self.conn.clone();
        let original = original.to_string();

        // 在后台线程执行，不阻塞主流程
        std::thread::spawn(move || {
            let conn = conn.lock().unwrap();
            let _ = conn.execute(
                "UPDATE atomic_translations SET usage_count = usage_count + 1 WHERE original_text = ?1",
                params![&original],
            );
        });
    }
}

/// 获取当前时间戳（秒）
fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_atomic_db_basic() {
        let db = AtomicDB::new(":memory:").unwrap();

        // 添加原子词
        db.upsert_atom("savangard", "松加德", AtomSource::Base)
            .unwrap();
        db.upsert_atom("argonian", "亚龙人", AtomSource::Base)
            .unwrap();

        // 测试替换
        let input = "The Argonian waits in Savangard.";
        let output = db.replace_with_atoms(input);
        assert!(output.contains("Argonian(亚龙人)"));
        assert!(output.contains("Savangard(松加德)"));
    }

    #[test]
    fn test_plural_matching() {
        let db = AtomicDB::new(":memory:").unwrap();

        db.upsert_atom("argonian", "亚龙人", AtomSource::Base)
            .unwrap();

        // 测试复数匹配
        let input = "Many argonians live here.";
        let output = db.replace_with_atoms(input);
        println!("Input:  {}", input);
        println!("Output: {}", output);
        assert!(output.contains("argonians(亚龙人)"));
    }

    #[test]
    fn test_case_insensitive() {
        let db = AtomicDB::new(":memory:").unwrap();

        db.upsert_atom("skyrim", "天际", AtomSource::Base).unwrap();

        // 测试大小写不敏感
        let input = "Welcome to SKYRIM and Skyrim!";
        let output = db.replace_with_atoms(input);
        assert!(output.contains("SKYRIM(天际)"));
        assert!(output.contains("Skyrim(天际)"));
    }
}
