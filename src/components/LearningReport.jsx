import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getLearningReport, getReportDownloadUrl } from '../utils/api';
import LoadingSpinner from './LoadingSpinner';

function LearningReport() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    loadData();
  }, [days]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLearningReport(days);
      setReport(data);
    } catch (e) {
      setError(e.message || '加载学习报告失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (format) => {
    const url = getReportDownloadUrl(format);
    const a = document.createElement('a');
    a.href = url;
    a.download = `learning_report.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getMasteryColor = (score) => {
    if (score === null || score === undefined) return '#9e9e9e';
    if (score >= 80) return '#4caf50';
    if (score >= 60) return '#ff9800';
    return '#f44336';
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

  const { overview = {}, chapters = [], error_by_category = [], weak_knowledge_points = [], trend = [], exam_stats = {}, suggestions = [], top_error_tags = [] } = report || {};
  const maxTrendPracticed = Math.max(...trend.map(t => t.practiced), 1);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">📊 学习报告</h1>
          <p style={{ color: '#666', marginTop: '0.5rem', fontSize: '0.875rem' }}>
            报告生成时间：{report?.generated_at} · 统计周期：近 {days} 天
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDays(d)}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
            >
              {d} 天
            </button>
          ))}
          <button
            className="btn btn-secondary"
            onClick={() => handleDownload('json')}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
          >
            ⬇ 导出 JSON
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleDownload('md')}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
          >
            ⬇ 导出 Markdown
          </button>
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="stats-grid" style={{ marginTop: '1rem' }}>
        <div className="stat-card">
          <div className="stat-card-title">错题总数</div>
          <div className="stat-card-value">{overview.total_wrong_questions || 0}</div>
          <div className="stat-card-sub">已掌握 {overview.mastered || 0} / 未掌握 {overview.unmastered || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">掌握率</div>
          <div className="stat-card-value" style={{ color: '#4caf50' }}>{overview.mastery_rate || 0}%</div>
          <div className="stat-card-sub">错题攻克进度</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">练习正确率</div>
          <div className="stat-card-value" style={{ color: '#2196f3' }}>{overview.accuracy || 0}%</div>
          <div className="stat-card-sub">共练习 {overview.practice_count || 0} 次</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">累计打卡</div>
          <div className="stat-card-value" style={{ color: '#ff9800' }}>{overview.total_checkin_days || 0} 天</div>
          <div className="stat-card-sub">{overview.today_checkin ? '今日已打卡 ✓' : '今日未打卡'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">模考平均分</div>
          <div className="stat-card-value">{exam_stats.avg_score || 0}</div>
          <div className="stat-card-sub">最高 {exam_stats.max_score || 0} · 共 {exam_stats.total_exams || 0} 次</div>
        </div>
      </div>

      {/* 建议提示 */}
      {suggestions.length > 0 && (
        <div className="section-card" style={{ marginTop: '1rem', background: '#fff8e1', border: '1px solid #ffe082' }}>
          <h2 className="section-title">💡 个性化建议</h2>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.2rem', color: '#5d4037', lineHeight: 1.8 }}>
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '1rem' }}>
        {/* 学习趋势 */}
        <div className="section-card">
          <h2 className="section-title">📈 学习趋势（近 {days} 天）</h2>
          {trend.length > 0 ? (
            <div className="chart-container">
              <div className="chart-bars">
                {trend.map((day, idx) => (
                  <div key={idx} className="chart-bar-item">
                    <div
                      className="chart-bar"
                      style={{ height: `${((day.practiced || 0) / maxTrendPracticed) * 100}%` }}
                    >
                      <div className="chart-bar-value">{day.practiced || 0}</div>
                    </div>
                    <div className="chart-bar-label">{(day.date || '').slice(5)}</div>
                    <div className="chart-bar-rate">{day.correct_rate || 0}%</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📉</div>
              <p>近 {days} 天暂无练习记录</p>
            </div>
          )}
        </div>

        {/* 错题分类 */}
        <div className="section-card">
          <h2 className="section-title">🗂 错题分类分布</h2>
          {error_by_category.length > 0 ? (
            <div style={{ marginTop: '1rem' }}>
              {error_by_category.slice(0, 8).map((cat, idx) => {
                const total = error_by_category.reduce((s, c) => s + (c.cnt || 0), 0);
                const percent = total > 0 ? ((cat.cnt || 0) / total) * 100 : 0;
                const colors = ['#667eea', '#764ba2', '#4caf50', '#ff9800', '#f44336', '#2196f3', '#9c27b0', '#00bcd4'];
                return (
                  <div key={idx} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                      <span style={{ color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                        {cat.category || '未分类'}
                      </span>
                      <span style={{ fontWeight: 600, color: '#333' }}>{cat.cnt || 0} 题</span>
                    </div>
                    <div className="category-bar" style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px' }}>
                      <div
                        className="category-bar-fill"
                        style={{ width: `${percent}%`, background: colors[idx % colors.length], height: '100%', borderRadius: '3px' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <p>暂无分类数据</p>
            </div>
          )}
        </div>
      </div>

      {/* 高频错误标签 */}
      {top_error_tags.length > 0 && (
        <div className="section-card" style={{ marginTop: '1rem' }}>
          <h2 className="section-title">🏷 高频错误标签 Top 10</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            {top_error_tags.map((tag, idx) => (
              <div
                key={idx}
                style={{
                  padding: '0.4rem 0.9rem',
                  background: '#ffebee',
                  color: '#f44336',
                  borderRadius: '16px',
                  fontSize: '0.85rem',
                  fontWeight: 500
                }}
              >
                {tag.tag || '未命名'} · {tag.cnt || 0} 次
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 薄弱知识点 */}
      <div className="section-card" style={{ marginTop: '1rem' }}>
        <h2 className="section-title">⚠️ 薄弱知识点 Top 5</h2>
        {weak_knowledge_points.length > 0 ? (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                  <th style={{ padding: '0.6rem', borderBottom: '2px solid #ddd' }}>知识点</th>
                  <th style={{ padding: '0.6rem', borderBottom: '2px solid #ddd', width: '120px' }}>掌握度</th>
                  <th style={{ padding: '0.6rem', borderBottom: '2px solid #ddd', width: '100px' }}>错题数</th>
                  <th style={{ padding: '0.6rem', borderBottom: '2px solid ' + '#ddd', width: '100px' }}>待复习</th>
                </tr>
              </thead>
              <tbody>
                {weak_knowledge_points.map((kp, idx) => {
                  const rawScore = kp.mastery_score;
                  const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
                  const hasScore = Number.isFinite(score);
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.6rem', color: '#333' }}>{kp.name}</td>
                      <td style={{ padding: '0.6rem' }}>
                        <span style={{ color: getMasteryColor(hasScore ? score : null), fontWeight: 600 }}>
                          {hasScore ? `${score}%` : '未学习'}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem', color: '#666' }}>{kp.wrong_count || 0}</td>
                      <td style={{ padding: '0.6rem', color: '#f44336', fontWeight: 600 }}>{kp.pending || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">🎉</div>
            <p>暂无明显薄弱知识点</p>
          </div>
        )}
        <div style={{ marginTop: '1rem' }}>
          <Link to="/learning-path" className="btn btn-primary">查看完整学习路径推荐 →</Link>
        </div>
      </div>

      {/* 章节掌握度 */}
      <div className="section-card" style={{ marginTop: '1rem' }}>
        <h2 className="section-title">📚 章节掌握度概览</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
          {chapters.map((ch, idx) => {
            const score = ch.mastery_score;
            const color = getMasteryColor(score);
            return (
              <div
                key={idx}
                style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  background: '#fafafa',
                  border: '1px solid #eee'
                }}
              >
                <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ch.name}>
                  {ch.name}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#888' }}>{ch.knowledge_point_count} 个知识点</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color }}>
                    {score !== null && score !== undefined ? `${Math.round(score)}%` : '—'}
                  </span>
                </div>
                <div className="category-bar" style={{ height: '4px', background: '#eee', borderRadius: '2px' }}>
                  <div
                    className="category-bar-fill"
                    style={{ width: `${score || 0}%`, background: color, height: '100%', borderRadius: '2px' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="section-card" style={{ marginTop: '1rem', background: '#f0f7ff', border: '1px solid #bbdefb' }}>
        <h2 className="section-title">🔗 相关功能</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <Link to="/review" className="btn btn-secondary">🔁 今日复习队列</Link>
          <Link to="/radar" className="btn btn-secondary">🕸️ 能力雷达图</Link>
          <Link to="/diagnosis" className="btn btn-secondary">🔬 错题归因诊断</Link>
          <Link to="/learning-path" className="btn btn-secondary">🧭 学习路径</Link>
          <Link to="/exam" className="btn btn-secondary">📝 模拟考试</Link>
        </div>
      </div>
    </div>
  );
}

export default LearningReport;
