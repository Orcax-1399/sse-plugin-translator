import { Box, Typography, Paper, List, ListItem, ListItemText, Collapse, IconButton, Tooltip } from '@mui/material';
import { ExpandMore, ExpandLess, ContentCopy } from '@mui/icons-material';
import { useState } from 'react';
import type { Translation } from '../types';

interface TranslationReferencePanelProps {
  /** 参考翻译列表 */
  references: Translation[];
  /** 是否正在加载 */
  loading?: boolean;
  /** 点击复制回调 */
  onCopy?: (text: string) => void;
}

/**
 * 翻译参考面板
 *
 * 显示查询到的参考翻译（top 3），支持折叠和复制
 */
export default function TranslationReferencePanel({
  references,
  loading = false,
  onCopy,
}: TranslationReferencePanelProps) {
  const [expanded, setExpanded] = useState(true);

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  const handleCopy = (text: string) => {
    if (onCopy) {
      onCopy(text);
    }
  };

  if (references.length === 0 && !loading) {
    return null;
  }

  return (
    <Paper variant="outlined" sx={{ mt: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1.5,
          bgcolor: 'action.hover',
          cursor: 'pointer',
        }}
        onClick={handleToggle}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          参考翻译 {references.length > 0 && `(${references.length})`}
        </Typography>
        <IconButton size="small">
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        {loading ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              查询中...
            </Typography>
          </Box>
        ) : references.length === 0 ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              未找到参考翻译
            </Typography>
          </Box>
        ) : (
          <List dense>
            {references.map((ref, index) => (
              <ListItem
                key={`${ref.form_id}-${index}`}
                sx={{
                  borderBottom: index < references.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
                secondaryAction={
                  <Tooltip title="复制译文">
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => handleCopy(ref.translated_text)}
                    >
                      <ContentCopy fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {ref.translated_text}
                      </Typography>
                      {ref.plugin_name && (
                        <Typography
                          variant="caption"
                          sx={{
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            px: 0.75,
                            py: 0.25,
                            borderRadius: 1,
                            fontSize: '0.7rem',
                          }}
                        >
                          {ref.plugin_name}
                        </Typography>
                      )}
                    </Box>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      原文: {ref.original_text}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Collapse>
    </Paper>
  );
}
