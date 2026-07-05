import React, { useState, useEffect } from 'react';
import { fetchAPI } from '../utils/api';

function Statistics() {
  const [categoryStats, setCategoryStats] = useState([]);
  const [chapterStats, setChapterStats] = useState([]);
  const [weakPoints, setWeakPoints] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [categoryData, chapterData, weakPointsData, dailyData] = await Promise.all([
        fetchAPI('/api/stats/category').catch(() => ({ categories: [] })),
        fetchAPI('/api/stats/chapter').catch(() => ({ chapters: [] })),
        fetchAPI('/api/stats/weak-points').catch(() => ({ weak_points: [] })),
        fetchAPI('/api/stats/daily?days=30').catch(() => ({ daily_stats: [] }))
      ]);

      setCategoryStats(categoryData?.categories || []);
      setChapterStats(chapterData?.chapters || []);
      setWeakPoints(weakPointsData?.weak_points || []);
      setDailyStats(dailyData?.daily_stats || []);
    } catch (error) {
      console.error('获取统计数据失败:', error);
      setError(error.message || '获取统计数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="page-container"><div className="empty-state">加载中...</div></div>;
  }

  const totalQuestions = categoryStats.reduce((sum, cat) => sum + (cat.total || 0), 0);
  const totalMastered = categoryStats.reduce((sum, cat) => sum + (cat.mastered || 0), 0);
  const overallRate = totalQuestions > 0 ? ((totalMastered / totalQuestions) * 100).toFixed(1) : 0;

  return (
    <div className="page-container">
      <h1 className="page-title">统计分析</h1>

      {error && (
        <div className="error-banner" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', cursor: 'pointer' }} onClick={() => setError(null)}>
          {error} <span style={{ float: 'right' }}>点击关闭</span>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">总错题数</div>
          <div className="stat-card-value">{totalQuestions}</div>
          <div className="stat-card-sub">所有采集的错题</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">已掌握</div>
          <div className="stat-card-value" style={{ color: '#4caf50' }}>{totalMastered}</div>
          <div className="stat-card-sub">掌握率 {overallRate}%</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">未掌握</div>
          <div className="stat-card-value" style={{ color: '#f44336' }}>{totalQuestions - totalMastered}</div>
          <div className="stat-card-sub">需要继续练习</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">薄弱类别</div>
          <div className="stat-card-value">{weakPoints.length}</div>
          <div className="stat-card-sub">需要加强学习的类别</div>
        </div>
      </div>

      <div className="section-card">
        <h2 className="section-title">分类统计详情</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>分类名称</th>
                <th>总题数</th>
                <th>已掌握</th>
                <th>未掌握</th>
                <th>掌握率</th>
                <th>掌握进度</th>
              </tr>
            </thead>
            <tbody>
              {categoryStats.length > 0 ? (
                categoryStats.map((cat, index) => (
                  <tr key={index}>
                    <td>{cat.name || '未分类'}</td>
                    <td>{cat.total || 0}</td>
                    <td style={{ color: '#4caf50' }}>{cat.mastered || 0}</td>
                    <td style={{ color: '#f44336' }}>{(cat.total || 0) - (cat.mastered || 0)}</td>
                    <td>{cat.mastery_rate || 0}%</td>
                    <td>
                      <div className="table-progress">
                        <div className="table-progress-bar" style={{ width: `${cat.mastery_rate || 0}%` }} />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center' }}>暂无数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-card">
        <h2 className="section-title">章节统计详情</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>章节名称</th>
                <th>所属分类</th>
                <th>总题数</th>
                <th>已掌握</th>
                <th>掌握率</th>
              </tr>
            </thead>
            <tbody>
              {chapterStats.length > 0 ? (
                chapterStats.slice(0, 20).map((ch, index) => (
                  <tr key={index}>
                    <td>{ch.name || '未命名'}</td>
                    <td>{ch.category || '-'}</td>
                    <td>{ch.total || 0}</td>
                    <td style={{ color: '#4caf50' }}>{ch.mastered || 0}</td>
                    <td>{ch.mastery_rate || 0}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center' }}>暂无数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-card">
        <h2 className="section-title">薄弱知识点分析</h2>
        {weakPoints.length > 0 ? (
          <div className="weak-points-list">
            {weakPoints.map((point, index) => (
              <div className="weak-point-item" key={index}>
                <div className="weak-point-rank">{index + 1}</div>
                <div className="weak-point-info">
                  <div className="weak-point-name">{point.name || '未命名'}</div>
                  <div className="weak-point-stats">
                    共 {point.total || 0} 题 | 未掌握 {point.not_mastered || 0} 题
                  </div>
                </div>
                <div className="weak-point-rate">
                  <div>掌握率 {100 - (point.weak_rate || 0)}%</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">🎯</div>
            <p>暂无薄弱知识点</p>
          </div>
        )}
      </div>

      <div className="section-card">
        <h2 className="section-title">学习趋势（最近30天）</h2>
        {dailyStats.length > 0 ? (
          <div className="trend-chart">
            <div className="trend-bars">
              {dailyStats.map((day, index) => {
                const practiced = day.practiced || 0;
                const maxPracticed = Math.max(...dailyStats.map(d => d.practiced || 0), 1);
                return (
                  <div key={index} className="trend-bar-item">
                    <div
                      className="trend-bar"
                      style={{ height: `${practiced > 0 ? (practiced / maxPracticed * 100) : 0}%` }}
                      title={`练习: ${practiced}, 正确率: ${day.correct_rate || 0}%`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="trend-labels">
              <span>每日练习题数</span>
              <span>共 {dailyStats.length} 天</span>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📈</div>
            <p>暂无学习趋势数据</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Statistics;