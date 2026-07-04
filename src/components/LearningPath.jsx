import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getLearningPathRecommend } from '../utils/api';
import LoadingSpinner from './LoadingSpinner';

const ACTION_STYLE = {
  review: { color: '#ef4444', bg: '#fee2e2', icon: '🔁' },
  practice: { color: '#f59e0b', bg: '#fef3c7', icon: '✍️' },
  learn: { color: '#2196f3', bg: '#e3f2fd', icon: '📖' }
};

function LearningPath() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ recommendations: [], total_weak_kps: 0, returned: 0 });
  const [limit, setLimit] = useState(5);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    loadData();
  }, [limit]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLearningPathRecommend(limit);
      setData(result);
    } catch (e) {
      setError(e.message || '加载学习路径失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (idx) => {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const getMasteryColor = (score) => {
    if (score === null || score === undefined) return '#9e9e9e';
    if (score >= 80) return '#4caf50';
    if (score >= 60) return '#ff9800';
    return '#f44336';
  };

  const getMasteryLabel = (score) => {
    if (score === null || score === undefined) return '未学习';
    if (score >= 80) return '良好';
    if (score >= 60) return '及格';
    return '薄弱';
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
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={loadData}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const { recommendations, total_weak_kps } = data;

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">🧭 智能学习路径</h1>
          <p style={{ color: '#666', marginTop: '0.5rem', fontSize: '0.875rem' }}>
            基于你的薄弱知识点和错题情况，推荐最优学习顺序
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[3, 5, 10].map((n) => (
            <button
              key={n}
              className={`btn ${limit === n ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLimit(n)}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
            >
              {n} 项
            </button>
          ))}
        </div>
      </div>

      <div className="stats-grid" style={{ marginTop: '1rem' }}>
        <div className="stat-card">
          <div className="stat-card-title">薄弱知识点</div>
          <div className="stat-card-value" style={{ color: '#f44336' }}>{total_weak_kps}</div>
          <div className="stat-card-sub">待攻克总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">本次推荐</div>
          <div className="stat-card-value" style={{ color: '#2196f3' }}>{recommendations.length}</div>
          <div className="stat-card-sub">优先学习项</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">含错题未掌握</div>
          <div className="stat-card-value">
            {recommendations.filter(r => r.knowledge_point?.pending_wrong > 0).length}
          </div>
          <div className="stat-card-sub">需立即复习</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">尚未学习</div>
          <div className="stat-card-value">
            {recommendations.filter(r => r.knowledge_point?.mastery_score === null).length}
          </div>
          <div className="stat-card-sub">需新增学习</div>
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-icon">🎉</div>
            <p>暂无薄弱知识点，继续保持学习！</p>
            <Link to="/practice" className="btn btn-primary" style={{ marginTop: '1rem' }}>
              去练习巩固
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          {recommendations.map((rec, idx) => {
            const kp = rec.knowledge_point || {};
            const isExpanded = expanded[idx];
            const masteryColor = getMasteryColor(kp.mastery_score);
            const masteryLabel = getMasteryLabel(kp.mastery_score);
            const actionStyle = rec.actions[0] ? ACTION_STYLE[rec.actions[0].type] : ACTION_STYLE.learn;

            return (
              <div
                key={idx}
                className="section-card"
                style={{ margin: 0, borderLeft: `4px solid ${actionStyle.color}`, cursor: 'pointer' }}
                onClick={() => toggleExpand(idx)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      background: actionStyle.bg,
                      color: actionStyle.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '1.1rem',
                      flexShrink: 0
                    }}
                  >
                    {idx + 1}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 600, fontSize: '1.05rem', color: '#333' }}>
                        {kp.name || '未知知识点'}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span
                          style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            background: masteryColor + '22',
                            color: masteryColor,
                            fontWeight: 600
                          }}
                        >
                          {masteryLabel}
                          {kp.mastery_score !== null && kp.mastery_score !== undefined ? ` ${kp.mastery_score}%` : ''}
                        </span>
                        {kp.pending_wrong > 0 && (
                          <span
                            style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              background: '#fee2e2',
                              color: '#ef4444',
                              fontWeight: 600
                            }}
                          >
                            {kp.pending_wrong} 题待复习
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: '0.5rem', color: '#666', fontSize: '0.875rem' }}>
                      <span style={{ color: actionStyle.color, fontWeight: 500 }}>原因：</span>
                      {rec.reason || '建议加强学习'}
                    </div>

                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {rec.actions.map((action, i) => {
                        const style = ACTION_STYLE[action.type] || ACTION_STYLE.learn;
                        return (
                          <Link
                            key={i}
                            to={action.target}
                            onClick={(e) => e.stopPropagation()}
                            className="btn"
                            style={{
                              padding: '0.4rem 0.9rem',
                              fontSize: '0.85rem',
                              background: style.bg,
                              color: style.color,
                              border: `1px solid ${style.color}`,
                              textDecoration: 'none'
                            }}
                          >
                            {style.icon} {action.label}
                          </Link>
                        );
                      })}
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #e0e0e0' }}>
                        {rec.parent_chapter && (
                          <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                            <span style={{ color: '#888' }}>所属章节：</span>
                            <span style={{ color: '#333', fontWeight: 500 }}>{rec.parent_chapter.name}</span>
                          </div>
                        )}

                        {rec.siblings && rec.siblings.length > 0 && (
                          <div>
                            <div style={{ color: '#888', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                              相关知识点（可作为参考）：
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              {rec.siblings.map((sib, i) => (
                                <div
                                  key={i}
                                  style={{
                                    padding: '0.4rem 0.8rem',
                                    background: '#f5f5f5',
                                    borderRadius: '6px',
                                    fontSize: '0.8rem',
                                    color: '#555',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem'
                                  }}
                                >
                                  <span>{sib.name}</span>
                                  {sib.mastery_score !== null && sib.mastery_score !== undefined && (
                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        color: getMasteryColor(sib.mastery_score),
                                        fontWeight: 600
                                      }}
                                    >
                                      {sib.mastery_score}%
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#999' }}>
                          错题总数：{kp.wrong_count || 0} · 已掌握：{(kp.wrong_count || 0) - (kp.pending_wrong || 0)}
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#999' }}>
                      {isExpanded ? '点击收起 ▲' : '点击查看详情 ▼'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="section-card" style={{ marginTop: '1.5rem', background: '#f0f7ff', border: '1px solid #bbdefb' }}>
        <h2 className="section-title">💡 学习路径说明</h2>
        <ul style={{ marginTop: '0.5rem', color: '#555', fontSize: '0.875rem', lineHeight: 1.8, paddingLeft: '1.2rem' }}>
          <li>系统根据你的<strong>错题分布</strong>和<strong>掌握度</strong>智能识别薄弱知识点</li>
          <li>优先推荐<strong>待复习错题最多</strong>的知识点，避免遗忘加深</li>
          <li>每个知识点提供三种行动建议：<strong>复习错题</strong> / <strong>专项练习</strong> / <strong>学习教材</strong></li>
          <li>展开后可查看所属章节与相关知识点，帮助建立知识关联</li>
        </ul>
      </div>
    </div>
  );
}

export default LearningPath;
