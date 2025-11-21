use crate::plugin_session::StringRecord;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// 打开编辑窗口
#[tauri::command]
pub async fn open_editor_window(
    app: tauri::AppHandle,
    editor_data_store: tauri::State<'_, Mutex<HashMap<String, StringRecord>>>,
    record: StringRecord,
) -> Result<String, String> {
    // 生成唯一的窗口标签（使用时间戳）
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let window_label = format!("editor-{}", timestamp);

    println!("→ 准备创建编辑窗口: {}", window_label);
    println!("  form_id: {}", record.form_id);

    // 先存储数据
    {
        match editor_data_store.lock() {
            Ok(mut store) => {
                store.insert(window_label.clone(), record.clone());
                println!("  ✓ 数据已存储到内存");
            }
            Err(e) => {
                println!("  ❌ 锁定数据存储失败: {}", e);
                return Err(format!("锁定数据存储失败: {}", e));
            }
        }
    }

    println!("  → 开始异步创建窗口...");

    // 直接在异步上下文中创建窗口
    let builder = WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App("/editor".into()))
        .title("编辑翻译")
        .inner_size(900.0, 600.0)
        .resizable(true)
        .additional_browser_args("--disable-gpu --disable-d3d11")
        .center();

    match builder.build() {
        Ok(_) => {
            println!("  ✓ 编辑窗口创建成功: {}", window_label);
            Ok(window_label)
        }
        Err(e) => {
            println!("  ❌ 编辑窗口创建失败: {}", e);

            // 清理已存储的数据
            if let Ok(mut store) = editor_data_store.lock() {
                store.remove(&window_label);
            }

            Err(format!("创建编辑窗口失败: {}", e))
        }
    }
}

/// 获取编辑窗口数据（前端准备好后调用）
#[tauri::command]
pub fn get_editor_data(
    window_label: String,
    editor_data_store: tauri::State<Mutex<HashMap<String, StringRecord>>>,
) -> Result<StringRecord, String> {
    println!("→ 前端请求编辑数据: {}", window_label);

    let record = {
        match editor_data_store.lock() {
            Ok(mut store) => {
                println!("  ✓ 成功锁定数据存储");
                println!("  当前存储的窗口数: {}", store.len());

                // 取出数据并移除（避免内存泄漏）
                match store.remove(&window_label) {
                    Some(rec) => {
                        println!("  ✓ 找到数据 (form_id: {})", rec.form_id);
                        Ok(rec)
                    }
                    None => {
                        println!("  ❌ 未找到窗口数据");
                        println!("  可用的窗口标签: {:?}", store.keys().collect::<Vec<_>>());
                        Err(format!("未找到窗口数据: {}", window_label))
                    }
                }
            }
            Err(e) => {
                println!("  ❌ 锁定数据存储失败: {}", e);
                Err(format!("锁定数据存储失败: {}", e))
            }
        }
    }?;

    println!("✓ 编辑数据已返回: {}", window_label);

    Ok(record)
}
