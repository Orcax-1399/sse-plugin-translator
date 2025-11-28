import { Box, LinearProgress, Typography } from "@mui/material";
import type { CoverageExtractionProgress } from "../../types";

interface ExtractionProgressProps {
  progress: CoverageExtractionProgress;
}

/**
 * 提取进度显示组件
 */
export default function ExtractionProgress({
  progress,
}: ExtractionProgressProps) {
  const safeTotal = progress.total || 0;
  const percentage =
    safeTotal > 0
      ? Math.min(
          100,
          Math.round((progress.current_progress / safeTotal) * 100),
        )
      : 0;
  const label = progress.current_mod
    ? `${progress.current_mod} (${Math.min(progress.current_progress, safeTotal)}/${safeTotal || "?"})`
    : progress.completed
      ? "提取完成"
      : "等待中...";

  return (
    <Box sx={{ width: "100%", mt: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Box sx={{ flex: 1, mr: 2 }}>
          <LinearProgress
            variant="determinate"
            value={percentage}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 45 }}>
          {percentage}%
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
