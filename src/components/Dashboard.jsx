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
  const [cognitionMap, setCognitionMap] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [conversion, setConversion] = useState({ conversion_rate: 0, denominator_users: 0, numerator_users: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const getUserId = () => {
    const stored = localStorage.getItem('ruankao_user_id');
    return stored || 'default_user';
  };

  const fetchData = async () => {
    try {
      const userId = getUserId();
      const [statsRes, cognitionRes, dailyRes, conversionRes] = await Promise.all([
        fetch(`http://localhost:5002/api/stats/overview?user_id=${encodeURIComponent(userId)}`),
        fetch(`http://localhost:5002/api/stats/cognition?user_id=${encodeURIComponent(userId)}`),
        fetch(`http://localhost:5002/api/stats/daily?days=7&user_id=${encodeURIComponent(userId)}`),
        fetch('http://localhost:5002/api/metrics/repractice-conversion?days=7&hours=72')
      ]);

      const statsData = await statsRes.json();
      const cognitionData = await cognitionRes.json();
      const dailyData = await dailyRes.json();
      const conversionData = await conversionRes.json();

      setStats(statsData);
      setCognitionMap(cognitionData.cognition_map || []);
      setDailyStats(dailyData.daily_stats || dailyData.daily || []);
      setConversion(conversionData || { conversion_rate: 0, denominator_users: 0, numerator_users: 0 });
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
