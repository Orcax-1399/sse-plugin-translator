import { useEffect, useRef, useCallback, useMemo } from "react";
import {
  Box,
  Button,
  Typography,
  Paper,
  Chip,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
  Divider,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningIcon from "@mui/icons-material/Warning";
import { useCoverageStore } from "../../stores/coverageStore";
import ExtractionProgress from "./ExtractionProgress";

/**
 * 覆盖状态检测面板
 */
export default function CoverageStatusPanel() {
  const {
    status,
    extractionProgress,
    lastExtractionStats,
    isLoadingStatus,
    isExtracting,
    error,
    fetchStatus,
    startExtraction,
    pollProgress,
    clearError,
  } = useCoverageStore();

  const pollIntervalRef = useRef<number | null>(null);

  // 初始加载状态
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 提取过程中轮询进度
  useEffect(() => {
    if (isExtracting) {
      pollIntervalRef.current = window.setInterval(() => {
        pollProgress();
      }, 500);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isExtracting, pollProgress]);

  // 格式化时间戳
  const formatTimestamp = useCallback((timestamp: number | null) => {
    if (!timestamp) return "从未";
    const date = new Date(timestamp * 1000);
    return date.toLocaleString("zh-CN");
  }, []);

  const formatPosition = useCallback((position?: number | null) => {
    if (typeof position === "number") {
      return `#${position + 1}`;
    }
    return "未知序号";
  }, []);

  const snapshotLabel = useMemo(() => {
    if (!status) return "未知";
    if (!status.has_snapshot) return "尚未生成";
    return formatTimestamp(status.snapshot_timestamp ?? null);
  }, [status, formatTimestamp]);

  const loadOrderAvailable = status?.load_order_available ?? false;

  // 处理开始提取
  const handleStartExtraction = async () => {
    clearError();
    await startExtraction();
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* 错误提示 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={clearError}>
          {error}
        </Alert>
      )}

      {/* 提取完成提示 */}
      {lastExtractionStats && !isExtracting && (
        <Alert
          severity={lastExtractionStats.failed_plugins > 0 ? "warning" : "success"}
          sx={{ mb: 2 }}
        >
          提取完成: {lastExtractionStats.processed_plugins}/
          {lastExtractionStats.total_plugins} 个插件,{" "}
          {lastExtractionStats.total_records} 条记录
          {lastExtractionStats.failed_plugins > 0 &&
            ` (${lastExtractionStats.failed_plugins} 个失败)`}
        </Alert>
      )}

      {/* 状态卡片 */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 500, mr: 2 }}>
            同步状态:
          </Typography>
          {isLoadingStatus ? (
            <CircularProgress size={20} />
          ) : status ? (
            status.has_snapshot ? (
              status.in_sync ? (
                <Chip
                  icon={<CheckCircleIcon />}
                  label="已同步"
                  color="success"
                  size="small"
                />
              ) : (
                <Chip
                  icon={<WarningIcon />}
                  label="需要更新"
                  color="warning"
                  size="small"
                />
              )
            ) : (
              <Chip label="尚未提取" color="info" size="small" />
            )
          ) : (
            <Chip label="未知" size="small" />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary">
          上次快照: {snapshotLabel}
        </Typography>
        {status && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            当前插件: {status.current_count} 个 · 快照: {status.snapshot_count} 个
          </Typography>
        )}
      </Paper>

      {status && !loadOrderAvailable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          未检测到 loadorder.txt，可能未通过 Mod 管理器启动。请先生成 load order 后再进行覆盖提取。
        </Alert>
      )}

      {/* 操作按钮 */}
      <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={fetchStatus}
          disabled={isLoadingStatus || isExtracting}
        >
          刷新状态
        </Button>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={handleStartExtraction}
          disabled={isExtracting || !loadOrderAvailable}
        >
          {isExtracting ? "提取中..." : "开始提取"}
        </Button>
      </Box>

      {/* 提取进度 */}
      {isExtracting && extractionProgress && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            提取进度
          </Typography>
          <ExtractionProgress progress={extractionProgress} />
        </Paper>
      )}

      {/* 差异详情 */}
      {status && status.has_snapshot && !status.in_sync && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            差异详情
          </Typography>

          <Box sx={{ display: "flex", gap: 2 }}>
            {/* 新增插件 */}
            <Paper variant="outlined" sx={{ flex: 1, p: 2 }}>
              <Typography
                variant="subtitle2"
                color="success.main"
                sx={{ mb: 1 }}
              >
                新增插件 ({status.extra_plugins.length})
              </Typography>
              {status.extra_plugins.length > 0 ? (
                <List dense disablePadding>
                  {status.extra_plugins.map((plugin) => (
                    <ListItem
                      key={`extra-${plugin.plugin_name}`}
                      disablePadding
                    >
                      <ListItemText
                        primary={plugin.plugin_name}
                        primaryTypographyProps={{ variant: "body2" }}
                        secondary={
                          plugin.current_position != null || plugin.plugin_path
                            ? [
                                plugin.current_position != null
                                  ? `当前序号 ${formatPosition(plugin.current_position)}`
                                  : null,
                                plugin.plugin_path,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : undefined
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  无
                </Typography>
              )}
            </Paper>

            {/* 移除插件 */}
            <Paper variant="outlined" sx={{ flex: 1, p: 2 }}>
              <Typography variant="subtitle2" color="error.main" sx={{ mb: 1 }}>
                移除插件 ({status.missing_plugins.length})
              </Typography>
              {status.missing_plugins.length > 0 ? (
                <List dense disablePadding>
                  {status.missing_plugins.map((plugin) => (
                    <ListItem
                      key={`missing-${plugin.plugin_name}`}
                      disablePadding
                    >
                      <ListItemText
                        primary={plugin.plugin_name}
                        primaryTypographyProps={{ variant: "body2" }}
                        secondary={
                          plugin.snapshot_position != null || plugin.plugin_path
                            ? [
                                plugin.snapshot_position != null
                                  ? `快照序号 ${formatPosition(plugin.snapshot_position)}`
                                  : null,
                                plugin.plugin_path,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : undefined
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  无
                </Typography>
              )}
            </Paper>
          </Box>
        </>
      )}
    </Box>
  );
}
