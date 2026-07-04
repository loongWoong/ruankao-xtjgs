import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import Onboarding, { ONBOARD_KEY } from './components/Onboarding';
import { getTodayCheckin } from './utils/api';

function App({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const location = useLocation();

  const navItems = [
    { path: '/', label: '总览', icon: '📊' },
    { path: '/review', label: '今日复习', icon: '🔁' },
    { path: '/radar', label: '能力雷达', icon: '🕸️' },
    { path: '/diagnosis', label: '错题诊断', icon: '🔬' },
    { path: '/learning-path', label: '学习路径', icon: '🧭' },
    { path: '/report', label: '学习报告', icon: '📊' },
    { path: '/textbook', label: '教材学习', icon: '📖' },
    { path: '/knowledge', label: '知识图谱', icon: '🌳' },
    { path: '/questions', label: '错题库', icon: '📚' },
    { path: '/custom-questions', label: '我的题库', icon: '🗂️' },
    { path: '/analysis', label: '错题分析', icon: '🎯' },
    { path: '/practice', label: '练习', icon: '✍️' },
    { path: '/exam', label: '模拟考试', icon: '📝' },
    { path: '/real-exam', label: '真题模考', icon: '🏆' },
    { path: '/case', label: '案例分析', icon: '🔍' },
    { path: '/essay', label: '论文训练', icon: '✏️' },
    { path: '/syllabus', label: '考纲覆盖', icon: '🗺️' },
    { path: '/checkin', label: '学习打卡', icon: '🔥' },
    { path: '/statistics', label: '统计', icon: '📈' },
    { path: '/plan', label: '学习计划', icon: '📅' },
    { path: '/notebook', label: '笔记', icon: '🗒️' }
  ];

  // 首次使用引导：检测 localStorage 标记
  useEffect(() => {
    const onboarded = localStorage.getItem(ONBOARD_KEY);
    if (!onboarded) {
      setShowOnboarding(true);
    }
  }, []);

  // 学习提醒：每日首次进入时检查是否已打卡
  useEffect(() => {
    if (showOnboarding) return;
    const reminderKey = `ruankao_reminder_${new Date().toISOString().split('T')[0]}`;
    if (localStorage.getItem(reminderKey)) return;

    const timer = setTimeout(async () => {
      try {
        const today = await getTodayCheckin();
        if (!today.checked_in) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('软考备考提醒', {
              body: '今天还没打卡学习哦，坚持每日积累是通关的关键！',
              icon: '/vite.svg'
            });
          } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission();
          }
          // 控制台提示也保留一份，便于开发环境观察
          console.log('📚 软考备考提醒：今天还没打卡学习哦');
        }
        localStorage.setItem(reminderKey, '1');
      } catch (e) {
        // 静默失败，不打扰用户
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [showOnboarding]);

  const handleCloseOnboarding = () => setShowOnboarding(false);

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

      {showOnboarding && <Onboarding onClose={handleCloseOnboarding} />}
    </div>
  );
}

export default App;
