import { useState } from 'react';
import {
  Container,
  Stack,
  Typography,
  IconButton,
  Box,
  Tabs,
  Tab,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import AtomDbTermsPanel from '../components/atomic/AtomDbTermsPanel';
import SearchHistoryPanel from '../components/atomic/SearchHistoryPanel';

export default function AtomicDbWindow() {
  const [tabIndex, setTabIndex] = useState(0);

  // 关闭窗口
  const handleClose = () => {
    getCurrentWebviewWindow().close();
  };

  return (
    <Container maxWidth="xl" sx={{ height: '100vh', py: 3 }}>
      <Stack spacing={2} sx={{ height: '100%' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h5">原子数据库管理</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Tabs */}
        <Tabs value={tabIndex} onChange={(_, value) => setTabIndex(value)}>
          <Tab label="原子库术语" />
          <Tab label="AI搜索记录" />
        </Tabs>

        {/* Tab Content */}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {tabIndex === 0 && <AtomDbTermsPanel />}
          {tabIndex === 1 && <SearchHistoryPanel />}
        </Box>

        {/* 底部关闭按钮 */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="outlined" onClick={handleClose}>
            关闭
          </Button>
        </Box>
      </Stack>
    </Container>
  );
}
