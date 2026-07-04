import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getErrorDistribution,
  getErrorTrend,
  getErrorRecommendations,
  batchAnalyzeErrors,
  getStatsOverview
} from '../utils/api';
import LoadingSpinner from './LoadingSpinner';

const ERROR_CATEGORIES = {
  concept: { label: '概念错误', color: '#ff6b6b' },
  memory: { label: '记忆错误', color: '#ffa502' },
  calculation: { label: '计算错误', color: '#ffd93d' },
  reading: { label: '审题错误', color: '#6bcb77' },
  logic: { label: '逻辑错误', color: '#4d96ff' }
};

function ErrorAnalysis() {
  const [stats, setStats] = useState({
    total_wrong_questions: 0,
    total_not_mastered: 0
  });
  const [distribution, setDistribution] = useState([]);
  const [trend, setTrend] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [weakPoints, setWeakPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setError(null);
      const [overviewData, distData, trendData, recData] = await Promise.all([
        getStatsOverview(),
        getErrorDistribution(),
        getErrorTrend(30),
        getErrorRecommendations(5)
      ]);

      setStats({
        total_wrong_questions: overviewData.total_wrong_questions || 0,
        total_not_mastered: overviewData.total_not_mastered || 0
      });

      const dist = distData.distribution || distData.categories || [];
      setDistribution(dist);

      const weak = distData.weak_points || distData.knowledge_points || [];
      setWeakPoints(weak.sort((a, b) => (b.error_count || 0) - (a.error_count || 0)).slice(0, 10));

      const trendList = trendData.trend || trendData.daily || [];
      setTrend(trendList);

      setRecommendations(recData.recommendations || recData.questions || []);
    } catch (err) {
      console.error('获取数据失败:', err);
      setError(err.message || '获取数据失败');
      setDistribution(mockDistribution());
      setTrend(mockTrend());
      setRecommendations(mockRecommendations());
      setWeakPoints(mockWeakPoints());
      setStats({
        total_wrong_questions: 86,
        total_not_mastered: 42
      });
    } finally {
      setLoading(false);
    }
  };

  const mockDistribution = () => [
    { type: 'concept', name: '概念错误', count: 28 },
    { type: 'memory', name: '记忆错误', count: 18 },
    { type: 'calculation', name: '计算错误', count: 15 },
    { type: 'reading', name: '审题错误', count: 12 },
    { type: 'logic', name: '逻辑错误', count: 13 }
  ];

  const mockTrend = () => {
    const data = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        error_count: Math.floor(Math.random() * 8) + 1
      });
    }
    return data;
  };

  const mockRecommendations = () => [
    {
      id: 1,
      type: '单选题',
      content: '在数据库系统中，事务的ACID特性不包括以下哪一项？',
      knowledge_point: '数据库事务',
      reason: '概念错误高发，需强化理解',
      error_count: 5
    },
    {
      id: 2,
      type: '多选题',
      content: '以下哪些属于面向对象设计的基本原则？（多选）',
      knowledge_point: '面向对象设计',
      reason: '记忆混淆，建议对比学习',
      error_count: 4
    },
    {
      id: 3,
      type: '单选题',
      content: '某系统的可靠性模型为串联系统，三个部件的可靠度分别为0.9、0.8、0.7，则系统可靠度为？',
      knowledge_point: '系统可靠性计算',
      reason: '计算错误频发，需加强练习',
      error_count: 3
    }
  ];

  const mockWeakPoints = () => [
    { name: '数据库事务管理', error_count: 12, mastery_rate: 35 },
    { name: '面向对象设计原则', error_count: 10, mastery_rate: 42 },
    { name: '系统架构设计模式', error_count: 9, mastery_rate: 45 },
    { name: '算法复杂度分析', error_count: 8, mastery_rate: 50 },
    { name: '网络协议与安全', error_count: 7, mastery_rate: 55 },
    { name: '软件工程方法论', error_count: 6, mastery_rate: 58 },
    { name: '操作系统进程调度', error_count: 6, mastery_rate: 60 },
    { name: '数据结构与算法', error_count: 5, mastery_rate: 65 },
    { name: '需求工程与建模', error_count: 5, mastery_rate: 68 },
    { name: '系统性能优化', error_count: 4, mastery_rate: 72 }
  ];

  const handleBatchAnalyze = async () => {
    try {
      setBatchAnalyzing(true);
      await batchAnalyzeErrors();
      fetchData();
    } catch (err) {
      console.error('批量分析失败:', err);
    } finally {
      setBatchAnalyzing(false);
    }
  };

  const getTotalErrors = () => {
    return distribution.reduce((sum, item) => sum + (item.count || item.total || 0), 0);
  };

  const getTopCategory = () => {
    if (distribution.length === 0) return { label: '暂无', color: '#999' };
    const top = distribution.reduce((prev, curr) => 
      (curr.count || curr.total || 0) > (prev.count || prev.total || 0) ? curr : prev
    );
    const catKey = top.type || top.category;
    return ERROR_CATEGORIES[catKey] || { label: top.name || catKey, color: '#667eea' };
  };

  const getTrendDirection = () => {
    if (trend.length < 2) return 'stable';
    const firstHalf = trend.slice(0, Math.floor(trend.length / 2));
    const secondHalf = trend.slice(Math.floor(trend.length / 2));
    const firstAvg = firstHalf.reduce((s, d) => s + (d.error_count || d.count || 0), 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, d) => s + (d.error_count || d.count || 0), 0) / secondHalf.length;
    if (secondAvg > firstAvg * 1.1) return 'up';
    if (secondAvg < firstAvg * 0.9) return 'down';
    return 'stable';
  };

  const getCategoryColor = (type) => {
    return ERROR_CATEGORIES[type]?.color || '#667eea';
  };

  const getCategoryLabel = (item) => {
    if (item.name) return item.name;
    return ERROR_CATEGORIES[item.type || item.category]?.label || (item.type || item.category);
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

  const totalErrors = getTotalErrors();
  const topCategory = getTopCategory();
  const trendDirection = getTrendDirection();
  const maxTrendValue = Math.max(...trend.map(d => d.error_count || d.count || 0), 1);

  return (
    <div className="page-container">
      <div className="ea-header">
        <div>
          <h1 className="page-title">错题深度归因分析</h1>
          <p className="page-subtitle">智能分析错题原因，精准定位薄弱环节</p>
        </div>
        {stats.total_not_mastered > 0 && (
          <button 
            className="btn btn-primary ea-batch-btn"
            onClick={handleBatchAnalyze}
            disabled={batchAnalyzing}
          >
            {batchAnalyzing ? '分析中...' : '🔍 批量智能分析'}
          </button>
        )}
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">总错题数</div>
          <div className="stat-card-value">{stats.total_wrong_questions}</div>
          <div className="stat-card-sub">累计收录错题</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">已分析数</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>
            {stats.total_wrong_questions - stats.total_not_mastered}
          </div>
          <div className="stat-card-sub">
            {stats.total_wrong_questions > 0 
              ? `${Math.round(((stats.total_wrong_questions - stats.total_not_mastered) / stats.total_wrong_questions) * 100)}% 已完成`
              : '暂无数据'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">主要错误类型</div>
          <div className="stat-card-value" style={{ color: topCategory.color, fontSize: '1.25rem' }}>
            {topCategory.label}
          </div>
          <div className="stat-card-sub">占比最高的错误分类</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-title">薄弱知识点</div>
          <div className="stat-card-value" style={{ color: '#ff6b6b' }}>{weakPoints.length}</div>
          <div className="stat-card-sub">需重点攻克的知识点</div>
        </div>
      </div>

      <div className="ea-main-grid">
        <div className="section-card">
          <h2 className="section-title">📊 错误类型分布</h2>
          <div className="ea-distribution-content">
            <div className="ea-pie-chart">
              <svg viewBox="0 0 42 42" className="donut-svg">
                {(() => {
                  const total = distribution.reduce((s, c) => s + (c.count || c.total || 0), 0);
                  let offset = 0;
                  return distribution.map((cat, i) => {
                    const count = cat.count || cat.total || 0;
                    const percent = total > 0 ? (count / total) * 100 : 0;
                    const dashArray = `${percent} ${100 - percent}`;
                    const dashOffset = -offset;
                    const color = getCategoryColor(cat.type || cat.category);
                    const isSelected = selectedCategory === (cat.type || cat.category);
                    offset += percent;
                    return (
                      <circle
                        key={i}
                        cx="21"
                        cy="21"
                        r="15.9155"
                        fill="transparent"
                        stroke={color}
                        strokeWidth={isSelected ? "8" : "6"}
                        strokeDasharray={dashArray}
                        strokeDashoffset={dashOffset}
                        transform="rotate(-90 21 21)"
                        style={{ cursor: 'pointer', transition: 'stroke-width 0.2s', opacity: selectedCategory && !isSelected ? 0.4 : 1 }}
                        onClick={() => setSelectedCategory(selectedCategory === (cat.type || cat.category) ? null : (cat.type || cat.category))}
                      />
                    );
                  });
                })()}
              </svg>
              <div className="donut-center">
                <div className="donut-value">{totalErrors}</div>
                <div className="donut-label">错题总数</div>
              </div>
            </div>
            <div className="ea-legend-list">
              {distribution.map((cat, i) => {
                const count = cat.count || cat.total || 0;
                const type = cat.type || cat.category;
                const color = getCategoryColor(type);
                const percent = totalErrors > 0 ? ((count / totalErrors) * 100).toFixed(1) : 0;
                const isSelected = selectedCategory === type;
                return (
                  <div 
                    key={i} 
                    className={`ea-legend-item ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(isSelected ? null : type)}
                  >
                    <div className="ea-legend-dot" style={{ background: color }} />
                    <span className="ea-legend-label">{getCategoryLabel(cat)}</span>
                    <span className="ea-legend-count">{count}</span>
                    <span className="ea-legend-percent">{percent}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="section-card">
          <h2 className="section-title">
            📈 错误趋势（近30天）
            <span className={`ea-trend-badge ea-trend-${trendDirection}`}>
              {trendDirection === 'up' ? '↑ 上升' : trendDirection === 'down' ? '↓ 下降' : '→ 平稳'}
            </span>
          </h2>
          <div className="ea-trend-chart">
            <div className="ea-trend-bars">
              {trend.map((day, index) => {
                const count = day.error_count || day.count || 0;
                const heightPercent = (count / maxTrendValue) * 100;
                return (
                  <div key={index} className="ea-trend-bar-item" title={`${day.date}: ${count}道`}>
                    <div
                      className="ea-trend-bar"
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="ea-trend-labels">
              <span>{trend[0]?.date?.slice(5) || ''}</span>
              <span>{trend[Math.floor(trend.length / 2)]?.date?.slice(5) || ''}</span>
              <span>{trend[trend.length - 1]?.date?.slice(5) || ''}</span>
            </div>
          </div>
        </div>

        <div className="section-card">
          <h2 className="section-title">🎯 薄弱知识点 TOP10</h2>
          <div className="ea-weak-list">
            {weakPoints.map((wp, index) => (
              <div key={index} className="ea-weak-item">
                <div className="ea-weak-rank" style={{ background: index < 3 ? `linear-gradient(135deg, ${['#ff6b6b', '#ffa502', '#ffd93d'][index]} 0%, ${['#ff4757', '#ff7f50', '#ffbe0b'][index]} 100%)` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  {index + 1}
                </div>
                <div className="ea-weak-info">
                  <div className="ea-weak-name">{wp.name}</div>
                  <div className="ea-weak-bar">
                    <div 
                      className="ea-weak-bar-fill" 
                      style={{ 
                        width: `${wp.mastery_rate}%`,
                        background: wp.mastery_rate < 40 ? 'linear-gradient(90deg, #ff6b6b 0%, #ff4757 100%)' : 
                                   wp.mastery_rate < 60 ? 'linear-gradient(90deg, #ffa502 0%, #ff7f50 100%)' : 
                                   'linear-gradient(90deg, #6bcb77 0%, #4ade80 100%)'
                      }} 
                    />
                  </div>
                </div>
                <div className="ea-weak-stats">
                  <span className="ea-weak-count">错 {wp.error_count}次</span>
                  <span className="ea-weak-rate">{wp.mastery_rate}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2 className="section-title">💡 针对性练习推荐</h2>
        <p style={{ color: '#888', fontSize: '0.875rem', marginBottom: '1rem' }}>
          基于你的错题分析，智能推荐以下练习题目
        </p>
        <div className="ea-recommend-list">
          {recommendations.map((rec, index) => (
            <div key={index} className="ea-recommend-card">
              <div className="ea-recommend-header">
                <span className="ea-recommend-type">{rec.type}</span>
                <span className="ea-recommend-kp">{rec.knowledge_point}</span>
              </div>
              <div className="ea-recommend-content">{rec.content}</div>
              <div className="ea-recommend-reason">
                <span className="ea-reason-icon">💡</span>
                <span>{rec.reason}</span>
              </div>
              <div className="ea-recommend-footer">
                <span className="ea-error-count">已错 {rec.error_count || 0} 次</span>
                <Link to={`/practice?mode=recommend`} className="btn btn-primary ea-start-btn">
                  开始练习
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ErrorAnalysis;
