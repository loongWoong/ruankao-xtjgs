import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

import Dashboard from './components/Dashboard.jsx'
import QuestionBank from './components/QuestionBank.jsx'
import Practice from './components/Practice.jsx'
import Statistics from './components/Statistics.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <App>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/questions" element={<QuestionBank />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/statistics" element={<Statistics />} />
        </Routes>
      </App>
    </Router>
  </React.StrictMode>,
)