import React, { useState, useEffect } from 'react';
import { getErrorDiagnosisReport } from '../utils/api';
import { Link } from 'react-router-dom';

const CATEGORY_INFO = {
  concept: { label: '概念类', color: '#667eea', bgColor: '#eef1ff', icon: '🧠' },
  memory: { label: '记忆类', color: '#f59e0b', bgColor: '#fef3c7', icon: '📝' },
  calculation: { label: '计算类', color: '#ef4444', bgColor: '#fee2e2', icon: '🔢' },
  reading: { label: '审题类', color: '#10b981', bgColor: '#d1fae5', icon: '👀' },
  logic: { label: '逻辑类', color: '#8b5cf6', bgColor: '#ede9fe', icon: '🔗' }
};

function ErrorDiagnosis() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [report, setReport] = useState({ overview: {}, by_category: [], by_chapter: [], hot_questions: [], trend: [], suggestions: [] });
  const [days, setDays] = useState(30);

  useEffect(() => {
    loadData();
  }, [days]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getErrorDiagnosisReport(days);
      setReport(data);
    } catch (e) {
      setError(e.message || '加载诊断报告失败');
    } finally {
      setLoading(false);
    }
  };

  const overview = report.overview || {};

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">生成诊断报告中...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2 className="page-title">错题归因诊断</h2>
      <p className="page-subtitle">从错误类型、章节、高频题维度深度分析薄弱根源</p>

      {error && <div className="error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">总错题</div>
          <div className="stat-card-value">{overview.total_wrong || 0}</div>
          <div className="stat-card-sub">近 {days} 天</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">已掌握</div>
          <div className="stat-card-value" style={{ color: '#10b981' }}>{overview.mastered || 0}</div>
          <div className="stat-card-sub">{overview.mastered_rate || 0}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">待攻克</div>
          <div className="stat-card-value" style={{ color: '#ef4444' }}>{overview.pending || 0}</div>
          <div className="stat-card-sub">未掌握</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">平均错误次数</div>
          <div className="stat-card-value" style={{ color: '#f59e0b' }}>{overview.avg_wrong_per_q || 0}</div>
          <div className="stat-card-sub">次/题</div>
        </div>
      </div>

      {/* 诊断建议 */}
      {report.suggestions && report.suggestions.length > 0 && (
        <div className="section-card" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
          <h3 className="section-title"><span>💡</span>诊断建议</h3>
          {report.suggestions.map((s, idx) => (
            <div key={idx} style={{ padding: '0.75rem', background: '#fff', borderRadius: '6px', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 600, color: '#92400e', marginBottom: '0.25rem' }}>
                {s.type === 'top_category' && '🎯 '}
                {s.type === 'hot_questions' && '🔥 '}
                {s.type === 'low_mastery' && '⚠️ '}
                {s.message}
              </div>
              {s.type === 'hot_questions' && Array.isArray(s.detail) && (
                <ul style={{ fontSize: '0.85rem', color: '#666', paddingLeft: '1.5rem', margin: '0.25rem 0' }}>
                  {s.detail.slice(0, 3).map((q, i) => (
                    <li key={i}>错 {q.wrong_count} 次: {q.question}...</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 错误类型分布 */}
      <div className="section-card">
        <h3 className="section-title"><span>📊</span>错误类型分布</h3>
        {report.by_category && report.by_category.length > 0 ? (
          report.by_category.map((cat, idx) => {
            const info = CATEGORY_INFO[cat.category] || { label: cat.category, color: '#666', bgColor: '#f0f0f0', icon: '📌' };
            const maxCount = Math.max(...report.by_category.map(c => c.count), 1);
            return (
              <div key={idx} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>{info.icon}</span>
                  <span style={{ fontWeight: 600, color: info.color }}>{info.label}</span>
                  <span style={{ marginLeft: 'auto', color: '#888', fontSize: '0.9rem' }}>{cat.count} 次</span>
                </div>
                <div style={{ height: '8px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.4rem' }}>
                  <div style={{ width: `${(cat.count / maxCount) * 100}%`, height: '100%', background: info.color }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {(cat.tags || []).map((t, i) => (
                    <span key={i} style={{
                      padding: '2px 8px', background: info.bgColor, color: info.color,
                      borderRadius: '4px', fontSize: '0.8rem'
                    }}>
                      {t.name || '未命名'} ({t.count || 0})
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty-state">暂无错误标签数据，请在错题分析页为错题添加标签</div>
        )}
      </div>

      {/* 章节薄弱分布 */}
      <div className="section-card">
        <h3 className="section-title"><span>📚</span>章节薄弱分布</h3>
        {report.by_chapter && report.by_chapter.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                  <th style={{ padding: '0.6rem' }}>章节</th>
                  <th style={{ padding: '0.6rem', width: '80px' }}>总错题</th>
                  <th style={{ padding: '0.6rem', width: '80px' }}>待攻克</th>
                  <th style={{ padding: '0.6rem', width: '100px' }}>平均错误</th>
                </tr>
              </thead>
              <tbody>
                {report.by_chapter.map((ch, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.6rem' }}>{ch.category}</td>
                    <td style={{ padding: '0.6rem' }}>{ch.total}</td>
                    <td style={{ padding: '0.6rem' }}>
                      <span style={{ color: ch.pending > 0 ? '#ef4444' : '#10b981', fontWeight: 600 }}>{ch.pending}</span>
                    </td>
                    <td style={{ padding: '0.6rem', color: '#888' }}>{ch.avg_wrong_count ? ch.avg_wrong_count.toFixed(1) : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">暂无章节错题数据</div>
        )}
      </div>

      {/* 高频错题 */}
      {report.hot_questions && report.hot_questions.length > 0 && (
        <div className="section-card">
          <h3 className="section-title"><span>🔥</span>高频错题 Top 5</h3>
          {report.hot_questions.map((q, idx) => (
            <div key={q.id} style={{ padding: '0.75rem', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.3rem' }}>
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>#{idx + 1}</span>
                  {q.category && <span style={{ background: '#f0f0f0', color: '#666', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>{q.category}</span>}
                  <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>错 {q.wrong_count} 次</span>
                </div>
                <div style={{ color: '#333' }}>{q.question ? (q.question.length > 80 ? q.question.slice(0, 80) + '...' : q.question) : '（无内容）'}</div>
              </div>
              <Link to="/review" className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.4rem 0.85rem' }}>去攻克</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ErrorDiagnosis;
