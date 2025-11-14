import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stack,
} from "@mui/material";
import { ContentCopy, Check } from "@mui/icons-material";
import { useEffect, useRef } from "react";

interface BatchApplyConfirmModalProps {
  open: boolean;
  originalText: string;
  matchCount: number;
  onConfirm: (applyAll: boolean) => void;
  onClose: () => void;
}

/**
 * 批量应用翻译确认对话框
 *
 * 当发现多个相同的原文时，提示用户是否批量应用翻译
 */
export default function BatchApplyConfirmModal({
  open,
  originalText,
  matchCount,
  onConfirm,
  onClose,
}: BatchApplyConfirmModalProps) {
  const batchButtonRef = useRef<HTMLButtonElement>(null);

  // 对话框打开时自动聚焦批量应用按钮
  useEffect(() => {
    if (open && batchButtonRef.current) {
      // 延迟聚焦，确保对话框完全渲染
      setTimeout(() => {
        batchButtonRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onConfirm(true); // Enter 确认批量应用
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose(); // Esc 取消
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      onKeyDown={handleKeyDown}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <ContentCopy color="primary" />
          <Typography variant="h6">发现相同原文</Typography>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2}>
          {/* 提示信息 */}
          <Typography variant="body1">
            在当前 session 中发现{" "}
            <Typography
              component="span"
              color="primary"
              fontWeight="bold"
              fontSize="1.2em"
            >
              {matchCount}
            </Typography>{" "}
            个相同的原文。
          </Typography>

          {/* 原文预览 */}
          <Box
            sx={{
              p: 2,
              bgcolor: "grey.100",
              borderRadius: 1,
              border: "1px solid",
              borderColor: "grey.300",
              maxHeight: "150px",
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
            <Typography
              variant="body2"
              sx={{
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {originalText}
            </Typography>
          </Box>

          {/* 询问信息 */}
          <Typography variant="body2" color="text.secondary">
            是否将当前的译文统一应用到所有匹配的条目？
          </Typography>

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
              <strong>快捷键：</strong>Enter 确认批量应用 | Esc 取消
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" onClick={() => onConfirm(false)}>
          仅应用当前
        </Button>
        <Button
          ref={batchButtonRef}
          variant="contained"
          startIcon={<Check />}
          onClick={() => onConfirm(true)}
          autoFocus
        >
          批量应用 ({matchCount} 个)
        </Button>
      </DialogActions>
    </Dialog>
  );
}
