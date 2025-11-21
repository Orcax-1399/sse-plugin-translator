import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  useSessionStore,
  type TranslationUpdatedPayload,
} from "../../stores/sessionStore";
import BatchApplyConfirmModal from "../BatchApplyConfirmModal";
import { showSuccess } from "../../stores/notificationStore";

interface BatchModalData {
  sessionId: string;
  originalText: string;
  matchCount: number;
  payload: TranslationUpdatedPayload;
}

/**
 * 翻译更新事件监听器
 *
 * 关键设计：
 * - 不使用 useSessionStore() hook，避免订阅 React context
 * - 只使用 useSessionStore.getState() 动态读取最新状态
 * - 检测到批量情况时弹出 BatchApplyConfirmModal
 */
export default function TranslationUpdatedListener() {
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchModalData, setBatchModalData] = useState<BatchModalData | null>(
    null,
  );

  // 处理批量应用确认
  const handleBatchConfirm = useCallback(
    (applyAll: boolean) => {
      if (!batchModalData) return;

      const { sessionId, payload } = batchModalData;
      const { openedSessions, updateStringRecord, batchUpdateStringRecords } =
        useSessionStore.getState();
      const session = openedSessions.get(sessionId);

      if (!session || !updateStringRecord) {
        setBatchModalOpen(false);
        setBatchModalData(null);
        return;
      }

      if (applyAll) {
        // 批量应用：找到所有小写匹配的记录
        const matchingRecords = session.strings.filter(
          (r) =>
            r.original_text.trim().toLowerCase() ===
            payload.original_text.trim().toLowerCase(),
        );

        // ✅ 使用批量更新方法，创建单个批量历史记录
        if (batchUpdateStringRecords) {
          const updates = matchingRecords.map((record) => ({
            formId: record.form_id,
            recordType: record.record_type,
            subrecordType: record.subrecord_type,
            index: record.index,
            translatedText: payload.translated_text,
            translationStatus: payload.translation_status,
          }));

          batchUpdateStringRecords(sessionId, updates);
          showSuccess(`已批量应用到 ${matchingRecords.length} 条记录`);
          console.log(`✓ 批量翻译已应用: ${matchingRecords.length} 条`);
        }
      } else {
        // 仅应用当前记录
        updateStringRecord(
          sessionId,
          payload.form_id,
          payload.record_type,
          payload.subrecord_type,
          payload.index,
          payload.translated_text,
          payload.translation_status,
        );
        showSuccess("已应用到当前记录");
        console.log(`✓ 单条翻译已应用: ${payload.form_id}`);
      }

      setBatchModalOpen(false);
      setBatchModalData(null);
    },
    [batchModalData],
  );

  const handleTranslationUpdate = useCallback(
    (payload: TranslationUpdatedPayload) => {
      // 动态获取最新状态，不依赖闭包
      const { openedSessions, updateStringRecord } = useSessionStore.getState();

      for (const [sessionId, session] of openedSessions.entries()) {
        const record = session.strings.find(
          (s) =>
            s.form_id === payload.form_id &&
            s.record_type === payload.record_type &&
            s.subrecord_type === payload.subrecord_type,
        );

        if (record) {
          // 使用小写比较匹配相同原文
          const currentOriginalTextLower = payload.original_text
            .trim()
            .toLowerCase();
          const matching = session.strings.filter(
            (r) =>
              r.original_text.trim().toLowerCase() === currentOriginalTextLower,
          );

          console.log("匹配情况:", {
            currentOriginalText: payload.original_text.trim(),
            matchingCount: matching.length,
          });

          if (matching.length > 1) {
            // 批量情况：弹出Modal让用户选择
            setBatchModalData({
              sessionId,
              originalText: payload.original_text.trim(),
              matchCount: matching.length,
              payload,
            });
            setBatchModalOpen(true);
            // 不在这里更新，等待用户选择
          } else {
            // 单条情况：直接更新
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

  return (
    <BatchApplyConfirmModal
      open={batchModalOpen}
      originalText={batchModalData?.originalText || ""}
      matchCount={batchModalData?.matchCount || 0}
      onConfirm={handleBatchConfirm}
      onClose={() => {
        setBatchModalOpen(false);
        setBatchModalData(null);
      }}
    />
  );
}
