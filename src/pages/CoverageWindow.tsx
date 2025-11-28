import { useState } from "react";
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
import CoverageStatusPanel from "../components/coverage/CoverageStatusPanel";
import CoverageSearchPanel from "../components/coverage/CoverageSearchPanel";

/**
 * 覆盖数据库管理窗口
 */
export default function CoverageWindow() {
  const [tabIndex, setTabIndex] = useState(0);

  // 关闭窗口
  const handleClose = () => {
    getCurrentWebviewWindow().close();
  };

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
