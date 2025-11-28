import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import GamePathSelector from './pages/GamePathSelector';
import Workspace from './pages/Workspace';
import EditorWindow from './pages/EditorWindow';
import AtomicDbWindow from './pages/AtomicDbWindow';
import CoverageWindow from './pages/CoverageWindow';
import NotificationProvider from './components/NotificationProvider';

// 创建MUI主题
const theme = createTheme({
  palette: {
    mode: 'light',
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <NotificationProvider />
      <Router>
        <Routes>
          <Route path="/" element={<GamePathSelector />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/editor" element={<EditorWindow />} />
          <Route path="/atomic-db" element={<AtomicDbWindow />} />
          <Route path="/coverage" element={<CoverageWindow />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
