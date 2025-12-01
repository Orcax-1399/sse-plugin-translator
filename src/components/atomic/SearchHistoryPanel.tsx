import { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialReactTable, type MRT_ColumnDef } from 'material-react-table';
import { invoke } from '@tauri-apps/api/core';
import { Box, Typography, Chip, Alert, Snackbar } from '@mui/material';

interface SearchHistoryEntry {
  term: string;
  candidates: string[];
  updated_at: number;
}

type HistoryRow = SearchHistoryEntry & { id: number };

export default function SearchHistoryPanel() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState<'success' | 'error'>('success');

  const loadHistory = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleChipClick = useCallback(async (term: string, candidate: string) => {
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
  }, [loadHistory]);

  const columns = useMemo<MRT_ColumnDef<HistoryRow>[]>(() => [
    {
      header: '查询术语',
      accessorKey: 'term',
      size: 150,
      grow: 1,
    },
    {
      header: '候选译文',
      accessorKey: 'candidates',
      size: 300,
      grow: 2,
      Cell: ({ row }) => {
        const term = row.original.term;
        const candidates = row.original.candidates;
        return (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', py: 0.5 }}>
            {candidates.slice(0, 5).map((candidate, idx) => (
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
      header: '最后查询',
      accessorKey: 'updated_at',
      size: 180,
      Cell: ({ cell }) =>
        new Date(cell.getValue<number>()).toLocaleString('zh-CN'),
    },
  ], [handleChipClick]);

  const rows: HistoryRow[] = history.map((entry, idx) => ({
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
        <MaterialReactTable<HistoryRow>
          columns={columns}
          data={rows}
          getRowId={(row, index) =>
            row?.id !== undefined && row?.id !== null
              ? row.id.toString()
              : `row-${index}`
          }
          enableTopToolbar={false}
          enableColumnFilters={false}
          layoutMode="grid"
          initialState={{
            pagination: { pageIndex: 0, pageSize: 100 },
            sorting: [{ id: 'updated_at', desc: true }],
          }}
          muiTablePaperProps={{
            elevation: 0,
            sx: { height: '100%', display: 'flex', flexDirection: 'column' },
          }}
          muiTableContainerProps={{
            sx: { flex: 1 },
          }}
          muiTableBodyCellProps={{
            sx: {
              py: 1,
              '&:focus': {
                outline: 'none',
              },
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            },
          }}
          muiTableBodyRowProps={{
            sx: {
              '&:hover': {
                backgroundColor: 'action.hover',
              },
              '& td': {
                whiteSpace: 'normal',
              },
            },
          }}
          muiPaginationProps={{
            rowsPerPageOptions: [50, 100, 300],
          }}
          state={{
            isLoading: loading,
            showProgressBars: loading,
          }}
          positionPagination="bottom"
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
