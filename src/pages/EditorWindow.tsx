import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Container,
  Typography,
  Button,
  Stack,
  Divider,
  Chip,
} from "@mui/material";
import { Save, Close } from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { StringRecord, Translation } from "../types";
import TranslationReferencePanel from "../components/TranslationReferencePanel";
import { showSuccess, showError } from "../stores/notificationStore";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { bookDescExtensions, editorFontFamily } from "../utils/customSyntax";

/**
 * 编辑窗口页面
 *
 * 用于编辑单条翻译记录
 */
export default function EditorWindow() {
  const [record, setRecord] = useState<StringRecord | null>(null);
  const [translatedText, setTranslatedText] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [references, setReferences] = useState<Translation[]>([]);
  const [loadingReferences, setLoadingReferences] = useState(false);

  // ✅ 组件加载后主动拉取数据
  useEffect(() => {
    const loadEditorData = async () => {
      try {
        // 获取当前窗口标签
        const window = getCurrentWebviewWindow();
        const windowLabel = window.label;

        console.log("✓ 编辑窗口已准备好");
        console.log("  窗口标签:", windowLabel);
        console.log("  准备拉取数据...");

        // 添加超时保护
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("获取数据超时（5秒）")), 5000),
        );

        const dataPromise = invoke<StringRecord>("get_editor_data", {
          windowLabel,
        });

        // 从后端拉取数据（带超时）
        const data = await Promise.race([dataPromise, timeoutPromise]);

        console.log("✓ 收到编辑数据:", data);

        setRecord(data);
        setTranslatedText(data.translated_text);
      } catch (error) {
        console.error("❌ 加载编辑数据失败:", error);
        showError("加载编辑数据失败: " + String(error));

        // 如果加载失败，显示错误信息而不是一直显示"加载中..."
        setRecord({
          form_id: "ERROR",
          editor_id: null,
          record_type: "ERROR",
          subrecord_type: "ERROR",
          index: 0,
          original_text: "加载失败: " + String(error),
          translated_text: "",
          translation_status: "untranslated",
        });
      }
    };

    // 延迟一小段时间确保窗口完全初始化
    const timer = setTimeout(() => {
      console.log("→ 开始加载编辑器数据...");
      loadEditorData();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // 监听原文区域的文本选择
  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text && text.length > 0) {
      setSelectedText(text);
      // 查询参考翻译
      queryReferences(text);
    } else {
      setSelectedText("");
      setReferences([]);
    }
  }, []);

  // 查询参考翻译
  const queryReferences = async (text: string) => {
    try {
      setLoadingReferences(true);
      const results = await invoke<Translation[]>("query_word_translations", {
        text,
        limit: 3,
      });
      setReferences(results);
    } catch (error) {
      console.error("查询参考翻译失败:", error);
      setReferences([]);
    } finally {
      setLoadingReferences(false);
    }
  };

  // 复制参考翻译到译文区
  const handleCopyReference = (text: string) => {
    setTranslatedText(text);
    showSuccess("已复制到译文区");
  };

  // 应用翻译
  const handleApplyTranslation = async () => {
    if (!record) return;

    try {
      // 发射事件到主窗口（更新数据）
      await getCurrentWebviewWindow().emit("translation-updated", {
        form_id: record.form_id,
        record_type: record.record_type,
        subrecord_type: record.subrecord_type,
        index: record.index,
        original_text: record.original_text, // ✅ 添加 original_text
        translated_text: translatedText,
        translation_status: "manual",
      });

      showSuccess("翻译已应用");

      // 关闭窗口
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error("应用翻译失败:", error);
      showError("应用翻译失败: " + String(error));
    }
  };

  // 取消编辑
  const handleCancel = async () => {
    try {
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error("关闭窗口失败:", error);
    }
  };

  if (!record) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <Typography variant="h6" color="text.secondary">
          加载中...
        </Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ height: "100vh", py: 3 }}>
      <Stack spacing={2} sx={{ height: "100%" }}>
        {/* 标题栏 */}
        <Box>
          <Typography variant="h5" gutterBottom>
            编辑翻译
          </Typography>
          <Stack direction="row" spacing={1}>
            <Chip label={record.record_type} size="small" color="primary" />
            <Chip
              label={record.subrecord_type}
              size="small"
              color="secondary"
            />
            {record.editor_id && (
              <Chip label={record.editor_id} size="small" variant="outlined" />
            )}
            <Chip label={record.form_id} size="small" variant="outlined" />
          </Stack>
        </Box>

        <Divider />

        {/* 主编辑区域 */}
        <Box sx={{ flex: 1, display: "flex", gap: 2, overflow: "hidden" }}>
          {/* 左侧：原文 */}
          <Box
            sx={{
              flex: 1,
              maxWidth: "50%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              原文
            </Typography>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                overflow: "auto",
                "&::-webkit-scrollbar": {
                  width: "6px",
                  height: "6px",
                },
                "&::-webkit-scrollbar-track": {
                  background: "rgba(0, 0, 0, 0.05)",
                },
                "&::-webkit-scrollbar-thumb": {
                  background: "rgba(0, 0, 0, 0.2)",
                  borderRadius: "6px",
                },
                "&::-webkit-scrollbar-thumb:hover": {
                  background: "rgba(0, 0, 0, 0.3)",
                },
                "& .cm-editor": {
                  height: "auto",
                },
                "& .cm-scroller": {
                  overflow: "visible !important",
                },
              }}
              onMouseUp={handleTextSelection}
            >
              <CodeMirror
                value={record.original_text}
                editable={false}
                basicSetup={{
                  lineNumbers: false,
                  foldGutter: false,
                  highlightActiveLine: false,
                  highlightActiveLineGutter: false,
                }}
                extensions={[
                  ...bookDescExtensions,
                  EditorView.lineWrapping,
                  EditorView.theme({
                    "&": {
                      backgroundColor: "rgba(0, 0, 0, 0.02)",
                      fontSize: "14px",
                      fontFamily: editorFontFamily,
                    },
                    ".cm-content": {
                      padding: "16px",
                      lineHeight: "1.8",
                      caretColor: "transparent",
                      overflowWrap: "anywhere",
                    },
                    ".cm-line": {
                      wordBreak: "break-word",
                    },
                  }),
                ]}
              />
            </Box>

            {/* 选中文本提示 */}
            {selectedText && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  已选中: {selectedText}
                </Typography>
              </Box>
            )}

            {/* 参考翻译面板 */}
            <TranslationReferencePanel
              references={references}
              loading={loadingReferences}
              onCopy={handleCopyReference}
            />
          </Box>

          {/* 右侧：译文 */}
          <Box
            sx={{
              flex: 1,
              maxWidth: "50%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              译文
            </Typography>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                overflow: "auto",
                "&::-webkit-scrollbar": {
                  width: "6px",
                  height: "6px",
                },
                "&::-webkit-scrollbar-track": {
                  background: "rgba(0, 0, 0, 0.05)",
                },
                "&::-webkit-scrollbar-thumb": {
                  background: "rgba(0, 0, 0, 0.2)",
                  borderRadius: "6px",
                },
                "&::-webkit-scrollbar-thumb:hover": {
                  background: "rgba(0, 0, 0, 0.3)",
                },
                "& .cm-editor": {
                  height: "auto",
                },
                "& .cm-scroller": {
                  overflow: "visible !important",
                },
              }}
            >
              <CodeMirror
                value={translatedText}
                onChange={(value) => setTranslatedText(value)}
                placeholder="请输入译文..."
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                }}
                extensions={[
                  ...bookDescExtensions,
                  EditorView.lineWrapping,
                  EditorView.theme({
                    "&": {
                      backgroundColor: "#ffffff",
                      fontSize: "14px",
                      fontFamily: editorFontFamily,
                    },
                    ".cm-content": {
                      padding: "16px",
                      lineHeight: "1.8",
                      overflowWrap: "anywhere",
                    },
                    ".cm-line": {
                      wordBreak: "break-word",
                    },
                    "&.cm-focused": {
                      outline: "none",
                    },
                  }),
                ]}
              />
            </Box>
          </Box>
        </Box>

        <Divider />

        {/* 底部工具栏 */}
        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button
            variant="outlined"
            startIcon={<Close />}
            onClick={handleCancel}
          >
            取消
          </Button>
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleApplyTranslation}
            disabled={!translatedText.trim()}
          >
            应用翻译
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
}
