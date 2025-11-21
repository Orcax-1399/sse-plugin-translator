import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Stack,
  Typography,
  Switch,
  FormControlLabel,
  IconButton,
  Tooltip,
  Alert,
  Chip,
  Paper,
  Divider,
} from "@mui/material";
import {
  FindReplace,
  Search,
  AutoFixHigh,
  Close,
} from "@mui/icons-material";
import { useState, useEffect, useRef } from "react";
import type { StringRecord } from "../../types";

interface ReplaceDialogProps {
  /** 是否打开对话框 */
  open: boolean;
  /** 关闭对话框回调 */
  onClose: () => void;
  /** Session ID */
  sessionId: string;
  /** 字符串记录列表 */
  records: StringRecord[];
  /** 执行替换回调 */
  onReplace: (updates: Array<{ formId: string; recordType: string; subrecordType: string; index: number; translatedText: string }>) => void;
}

/**
 * 匹配项接口
 */
interface MatchItem {
  record: StringRecord;
  before: string;
  after: string;
}

/**
 * 查找替换对话框组件
 *
 * 支持：
 * - 正则表达式和普通文本查找
 * - 大小写敏感选项
 * - AI辅助生成正则表达式（预留接口）
 * - 预览替换结果
 */
export default function ReplaceDialog({
  open,
  onClose,
  records,
  onReplace,
}: ReplaceDialogProps) {
  // 查找替换状态
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 聚焦管理
  const findInputRef = useRef<HTMLInputElement>(null);

  // 对话框打开时自动聚焦查找输入框
  useEffect(() => {
    if (open && findInputRef.current) {
      setTimeout(() => {
        findInputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // 对话框关闭时重置状态
  useEffect(() => {
    if (!open) {
      setFindText("");
      setReplaceText("");
      setMatches([]);
      setError(null);
      setUseRegex(false);
      setCaseSensitive(false);
    }
  }, [open]);

  /**
   * 执行查找
   */
  const handleFind = () => {
    setError(null);

    if (!findText.trim()) {
      setError("请输入查找内容");
      return;
    }

    try {
      let pattern: RegExp;

      if (useRegex) {
        // 正则表达式模式
        const flags = caseSensitive ? "g" : "gi";
        pattern = new RegExp(findText, flags);
      } else {
        // 普通文本模式（转义特殊字符）
        const escapedText = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const flags = caseSensitive ? "g" : "gi";
        pattern = new RegExp(escapedText, flags);
      }

      // 查找匹配项
      const matchedItems: MatchItem[] = [];

      for (const record of records) {
        const text = record.translated_text;
        if (pattern.test(text)) {
          // 计算替换后的文本
          const after = text.replace(pattern, replaceText);

          matchedItems.push({
            record,
            before: text,
            after,
          });

          // 重置正则的 lastIndex（避免全局正则的状态问题）
          pattern.lastIndex = 0;
        }
      }

      setMatches(matchedItems);

      if (matchedItems.length === 0) {
        setError("未找到匹配项");
      }
    } catch (err) {
      setError(`正则表达式错误: ${err instanceof Error ? err.message : String(err)}`);
      setMatches([]);
    }
  };

  /**
   * 执行替换
   */
  const handleReplace = () => {
    if (matches.length === 0) {
      return;
    }

    // 构造更新列表
    const updates = matches.map((match) => ({
      formId: match.record.form_id,
      recordType: match.record.record_type,
      subrecordType: match.record.subrecord_type,
      index: match.record.index,
      translatedText: match.after,
    }));

    // 执行替换
    onReplace(updates);

    // 关闭对话框
    onClose();
  };

  /**
   * AI辅助生成正则表达式（预留接口）
   */
  const handleAiAssist = async () => {
    setAiLoading(true);
    setError(null);

    try {
      // TODO: 调用后端AI接口
      // const regex = await invoke<string>('ai_generate_regex', {
      //   description: findText,
      //   mode: findText && /^[\/\\^$.*+?()[\]{}|]/.test(findText) ? 'optimize' : 'generate'
      // });
      // setFindText(regex);
      // setUseRegex(true);

      // 临时提示
      setError("AI辅助功能即将推出，敬请期待！");
    } catch (err) {
      setError(`AI辅助失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiLoading(false);
    }
  };

  /**
   * 键盘快捷键处理
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (matches.length > 0) {
        handleReplace();
      } else {
        handleFind();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      onKeyDown={handleKeyDown}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <FindReplace color="primary" />
          <Typography variant="h6">查找替换</Typography>
          <Chip
            label={`${records.length} 条记录`}
            size="small"
            color="default"
            sx={{ ml: "auto" }}
          />
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5}>
          {/* 查找输入框 */}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              查找内容
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                inputRef={findInputRef}
                fullWidth
                size="small"
                placeholder={useRegex ? "输入正则表达式或描述..." : "输入查找文本..."}
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleFind();
                  }
                }}
              />
              <Tooltip title="AI辅助生成正则表达式">
                <IconButton
                  size="small"
                  color="primary"
                  onClick={handleAiAssist}
                  disabled={aiLoading || !findText.trim()}
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <AutoFixHigh fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* 替换输入框 */}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              替换为
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder="输入替换文本..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
            />
          </Box>

          {/* 选项 */}
          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={useRegex}
                  onChange={(e) => setUseRegex(e.target.checked)}
                />
              }
              label={<Typography variant="body2">正则表达式</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                />
              }
              label={<Typography variant="body2">大小写敏感</Typography>}
            />
          </Box>

          {/* 查找按钮 */}
          <Button
            variant="contained"
            startIcon={<Search />}
            onClick={handleFind}
            disabled={!findText.trim()}
            fullWidth
          >
            查找匹配项 {matches.length > 0 && `(${matches.length} 个)`}
          </Button>

          {/* 错误提示 */}
          {error && (
            <Alert severity="warning" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* 预览列表 */}
          {matches.length > 0 && (
            <>
              <Divider />
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  预览替换结果（共 {matches.length} 条）
                </Typography>
                <Box
                  sx={{
                    maxHeight: "300px",
                    overflow: "auto",
                    "&::-webkit-scrollbar": {
                      width: "6px",
                    },
                    "&::-webkit-scrollbar-track": {
                      background: "rgba(0, 0, 0, 0.05)",
                    },
                    "&::-webkit-scrollbar-thumb": {
                      background: "rgba(0, 0, 0, 0.2)",
                      borderRadius: "6px",
                    },
                  }}
                >
                  <Stack spacing={1}>
                    {matches.map((match, index) => (
                      <Paper
                        key={index}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          bgcolor: "grey.50",
                        }}
                      >
                        <Stack spacing={0.5}>
                          {/* 记录信息 */}
                          <Typography variant="caption" color="text.secondary">
                            #{index + 1} · {match.record.record_type}
                            {match.record.subrecord_type && ` · ${match.record.subrecord_type}`}
                            {" · "}索引 {match.record.index}
                          </Typography>

                          {/* 原文（灰色小字） */}
                          <Typography
                            variant="caption"
                            color="text.disabled"
                            sx={{
                              fontFamily: "monospace",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            原文: {match.record.original_text}
                          </Typography>

                          {/* 替换前（删除线） */}
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: "monospace",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              textDecoration: "line-through",
                              color: "error.main",
                            }}
                          >
                            {match.before}
                          </Typography>

                          {/* 替换后（绿色高亮） */}
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: "monospace",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              color: "success.main",
                              fontWeight: "bold",
                            }}
                          >
                            {match.after}
                          </Typography>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              </Box>
            </>
          )}

          {/* 快捷键提示 */}
          <Box
            sx={{
              p: 1.5,
              bgcolor: "info.lighter",
              borderRadius: 1,
              border: "1px solid",
              borderColor: "info.light",
            }}
          >
            <Typography variant="caption" color="text.secondary">
              <strong>快捷键：</strong>
              Enter {matches.length > 0 ? "执行替换" : "查找"} | Esc 关闭
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" onClick={onClose} startIcon={<Close />}>
          取消
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={handleReplace}
          disabled={matches.length === 0}
        >
          执行替换 ({matches.length} 条)
        </Button>
      </DialogActions>
    </Dialog>
  );
}
