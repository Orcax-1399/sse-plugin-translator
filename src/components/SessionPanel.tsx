import { Box, Typography, Paper, IconButton, LinearProgress, Fade, Tooltip, Button, Badge, Chip } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import SaveIcon from '@mui/icons-material/Save';
import type { PluginStringsResponse } from '../types';
import StringTable from './StringTable';
import { useSessionStore } from '../stores/sessionStore';
import { showSuccess, showError } from '../stores/notificationStore';
import { useState, useMemo } from 'react';

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
 *
 * ✅ 使用 selector 精确订阅，避免引用整个 store 对象
 */
export default function SessionPanel({ sessionData }: SessionPanelProps) {
  // ✅ 使用 selector 精确订阅状态和方法
  const translationProgress = useSessionStore((state) => state.translationProgress);
  const getSessionPendingCount = useSessionStore((state) => state.getSessionPendingCount);
  const saveSessionTranslations = useSessionStore((state) => state.saveSessionTranslations);
  const getFilterStatus = useSessionStore((state) => state.getFilterStatus);
  const setFilterStatus = useSessionStore((state) => state.setFilterStatus);

  const progress = translationProgress.get(sessionData.session_id);
  const [showInfo, setShowInfo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 是否正在加载翻译
  const isLoadingTranslations = progress !== undefined && progress < 100;

  // 获取当前 session 的未保存数量
  const pendingCount = getSessionPendingCount ? getSessionPendingCount(sessionData.session_id) : 0;

  // 获取当前筛选状态
  const currentFilter = getFilterStatus ? getFilterStatus(sessionData.session_id) : 'all';

  // 根据筛选状态过滤数据
  const filteredStrings = useMemo(() => {
    if (currentFilter === 'all') {
      return sessionData.strings;
    }
    return sessionData.strings.filter((s) => s.translation_status === currentFilter);
  }, [sessionData.strings, currentFilter]);

  // 处理筛选状态变更
  const handleFilterChange = (status: 'all' | 'untranslated' | 'manual' | 'ai') => {
    if (setFilterStatus) {
      setFilterStatus(sessionData.session_id, status);
    }
  };

  // 保存当前 session 的翻译
  const handleSaveTranslations = async () => {
    if (!saveSessionTranslations) {
      showError('保存功能不可用');
      return;
    }

    setIsSaving(true);

    try {
      const savedCount = await saveSessionTranslations(sessionData.session_id);
      if (savedCount > 0) {
        showSuccess(`成功保存 ${savedCount} 条翻译`);
      } else {
        showSuccess('没有需要保存的翻译');
      }
    } catch (error) {
      showError('保存翻译失败: ' + String(error));
    } finally {
      setIsSaving(false);
    }
  };

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
        {/* 第一行：总计 + 筛选Chips + 保存按钮 + 信息按钮 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: isLoadingTranslations ? 1 : 0 }}>
          <Typography variant="body2" color="text.secondary">
            总计: <strong>{sessionData.total_count}</strong> 条
            {currentFilter !== 'all' && (
              <span> · 筛选: <strong>{filteredStrings.length}</strong> 条</span>
            )}
          </Typography>

          {/* 筛选Chips */}
          <Box sx={{ display: 'flex', gap: 0.5, ml: 2 }}>
            <Chip
              label="全部"
              size="small"
              variant={currentFilter === 'all' ? 'filled' : 'outlined'}
              color={currentFilter === 'all' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('all')}
            />
            <Chip
              label="未翻译"
              size="small"
              variant={currentFilter === 'untranslated' ? 'filled' : 'outlined'}
              color={currentFilter === 'untranslated' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('untranslated')}
            />
            <Chip
              label="已翻译"
              size="small"
              variant={currentFilter === 'manual' ? 'filled' : 'outlined'}
              color={currentFilter === 'manual' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('manual')}
            />
            <Chip
              label="AI翻译"
              size="small"
              variant={currentFilter === 'ai' ? 'filled' : 'outlined'}
              color={currentFilter === 'ai' ? 'primary' : 'default'}
              onClick={() => handleFilterChange('ai')}
            />
          </Box>

          {/* 保存翻译按钮 */}
          <Badge badgeContent={pendingCount} color="error" sx={{ ml: 'auto' }}>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              startIcon={<SaveIcon />}
              onClick={handleSaveTranslations}
              disabled={isSaving || pendingCount === 0}
            >
              {isSaving ? '保存中...' : '保存翻译'}
            </Button>
          </Badge>

          <Tooltip title={showInfo ? '隐藏详情' : '查看插件详情'}>
            <IconButton
              size="small"
              onClick={() => setShowInfo(!showInfo)}
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
        <StringTable rows={filteredStrings} sessionId={sessionData.session_id} />
      </Box>
    </Box>
  );
}
