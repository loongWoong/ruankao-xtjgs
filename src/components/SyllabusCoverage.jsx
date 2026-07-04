import React, { useState, useEffect } from 'react';
import { getSyllabusCoverage } from '../utils/api';

const STATUS_CONFIG = {
  unread: { label: '未学习', color: '#9ca3af', bgColor: '#f3f4f6', icon: '⚪' },
  learning: { label: '学习中', color: '#667eea', bgColor: '#eef1ff', icon: '🔵' },
  weak: { label: '薄弱', color: '#f59e0b', bgColor: '#fef3c7', icon: '🟡' },
  mastered: { label: '已掌握', color: '#10b981', bgColor: '#d1fae5', icon: '🟢' }
};

function SyllabusCoverage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ chapters: [], overall: {} });
  const [sortBy, setSortBy] = useState('coverage_asc');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSyllabusCoverage();
      setData(result);
    } catch (e) {
      setError(e.message || '加载考纲覆盖度失败');
    } finally {
      setLoading(false);
    }
  };

  const getSortedChapters = () => {
    let list = [...(data.chapters || [])];
    if (filterStatus) {
      list = list.filter(c => c.status === filterStatus);
    }
    switch (sortBy) {
      case 'coverage_asc':
        list.sort((a, b) => (a.coverage_rate || 0) - (b.coverage_rate || 0));
        break;
      case 'coverage_desc':
        list.sort((a, b) => (b.coverage_rate || 0) - (a.coverage_rate || 0));
        break;
      case 'mastery_asc':
        list.sort((a, b) => (a.mastery_rate || 0) - (b.mastery_rate || 0));
        break;
      case 'mastery_desc':
        list.sort((a, b) => (b.mastery_rate || 0) - (a.mastery_rate || 0));
        break;
      case 'wrong_desc':
        list.sort((a, b) => (b.wrong_count || 0) - (a.wrong_count || 0));
        break;
      case 'weight_desc':
        list.sort((a, b) => (b.exam_weight || 0) - (a.exam_weight || 0));
        break;
      default:
        break;
    }
    return list;
  };

  const chapters = getSortedChapters();
  const overall = data.overall || {};

  const stats = (data.chapters || []).reduce((acc, c) => {
    acc.total += 1;
    acc.totalKps += c.total_kps || 0;
    acc.visitedKps += c.visited_kps || 0;
    acc.wrongCount += c.wrong_count || 0;
    acc.statusCount[c.status] = (acc.statusCount[c.status] || 0) + 1;
    return acc;
  }, { total: 0, totalKps: 0, visitedKps: 0, wrongCount: 0, statusCount: {} });

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">加载考纲覆盖度数据...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2 className="page-title">考纲覆盖度仪表盘</h2>
      <p className="page-subtitle">追踪每个章节的掌握情况，发现薄弱环节</p>

      {error && <div className="error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">章节总数</div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-sub">个章节</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">知识点覆盖</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>
            {stats.totalKps > 0 ? Math.round(stats.visitedKps / stats.totalKps * 100) : 0}%
          </div>
          <div className="stat-card-sub">{stats.visitedKps} / {stats.totalKps} 个知识点</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">已掌握</div>
          <div className="stat-card-value" style={{ color: '#10b981' }}>
            {stats.statusCount.mastered || 0}
          </div>
          <div className="stat-card-sub">个章节</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">薄弱章节</div>
          <div className="stat-card-value" style={{ color: '#f59e0b' }}>
            {(stats.statusCount.weak || 0) + (stats.statusCount.unread || 0)}
          </div>
          <div className="stat-card-sub">需要加强</div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">
          <span>📊</span>章节掌握情况
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#888', fontWeight: 'normal' }}>
            累计错题 {stats.wrongCount} 道
          </span>
        </h3>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <select
            className="sp-form-input"
            style={{ width: 'auto' }}
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
          <select
            className="sp-form-input"
            style={{ width: 'auto' }}
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            <option value="coverage_asc">覆盖率（低→高）</option>
            <option value="coverage_desc">覆盖率（高→低）</option>
            <option value="mastery_asc">掌握度（低→高）</option>
            <option value="mastery_desc">掌握度（高→低）</option>
            <option value="wrong_desc">错题数（多→少）</option>
            <option value="weight_desc">考试权重（高→低）</option>
          </select>
          <button className="btn btn-secondary" onClick={loadData}>🔄 刷新</button>
        </div>

        {chapters.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div>{filterStatus ? '该状态下暂无章节' : '暂无考纲数据'}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem' }}>章节</th>
                  <th style={{ padding: '0.75rem', width: '90px' }}>知识点</th>
                  <th style={{ padding: '0.75rem', width: '140px' }}>覆盖率</th>
                  <th style={{ padding: '0.75rem', width: '140px' }}>掌握度</th>
                  <th style={{ padding: '0.75rem', width: '80px' }}>错题</th>
                  <th style={{ padding: '0.75rem', width: '90px' }}>权重</th>
                  <th style={{ padding: '0.75rem', width: '100px' }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map(ch => {
                  const statusCfg = STATUS_CONFIG[ch.status] || STATUS_CONFIG.unread;
                  const coverage = ch.coverage_rate || 0;
                  const mastery = ch.mastery_rate || 0;
                  return (
                    <tr key={ch.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ fontWeight: 600 }}>{ch.name}</div>
                        {ch.category && (
                          <div style={{ fontSize: '0.8rem', color: '#888' }}>{ch.category}</div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem', color: '#555' }}>
                        {ch.visited_kps}/{ch.total_kps}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: '8px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${coverage}%`,
                              height: '100%',
                              background: coverage >= 80 ? '#10b981' : coverage >= 50 ? '#667eea' : '#f59e0b'
                            }} />
                          </div>
                          <span style={{ minWidth: '40px', textAlign: 'right' }}>{coverage.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: '8px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${mastery}%`,
                              height: '100%',
                              background: mastery >= 80 ? '#10b981' : mastery >= 50 ? '#667eea' : '#ef4444'
                            }} />
                          </div>
                          <span style={{ minWidth: '40px', textAlign: 'right' }}>{mastery ? mastery.toFixed(0) : 0}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {ch.wrong_count > 0 ? (
                          <span style={{ color: '#ef4444', fontWeight: 600 }}>{ch.wrong_count}</span>
                        ) : (
                          <span style={{ color: '#ccc' }}>0</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem', color: '#666' }}>
                        {ch.exam_weight > 0 ? `${(ch.exam_weight * 100).toFixed(0)}%` : '-'}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '12px',
                          fontSize: '0.8rem',
                          background: statusCfg.bgColor,
                          color: statusCfg.color,
                          fontWeight: 600
                        }}>
                          {statusCfg.icon} {statusCfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 className="section-title"><span>💡</span>学习建议</h3>
        <div style={{ padding: '0.5rem 0', color: '#555', lineHeight: 1.8 }}>
          {(stats.statusCount.unread || 0) > 0 && (
            <div>⚪ <strong>{stats.statusCount.unread}</strong> 个章节尚未开始学习，建议优先攻克考试权重高的章节</div>
          )}
          {(stats.statusCount.weak || 0) > 0 && (
            <div>🟡 <strong>{stats.statusCount.weak}</strong> 个章节掌握度较低，建议结合错题本针对性复习</div>
          )}
          {(stats.statusCount.learning || 0) > 0 && (
            <div>🔵 <strong>{stats.statusCount.learning}</strong> 个章节正在学习中，继续保持每日练习</div>
          )}
          {(stats.statusCount.mastered || 0) > 0 && (
            <div>🟢 <strong>{stats.statusCount.mastered}</strong> 个章节已掌握，定期复习以防遗忘</div>
          )}
          {stats.wrongCount > 0 && (
            <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: '#fef3c7', borderRadius: '6px', color: '#92400e' }}>
              ⚠️ 当前累计 <strong>{stats.wrongCount}</strong> 道错题，建议前往「错题库」集中复习
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SyllabusCoverage;
