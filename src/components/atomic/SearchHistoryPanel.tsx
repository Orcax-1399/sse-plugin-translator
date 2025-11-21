import { useEffect, useState } from 'react';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { invoke } from '@tauri-apps/api/core';
import { Box, Typography, Chip, Alert } from '@mui/material';

interface SearchHistoryEntry {
  term: string;
  candidates: string[];
  updated_at: number;
}

export default function SearchHistoryPanel() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
    loadHistory();
  }, []);

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
      renderCell: (params) => (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', py: 0.5 }}>
          {(params.value as string[]).slice(0, 5).map((candidate: string, idx: number) => (
            <Chip
              key={idx}
              label={candidate}
              size="small"
              variant="outlined"
            />
          ))}
        </Box>
      ),
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
          pageSizeOptions={[25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 50 } },
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
    </Box>
  );
}
