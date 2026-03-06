import {
  Box,
  Typography,
  Paper,
  IconButton,
  LinearProgress,
  Fade,
  Tooltip,
  Button,
  Badge,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  styled,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { motion, AnimatePresence } from "framer-motion";
import type { GridPaginationModel } from "@mui/x-data-grid";
import InfoIcon from "@mui/icons-material/Info";
import SaveIcon from "@mui/icons-material/Save";
import TranslateIcon from "@mui/icons-material/Translate";
import UndoIcon from "@mui/icons-material/Undo";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import PublishIcon from "@mui/icons-material/Publish";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { PluginStringsResponse } from "../types";
import StringTable from "./StringTable";
import ReplaceDialog from "./workspace/ReplaceDialog";
import { useSessionStore } from "../stores/sessionStore";
import { useApiConfigStore } from "../stores/apiConfigStore";
import { useHistoryStore, type HistoryCommand, type HistoryRecord } from "../stores/historyStore";
import {
  showSuccess,
  showError,
  showInfo as showInfoNotification,
} from "../stores/notificationStore";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  translateBatchWithAI,
  createCancellationToken,
  type TranslationEntry,
  type CancellationToken,
  type AiStatusUpdate,
} from "../utils/aiTranslation";
import type { TranslationMemoryEntry } from "../utils/aiPrompts";

// Thinking 动画组件（Claude/ChatGPT 风格 shimmer 效果）
const ThinkingText = styled(Typography)(({ theme }) => ({
  background: `linear-gradient(
    90deg,
    ${theme.palette.text.secondary} 0%,
    ${theme.palette.text.secondary} 40%,
    ${theme.palette.primary.main} 50%,
    ${theme.palette.text.secondary} 60%,
    ${theme.palette.text.secondary} 100%
  )`,
  backgroundSize: "200% 100%",
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: "shimmer 2s infinite linear",
  "@keyframes shimmer": {
    "0%": { backgroundPosition: "100% 0" },
    "100%": { backgroundPosition: "-100% 0" },
  },
}));

// 状态消息堆叠动画配置（iOS 风格）
const statusItemVariants = {
  initial: {
    opacity: 0,
    scale: 0.8,
    y: 20,
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 500,
      damping: 30,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.6,
    y: -10,
    transition: {
      duration: 0.2,
    },
  },
};

const AI_TRANSLATION_CHUNK_SIZE = 50;

const MAX_CACHE_ENTRIES = 200;
const MAX_CACHE_TEXT_LENGTH = 200;

const buildSessionTranslationMemory = (
  sessionId: string,
): TranslationMemoryEntry[] => {
  const session = useSessionStore
    .getState()
    .openedSessions.get(sessionId);

  if (!session) {
    return [];
  }

  const uniqueEntries = new Map<string, TranslationMemoryEntry>();
  session.strings.forEach((record) => {
    if (
      record.translation_status !== "ai" ||
      !record.translated_text ||
      !record.original_text
    ) {
      return;
    }

    const original = record.original_text.trim();
    const translated = record.translated_text.trim();
    if (!original || !translated || uniqueEntries.has(original)) {
      return;
    }

    const truncatedOriginal =
      original.length > MAX_CACHE_TEXT_LENGTH
        ? `${original.slice(0, MAX_CACHE_TEXT_LENGTH)}...`
        : original;
    const truncatedTranslated =
      translated.length > MAX_CACHE_TEXT_LENGTH
        ? `${translated.slice(0, MAX_CACHE_TEXT_LENGTH)}...`
        : translated;

    uniqueEntries.set(truncatedOriginal, {
      original: truncatedOriginal,
      translated: truncatedTranslated,
    });
  });

  return Array.from(uniqueEntries.values()).slice(
    0,
    MAX_CACHE_ENTRIES,
  );
};

interface SessionPanelProps {
  /** Session 数据 */
  sessionData: PluginStringsResponse;
}

