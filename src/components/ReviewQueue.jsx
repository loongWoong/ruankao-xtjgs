import React, { useState, useEffect } from 'react';
import { getReviewQueue, getReviewUpcoming } from '../utils/api';
import { Link } from 'react-router-dom';

const PRIORITY_LABELS = {
  1: { label: '逾期', color: '#ef4444', bgColor: '#fee2e2' },
  2: { label: '今日到期', color: '#f59e0b', bgColor: '#fef3c7' },
  3: { label: '新错题', color: '#667eea', bgColor: '#eef1ff' },
  4: { label: '未到期', color: '#9ca3af', bgColor: '#f3f4f6' }
};

function ReviewQueue() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState({ items: [], stats: {} });
  const [upcoming, setUpcoming] = useState([]);
  const [limit, setLimit] = useState(20);

  useEffect(() => {
    loadData();
  }, [limit]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [queueData, upcomingData] = await Promise.all([
        getReviewQueue(limit),
        getReviewUpcoming(14)
      ]);
      setQueue(queueData);
      setUpcoming(upcomingData.items || []);
    } catch (e) {
      setError(e.message || '加载复习队列失败');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dt) => {
    if (!dt) return '未安排';
    const d = new Date(dt);
    const now = new Date();
    const diff = d - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (diff < 0) {
      if (days < -1) return `逾期 ${-days} 天`;
      return `逾期 ${-hours} 小时`;
    }
    if (days > 0) return `${days} 天后`;
    if (hours > 0) return `${hours} 小时后`;
    return '即将到期';
  };

  const stats = queue.stats || {};
  const items = queue.items || [];
  const todayLoad = (stats.overdue_count || 0) + (stats.today_count || 0) + (stats.new_count || 0);

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">加载复习队列...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2 className="page-title">复习优先级队列</h2>
      <p className="page-subtitle">基于间隔重复算法，智能排序今日该复习的错题</p>

      {error && <div className="error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">今日待复习</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>{todayLoad}</div>
          <div className="stat-card-sub">道错题</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">逾期</div>
          <div className="stat-card-value" style={{ color: '#ef4444' }}>{stats.overdue_count || 0}</div>
          <div className="stat-card-sub">需立即复习</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">今日到期</div>
          <div className="stat-card-value" style={{ color: '#f59e0b' }}>{stats.today_count || 0}</div>
          <div className="stat-card-sub">SRS 排程</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">未开始 SRS</div>
          <div className="stat-card-value" style={{ color: '#9ca3af' }}>{stats.new_count || 0}</div>
          <div className="stat-card-sub">新错题</div>
        </div>
      </div>

      {todayLoad > 0 && (
        <div className="section-card" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', border: 'none', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>🎯 今日有 {todayLoad} 道错题待复习</div>
              <div style={{ fontSize: '0.875rem', opacity: 0.9, marginTop: '0.25rem' }}>立即开始复习，推进 SRS 间隔递进，巩固长期记忆</div>
            </div>
            <Link
              to="/practice?mode=today"
              className="btn"
              style={{
                background: '#fff',
                color: '#667eea',
                fontWeight: 600,
                padding: '0.6rem 1.5rem',
                textDecoration: 'none',
                borderRadius: '8px'
              }}
            >
              ▶ 开始今日复习
            </Link>
          </div>
        </div>
      )}

      <div className="section-card">
        <h3 className="section-title">
          <span>📋</span>复习队列
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 'normal' }}>
            <select
              value={limit}
              onChange={e => setLimit(parseInt(e.target.value, 10))}
              style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '0.25rem' }}
            >
              <option value={10}>显示 10 条</option>
              <option value={20}>显示 20 条</option>
              <option value={50}>显示 50 条</option>
            </select>
          </span>
        </h3>

        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎉</div>
            <div>今日没有待复习的错题，继续保持！</div>
            <Link to="/practice" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-block' }}>
              去做新练习
            </Link>
          </div>
        ) : (
          <>
            {items.map((item, idx) => {
              const pri = PRIORITY_LABELS[item.priority] || PRIORITY_LABELS[4];
              return (
                <div key={item.id} style={{
                  padding: '1rem', borderBottom: '1px solid #f0f0f0',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                      <span style={{ color: '#888', fontSize: '0.85rem' }}>#{idx + 1}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem',
                        background: pri.bgColor, color: pri.color, fontWeight: 600
                      }}>{pri.label}</span>
                      {item.category && (
                        <span style={{ background: '#f0f0f0', color: '#666', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>{item.category}</span>
                      )}
                      {item.srs_stage > 0 && (
                        <span style={{ color: '#667eea', fontSize: '0.75rem' }}>SRS阶段 {item.srs_stage}</span>
                      )}
                    </div>
                    <div style={{ lineHeight: 1.5, color: '#333' }}>
                      {item.question ? (item.question.length > 100 ? item.question.slice(0, 100) + '...' : item.question) : '（无题目内容）'}
                    </div>
                    <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#888' }}>
                      错误 {item.wrong_count || 0} 次 · {formatDate(item.next_review_time)}
                    </div>
                  </div>
                  <Link
                    to="/practice"
                    className="btn btn-primary"
                    style={{ fontSize: '0.85rem', padding: '0.4rem 0.85rem', whiteSpace: 'nowrap' }}
                  >
                    复习
                  </Link>
                </div>
              );
            })}
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <Link to="/questions" className="btn btn-secondary">查看全部错题</Link>
            </div>
          </>
        )}
      </div>

      <div className="section-card">
        <h3 className="section-title"><span>📅</span>未来 14 天复习预览</h3>
        {upcoming.length === 0 ? (
          <div style={{ padding: '1rem', color: '#888', textAlign: 'center' }}>
            未来两周暂无到期复习任务
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '0.5rem' }}>
            {upcoming.map((u, idx) => {
              const date = new Date(u.review_date);
              const isToday = u.review_date === new Date().toISOString().split('T')[0];
              return (
                <div key={idx} style={{
                  flex: '1 1 100px', minWidth: '100px',
                  padding: '0.75rem', borderRadius: '6px',
                  background: isToday ? '#eef1ff' : '#f9fafb',
                  border: isToday ? '2px solid #667eea' : '1px solid #eee'
                }}>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>
                    {date.getMonth() + 1}/{date.getDate()}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: isToday ? '#667eea' : '#333' }}>
                    {u.count}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>道</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReviewQueue;
