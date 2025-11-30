import { useEffect, useState } from 'react';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { invoke } from '@tauri-apps/api/core';
import { Box, Typography, Chip, Alert, Snackbar } from '@mui/material';

interface SearchHistoryEntry {
  term: string;
  candidates: string[];
  updated_at: number;
}

export default function SearchHistoryPanel() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState<'success' | 'error'>('success');

  const loadHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await invoke<SearchHistoryEntry[]>('get_search_history');
      setHistory(data);
    } catch (err) {
      console.error('加载搜索历史失败:', err);
      setError('加载搜索历史失败: ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleChipClick = async (term: string, candidate: string) => {
    try {
      // 1. 添加到原子数据库
      await invoke('add_atom_translation', {
        original: term,
        translated: candidate,
        source: 'manual'
      });

      // 2. 删除搜索历史记录
      await invoke('delete_search_history_entry', { term });

      // 3. 刷新表格
      await loadHistory();

      // 4. 显示成功Toast
      setToastMessage(`已添加: ${term} → ${candidate}`);
      setToastSeverity('success');
      setToastOpen(true);
    } catch (error) {
      console.error('操作失败:', error);
      setToastMessage(`操作失败: ${String(error)}`);
      setToastSeverity('error');
      setToastOpen(true);
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'term',
      headerName: '查询术语',
      flex: 1,
      minWidth: 150,
    },
    {
      field: 'candidates',
      headerName: '候选译文',
      flex: 2,
      minWidth: 300,
      renderCell: (params) => {
        const term = params.row.term as string;
        const candidates = params.value as string[];

        return (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', py: 0.5 }}>
            {candidates.slice(0, 5).map((candidate: string, idx: number) => (
              <Chip
                key={idx}
                label={candidate}
                size="small"
                variant="outlined"
                onClick={() => handleChipClick(term, candidate)}
                sx={{
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'primary.light',
                    borderColor: 'primary.main',
                    color: 'primary.contrastText',
                  },
                }}
              />
            ))}
          </Box>
        );
      },
    },
    {
      field: 'updated_at',
      headerName: '最后查询',
      width: 180,
      valueFormatter: (value) => new Date(value).toLocaleString('zh-CN'),
    },
  ];

  const rows = history.map((entry, idx) => ({
    id: idx,
    term: entry.term,
    candidates: entry.candidates,
    updated_at: entry.updated_at,
  }));

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Alert severity="info" sx={{ mb: 2 }}>
        显示AI翻译时查询过的术语及其候选译文,可用于分析AI学习效果和术语匹配情况
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          density="compact"
          pageSizeOptions={[50, 100, 300]}
          initialState={{
            pagination: { paginationModel: { pageSize: 100 } },
            sorting: {
              sortModel: [{ field: 'updated_at', sort: 'desc' }],
            },
          }}
          getRowHeight={() => 'auto'}
          sx={{
            '& .MuiDataGrid-cell': {
              py: 1,
            },
            '& .MuiDataGrid-cell:focus': {
              outline: 'none',
            },
          }}
        />
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        共 {history.length} 条搜索记录
      </Typography>

      <Snackbar
        open={toastOpen}
        autoHideDuration={3000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setToastOpen(false)}
          severity={toastSeverity}
          sx={{ width: '100%' }}
        >
          {toastMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}
