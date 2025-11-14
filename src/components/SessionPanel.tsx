import { Box, Typography, Paper } from '@mui/material';
import type { PluginStringsResponse } from '../types';
import StringTable from './StringTable';

interface SessionPanelProps {
  /** Session 数据 */
  sessionData: PluginStringsResponse;
}

/**
 * Session 面板组件
 *
 * 显示单个插件 Session 的内容：
 * - 顶部状态栏（60px）
 * - 字符串表格（占满剩余空间）
 */
export default function SessionPanel({ sessionData }: SessionPanelProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 状态栏（60px，预留空间用于未来扩展） */}
      <Paper
        elevation={0}
        sx={{
          height: '60px',
          borderBottom: 1,
          borderColor: 'divider',
          px: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          总计: <strong>{sessionData.total_count}</strong> 条字符串
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {sessionData.plugin_path}
        </Typography>
        {/* 预留空间：搜索框、筛选器等 */}
      </Paper>

      {/* 表格区域（占满剩余空间） */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <StringTable rows={sessionData.strings} />
      </Box>
    </Box>
  );
}
