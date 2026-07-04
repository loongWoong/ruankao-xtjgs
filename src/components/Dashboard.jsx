import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getStatsOverview,
  getStatsCognition,
  getStatsDaily,
  getStatsCategory,
  getRepracticeConversion
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setError(null);
      const [statsData, cognitionData, dailyData, categoryData, conversionData] = await Promise.all([
        getStatsOverview(),
        getStatsCognition(),
        getStatsDaily(7),
        getStatsCategory(),
        getRepracticeConversion(7, 72)
      ]);

      setStats(statsData);
      setCognitionMap(cognitionData.cognition_map || []);
      setDailyStats(dailyData.daily_stats || dailyData.daily || []);
      setCategoryStats(categoryData.categories || []);
      setConversion(conversionData || { conversion_rate: 0, denominator_users: 0, numerator_users: 0 });
    } catch (error) {
      console.error('获取数据失败:', error);
      setError(error.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
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

      <div className="section-card">
        <h2 className="section-title">快捷操作</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/practice?mode=recommend" className="btn btn-primary">🔥 攻克薄弱点 (智能推荐)</Link>
          <Link to="/questions" className="btn btn-secondary">查看错题库</Link>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
