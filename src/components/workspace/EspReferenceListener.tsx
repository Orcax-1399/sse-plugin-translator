import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSessionStore } from "../../stores/sessionStore";
import { showError } from "../../stores/notificationStore";
import EspReferenceModal from "./EspReferenceModal";

/**
 * 参考记录（ESP 对照的单条翻译）
 */
export interface ReferenceRecord {
  form_id: string;
  record_type: string;
  subrecord_type: string;
  index: number;
  original_text: string;
  translated_text: string;
}

/**
 * ESP 对照加载成功的 Payload
 */
export interface EspReferencePayload {
  session_id: string;
  source_plugin_name: string;
  total_count: number;
  matched_count: number;
  records: ReferenceRecord[];
}

/**
 * ESP 对照加载失败的 Payload
 */
interface EspReferenceErrorPayload {
  session_id: string;
  error: string;
}

/**
 * ESP 对照事件监听器
 *
 * 监听后端发送的 esp-reference-loaded 和 esp-reference-error 事件
 * 成功时弹出 EspReferenceModal 让用户选择替换策略
 */
export default function EspReferenceListener() {
  const [modalData, setModalData] = useState<EspReferencePayload | null>(null);

  useEffect(() => {
    // 监听加载成功事件
    const unlistenLoaded = listen<EspReferencePayload>(
      "esp-reference-loaded",
      (event) => {
        console.log("✓ 收到 ESP 对照数据:", event.payload.total_count, "条");

        // 结束加载状态
        const setEspReferenceLoading =
          useSessionStore.getState().setEspReferenceLoading;
        setEspReferenceLoading?.(event.payload.session_id, false);

        // 显示 Modal
        setModalData(event.payload);
      }
    );

    // 监听加载失败事件
    const unlistenError = listen<EspReferenceErrorPayload>(
      "esp-reference-error",
      (event) => {
        console.error("✗ ESP 对照加载失败:", event.payload.error);

        // 结束加载状态
        const setEspReferenceLoading =
          useSessionStore.getState().setEspReferenceLoading;
        setEspReferenceLoading?.(event.payload.session_id, false);

        // 显示错误
        showError(event.payload.error);
      }
    );

    // 清理函数
    return () => {
      unlistenLoaded.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []);

  return (
    <EspReferenceModal data={modalData} onClose={() => setModalData(null)} />
  );
}
