import { Routes, Route } from 'react-router-dom';
import Home from './Home';

function App() {
  return (
      <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/" element={<Navigate to="/home" />} /> {/* Added by Zepeng Yu to fix initial load issue and ensure upload button displays correctly */}
      </Routes>
  );
}

export default App;