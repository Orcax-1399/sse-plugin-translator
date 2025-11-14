import { Box, Typography, Paper, IconButton, LinearProgress, Fade, Tooltip } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import type { PluginStringsResponse } from '../types';
import StringTable from './StringTable';
import { useSessionStore } from '../stores/sessionStore';
import { useState } from 'react';

interface SessionPanelProps {
  /** Session 数据 */
  sessionData: PluginStringsResponse;
}

/**
 * Session 面板组件
 *
 * 显示单个插件 Session 的内容：
 * - 顶部状态栏（动态高度，包含进度信息）
 * - 字符串表格（占满剩余空间）
 */
export default function SessionPanel({ sessionData }: SessionPanelProps) {
  const translationProgress = useSessionStore((state) => state.translationProgress);
  const progress = translationProgress.get(sessionData.session_id);
  const [showInfo, setShowInfo] = useState(false);

  // 是否正在加载翻译
  const isLoadingTranslations = progress !== undefined && progress < 100;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 状态栏（动态高度） */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          px: 2,
          py: 1,
        }}
      >
        {/* 第一行：总计 + 信息按钮 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: isLoadingTranslations ? 1 : 0 }}>
          <Typography variant="body2" color="text.secondary">
            总计: <strong>{sessionData.total_count}</strong> 条字符串
          </Typography>
          <Tooltip title={showInfo ? '隐藏详情' : '查看插件详情'}>
            <IconButton
              size="small"
              onClick={() => setShowInfo(!showInfo)}
              sx={{ ml: 'auto' }}
            >
              <InfoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* 信息详情（可折叠） */}
        <Fade in={showInfo}>
          <Box sx={{ display: showInfo ? 'block' : 'none', mb: 1 }}>
            <Typography variant="caption" color="text.disabled">
              插件路径: {sessionData.plugin_path}
            </Typography>
          </Box>
        </Fade>

        {/* 进度区域（动态显示） */}
        <Fade in={isLoadingTranslations}>
          <Box sx={{ display: isLoadingTranslations ? 'block' : 'none' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" color="primary">
                📥 获取数据库翻译
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {progress?.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress || 0}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </Box>
        </Fade>
      </Paper>

      {/* 表格区域（占满剩余空间） */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <StringTable rows={sessionData.strings} sessionId={sessionData.session_id} />
      </Box>
    </Box>
  );
}
