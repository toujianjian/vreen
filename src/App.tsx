import { HashRouter, Route, Routes } from 'react-router-dom';
import { TopBar } from '@/components/hud/TopBar';
import { HomePage } from '@/pages/HomePage';
import { ViewerPage } from '@/pages/ViewerPage';
import { EngineDemoPage } from '@/pages/EngineDemoPage';

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col">
        <TopBar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/viewer" element={<ViewerPage />} />
          <Route path="/viewer/:assetId" element={<ViewerPage />} />
          <Route path="/engine-demo" element={<EngineDemoPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </div>
    </HashRouter>
  );
}
