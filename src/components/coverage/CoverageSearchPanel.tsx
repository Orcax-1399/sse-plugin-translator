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
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useCoverageStore } from "../../stores/coverageStore";
import type { CoverageEntry } from "../../types";

// DataGrid 列定义
const columns: GridColDef<CoverageEntry>[] = [
  {
    field: "form_id",
    headerName: "Form ID",
    width: 180,
    sortable: true,
  },
  {
    field: "record_type",
    headerName: "记录类型",
    width: 100,
    sortable: true,
  },
  {
    field: "subrecord_type",
    headerName: "子类型",
    width: 100,
    sortable: true,
  },
  {
    field: "text",
    headerName: "文本内容",
    flex: 1,
    minWidth: 200,
    sortable: false,
  },
  {
    field: "source_mod",
    headerName: "来源MOD",
    width: 180,
    sortable: true,
  },
  {
    field: "load_order_pos",
    headerName: "加载顺序",
    width: 90,
    type: "number",
    sortable: true,
  },
];

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
        <DataGrid
          rows={searchResults}
          columns={columns}
          getRowId={getRowId}
          loading={isSearching}
          pageSizeOptions={[25, 50, 100]}
          initialState={{
            pagination: {
              paginationModel: { pageSize: 25 },
            },
          }}
          disableRowSelectionOnClick
          sx={{
            "& .MuiDataGrid-cell": {
              fontSize: "0.875rem",
            },
          }}
          localeText={{
            noRowsLabel: "无搜索结果",
          }}
        />
      </Box>
    </Box>
  );
}
