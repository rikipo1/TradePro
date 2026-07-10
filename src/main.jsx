import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './App.jsx';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
);
