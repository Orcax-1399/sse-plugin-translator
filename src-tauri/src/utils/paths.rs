use std::path::PathBuf;

/// 获取 userdata 目录路径
pub fn get_userdata_dir() -> PathBuf {
    let userdata_dir = if cfg!(debug_assertions) {
        // 开发模式：项目根目录
        std::env::current_dir()
            .expect("无法获取当前目录")
            .join("userdata")
    } else {
        // 生产模式：可执行文件同级目录
        std::env::current_exe()
            .expect("无法获取可执行文件路径")
            .parent()
            .expect("无法获取父目录")
            .join("userdata")
    };

    // 确保userdata目录存在
    if !userdata_dir.exists() {
        std::fs::create_dir_all(&userdata_dir).expect("无法创建userdata目录");
    }

    userdata_dir
}

/// 获取翻译数据库文件路径
pub fn get_db_path() -> PathBuf {
    get_userdata_dir().join("translations.db")
}

/// 获取原子数据库文件路径
pub fn get_atomic_db_path() -> PathBuf {
    get_userdata_dir().join("atomic_translations.db")
}

/// 获取API配置数据库文件路径
pub fn get_api_db_path() -> PathBuf {
    get_userdata_dir().join("api.db")
}

/// 获取搜索历史数据库文件路径
pub fn get_search_history_db_path() -> PathBuf {
    get_userdata_dir().join("search_history.db")
}
