import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Divider,
} from "@mui/material";
import { useSessionStore } from "../../stores/sessionStore";
import { showSuccess, showError } from "../../stores/notificationStore";
import type { EspReferencePayload } from "./EspReferenceListener";

interface Props {
  data: EspReferencePayload | null;
  onClose: () => void;
}

/**
 * ESP 对照确认 Modal
 *
 * 显示导入统计信息，让用户选择替换策略：
 * - 替换未翻译：只替换 translation_status === "untranslated" 的记录
 * - 替换全部：替换所有匹配的记录
 */
export default function EspReferenceModal({ data, onClose }: Props) {
  if (!data) return null;

  /**
   * 执行替换操作
   * @param mode - 替换模式：'untranslated' 只替换未翻译，'all' 替换全部
   */
  const handleReplace = (mode: "untranslated" | "all") => {
    const { openedSessions, batchUpdateStringRecords } =
      useSessionStore.getState();
    const session = openedSessions.get(data.session_id);

    if (!session || !batchUpdateStringRecords) {
      showError("Session 不存在或 batchUpdateStringRecords 未定义");
      onClose();
      return;
    }

    // 1. 构建 RecordKey -> translatedText 映射
    const referenceMap = new Map<string, string>();
    for (const r of data.records) {
      const key = `${r.form_id}|${r.record_type}|${r.subrecord_type}|${r.index}`;
      referenceMap.set(key, r.translated_text);
    }

    // 2. 筛选需要更新的记录
    const updates: Array<{
      formId: string;
      recordType: string;
      subrecordType: string;
      index: number;
      translatedText: string;
      translationStatus: string;
    }> = [];

    for (const str of session.strings) {
      const key = `${str.form_id}|${str.record_type}|${str.subrecord_type}|${str.index}`;
      const newText = referenceMap.get(key);

      if (!newText) continue;

      // 根据 mode 过滤
      if (mode === "untranslated") {
        // 只替换未翻译的记录
        if (
          str.translation_status !== "untranslated" &&
          str.translation_status !== undefined &&
          str.translated_text !== str.original_text
        ) {
          continue;
        }
      }

      // 跳过译文相同的记录
      if (str.translated_text === newText) {
        continue;
      }

      updates.push({
        formId: str.form_id,
        recordType: str.record_type,
        subrecordType: str.subrecord_type,
        index: str.index,
        translatedText: newText,
        translationStatus: "manual",
      });
    }

    if (updates.length === 0) {
      showSuccess("没有需要替换的记录");
      onClose();
      return;
    }

    // 3. 使用 batchUpdateStringRecords 一次性更新所有记录
    // 自带 Immer 批量更新 + 历史记录（使用自定义描述）
    const description = `加载 ESP 对照 - ${mode === "untranslated" ? "替换未翻译" : "替换全部"}(${updates.length} 条)`;
    batchUpdateStringRecords(data.session_id, updates, description);

    showSuccess(
      `已替换 ${updates.length} 条翻译（来自 ${data.source_plugin_name}）`
    );
    onClose();
  };

  return (
    <Dialog open={!!data} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>加载 ESP 对照</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            来源文件
          </Typography>
          <Typography variant="body1" fontWeight="medium">
            {data.source_plugin_name}
          </Typography>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: "flex", gap: 4, mb: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              提取的翻译条目
            </Typography>
            <Typography variant="h5" color="primary">
              {data.total_count}
            </Typography>
          </Box>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          选择替换策略：
        </Typography>
        <Typography variant="caption" color="text.secondary">
          • <strong>替换未翻译</strong>：只替换当前未翻译的条目
          <br />• <strong>替换全部</strong>：替换所有匹配的条目（会覆盖已有翻译）
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button
          onClick={() => handleReplace("untranslated")}
          variant="outlined"
          color="primary"
        >
          替换未翻译
        </Button>
        <Button
          onClick={() => handleReplace("all")}
          variant="contained"
          color="primary"
        >
          替换全部
        </Button>
      </DialogActions>
    </Dialog>
  );
}
