import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { useAppStore } from "../stores/appStore";
import { WORKSPACE_STORAGE_KEY } from "../constants/storageKeys";

interface StoredWorkspace {
  path: string;
  mode?: "directory" | "file";
}

/**
 * 游戏路径选择页面
 * 首次启动时显示，要求用户选择游戏目录或单个插件文件
 */
export default function GamePathSelector() {
  const navigate = useNavigate();
  const setGamePath = useAppStore((state) => state.setGamePath);

  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 处理路径选择（统一逻辑）
  const handlePathSelection = useCallback(
    async (selectedPath: string, mode: "directory" | "file") => {
      try {
        setIsValidating(true);
        setError(null);

        // 验证路径是否有效
        const isValid = await invoke<boolean>("validate_game_directory", {
          path: selectedPath,
        });

        if (!isValid) {
          if (mode === "directory") {
            setError(
              "所选目录不是有效的 Skyrim 游戏目录。\n请确保目录下存在 Data/Skyrim.esm 文件。",
            );
          } else {
            setError(
              "所选文件不是有效的插件文件。\n请选择 .esp、.esm 或 .esl 文件。",
            );
          }
          setIsValidating(false);
          return;
        }

        // 保存路径
        await setGamePath(selectedPath);

        localStorage.setItem(
          WORKSPACE_STORAGE_KEY,
          JSON.stringify({ path: selectedPath, mode }),
        );

        // 跳转到主界面
        navigate("/workspace");
      } catch (err) {
        console.error("路径选择失败:", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsValidating(false);
      }
    },
    [navigate, setGamePath],
  );

  const autoLoadAttemptedRef = useRef(false);

  useEffect(() => {
    if (autoLoadAttemptedRef.current) {
      return;
    }
    const savedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!savedWorkspace) {
      return;
    }
    try {
      const parsed = JSON.parse(savedWorkspace) as StoredWorkspace;
      if (!parsed?.path) {
        return;
      }
      autoLoadAttemptedRef.current = true;
      const mode = parsed.mode === "file" ? "file" : "directory";
      void handlePathSelection(parsed.path, mode);
    } catch (error) {
      console.warn("自动加载工作区失败，已清除本地缓存:", error);
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
  }, [handlePathSelection]);

  const handleSelectDirectory = async () => {
    try {
      setError(null);

      // 打开文件夹选择对话框
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "选择游戏目录",
      });

      if (!selectedPath || typeof selectedPath !== "string") {
        return;
      }

      await handlePathSelection(selectedPath, "directory");
    } catch (err) {
      console.error("选择目录失败:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectFile = async () => {
    try {
      setError(null);

      // 打开文件选择对话框
      const selectedPath = await open({
        multiple: false,
        title: "选择插件文件",
        filters: [
          {
            name: "Skyrim 插件",
            extensions: ["esp", "esm", "esl"],
          },
        ],
      });

      if (!selectedPath || typeof selectedPath !== "string") {
        return;
      }

      await handlePathSelection(selectedPath, "file");
    } catch (err) {
      console.error("选择文件失败:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        bgcolor: "background.default",
        p: 3,
      }}
    >
      <Card sx={{ maxWidth: 500, width: "100%" }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            esp translator
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            paragraph
            align="center"
            sx={{ mt: 2, mb: 4 }}
          >
            欢迎使用！请选择工作模式：
          </Typography>

          {error && (
            <Alert
              severity="error"
              sx={{ mb: 3 }}
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}

          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={
                isValidating ? (
                  <CircularProgress size={20} />
                ) : (
                  <FolderOpenIcon />
                )
              }
              onClick={handleSelectDirectory}
              disabled={isValidating}
              sx={{ py: 1.5 }}
            >
              {isValidating ? "验证中..." : "选择游戏目录（工作区模式）"}
            </Button>

            <Button
              variant="outlined"
              size="large"
              fullWidth
              startIcon={
                isValidating ? (
                  <CircularProgress size={20} />
                ) : (
                  <FolderOpenIcon />
                )
              }
              onClick={handleSelectFile}
              disabled={isValidating}
              sx={{ py: 1.5 }}
            >
              选择单个插件文件
            </Button>
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            align="center"
            sx={{ mt: 3 }}
          >
            工作区模式：管理所有插件（游戏目录包含 SkyrimSE.exe）
            <br />
            单文件模式：仅翻译一个 Mod（.esp/.esm/.esl 文件）
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
