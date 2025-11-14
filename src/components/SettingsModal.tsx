import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  LinearProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  Divider,
  IconButton,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useTranslationStore } from '../stores/translationStore';
import type { ExtractionStats } from '../types';

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
  const [dataDir, setDataDir] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<ExtractionStats | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);

  const { extractDictionary, getBasePluginsList, clearBaseDictionary } = useTranslationStore();
  const [basePlugins, setBasePlugins] = useState<string[]>([]);

  // 加载基础插件列表
  const handleLoadPluginsList = async () => {
    try {
      const plugins = await getBasePluginsList();
      setBasePlugins(plugins);
    } catch (error) {
      console.error('加载插件列表失败:', error);
    }
  };

  // 选择游戏 Data 目录
  const handleSelectDirectory = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: '选择游戏 Data 目录',
      });

      if (selected && typeof selected === 'string') {
        setDataDir(selected);
      }
    } catch (error) {
      console.error('选择目录失败:', error);
    }
  };

  // 执行提取（清除并重新提取）
  const handleExtract = async () => {
    if (!dataDir) {
      setExtractionError('请先选择游戏 Data 目录');
      return;
    }

    // 确认对话框
    const confirmed = window.confirm(
      '⚠️ 注意：\n\n' +
      '此操作会先清除所有已存在的基础词典数据（9个官方插件），然后重新提取。\n' +
      '用户手动翻译的其他插件数据不受影响。\n\n' +
      '是否继续？'
    );

    if (!confirmed) {
      return;
    }

    setIsExtracting(true);
    setExtractionError(null);
    setExtractionResult(null);
    setDeletedCount(null);

    try {
      // 第一步：清除基础词典
      console.log('🗑️ 正在清除旧的基础词典数据...');
      const deleted = await clearBaseDictionary();
      setDeletedCount(deleted);
      console.log(`✅ 已清除 ${deleted} 条旧记录`);

      // 第二步：重新提取
      console.log('📖 正在重新提取基础词典...');
      const stats = await extractDictionary(dataDir);
      setExtractionResult(stats);
      console.log('✅ 提取完成');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setExtractionError(errorMsg);
      console.error('❌ 提取失败:', errorMsg);
    } finally {
      setIsExtracting(false);
    }
  };

  // 关闭弹窗时重置状态
  const handleClose = () => {
    setDataDir('');
    setExtractionResult(null);
    setExtractionError(null);
    setDeletedCount(null);
    setBasePlugins([]);
    onClose();
  };

  // 打开弹窗时加载插件列表
  const handleOpen = () => {
    if (open && basePlugins.length === 0) {
      handleLoadPluginsList();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      onTransitionEnter={handleOpen}
    >
      <DialogTitle>原始字典提取设置</DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          {/* 目录选择 */}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              游戏 Data 目录
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                fullWidth
                size="small"
                value={dataDir}
                placeholder="请选择游戏 Data 目录..."
                InputProps={{
                  readOnly: true,
                }}
              />
              <IconButton
                color="primary"
                onClick={handleSelectDirectory}
                disabled={isExtracting}
              >
                <FolderOpenIcon />
              </IconButton>
            </Box>
          </Box>

          {/* 插件列表 */}
          {basePlugins.length > 0 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                将提取以下基础插件（共 {basePlugins.length} 个）
              </Typography>
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                <List dense disablePadding>
                  {basePlugins.map((plugin, index) => (
                    <ListItem key={plugin} divider={index < basePlugins.length - 1}>
                      <ListItemText
                        primary={plugin}
                        primaryTypographyProps={{ variant: 'body2' }}
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            </Box>
          )}

          {/* 提取进度 */}
          {isExtracting && (
            <Box>
              <Typography variant="body2" gutterBottom>
                正在提取字典...
              </Typography>
              <LinearProgress />
            </Box>
          )}

          {/* 错误信息 */}
          {extractionError && (
            <Alert severity="error" onClose={() => setExtractionError(null)}>
              {extractionError}
            </Alert>
          )}

          {/* 提取结果 */}
          {extractionResult && (
            <Alert severity="success">
              <Typography variant="subtitle2" gutterBottom>
                ✅ 提取完成！
              </Typography>
              <Box sx={{ mt: 1 }}>
                {deletedCount !== null && deletedCount > 0 && (
                  <Typography variant="body2" color="warning.main">
                    • 清除旧记录：{deletedCount.toLocaleString()} 条
                  </Typography>
                )}
                <Typography variant="body2">
                  • 成功文件：{extractionResult.successful_files}/{extractionResult.total_files}
                </Typography>
                <Typography variant="body2">
                  • 导入记录：{extractionResult.total_strings.toLocaleString()} 条
                </Typography>
                {extractionResult.skipped_files.length > 0 && (
                  <Typography variant="body2" color="warning.main">
                    • 跳过文件：{extractionResult.skipped_files.join(', ')}
                  </Typography>
                )}
                {extractionResult.errors.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2" color="error">
                      错误信息：
                    </Typography>
                    {extractionResult.errors.map((err, i) => (
                      <Typography key={i} variant="caption" color="error" display="block">
                        - {err}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Alert>
          )}

          {/* 说明文本 */}
          <Box sx={{ bgcolor: 'info.lighter', p: 2, borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              💡 <strong>功能说明</strong>：
            </Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              • 提取英文版和中文版字符串，建立英→中翻译映射
            </Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              • 每次提取会先清除旧的基础词典数据，然后重新建立
            </Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              • 提取过程可能需要几分钟，请耐心等待
            </Typography>
            <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 1 }}>
              ⚠️ <strong>注意</strong>：只会清除9个官方插件的数据，用户翻译的其他插件不受影响
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <Divider />

      <DialogActions>
        <Button onClick={handleClose} disabled={isExtracting}>
          关闭
        </Button>
        <Button
          onClick={handleExtract}
          variant="contained"
          disabled={!dataDir || isExtracting}
        >
          {isExtracting ? '提取中...' : '开始提取'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
