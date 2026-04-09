import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

function Dashboard() {
  const [stats, setStats] = useState({
    total_wrong_questions: 0,
    total_mastered: 0,
    total_not_mastered: 0,
    mastery_rate: 0,
    today_practiced: 0,
    today_correct_rate: 0
  });
  const [categories, setCategories] = useState([]);
  const [weakPoints, setWeakPoints] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, categoriesRes, weakPointsRes, dailyRes] = await Promise.all([
        fetch('http://localhost:5002/api/stats/overview'),
        fetch('http://localhost:5002/api/stats/category'),
        fetch('http://localhost:5002/api/stats/weak-points'),
        fetch('http://localhost:5002/api/stats/daily?days=7')
      ]);

      const statsData = await statsRes.json();
      const categoriesData = await categoriesRes.json();
      const weakPointsData = await weakPointsRes.json();
      const dailyData = await dailyRes.json();

      setStats(statsData);
      setCategories(categoriesData.categories || []);
      setWeakPoints(weakPointsData.weak_points || []);
      setDailyStats(dailyData.daily_stats || []);
    } catch (error) {
      console.error('获取数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="page-container"><div className="empty-state">加载中...</div></div>;
  }

  return (
    <div className="page-container">
      <h1 className="page-title">学习总览</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">错题总数</div>
          <div className="stat-card-value">{stats.total_wrong_questions}</div>
          <div className="stat-card-sub">已采集的错题数量</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">已掌握</div>
          <div className="stat-card-value" style={{ color: '#4caf50' }}>{stats.total_mastered}</div>
          <div className="stat-card-sub">正确率超过70%的题目</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">未掌握</div>
          <div className="stat-card-value" style={{ color: '#f44336' }}>{stats.total_not_mastered}</div>
          <div className="stat-card-sub">还需继续练习的题目</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">掌握率</div>
          <div className="stat-card-value">{stats.mastery_rate}%</div>
          <div className="stat-card-sub">总体掌握进度</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">今日练习</div>
          <div className="stat-card-value">{stats.today_practiced}</div>
          <div className="stat-card-sub">今日已完成</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">正确率</div>
          <div className="stat-card-value">{stats.today_correct_rate}%</div>
          <div className="stat-card-sub">今日答题正确率</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="section-card">
          <h2 className="section-title">分类掌握度</h2>
          {categories.length > 0 ? (
            categories.map((cat, index) => (
              <div className="category-item" key={index}>
                <div className="category-header">
                  <span className="category-name">{cat.name}</span>
                  <span className="category-stats">
                    {cat.mastered}/{cat.total} ({cat.mastery_rate}%)
                  </span>
                </div>
                <div className="category-bar">
                  <div
                    className="category-bar-fill"
                    style={{ width: `${cat.mastery_rate}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📚</div>
              <p>暂无分类数据</p>
            </div>
          )}
        </div>

        <div className="section-card">
          <h2 className="section-title">薄弱知识点</h2>
          {weakPoints.length > 0 ? (
            weakPoints.map((point, index) => (
              <div className="weak-point-item" key={index}>
                <div className="weak-point-rank">{index + 1}</div>
                <div className="weak-point-info">
                  <div className="weak-point-name">{point.name}</div>
                  <div className="weak-point-stats">
                    共 {point.total} 题，未掌握 {point.not_mastered} 题
                  </div>
                </div>
                <div className="weak-point-rate">{100 - point.weak_rate}%</div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">🎯</div>
              <p>暂无薄弱知识点</p>
            </div>
          )}
        </div>
      </div>

      <div className="section-card">
        <h2 className="section-title">每日学习趋势</h2>
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

      <div className="section-card">
        <h2 className="section-title">快捷操作</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/practice" className="btn btn-primary">开始练习</Link>
          <Link to="/questions" className="btn btn-secondary">查看错题库</Link>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;