import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getStatsOverview,
  getStatsCognition,
  getStatsDaily,
  getStatsCategory,
  getRepracticeConversion,
  getReviewQueue,
  getReportDownloadUrl,
  getTodayStudyGoals,
  checkin,
  getTextbookProgress,
  getFlashcardStats,
  getEssayStats,
  getCaseStats,
  getMockExamStats,
  getUserId
} from '../utils/api';
import LoadingSpinner from './LoadingSpinner';

function Dashboard() {
  const [stats, setStats] = useState({
    total_wrong_questions: 0,
    total_mastered: 0,
    total_not_mastered: 0,
    mastery_rate: 0,
    today_practiced: 0,
    today_correct_rate: 0
  });
  const [cognitionMap, setCognitionMap] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [categoryStats, setCategoryStats] = useState([]);
  const [conversion, setConversion] = useState({ conversion_rate: 0, denominator_users: 0, numerator_users: 0 });
  const [reviewSummary, setReviewSummary] = useState({ today_count: 0, overdue_count: 0, total_pending: 0 });
  const [goals, setGoals] = useState({ goals: [], overall_rate: 0, streak_days: 0, total_checkin_days: 0, checked_in_today: false });
  const [learningCenter, setLearningCenter] = useState({
    textbook: { total: 0, completed: 0, rate: 0 },
    flashcard: { total: 0, mastered: 0, due: 0 },
    essay: { total: 0, submitted: 0 },
    caseQ: { total: 0, submitted: 0 },
    mockExam: { total: 0, avg_score: 0 }
  });
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setError(null);
      const [statsData, cognitionData, dailyData, categoryData, conversionData, reviewData, goalsData, textbookData, flashcardData, essayData, caseData, mockData] = await Promise.all([
        getStatsOverview(),
        getStatsCognition(),
        getStatsDaily(7),
        getStatsCategory(),
        getRepracticeConversion(7, 72),
        getReviewQueue(1).catch(() => ({ stats: {} })),
        getTodayStudyGoals().catch(() => ({ goals: [], overall_rate: 0, streak_days: 0, checked_in_today: false })),
        getTextbookProgress().catch(() => ({ total_chapters: 0, completed_count: 0, completion_rate: 0 })),
        getFlashcardStats().catch(() => ({ total_cards: 0, mastered_count: 0, due_count: 0 })),
        getEssayStats().catch(() => ({ total_topics: 0, submitted_count: 0 })),
        getCaseStats().catch(() => ({ total_cases: 0, submitted_count: 0 })),
        getMockExamStats().catch(() => ({ total_exams: 0, avg_score: 0 }))
      ]);

      setStats(statsData);
      setCognitionMap(cognitionData.cognition_map || []);
      setDailyStats(dailyData.daily_stats || dailyData.daily || []);
      setCategoryStats(categoryData.categories || []);
      setConversion(conversionData || { conversion_rate: 0, denominator_users: 0, numerator_users: 0 });
      setReviewSummary(reviewData.stats || { today_count: 0, overdue_count: 0, total_pending: 0 });
      setGoals(goalsData);
      setLearningCenter({
        textbook: {
          total: textbookData.total_chapters || 0,
          completed: textbookData.completed_count || 0,
          rate: textbookData.completion_rate || 0
        },
        flashcard: {
          total: flashcardData.total_cards || 0,
          mastered: flashcardData.mastered_count || 0,
          due: flashcardData.due_count || 0
        },
        essay: {
          total: essayData.total_topics || 0,
          submitted: essayData.submitted_count || 0
        },
        caseQ: {
          total: caseData.total_cases || 0,
          submitted: caseData.submitted_count || 0
        },
        mockExam: {
          total: mockData.total_exams || 0,
          avg_score: mockData.avg_score || 0
        }
      });
    } catch (error) {
      console.error('获取数据失败:', error);
      setError(error.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickCheckin = async () => {
    if (checkinBusy || goals.checked_in_today) return;
    setCheckinBusy(true);
    try {
      await checkin({ user_id: getUserId(), study_minutes: 30, note: '首页一键打卡' });
      // 刷新 goals 与打卡状态
      const refreshed = await getTodayStudyGoals();
      setGoals(refreshed);
    } catch (e) {
      console.error('打卡失败', e);
    } finally {
      setCheckinBusy(false);
    }
  };

  const handleDownloadReport = (format) => {
    const url = getReportDownloadUrl(format);
    const a = document.createElement('a');
    a.href = url;
    a.download = `learning_report.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p style={{ color: '#f44336' }}>加载失败: {error}</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={fetchData}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="page-title">认知增强看板</h1>

      {/* 今日学习目标 + 连续打卡激励（首页强引导） */}
      <div className="dashboard-grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: '1rem' }}>
        <div className="section-card" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', border: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 className="section-title" style={{ color: '#fff', margin: 0 }}>🎯 今日学习目标</h2>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, background: 'rgba(255,255,255,0.25)', padding: '0.2rem 0.8rem', borderRadius: '12px' }}>
              {goals.overall_rate || 0}%
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {(goals.goals || []).map((g) => {
              const rate = g.target > 0 ? Math.min(100, (g.done / g.target) * 100) : 0;
              const done = g.done >= g.target;
              return (
                <Link
                  key={g.key}
                  to={g.link}
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    textDecoration: 'none',
                    color: '#fff',
                    border: done ? '1px solid rgba(255,255,255,0.5)' : '1px solid transparent'
                  }}
                >
                  <div style={{ fontSize: '1.2rem' }}>{g.icon} {done && '✓'}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.9, marginTop: '0.25rem' }}>{g.label}</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '0.25rem' }}>
                    {g.done}/{g.target} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>{g.unit}</span>
                  </div>
                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px', marginTop: '0.4rem' }}>
                    <div style={{ width: `${rate}%`, height: '100%', background: '#fff', borderRadius: '2px' }} />
                  </div>
                </Link>
              );
            })}
          </div>
          {goals.overall_rate < 100 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', opacity: 0.9 }}>
              💪 完成今日目标，保持学习节奏！
            </div>
          )}
          {goals.overall_rate >= 100 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', opacity: 0.9 }}>
              🎉 今日目标已全部完成，太棒了！
            </div>
          )}
        </div>

        <div className="section-card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>连续打卡</div>
          <div style={{ fontSize: '3rem', fontWeight: 800, color: '#ff9800', lineHeight: 1.1, margin: '0.25rem 0' }}>
            {goals.streak_days || 0}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#666' }}>天 🔥</div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#999' }}>
            累计 {goals.total_checkin_days || 0} 天
          </div>
          {goals.checked_in_today ? (
            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#4caf50', fontWeight: 600 }}>
              ✓ 今日已打卡
            </div>
          ) : (
            <button
              onClick={handleQuickCheckin}
              disabled={checkinBusy}
              className="btn btn-primary"
              style={{ marginTop: '0.75rem', padding: '0.4rem 1rem', fontSize: '0.85rem', cursor: checkinBusy ? 'wait' : 'pointer' }}
            >
              {checkinBusy ? '打卡中...' : '一键打卡 +30min'}
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">错题总数</div>
          <div className="stat-card-value">{stats.total_wrong_questions}</div>
          <div className="stat-card-sub">已采集的错题数量</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">总体掌握率</div>
          <div className="stat-card-value" style={{ color: '#4caf50' }}>{stats.mastery_rate}%</div>
          <div className="stat-card-sub">认知状态提升进度</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">今日练习</div>
          <div className="stat-card-value">{stats.today_practiced}</div>
          <div className="stat-card-sub">今日认知激活次数</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">今日正确率</div>
          <div className="stat-card-value">{stats.today_correct_rate}%</div>
          <div className="stat-card-sub">认知准确度</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">72h 二练转化</div>
          <div className="stat-card-value" style={{ color: '#2196f3' }}>{conversion.conversion_rate}%</div>
          <div className="stat-card-sub">{conversion.numerator_users}/{conversion.denominator_users} 用户</div>
        </div>
      </div>

      {/* 学习中心：模块导航 + 进度速览 */}
      <div className="section-card">
        <h2 className="section-title"><span>🚀</span>学习中心</h2>
        <p style={{ fontSize: '0.85rem', color: '#888', margin: '0.25rem 0 1rem' }}>点击任一模块快速进入学习，进度实时同步</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
          {(() => {
            const lc = learningCenter;
            const cards = [
              { key: 'textbook', icon: '📖', label: '教材学习', to: '/textbook',
                main: `${lc.textbook.completed}/${lc.textbook.total}`,
                sub: `章节 · ${lc.textbook.rate}%`, progress: lc.textbook.rate },
              { key: 'flashcard', icon: '🎴', label: '闪卡复习', to: '/knowledge',
                main: `${lc.flashcard.due}`,
                sub: `待复习 · 掌握 ${lc.flashcard.mastered}/${lc.flashcard.total}`,
                progress: lc.flashcard.total > 0 ? (lc.flashcard.mastered / lc.flashcard.total) * 100 : 0 },
              { key: 'essay', icon: '✍️', label: '论文训练', to: '/essay',
                main: `${lc.essay.submitted}/${lc.essay.total}`,
                sub: '已写/题库', progress: lc.essay.total > 0 ? (lc.essay.submitted / lc.essay.total) * 100 : 0 },
              { key: 'case', icon: '🔧', label: '案例分析', to: '/case',
                main: `${lc.caseQ.submitted}/${lc.caseQ.total}`,
                sub: '已写/题库', progress: lc.caseQ.total > 0 ? (lc.caseQ.submitted / lc.caseQ.total) * 100 : 0 },
              { key: 'mock', icon: '🏆', label: '模考训练', to: '/exam',
                main: `${lc.mockExam.total}`,
                sub: `场次 · 均分 ${lc.mockExam.avg_score}`, progress: 0 }
            ];
            return cards.map(c => (
              <Link key={c.key} to={c.to} style={{
                textDecoration: 'none', color: 'inherit',
                background: '#f9fafb', borderRadius: '8px', padding: '0.85rem',
                border: '1px solid #eee', transition: 'all 0.2s',
                display: 'block'
              }}>
                <div style={{ fontSize: '1.4rem' }}>{c.icon}</div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginTop: '0.25rem', color: '#333' }}>{c.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#667eea', marginTop: '0.35rem' }}>{c.main}</div>
                <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.15rem' }}>{c.sub}</div>
                {c.progress > 0 && (
                  <div style={{ height: '4px', background: '#e5e7eb', borderRadius: '2px', marginTop: '0.4rem', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, c.progress)}%`, height: '100%', background: '#667eea' }} />
                  </div>
                )}
              </Link>
            ));
          })()}
        </div>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="section-card">
          <h2 className="section-title">分类分布</h2>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginTop: '1rem' }}>
            {categoryStats.length > 0 ? (
              <>
                <div className="donut-chart">
                  <svg viewBox="0 0 42 42" className="donut-svg">
                    {(() => {
                    const total = categoryStats.reduce((s, c) => s + c.total, 0);
                    let offset = 0;
                    const colors = ['#667eea', '#764ba2', '#4caf50', '#ff9800', '#f44336', '#2196f3', '#9c27b0'];
                    return categoryStats.slice(0, 7).map((cat, i) => {
                      const percent = (cat.total / total) * 100;
                      const dashArray = `${percent} ${100 - percent}`;
                      const dashOffset = -offset;
                      const color = colors[i % colors.length];
                      offset += percent;
                      return (
                        <circle
                          key={i}
                          cx="21"
                          cy="21"
                          r="15.9155"
                          fill="transparent"
                          stroke={color}
                          strokeWidth="6"
                          strokeDasharray={dashArray}
                          strokeDashoffset={dashOffset}
                          transform="rotate(-90 21 21)"
                        />
                      );
                    });
                  })()}
                  </svg>
                  <div className="donut-center">
                    <div className="donut-value">{stats.total_wrong_questions}</div>
                    <div className="donut-label">总题数</div>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {categoryStats.slice(0, 7).map((cat, i) => {
                    const colors = ['#667eea', '#764ba2', '#4caf50', '#ff9800', '#f44336', '#2196f3', '#9c27b0'];
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: colors[i % colors.length], flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
                        <span style={{ fontWeight: 600, color: '#333' }}>{cat.total}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="empty-state" style={{ flex: 1 }}>
                <p>暂无分类数据</p>
              </div>
            )}
          </div>
        </div>

        <div className="section-card">
          <h2 className="section-title">掌握度进度</h2>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
            <div className="progress-ring-container">
              <svg className="progress-ring" width="160" height="160">
                <circle
                  stroke="#e0e0e0"
                  strokeWidth="10"
                  fill="transparent"
                  r="70"
                  cx="80"
                  cy="80"
                />
                <circle
                  stroke="url(#masteryGradient)"
                  strokeWidth="10"
                  fill="transparent"
                  r="70"
                  cx="80"
                  cy="80"
                  strokeDasharray={`${stats.mastery_rate * 4.398} 439.8`}
                  strokeDashoffset="0"
                  transform="rotate(-90 80 80)"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="masteryGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#667eea" />
                    <stop offset="100%" stopColor="#764ba2" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="progress-ring-text">
                <div className="progress-ring-value">{stats.mastery_rate}%</div>
                <div className="progress-ring-label">总体掌握率</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '1rem', fontSize: '0.875rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#4caf50' }}>{stats.total_mastered}</div>
              <div style={{ color: '#888' }}>已掌握</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f44336' }}>{stats.total_not_mastered}</div>
              <div style={{ color: '#888' }}>未掌握</div>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="section-card">
          <h2 className="section-title">认知热力图 (知识点掌握度)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
            {cognitionMap.length > 0 ? (
              cognitionMap.map((kp, index) => (
                <div 
                  key={index} 
                  className="cognition-bubble" 
                  style={{ 
                    padding: '1rem', 
                    borderRadius: '12px', 
                    backgroundColor: `rgba(244, 67, 54, ${1 - kp.score})`,
                    border: '1px solid #ddd',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{kp.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span>掌握度: {Math.round(kp.score * 100)}%</span>
                    <span>稳定性: {kp.stability.toFixed(1)}</span>
                  </div>
                  <div className="category-bar" style={{ height: '4px', background: '#eee', marginTop: '0.5rem' }}>
                    <div className="category-bar-fill" style={{ width: `${kp.score * 100}%`, background: '#4caf50', height: '100%' }} />
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">🧠</div>
                <p>暂无认知轨迹数据</p>
              </div>
            )}
          </div>
        </div>

        <div className="section-card">
          <h2 className="section-title">学习趋势</h2>
          {dailyStats.length > 0 ? (
            <div className="chart-container">
              <div className="chart-bars">
                {dailyStats.map((day, index) => (
                  <div key={index} className="chart-bar-item">
                    <div
                      className="chart-bar"
                      style={{ height: `${day.practiced > 0 ? (day.practiced / Math.max(...dailyStats.map(d => d.practiced), 1) * 100) : 0}%` }}
                    >
                      <div className="chart-bar-value">{day.practiced}</div>
                    </div>
                    <div className="chart-bar-label">{day.date.slice(5)}</div>
                    <div className="chart-bar-rate">{day.correct_rate}%</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📈</div>
              <p>暂无学习数据</p>
            </div>
          )}
        </div>
      </div>

      <div className="section-card" style={{ background: 'linear-gradient(135deg, #fff 0%, #f6f9ff 100%)', border: '1px solid #bbdefb' }}>
        <h2 className="section-title">🎯 智能学习中心</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
          <Link to="/review" className="btn btn-primary" style={{ justifyContent: 'flex-start' }}>
            🔁 今日复习
            {reviewSummary.total_pending > 0 && (
              <span style={{ marginLeft: 'auto', background: '#fff', color: '#f44336', padding: '0.1rem 0.5rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700 }}>
                {reviewSummary.total_pending}
              </span>
            )}
          </Link>
          <Link to="/learning-path" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
            🧭 学习路径推荐
          </Link>
          <Link to="/diagnosis" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
            🔬 错题归因诊断
          </Link>
          <Link to="/radar" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
            🕸️ 能力雷达图
          </Link>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <Link to="/practice?mode=recommend" className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            🔥 攻克薄弱点
          </Link>
          <Link to="/questions" className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            📚 错题库
          </Link>
          <Link to="/report" className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            📊 学习报告
          </Link>
          <button
            onClick={() => handleDownloadReport('md')}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}
          >
            ⬇ 一键导出报告 (MD)
          </button>
          <button
            onClick={() => handleDownloadReport('json')}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}
          >
            ⬇ 导出 JSON
          </button>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
