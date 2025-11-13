import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useAppStore } from '../stores/appStore';

/**
 * 游戏路径选择页面
 * 首次启动时显示，要求用户选择游戏目录
 */
export default function GamePathSelector() {
  const navigate = useNavigate();
  const setGamePath = useAppStore((state) => state.setGamePath);

  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectDirectory = async () => {
    try {
      setError(null);

      // 打开文件夹选择对话框
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: '选择游戏目录',
      });

      if (!selectedPath || typeof selectedPath !== 'string') {
        return;
      }

      setIsValidating(true);

      // 验证目录是否有效
      const isValid = await invoke<boolean>('validate_game_directory', {
        path: selectedPath,
      });

      if (!isValid) {
        setError(
          '所选目录不是有效的 Skyrim 游戏目录。\n请确保目录下存在 Data/Skyrim.esm 文件。'
        );
        setIsValidating(false);
        return;
      }

      // 保存游戏路径
      await setGamePath(selectedPath);

      // 跳转到主界面
      navigate('/workspace');
    } catch (err) {
      console.error('选择目录失败:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        p: 3,
      }}
    >
      <Card sx={{ maxWidth: 500, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            游戏Mod翻译器
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            paragraph
            align="center"
            sx={{ mt: 2, mb: 4 }}
          >
            欢迎使用！请选择您的 Skyrim 游戏目录以开始使用。
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={isValidating ? <CircularProgress size={20} /> : <FolderOpenIcon />}
            onClick={handleSelectDirectory}
            disabled={isValidating}
            sx={{ py: 1.5 }}
          >
            {isValidating ? '验证中...' : '选择游戏目录'}
          </Button>

          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            align="center"
            sx={{ mt: 3 }}
          >
            提示：游戏目录通常包含 SkyrimSE.exe 或类似的可执行文件
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
