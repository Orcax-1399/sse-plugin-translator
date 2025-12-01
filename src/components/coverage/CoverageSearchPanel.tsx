import { useState, useCallback } from "react";
import {
  Box,
  TextField,
  Button,
  Alert,
  Typography,
  CircularProgress,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { MaterialReactTable, type MRT_ColumnDef } from "material-react-table";
import { useCoverageStore } from "../../stores/coverageStore";
import type { CoverageEntry } from "../../types";
import { useMemo } from "react";

/**
 * 覆盖记录搜索面板
 */
export default function CoverageSearchPanel() {
  const {
    searchResults,
    isSearching,
    error,
    searchEntries,
    clearSearchResults,
    clearError,
  } = useCoverageStore();

  const [formIdQuery, setFormIdQuery] = useState("");
  const [textQuery, setTextQuery] = useState("");

  const columns = useMemo<MRT_ColumnDef<CoverageEntry>[]>(() => [
    {
      header: "Form ID",
      accessorKey: "form_id",
      size: 180,
    },
    {
      header: "记录类型",
      accessorKey: "record_type",
      size: 100,
    },
    {
      header: "子类型",
      accessorKey: "subrecord_type",
      size: 100,
    },
    {
      header: "文本内容",
      accessorKey: "text",
      grow: 1,
      size: 200,
      enableSorting: false,
    },
    {
      header: "来源MOD",
      accessorKey: "source_mod",
      size: 180,
    },
    {
      header: "加载顺序",
      accessorKey: "load_order_pos",
      size: 90,
    },
  ], []);

  // 执行搜索
  const handleSearch = useCallback(async () => {
    clearError();
    await searchEntries(
      formIdQuery.trim() || undefined,
      textQuery.trim() || undefined,
      100
    );
  }, [formIdQuery, textQuery, searchEntries, clearError]);

  // 清除搜索
  const handleClear = useCallback(() => {
    setFormIdQuery("");
    setTextQuery("");
    clearSearchResults();
    clearError();
  }, [clearSearchResults, clearError]);

  // 回车搜索
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch]
  );

  // 生成唯一的行ID
  const getRowId = useCallback(
    (row: CoverageEntry) =>
      `${row.form_id}|${row.record_type}|${row.subrecord_type}|${row.index}`,
    []
  );

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 错误提示 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={clearError}>
          {error}
        </Alert>
      )}

      {/* 搜索表单 */}
      <Box sx={{ display: "flex", gap: 2, mb: 2, alignItems: "center" }}>
        <TextField
          label="Form ID"
          size="small"
          value={formIdQuery}
          onChange={(e) => setFormIdQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="如: 00012BB7"
          sx={{ width: 200 }}
        />
        <TextField
          label="文本内容"
          size="small"
          value={textQuery}
          onChange={(e) => setTextQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索文本..."
          sx={{ flex: 1, maxWidth: 300 }}
        />
        <Button
          variant="contained"
          startIcon={isSearching ? <CircularProgress size={16} /> : <SearchIcon />}
          onClick={handleSearch}
          disabled={isSearching || (!formIdQuery.trim() && !textQuery.trim())}
        >
          搜索
        </Button>
        <Button
          variant="outlined"
          startIcon={<ClearIcon />}
          onClick={handleClear}
          disabled={isSearching}
        >
          清除
        </Button>
      </Box>

      {/* 搜索结果统计 */}
      {searchResults.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          找到 {searchResults.length} 条记录
        </Typography>
      )}

      {/* 结果表格 */}
      <Box sx={{ flex: 1, minHeight: 400 }}>
        <MaterialReactTable
          columns={columns}
          data={searchResults}
          getRowId={getRowId}
          enableTopToolbar={false}
          enableColumnFilters={false}
          enableRowSelection={false}
          initialState={{
            pagination: { pageIndex: 0, pageSize: 100 },
          }}
          muiTablePaperProps={{
            elevation: 0,
            sx: { height: "100%", display: "flex", flexDirection: "column" },
          }}
          muiTableContainerProps={{ sx: { flex: 1 } }}
          muiTableBodyCellProps={{
            sx: {
              fontSize: "0.875rem",
              borderBottom: "1px solid #e0e0e0",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
            },
          }}
          muiPaginationProps={{
            rowsPerPageOptions: [50, 100, 300],
          }}
          state={{
            isLoading: isSearching,
            showProgressBars: isSearching,
          }}
          renderBottomToolbarCustomActions={() =>
            searchResults.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                无搜索结果
              </Typography>
            ) : null
          }
        />
      </Box>
    </Box>
  );
}
