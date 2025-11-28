import { useState, useEffect } from "react";
import {
  Container,
  Stack,
  Typography,
  IconButton,
  Box,
  Tabs,
  Tab,
  Button,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import CoverageStatusPanel from "../components/coverage/CoverageStatusPanel";
import CoverageSearchPanel from "../components/coverage/CoverageSearchPanel";
import { useCoverageStore } from "../stores/coverageStore";
import type {
  CoverageProgressPayload,
  CoverageCompletePayload,
} from "../types";

/**
 * 覆盖数据库管理窗口
 */
export default function CoverageWindow() {
  const [tabIndex, setTabIndex] = useState(0);
  const { setExtractionProgress, setExtractionComplete } = useCoverageStore();

  // 关闭窗口
  const handleClose = () => {
    getCurrentWebviewWindow().close();
  };

  // 统一监听覆盖事件，窗口存在期间保持订阅
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    (async () => {
      console.log("[DEBUG] Setting up coverage event listeners...");

      unlistenProgress = await listen<CoverageProgressPayload>(
        "coverage_progress",
        (event) => {
          console.log("[DEBUG] Received coverage_progress:", event.payload);
          setExtractionProgress(event.payload);
        }
      );

      unlistenComplete = await listen<CoverageCompletePayload>(
        "coverage_complete",
        (event) => {
          console.log("[DEBUG] Received coverage_complete:", event.payload);
          const { success, stats, error } = event.payload;
          setExtractionComplete(success, stats ?? null, error ?? null);
        }
      );

      console.log("[DEBUG] Coverage event listeners ready");
    })();

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
    };
  }, [setExtractionProgress, setExtractionComplete]);

  return (
    <Container maxWidth="xl" sx={{ height: "100vh", py: 3 }}>
      <Stack spacing={2} sx={{ height: "100%" }}>
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="h5">覆盖数据库管理</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Tabs */}
        <Tabs value={tabIndex} onChange={(_, value) => setTabIndex(value)}>
          <Tab label="状态检测" />
          <Tab label="覆盖搜索" />
        </Tabs>

        {/* Tab Content */}
        <Box
          sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {tabIndex === 0 && <CoverageStatusPanel />}
          {tabIndex === 1 && <CoverageSearchPanel />}
        </Box>

        {/* 底部关闭按钮 */}
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="outlined" onClick={handleClose}>
            关闭
          </Button>
        </Box>
      </Stack>
    </Container>
  );
}
