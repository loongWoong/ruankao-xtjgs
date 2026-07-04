import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';

function App({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navItems = [
    { path: '/', label: '总览', icon: '📊' },
    { path: '/textbook', label: '教材学习', icon: '📖' },
    { path: '/knowledge', label: '知识图谱', icon: '🌳' },
    { path: '/questions', label: '错题库', icon: '📚' },
    { path: '/analysis', label: '错题分析', icon: '🎯' },
    { path: '/practice', label: '练习', icon: '✍️' },
    { path: '/exam', label: '模拟考试', icon: '📝' },
    { path: '/case', label: '案例分析', icon: '🔍' },
    { path: '/essay', label: '论文训练', icon: '✏️' },
    { path: '/statistics', label: '统计', icon: '📈' },
    { path: '/plan', label: '学习计划', icon: '📅' },
    { path: '/notebook', label: '笔记', icon: '🗒️' }
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <button className="menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
              ☰
            </button>
            <h1>软考错题分析系统</h1>
          </div>
        </div>
      </header>

      <div className="app-container">
        <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <nav className="sidebar-nav">
            {navItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <main className="app-main">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default App;