/**
 * Session 面板组件
 *
 * 显示单个插件 Session 的内容：
 * - 顶部状态栏（动态高度，包含进度信息）
 * - 字符串表格（占满剩余空间）
 *
 * ✅ 使用 selector 精确订阅，避免引用整个 store 对象
 */
export default function SessionPanel({ sessionData }: SessionPanelProps) {
  // ✅ 使用 selector 精确订阅状态和方法
  const translationProgress = useSessionStore(
    (state) => state.translationProgress,
  );
  const getSessionPendingCount = useSessionStore(
    (state) => state.getSessionPendingCount,
  );
  const saveSessionTranslations = useSessionStore(
    (state) => state.saveSessionTranslations,
  );
  const setFilterStatus = useSessionStore((state) => state.setFilterStatus);
  const updateStringRecord = useSessionStore(
    (state) => state.updateStringRecord,
  );
  const batchUpdateStringRecords = useSessionStore(
    (state) => state.batchUpdateStringRecords,
  );
  const setEspReferenceLoading = useSessionStore(
    (state) => state.setEspReferenceLoading,
  );

  // ✅ ESP 对照加载状态
  const isLoadingReference = useSessionStore(
    (state) => state.espReferenceLoading?.get(sessionData.session_id) || false,
  );

  // ✅ 使用selector订阅selectedRows的size，避免无限循环
  const selectedCount = useSessionStore(
    (state) => state.selectedRows?.get(sessionData.session_id)?.size || 0,
  );

  // ✅ 使用selector订阅filterStatus，确保响应式更新
  const currentFilter = useSessionStore(
    (state) => state.filterStatus?.get(sessionData.session_id) || "all",
  );

  // API配置
  const currentApi = useApiConfigStore((state) => state.currentApi);

  const progress = translationProgress.get(sessionData.session_id);
  const [showInfo, setShowInfo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 100,
  });

  const handlePaginationModelChange = useCallback(
    (model: GridPaginationModel) => {
      setPaginationModel((prev) =>
        prev.page === model.page && prev.pageSize === model.pageSize
          ? prev
          : { ...model },
      );
    },
    [],
  );

  // AI翻译状态
  const [isAiTranslating, setIsAiTranslating] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiCompleted, setAiCompleted] = useState(0);
  const [aiTotal, setAiTotal] = useState(0);
  const [, setAiStatus] = useState<AiStatusUpdate | null>(null);
  const [statusHistory, setStatusHistory] = useState<AiStatusUpdate[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [isHeartbeatActive, setIsHeartbeatActive] = useState(false);
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(
    null,
  );

  // 取消令牌和心跳计时器（使用 useRef 避免重新创建）
  const cancellationTokenRef = useRef<CancellationToken | null>(null);
  const lastStatusTimeRef = useRef<number>(Date.now());
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const resetAiContext = useCallback(() => {
    setIsAiTranslating(false);
    setAiProgress(0);
    setAiCompleted(0);
    setAiTotal(0);
    setStatusHistory([]);
    setCurrentIteration(0);
    setIsHeartbeatActive(false);
    setContextUsagePercent(null);
    setAiStatus(null);
    lastStatusTimeRef.current = Date.now();

    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    cancellationTokenRef.current = null;
  }, [
    setIsAiTranslating,
    setAiProgress,
    setAiCompleted,
    setAiTotal,
    setStatusHistory,
    setCurrentIteration,
    setIsHeartbeatActive,
    setAiStatus,
  ]);

  // Replace 对话框状态
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);

  // 可撤销的操作数量
  const undoCount = useHistoryStore((state) => state.getUndoCount(sessionData.session_id));

  // ✅ Ctrl+Z 快捷键监听（撤销功能）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查是否按下 Ctrl+Z (或 Cmd+Z on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // 防止在输入框中触发（检查 activeElement）
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
          activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          (activeElement as HTMLElement).isContentEditable
        );

        if (isInputField) {
          return; // 在输入框中，不拦截（保留浏览器原生撤销）
        }

        // 检查是否可以撤销
        const canUndo = useHistoryStore.getState().canUndo(sessionData.session_id);
        if (!canUndo) {
          console.log("⚠️ 没有可撤销的操作");
          return;
        }

        // 阻止默认行为
        e.preventDefault();

        // 执行撤销
        const command = useHistoryStore.getState().undo(sessionData.session_id);
        const revertCommand = useSessionStore.getState().revertCommand;
        if (command && revertCommand) {
          revertCommand(command);
          showSuccess(`已撤销: ${command.description}`);
          console.log(`✓ 撤销成功: ${command.description}`);
        }
      }
    };

    // 添加事件监听
    window.addEventListener('keydown', handleKeyDown);

    // 清理函数
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sessionData.session_id]); // 依赖 sessionId，确保切换 session 时重新绑定

  // 心跳机制：超过 5 秒无新状态时显示 thinking 动画
  useEffect(() => {
    if (isAiTranslating) {
      // 重置状态
      lastStatusTimeRef.current = Date.now();
      setIsHeartbeatActive(false);

      // 每秒检查一次是否超时
      heartbeatIntervalRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastStatusTimeRef.current;

        if (elapsed > 5000) {
          // 超过 5 秒无状态，激活心跳动画
          setIsHeartbeatActive(true);
        }
      }, 1000);
    }

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      setIsHeartbeatActive(false);
    };
  }, [isAiTranslating]);

  // 是否正在加载翻译
  const isLoadingTranslations = progress !== undefined && progress < 100;

  // 获取当前 session 的未保存数量
  const pendingCount = getSessionPendingCount
    ? getSessionPendingCount(sessionData.session_id)
    : 0;

  // 根据筛选状态过滤数据
  const filteredStrings = useMemo(() => {
    if (currentFilter === "all") {
      return sessionData.strings;
    }
    return sessionData.strings.filter(
      (s) => s.translation_status === currentFilter,
    );
  }, [sessionData.strings, currentFilter]);

  useEffect(() => {
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, [currentFilter, sessionData.session_id]);

  // Ctrl+H 快捷键监听（打开查找替换对话框）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setReplaceDialogOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setPaginationModel((prev) => {
      const maxPage = Math.max(
        Math.ceil(filteredStrings.length / prev.pageSize) - 1,
        0,
      );
      if (prev.page > maxPage) {
        return { ...prev, page: maxPage };
      }
      return prev;
    });
  }, [filteredStrings.length]);

  // 处理筛选状态变更
  const handleFilterChange = (
    status: "all" | "untranslated" | "manual" | "ai",
  ) => {
    if (setFilterStatus) {
      setFilterStatus(sessionData.session_id, status);
    }
  };

  // 保存当前 session 的翻译
  const handleSaveTranslations = async () => {
    if (!saveSessionTranslations) {
      showError("保存功能不可用");
      return;
    }

    setIsSaving(true);

    try {
      const savedCount = await saveSessionTranslations(sessionData.session_id);
      if (savedCount > 0) {
        showSuccess(`成功保存 ${savedCount} 条翻译`);
      } else {
        showSuccess("没有需要保存的翻译");
      }
    } catch (error) {
      showError("保存翻译失败: " + String(error));
    } finally {
      setIsSaving(false);
    }
  };

  // AI翻译处理
  const handleAiTranslate = async () => {
    if (!currentApi) {
      showError("请先在设置中配置API");
      return;
    }

    resetAiContext();

    const selectedRowIds =
      useSessionStore.getState().selectedRows?.get(sessionData.session_id) ||
      new Set<string>();
    console.log("[AI翻译] 选中的行数:", selectedRowIds.size);

    const entries: TranslationEntry[] = [];

    if (selectedRowIds.size > 0) {
      let index = 0;
      for (const rowId of selectedRowIds) {
        const parts = rowId.split("|");

        if (parts.length < 4) {
          console.warn("[AI翻译] 无效的rowId格式:", rowId);
          continue;
        }

        const indexPart = parts[parts.length - 1];
        const subrecordType = parts[parts.length - 2];
        const recordType = parts[parts.length - 3];
        const formId = parts.slice(0, parts.length - 3).join("|");
        const recordIndex = Number(indexPart);

        if (Number.isNaN(recordIndex)) {
          console.warn("[AI翻译] 无效的索引:", rowId);
          continue;
        }

        const record = sessionData.strings.find(
          (s) =>
            s.form_id === formId &&
            s.record_type === recordType &&
            s.subrecord_type === subrecordType &&
            s.index === recordIndex,
        );

        if (record) {
          entries.push({
            index: index++,
            recordIndex: record.index,
            formId: record.form_id,
            recordType: record.record_type,
            subrecordType: record.subrecord_type,
            originalText: record.original_text,
          });
        } else {
          console.warn("[AI翻译] 未找到记录:", {
            formId,
            recordType,
            subrecordType,
            recordIndex,
          });
        }
      }
    } else {
      const { page, pageSize } = paginationModel;
      const start = page * pageSize;
      const end = start + pageSize;
      const visibleRows = filteredStrings.slice(start, end);
      const untranslatedRows = visibleRows.filter(
        (row) =>
          row.translation_status === "untranslated" || !row.translation_status,
      );

      if (untranslatedRows.length === 0) {
        showInfoNotification(
          "当前页没有可翻译的条目（仅自动翻译“未翻译”的记录）",
        );
        return;
      }

      untranslatedRows.forEach((record, idx) => {
        entries.push({
          index: idx,
          recordIndex: record.index,
          formId: record.form_id,
          recordType: record.record_type,
          subrecordType: record.subrecord_type,
          originalText: record.original_text,
        });
      });

      console.log("[AI翻译] 自动选取当前页未翻译条目数:", entries.length);
    }

    console.log("[AI翻译] 找到的有效条目数:", entries.length);

    if (entries.length === 0) {
      showError("未找到有效的翻译条目");
      return;
    }

    // 📸 在翻译前捕获所有记录的 beforeState
    const historyRecords: HistoryRecord[] = [];
    for (const entry of entries) {
      const record = sessionData.strings.find(
        (s) =>
          s.form_id === entry.formId &&
          s.record_type === entry.recordType &&
          s.subrecord_type === entry.subrecordType &&
          s.index === entry.recordIndex,
      );

      if (record) {
        const recordId = `${entry.formId}|${entry.recordType}|${entry.subrecordType}|${entry.recordIndex}`;
        const beforeState = structuredClone(record);
        historyRecords.push({
          recordId,
          beforeState,
          afterState: beforeState, // 暂时设置为 beforeState，翻译后更新
        });
      }
    }

    const totalEntries = entries.length;
    const entryChunks: TranslationEntry[][] = [];
    for (let i = 0; i < entries.length; i += AI_TRANSLATION_CHUNK_SIZE) {
      entryChunks.push(entries.slice(i, i + AI_TRANSLATION_CHUNK_SIZE));
    }

    console.log(
      `[AI翻译] 将 ${totalEntries} 条拆分为 ${entryChunks.length} 个批次，每批最多 ${AI_TRANSLATION_CHUNK_SIZE} 条`,
    );

    // 开始AI翻译
    setIsAiTranslating(true);
    setAiProgress(0);
    setAiCompleted(0);
    setAiTotal(totalEntries);
    setStatusHistory([]); // 清空状态历史
    setCurrentIteration(0); // 重置迭代计数
    setAiStatus(null); // 清空当前状态
    lastStatusTimeRef.current = Date.now(); // 重置心跳计时器

    // 创建取消令牌
    const cancellationToken = createCancellationToken();
    cancellationTokenRef.current = cancellationToken;

    try {
      const pushStatus = (status: AiStatusUpdate) => {
        setAiStatus(status);
        setStatusHistory((prev) => [...prev.slice(-4), status]);
        if (typeof status.contextUsedPercent === "number") {
          setContextUsagePercent(status.contextUsedPercent);
        }
        lastStatusTimeRef.current = Date.now();
        setIsHeartbeatActive(false);
      };

      let chunkOffset = 0;
      let iterationBase = 0;
      let aggregatedTranslated = 0;
      let finalError: string | undefined;
      let overallSuccess = true;

      for (let chunkIndex = 0; chunkIndex < entryChunks.length; chunkIndex++) {
        const chunk = entryChunks[chunkIndex];
        let chunkMaxIteration = 0;

        const chunkResult = await translateBatchWithAI(
          chunk,
          currentApi,
          (completed, _chunkTotal) => {
            const overallCompleted = chunkOffset + completed;
            setAiCompleted(overallCompleted);
            setAiTotal(totalEntries);
            setAiProgress((overallCompleted / totalEntries) * 100);
          },
          (_index, recIndex, formId, recordType, subrecordType, translated) => {
            if (updateStringRecord) {
              updateStringRecord(
                sessionData.session_id,
                formId,
                recordType,
                subrecordType,
                recIndex,
                translated,
                "ai",
                true,
              );
            }

            const recordId = `${formId}|${recordType}|${subrecordType}|${recIndex}`;
            const historyRecord = historyRecords.find((hr) => hr.recordId === recordId);
            if (historyRecord) {
              const latestSession = useSessionStore
                .getState()
                .openedSessions.get(sessionData.session_id);
              const afterRecord = latestSession?.strings.find(
                (s) =>
                  s.form_id === formId &&
                  s.record_type === recordType &&
                  s.subrecord_type === subrecordType &&
                  s.index === recIndex,
              );
              if (afterRecord) {
                historyRecord.afterState = structuredClone({
                  ...afterRecord,
                  translated_text: translated,
                  translation_status: "ai",
                });
              }
            }
          },
          cancellationToken,
          pushStatus,
          (iteration) => {
            chunkMaxIteration = Math.max(chunkMaxIteration, iteration);
            setCurrentIteration(iterationBase + iteration);
          },
          buildSessionTranslationMemory(sessionData.session_id),
        );

        aggregatedTranslated += chunkResult.translatedCount;

        if (!chunkResult.success) {
          overallSuccess = false;
          finalError = chunkResult.error;
          break;
        }

        chunkOffset += chunk.length;
        iterationBase += Math.max(chunkMaxIteration, 0);
      }

      const result = {
        success: overallSuccess,
        translatedCount: aggregatedTranslated,
        error: finalError,
      };

      // 📝 翻译完成后，生成一个批量历史记录
      if (result.translatedCount > 0) {
        const successfulRecords = historyRecords.filter(
          (hr) => hr.afterState.translated_text !== hr.beforeState.translated_text,
        );

        if (successfulRecords.length > 0) {
          const historyCommand: HistoryCommand = {
            id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
            timestamp: Date.now(),
            type: 'batch',
            description: `AI Translate ${successfulRecords.length} items`,
            sessionId: sessionData.session_id,
            records: successfulRecords,
          };

          useHistoryStore.getState().pushCommand(historyCommand);
          console.log(`📝 AI翻译历史记录已添加: ${successfulRecords.length} 条`);
        }
      }

      if (result.success) {
        showSuccess(
          `AI翻译完成！已翻译 ${result.translatedCount} 条，请检查后保存`,
        );
      } else {
        if (result.error === "用户取消翻译") {
          showInfoNotification(
            `AI翻译已取消，已翻译 ${result.translatedCount} 条`,
          );
        } else {
          showError(`AI翻译失败: ${result.error || "未知错误"}`);
        }
      }
    } catch (error) {
      showError("AI翻译失败: " + String(error));
    } finally {
      resetAiContext();
    }
  };

  // 取消AI翻译
  const handleCancelTranslation = () => {
    if (cancellationTokenRef.current) {
      const cancelStatus: AiStatusUpdate = {
        id: `cancel-${Date.now()}`,
        type: "info",
        message: "正在尝试取消翻译...",
        timestamp: Date.now(),
      };
      setAiStatus(cancelStatus);
      setStatusHistory((prev) => [...prev.slice(-4), cancelStatus]);
      cancellationTokenRef.current.cancel();
    }
  };

  // 处理替换
  const handleReplace = (
    updates: Array<{
      formId: string;
      recordType: string;
      subrecordType: string;
      index: number;
      translatedText: string;
    }>,
  ) => {
    if (batchUpdateStringRecords) {
      batchUpdateStringRecords(sessionData.session_id, updates);
      showSuccess(`成功替换 ${updates.length} 条记录，已标记为AI翻译`);
    }
  };

  // 处理撤销
  const handleUndo = () => {
    const canUndo = useHistoryStore.getState().canUndo(sessionData.session_id);
    if (!canUndo) {
      showInfoNotification("没有可撤销的操作");
      return;
    }

    const command = useHistoryStore.getState().undo(sessionData.session_id);
    const revertCommand = useSessionStore.getState().revertCommand;
    if (command && revertCommand) {
      revertCommand(command);
      showSuccess(`已撤销: ${command.description}`);
    }
  };

  // 处理加载 ESP 对照
  const handleLoadEspReference = async () => {
    try {
      const selected = await open({
        filters: [{ name: "ESP Files", extensions: ["esp", "esm", "esl"] }],
        multiple: false,
      });

      if (!selected) {
        return; // 用户取消选择
      }

      // 设置加载状态
      setEspReferenceLoading?.(sessionData.session_id, true);

      // 调用后端命令（事件会在 EspReferenceListener 中处理）
      await invoke("load_esp_reference", {
        referencePath: selected,
        sessionId: sessionData.session_id,
      });
    } catch (error) {
      setEspReferenceLoading?.(sessionData.session_id, false);
      showError(`加载 ESP 对照失败: ${error}`);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 状态栏（动态高度） */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          px: 2,
          py: 1,
        }}
      >
        {/* 第一行：总计 + 筛选Chips + 保存按钮 + 信息按钮 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: isLoadingTranslations ? 1 : 0,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            总计: <strong>{sessionData.total_count}</strong> 条
            {currentFilter !== "all" && (
              <span>
                {" "}
                · 筛选: <strong>{filteredStrings.length}</strong> 条
              </span>
            )}
          </Typography>

          <Chip
            size="small"
            label={sessionData.has_dsd_overrides ? "esp/dsd" : "esp"}
            color={sessionData.has_dsd_overrides ? "secondary" : "default"}
            variant={sessionData.has_dsd_overrides ? "filled" : "outlined"}
            sx={{ mx: 1 }}
          />

          {/* 筛选Chips */}
          <Box sx={{ display: "flex", gap: 0.5, ml: 2 }}>
            <Chip
              label="全部"
              size="small"
              variant={currentFilter === "all" ? "filled" : "outlined"}
              color={currentFilter === "all" ? "primary" : "default"}
              onClick={() => handleFilterChange("all")}
            />
            <Chip
              label="未翻译"
              size="small"
              variant={currentFilter === "untranslated" ? "filled" : "outlined"}
              color={currentFilter === "untranslated" ? "primary" : "default"}
              onClick={() => handleFilterChange("untranslated")}
            />
            <Chip
              label="已翻译"
              size="small"
              variant={currentFilter === "manual" ? "filled" : "outlined"}
              color={currentFilter === "manual" ? "primary" : "default"}
              onClick={() => handleFilterChange("manual")}
            />
            <Chip
              label="AI翻译"
              size="small"
              variant={currentFilter === "ai" ? "filled" : "outlined"}
              color={currentFilter === "ai" ? "primary" : "default"}
              onClick={() => handleFilterChange("ai")}
            />
          </Box>

          {/* 加载 ESP 对照按钮 */}
          <Tooltip title="从已翻译的 ESP/ESM/ESL 文件导入翻译">
            <span style={{ marginLeft: "auto" }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={
                  isLoadingReference ? (
                    <CircularProgress size={16} />
                  ) : (
                    <CompareArrowsIcon />
                  )
                }
                onClick={handleLoadEspReference}
                disabled={isLoadingReference}
              >
                {isLoadingReference ? "加载中..." : "ESP对照"}
              </Button>
            </span>
          </Tooltip>

          {/* 撤销按钮 */}
          <Badge
            badgeContent={undoCount}
            color="info"
            sx={{ ml: 1 }}
          >
            <Tooltip title={undoCount > 0 ? `撤销最近的操作 (Ctrl+Z)` : "没有可撤销的操作"}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<UndoIcon />}
                  onClick={handleUndo}
                  disabled={undoCount === 0}
                >
                  撤销
                </Button>
              </span>
            </Tooltip>
          </Badge>

          {/* AI翻译按钮 */}
          <Badge
            badgeContent={selectedCount}
            color="primary"
            sx={{ ml: 1 }}
          >
            <Tooltip
              title={
                !currentApi
                  ? "请先在设置中配置并激活API"
                  : selectedCount === 0
                    ? "未选择时将自动翻译当前页的“未翻译”条目"
                    : ""
              }
            >
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  startIcon={<TranslateIcon />}
                  onClick={handleAiTranslate}
                  disabled={isAiTranslating || !currentApi}
                >
                  {isAiTranslating ? "AI翻译中..." : "AI翻译"}
                </Button>
              </span>
            </Tooltip>
          </Badge>

          {/* 保存翻译到数据库 */}
          <Badge badgeContent={pendingCount} color="error" sx={{ ml: 1 }}>
            <Tooltip title={isSaving ? "保存中..." : "保存翻译到数据库"}>
              <span>
                <IconButton
                  size="small"
                  color="secondary"
                  onClick={handleSaveTranslations}
                  disabled={isSaving || pendingCount === 0}
                >
                  <SaveIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Badge>

          {/* 应用翻译到插件文件 */}
          <Tooltip title="应用翻译到插件文件">
            <span>
              <IconButton
                size="small"
                color="success"
                sx={{ ml: 0.5 }}
                onClick={async () => {
                  if (useSessionStore.getState().applyTranslations) {
                    try {
                      setIsSaving(true);
                      await useSessionStore.getState().applyTranslations!(
                        sessionData.session_id,
                      );
                      showSuccess("成功应用翻译到插件文件");
                    } catch (error) {
                      showError("应用翻译失败: " + String(error));
                    } finally {
                      setIsSaving(false);
                    }
                  }
                }}
                disabled={isSaving}
              >
                <PublishIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          {/* 导出 DSD 格式 */}
          <Tooltip title="导出为 DSD 格式">
            <span>
              <IconButton
                size="small"
                color="info"
                sx={{ ml: 0.5 }}
                onClick={async () => {
                  if (useSessionStore.getState().exportDsd) {
                    try {
                      setIsSaving(true);
                      const savedPath = await useSessionStore.getState().exportDsd!(
                        sessionData.session_id,
                      );
                      showSuccess(`DSD 已导出到: ${savedPath}`);
                    } catch (error) {
                      showError("导出 DSD 失败: " + String(error));
                    } finally {
                      setIsSaving(false);
                    }
                  }
                }}
                disabled={isSaving}
              >
                <FileDownloadIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={showInfo ? "隐藏详情" : "查看插件详情"}>
            <IconButton size="small" onClick={() => setShowInfo(!showInfo)}>
              <InfoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* 信息详情（可折叠） */}
        <Fade in={showInfo}>
          <Box sx={{ display: showInfo ? "block" : "none", mb: 1 }}>
            <Typography variant="caption" color="text.disabled">
              插件路径: {sessionData.plugin_path}
            </Typography>
          </Box>
        </Fade>

        {/* 进度区域（动态显示） */}
        <Fade in={isLoadingTranslations}>
          <Box sx={{ display: isLoadingTranslations ? "block" : "none" }}>
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
            >
              <Typography variant="caption" color="primary">
                📥 获取数据库翻译
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {progress?.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress || 0}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Box>
        </Fade>
      </Paper>

      {/* 表格区域（占满剩余空间） */}
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <StringTable
          rows={filteredStrings}
          sessionId={sessionData.session_id}
          paginationModel={paginationModel}
          onPaginationModelChange={handlePaginationModelChange}
        />
      </Box>

      {/* AI翻译进度对话框 */}
      <Dialog open={isAiTranslating} disableEscapeKeyDown>
        <DialogTitle>AI翻译中...</DialogTitle>
        <DialogContent sx={{ minWidth: 450 }}>
          {/* 顶部状态条 - 基础版 */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
              p: 1,
              bgcolor: "action.hover",
              borderRadius: 1,
            }}
          >
            <Chip
              label={currentApi?.name}
              size="small"
              color="primary"
              variant="outlined"
            />
            <Box sx={{ textAlign: "right" }}>
              <Typography variant="caption" color="text.secondary">
                迭代 #{currentIteration}
              </Typography>
              {contextUsagePercent !== null && (
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    color: "text.disabled",
                    fontSize: "0.68rem",
                    lineHeight: 1.2,
                  }}
                >
                  Context ~{contextUsagePercent.toFixed(1)}% used
                </Typography>
              )}
            </Box>
          </Box>

          {/* 进度显示 */}
          <Box sx={{ mb: 2 }}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                mb: 0.5,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                进度: {aiCompleted} / {aiTotal}
              </Typography>
              <Typography variant="body2" color="primary">
                {aiProgress.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={aiProgress}
              sx={{
                "& .MuiLinearProgress-bar": {
                  animation: isHeartbeatActive
                    ? "pulse 1.5s ease-in-out infinite"
                    : "none",
                },
                "@keyframes pulse": {
                  "0%, 100%": { opacity: 1 },
                  "50%": { opacity: 0.6 },
                },
              }}
            />
          </Box>

          {/* 心跳 Thinking 动画 */}
          {isHeartbeatActive && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 1,
                mb: 1,
              }}
            >
              <CircularProgress size={14} thickness={5} />
              <ThinkingText variant="body2">
                AI 正在思考中，请耐心等待...
              </ThinkingText>
            </Box>
          )}

          {/* 滚动状态列表 - 最近 5 条，带 iOS 风格堆叠动画 */}
          <Box
            sx={{
              maxHeight: 200,
              overflowY: "auto",
              overflowX: "hidden",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              "&::-webkit-scrollbar": { display: "none" },
              MsOverflowStyle: "none",
              scrollbarWidth: "none",
            }}
          >
            <List dense disablePadding>
              <AnimatePresence mode="popLayout" initial={false}>
                {statusHistory.map((status) => (
                  <motion.div
                    key={status.id}
                    layout
                    variants={statusItemVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    <ListItem
                      sx={{
                        py: 0.5,
                        borderBottom: 1,
                        borderColor: "divider",
                        "&:last-child": { borderBottom: 0 },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        {status.type === "error" ? (
                          <ErrorOutlineIcon color="error" fontSize="small" />
                        ) : status.type === "success" ? (
                          <CheckCircleOutlineIcon
                            color="success"
                            fontSize="small"
                          />
                        ) : (
                          <InfoOutlinedIcon color="info" fontSize="small" />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={status.message}
                        primaryTypographyProps={{
                          variant: "body2",
                          noWrap: false,
                          sx: { wordBreak: "break-word" },
                        }}
                      />
                    </ListItem>
                  </motion.div>
                ))}
              </AnimatePresence>
              {statusHistory.length === 0 && !isHeartbeatActive && (
                <ListItem>
                  <ListItemText
                    primary="等待 AI 响应..."
                    primaryTypographyProps={{
                      variant: "body2",
                      color: "text.secondary",
                      fontStyle: "italic",
                    }}
                  />
                </ListItem>
              )}
            </List>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCancelTranslation}
            color="error"
            variant="outlined"
          >
            取消翻译
          </Button>
        </DialogActions>
      </Dialog>

      {/* 查找替换对话框 */}
      <ReplaceDialog
        open={replaceDialogOpen}
        onClose={() => setReplaceDialogOpen(false)}
        sessionId={sessionData.session_id}
        records={filteredStrings}
        onReplace={handleReplace}
      />
    </Box>
  );
}
