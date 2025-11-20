import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  useSessionStore,
  type TranslationUpdatedPayload,
} from "../../stores/sessionStore";

/**
 * 翻译更新事件监听器（独立组件，避免闭包捕获 openedSessions）
 *
 * 关键设计：
 * - 不使用 useSessionStore() hook，避免订阅 React context
 * - 只使用 useSessionStore.getState() 动态读取最新状态
 * - useCallback 依赖数组为空，确保函数只创建一次
 */
export default function TranslationUpdatedListener() {
  const handleTranslationUpdate = useCallback(
    (payload: TranslationUpdatedPayload) => {
      // 动态获取最新状态，不依赖闭包
      const { openedSessions, updateStringRecord } =
        useSessionStore.getState();

      for (const [sessionId, session] of openedSessions.entries()) {
        const record = session.strings.find(
          (s) =>
            s.form_id === payload.form_id &&
            s.record_type === payload.record_type &&
            s.subrecord_type === payload.subrecord_type,
        );

        if (record) {
          const currentOriginalText = payload.original_text.trim();
          const matching = session.strings.filter(
            (r) => r.original_text.trim() === currentOriginalText,
          );

          console.log("匹配情况:", {
            currentOriginalText,
            matchingCount: matching.length,
          });

          if (matching.length > 1) {
            // 批量情况：简化处理，只更新当前记录
            if (updateStringRecord) {
              updateStringRecord(
                sessionId,
                payload.form_id,
                payload.record_type,
                payload.subrecord_type,
                payload.index,
                payload.translated_text,
                payload.translation_status,
              );
              console.log(`✓ 单条翻译已应用: ${payload.form_id}`);
            }
          } else {
            // 单条情况：正常更新
            if (updateStringRecord) {
              updateStringRecord(
                sessionId,
                payload.form_id,
                payload.record_type,
                payload.subrecord_type,
                payload.index,
                payload.translated_text,
                payload.translation_status,
              );
              console.log(`✓ 翻译已应用: ${payload.form_id}`);
            }
          }

          break;
        }
      }
    },
    [], // 空依赖，只创建一次
  );

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      const unlisten = await listen<TranslationUpdatedPayload>(
        "translation-updated",
        (event) => {
          console.log("前端收到翻译更新事件:", event.payload);
          handleTranslationUpdate(event.payload);
        },
      );
      cleanup = unlisten;
    };

    setupListener();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [handleTranslationUpdate]);

  return null;
}
