import React, { useState, useEffect } from 'react';
import { getAbilityRadar } from '../utils/api';
import { Link } from 'react-router-dom';

function AbilityRadar() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ axes: [], data: [], summary: {} });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAbilityRadar();
      setData(result);
    } catch (e) {
      setError(e.message || '加载雷达数据失败');
    } finally {
      setLoading(false);
    }
  };

  const renderRadarChart = () => {
    const chapters = data.data || [];
    if (chapters.length < 3) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div>章节数据不足，至少需要 3 个章节才能绘制雷达图</div>
          <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.5rem' }}>
            当前 {chapters.length} 个章节
          </div>
        </div>
      );
    }

    // 取前 8 个章节避免雷达图过于拥挤
    const displayChapters = chapters.slice(0, 8);
    const n = displayChapters.length;
    const size = 420;
    const cx = size / 2;
    const cy = size / 2;
    const radius = 160;
    const levels = 5;

    // 计算每个点位置
    const angleFor = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
    const pointFor = (i, ratio) => ({
      x: cx + Math.cos(angleFor(i)) * radius * ratio,
      y: cy + Math.sin(angleFor(i)) * radius * ratio
    });

    const axes = ['覆盖率', '掌握度', '错题攻克率'];
    const colors = ['#667eea', '#10b981', '#f59e0b'];

    // 网格圆
    const gridRings = [];
    for (let lvl = 1; lvl <= levels; lvl++) {
      const ratio = lvl / levels;
      const points = Array.from({ length: n }, (_, i) => {
        const p = pointFor(i, ratio);
        return `${p.x},${p.y}`;
      }).join(' ');
      gridRings.push(
        <polygon key={lvl} points={points} fill="none" stroke="#e5e7eb" strokeWidth="1" />
      );
    }

    // 轴线
    const axisLines = displayChapters.map((ch, i) => {
      const p = pointFor(i, 1);
      return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth="1" />;
    });

    // 轴标签
    const axisLabels = displayChapters.map((ch, i) => {
      const p = pointFor(i, 1.15);
      const chName = ch.chapter || '未命名';
      const label = chName.length > 8 ? chName.slice(0, 8) + '...' : chName;
      return (
        <text
          key={i}
          x={p.x}
          y={p.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          fill="#666"
        >
          {label}
        </text>
      );
    });

    // 三个维度的数据多边形
    const dataPolygons = axes.map((axis, axisIdx) => {
      const key = ['coverage', 'mastery', 'wrong_mastered_rate'][axisIdx];
      const points = displayChapters.map((ch, i) => {
        const ratio = Math.min(100, ch[key] || 0) / 100;
        const p = pointFor(i, ratio);
        return `${p.x},${p.y}`;
      }).join(' ');
      return (
        <polygon
          key={axisIdx}
          points={points}
          fill={colors[axisIdx]}
          fillOpacity="0.15"
          stroke={colors[axisIdx]}
          strokeWidth="2"
        />
      );
    });

    // 顶点圆点
    const dataPoints = axes.map((axis, axisIdx) => {
      const key = ['coverage', 'mastery', 'wrong_mastered_rate'][axisIdx];
      return displayChapters.map((ch, i) => {
        const ratio = Math.min(100, ch[key] || 0) / 100;
        const p = pointFor(i, ratio);
        return <circle key={`${axisIdx}-${i}`} cx={p.x} cy={p.y} r="3" fill={colors[axisIdx]} />;
      });
    });

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <svg width={size} height={size} style={{ flex: '0 0 auto', maxWidth: '100%' }}>
          {gridRings}
          {axisLines}
          {dataPolygons}
          {dataPoints}
          {axisLabels}
          {/* 中心刻度标签 */}
          {Array.from({ length: levels }, (_, i) => {
            const y = cy - (radius * (i + 1) / levels);
            return (
              <text key={i} x={cx + 4} y={y} fontSize="9" fill="#bbb">
                {((i + 1) * 20)}
              </text>
            );
          })}
        </svg>

        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ marginBottom: '0.5rem', color: '#555' }}>图例</h4>
            {axes.map((axis, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', background: colors[idx], opacity: 0.6, borderRadius: '2px' }} />
                <span style={{ fontSize: '0.9rem' }}>{axis}</span>
              </div>
            ))}
          </div>

          <div style={{
            padding: '0.75rem', background: '#f9fafb', borderRadius: '6px',
            fontSize: '0.85rem', color: '#555'
          }}>
            <div>平均覆盖率: <strong style={{ color: '#667eea' }}>{data.summary?.avg_coverage || 0}%</strong></div>
            <div>平均掌握度: <strong style={{ color: '#10b981' }}>{data.summary?.avg_mastery || 0}%</strong></div>
            <div>平均错题攻克率: <strong style={{ color: '#f59e0b' }}>{data.summary?.avg_wrong_mastered || 0}%</strong></div>
          </div>
        </div>
      </div>
    );
  };

  const chapters = data.data || [];

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">加载能力雷达...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2 className="page-title">能力雷达图</h2>
      <p className="page-subtitle">按章节维度可视化掌握情况，一眼识别薄弱环节</p>

      {error && <div className="error">{error}</div>}

      <div className="section-card">
        <h3 className="section-title"><span>📊</span>章节能力雷达</h3>
        {renderRadarChart()}
      </div>

      <div className="section-card">
        <h3 className="section-title"><span>📋</span>章节明细</h3>
        {chapters.length === 0 ? (
          <div className="empty-state">暂无数据</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                  <th style={{ padding: '0.6rem' }}>章节</th>
                  <th style={{ padding: '0.6rem', width: '80px' }}>知识点</th>
                  <th style={{ padding: '0.6rem', width: '120px' }}>覆盖率</th>
                  <th style={{ padding: '0.6rem', width: '120px' }}>掌握度</th>
                  <th style={{ padding: '0.6rem', width: '120px' }}>错题攻克</th>
                  <th style={{ padding: '0.6rem', width: '80px' }}>待复习</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map((ch, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.6rem' }}>
                      <div style={{ fontWeight: 600 }}>{ch.chapter || '未命名'}</div>
                      {ch.category && <div style={{ fontSize: '0.8rem', color: '#888' }}>{ch.category}</div>}
                    </td>
                    <td style={{ padding: '0.6rem', color: '#555' }}>{ch.visited_kps || 0}/{ch.total_kps || 0}</td>
                    <td style={{ padding: '0.6rem' }}>
                      <span style={{ color: (ch.coverage || 0) >= 80 ? '#10b981' : (ch.coverage || 0) >= 50 ? '#667eea' : '#ef4444', fontWeight: 600 }}>
                        {ch.coverage || 0}%
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem' }}>
                      <span style={{ color: (ch.mastery || 0) >= 80 ? '#10b981' : (ch.mastery || 0) >= 50 ? '#667eea' : '#ef4444', fontWeight: 600 }}>
                        {ch.mastery || 0}%
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem' }}>
                      <span style={{ color: (ch.wrong_mastered_rate || 0) >= 80 ? '#10b981' : (ch.wrong_mastered_rate || 0) >= 50 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
                        {ch.wrong_mastered_rate || 0}%
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem' }}>
                      {(ch.pending_wrong || 0) > 0 ? (
                        <span style={{ color: '#ef4444', fontWeight: 600 }}>{ch.pending_wrong}</span>
                      ) : (
                        <span style={{ color: '#ccc' }}>0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
          <Link to="/syllabus" className="btn btn-secondary">查看考纲覆盖度</Link>
          <Link to="/review" className="btn btn-primary">去复习薄弱项</Link>
        </div>
      </div>
    </div>
  );
}

export default AbilityRadar;
