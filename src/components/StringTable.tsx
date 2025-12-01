import { useMemo, memo, useCallback } from 'react';
import { MaterialReactTable, type MRT_ColumnDef } from 'material-react-table';
import type { PaginationState, RowSelectionState, Updater } from '@tanstack/react-table';
import { Box } from '@mui/material';
import { invoke } from '@tauri-apps/api/core';
import type { StringRecord } from '../types';
import { showError } from '../stores/notificationStore';
import { useSessionStore } from '../stores/sessionStore';
import type { GridPaginationModel } from '@mui/x-data-grid';

interface StringTableProps {
  /** 字符串记录列表 */
  rows: StringRecord[];
  /** Session ID，用作 DataGrid 的 key，强制在 session 切换时重新挂载 */
  sessionId?: string;
  /** 分页模型（由父组件控制） */
  paginationModel: GridPaginationModel;
  /** 分页变更回调 */
  onPaginationModelChange: (model: GridPaginationModel) => void;
}

/**
 * 字符串表格组件
 *
 * 显示插件的字符串数据，支持列宽调整和虚拟滚动
 *
 * ✅ 使用 React.memo 包装，避免不必要的重渲染
 * ✅ 使用 selector 精确订阅，避免引用整个 store 对象
 */
const StringTable = memo(function StringTable({ rows, sessionId, paginationModel, onPaginationModelChange }: StringTableProps) {
  // ✅ 使用 selector 精确订阅状态和方法
  const selectedRows = useSessionStore((state) => state.selectedRows);
  const setSelectedRows = useSessionStore((state) => state.setSelectedRows);

  // 获取当前 session 的选中行
  const selectedSet = useMemo(() => {
    if (!sessionId || !selectedRows) {
      return new Set<string>();
    }
    return selectedRows.get(sessionId) || new Set<string>();
  }, [sessionId, selectedRows]);

  // Material React Table 的受控 rowSelection 状态
  const rowSelectionState: RowSelectionState = useMemo(() => {
    const state: RowSelectionState = {};
    selectedSet.forEach((id) => {
      state[id] = true;
    });
    return state;
  }, [selectedSet]);

  const handleRowSelectionChange = useCallback(
    (updater: Updater<RowSelectionState>) => {
      if (!sessionId || !setSelectedRows) return;

      const nextState = typeof updater === 'function' ? updater(rowSelectionState) : updater;
      const nextSet = new Set<string>();
      Object.entries(nextState).forEach(([key, selected]) => {
        if (selected) {
          nextSet.add(key);
        }
      });
      setSelectedRows(sessionId, nextSet);
    },
    [rowSelectionState, sessionId, setSelectedRows],
  );

  // 定义列（按需求顺序）
  const columns: MRT_ColumnDef<StringRecord>[] = useMemo(
    () => [
      {
        header: 'Form ID',
        accessorFn: (row) => row.form_id.split('|')[0],
        id: 'form_id_short',
        size: 120,
      },
      {
        header: 'Editor ID',
        accessorKey: 'editor_id',
        Cell: ({ row }) => row.original.editor_id || '(无)',
        size: 150,
      },
      {
        header: 'Type',
        accessorFn: (row) => `${row.record_type} ${row.subrecord_type}`,
        id: 'type',
        size: 150,
      },
      {
        header: 'Original Text',
        accessorKey: 'original_text',
        size: 200,
        grow: 1,
      },
      {
        header: 'Translated Text',
        accessorKey: 'translated_text',
        size: 200,
        grow: 1,
      },
    ],
    [],
  );

  const paginationState = useMemo<PaginationState>(
    () => ({
      pageIndex: paginationModel.page,
      pageSize: paginationModel.pageSize,
    }),
    [paginationModel],
  );

  const handlePaginationChange = useCallback(
    (updater: Updater<PaginationState>) => {
      const nextState = typeof updater === 'function' ? updater(paginationState) : updater;
      onPaginationModelChange({
        page: nextState.pageIndex,
        pageSize: nextState.pageSize,
      });
    },
    [paginationState, onPaginationModelChange],
  );

  const getRowStyle = useCallback((row: StringRecord) => {
    switch (row.translation_status) {
      case 'untranslated':
        return {
          backgroundColor: '#ffebee',
          '&:hover': {
            backgroundColor: '#ffcdd2',
          },
        };
      case 'manual':
        return {
          backgroundColor: '#e3f2fd',
          '&:hover': {
            backgroundColor: '#bbdefb',
          },
        };
      case 'ai':
        return {
          backgroundColor: '#e8f5e9',
          '&:hover': {
            backgroundColor: '#c8e6c9',
          },
        };
      default:
        return {};
    }
  }, []);

  // 双击行打开编辑窗口
  const handleRowDoubleClick = useCallback((record: StringRecord) => {
    console.log('→ 双击行，准备打开编辑窗口');

    // ✅ Fire-and-forget: 不等待也不处理结果
    // 这样即使后端阻塞也不会影响主窗口
    invoke('open_editor_window', { record }).catch((error) => {
      console.error('打开编辑窗口失败:', error);
      showError('打开编辑窗口失败: ' + String(error));
    });

    console.log('→ 调用已发出，不等待返回');
  }, []);

  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
      }}
    >
      <MaterialReactTable
        key={sessionId}
        columns={columns}
        data={rows}
        enableColumnResizing
        enableRowSelection
        enableMultiRowSelection
        enableTopToolbar={false}
        muiTablePaperProps={{
          sx: {
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
        muiTableContainerProps={{
          sx: {
            flex: 1,
          },
        }}
        muiTableBodyCellProps={{
          sx: {
            borderBottom: '1px solid #e0e0e0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          },
        }}
        muiTableBodyRowProps={({ row }) => ({
          onDoubleClick: () => handleRowDoubleClick(row.original as StringRecord),
          sx: {
            cursor: 'pointer',
            ...getRowStyle(row.original as StringRecord),
          },
        })}
        getRowId={(row) => `${row.form_id}|${row.record_type}|${row.subrecord_type}|${row.index}`}
        muiPaginationProps={{
          rowsPerPageOptions: [50, 100, 300, 500, 1000],
        }}
        state={{
          rowSelection: rowSelectionState,
          pagination: paginationState,
        }}
        onRowSelectionChange={handleRowSelectionChange}
        onPaginationChange={handlePaginationChange}
        muiTableHeadCellProps={{
          sx: { fontWeight: 600 },
        }}
        positionPagination="bottom"
        layoutMode="grid"
      />
    </Box>
  );
});

export default StringTable;
