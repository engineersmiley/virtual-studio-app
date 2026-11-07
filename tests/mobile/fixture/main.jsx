import React from 'react';
import { createRoot } from 'react-dom/client';
import Session from '@/pages/Session';
import '@/index.css';

// Render the entire real page, including its surrounding click handlers,
// React's delegated listeners, CSS, and mobile fullscreen toggle.
createRoot(document.getElementById('root')).render(<Session />);
