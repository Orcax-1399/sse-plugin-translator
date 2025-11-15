import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  Tabs,
  Tab,
} from '@mui/material';
import DictionaryExtractionPanel from './DictionaryExtractionPanel';
import ApiConfigPanel from './ApiConfigPanel';

interface SettingsModalProps {
  /** 是否打开弹窗 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
}

/**
 * 设置模态框组件
 */
export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  // Tab状态管理
  const [currentTab, setCurrentTab] = useState(0);

  // 切换Tab
  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
  };

  // 关闭弹窗时重置状态
  const handleClose = () => {
    setCurrentTab(0);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box>
          <Typography variant="h6" sx={{ mb: 2 }}>设置</Typography>
          <Tabs value={currentTab} onChange={handleTabChange}>
            <Tab label="词典提取" />
            <Tab label="AI配置" />
            <Tab label="通用设置" />
          </Tabs>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Tab 0: 词典提取 */}
        {currentTab === 0 && <DictionaryExtractionPanel />}

        {/* Tab 1: AI配置 */}
        {currentTab === 1 && <ApiConfigPanel />}

        {/* Tab 2: 通用设置 */}
        {currentTab === 2 && (
          <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body1">
              通用设置面板（预留）
            </Typography>
          </Box>
        )}
      </DialogContent>

      <Divider />

      <DialogActions>
        <Button onClick={handleClose}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
