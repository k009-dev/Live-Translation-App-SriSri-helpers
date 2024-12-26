import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Home } from './pages/home/Home';
import { VideoDetails } from './pages/details/VideoDetails';

export default function App() {
  return (
    <Router>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/details/:videoId" element={<VideoDetails />} />
      </Routes>
    </Router>
  );
}
