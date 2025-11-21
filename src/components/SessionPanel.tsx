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
  DialogContentText,
  DialogActions,
  Alert,
} from "@mui/material";
import type { GridPaginationModel } from "@mui/x-data-grid";
import InfoIcon from "@mui/icons-material/Info";
import SaveIcon from "@mui/icons-material/Save";
import TranslateIcon from "@mui/icons-material/Translate";
import UndoIcon from "@mui/icons-material/Undo";
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
import { useState, useMemo, useRef, useEffect } from "react";
import {
  translateBatchWithAI,
  createCancellationToken,
  type TranslationEntry,
  type CancellationToken,
  type AiStatusUpdate,
} from "../utils/aiTranslation";

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
    pageSize: 50,
  });

  // AI翻译状态
  const [isAiTranslating, setIsAiTranslating] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiCompleted, setAiCompleted] = useState(0);
  const [aiTotal, setAiTotal] = useState(0);
  const [aiStatus, setAiStatus] = useState<AiStatusUpdate | null>(null);

  // 取消令牌（使用 useRef 避免重新创建）
  const cancellationTokenRef = useRef<CancellationToken | null>(null);

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

    // 开始AI翻译
    setIsAiTranslating(true);
    setAiProgress(0);
    setAiCompleted(0);
    setAiTotal(entries.length);

    // 创建取消令牌
    const cancellationToken = createCancellationToken();
    cancellationTokenRef.current = cancellationToken;

    try {
      const result = await translateBatchWithAI(
        entries,
        currentApi,
        (completed, total) => {
          // 进度回调
          setAiCompleted(completed);
          setAiTotal(total);
          setAiProgress((completed / total) * 100);
        },
        (_index, recIndex, formId, recordType, subrecordType, translated) => {
          // Apply回调：更新UI（跳过历史记录）
          if (updateStringRecord) {
            updateStringRecord(
              sessionData.session_id,
              formId,
              recordType,
              subrecordType,
              recIndex,
              translated,
              "ai", // 标记为AI翻译
              true, // ⚠️ skipHistory=true：跳过单条历史记录
            );
          }

          // 更新 historyRecords 中对应记录的 afterState
          const recordId = `${formId}|${recordType}|${subrecordType}|${recIndex}`;
          const historyRecord = historyRecords.find((hr) => hr.recordId === recordId);
          if (historyRecord) {
            const afterRecord = sessionData.strings.find(
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
        cancellationToken, // 传递取消令牌
        (status) => setAiStatus(status),
      );

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
      setIsAiTranslating(false);
      setAiProgress(0);
      cancellationTokenRef.current = null;
      setAiStatus(null);
    }
  };

  // 取消AI翻译
  const handleCancelTranslation = () => {
    if (cancellationTokenRef.current) {
      setAiStatus({ type: "info", message: "正在尝试取消翻译..." });
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

          {/* 撤销按钮 */}
          <Badge
            badgeContent={undoCount}
            color="info"
            sx={{ ml: "auto" }}
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

          <Badge badgeContent={pendingCount} color="error" sx={{ ml: 1 }}>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              startIcon={<SaveIcon />}
              onClick={handleSaveTranslations}
              disabled={isSaving || pendingCount === 0}
            >
              {isSaving ? "保存中..." : "保存翻译"}
            </Button>
          </Badge>

          {/* 应用到插件按钮 */}
          <Button
            size="small"
            variant="contained"
            color="success"
            sx={{ ml: 1 }}
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
            应用到插件
          </Button>

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
          onPaginationModelChange={setPaginationModel}
        />
      </Box>

      {/* AI翻译进度对话框 */}
      <Dialog open={isAiTranslating} disableEscapeKeyDown>
        <DialogTitle>AI翻译中...</DialogTitle>
        <DialogContent sx={{ minWidth: 400 }}>
          <DialogContentText>
            正在使用 {currentApi?.name} 进行翻译，请稍候...
          </DialogContentText>
          <Box sx={{ mt: 2 }}>
            <Box
              sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}
            >
              <Typography variant="body2" color="text.secondary">
                进度: {aiCompleted} / {aiTotal}
              </Typography>
              <Typography variant="body2" color="primary">
                {aiProgress.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress variant="determinate" value={aiProgress} />
            {aiStatus && (
              <Alert severity={aiStatus.type} variant="outlined" sx={{ mt: 2 }}>
                {aiStatus.message}
              </Alert>
            )}
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
