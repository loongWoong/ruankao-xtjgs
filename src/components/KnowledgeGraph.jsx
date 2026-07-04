import React, { useState, useEffect } from 'react';
import { getKnowledgeTree, getKnowledgeProgress, getWeakestKnowledge } from '../utils/api';
import LoadingSpinner from './LoadingSpinner';
import '../App.css';

function KnowledgeGraph() {
  const [tree, setTree] = useState([]);
  const [progress, setProgress] = useState([]);
  const [weakest, setWeakest] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedChapters, setExpandedChapters] = useState(new Set());
  const [selectedKp, setSelectedKp] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [treeData, progressData, weakestData] = await Promise.all([
        getKnowledgeTree(),
        getKnowledgeProgress(),
        getWeakestKnowledge(10)
      ]);
      setTree(treeData.tree || []);
      setProgress(progressData.progress || progressData.chapters || []);
      setWeakest(weakestData.weak_points || []);
      const defaultExpanded = new Set((treeData.tree || []).slice(0, 3).map(ch => ch.id));
      setExpandedChapters(defaultExpanded);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleChapter = (chapterId) => {
    const next = new Set(expandedChapters);
    if (next.has(chapterId)) {
      next.delete(chapterId);
    } else {
      next.add(chapterId);
    }
    setExpandedChapters(next);
  };

  const getMasteryColor = (score) => {
    if (score >= 0.8) return '#4caf50';
    if (score >= 0.6) return '#ff9800';
    if (score >= 0.4) return '#ff5722';
    return '#f44336';
  };

  const getMasteryLabel = (score) => {
    if (score >= 0.8) return '掌握';
    if (score >= 0.6) return '熟悉';
    if (score >= 0.4) return '了解';
    return '薄弱';
  };

  if (loading) {
    return (
      <div className="page-container">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <p>加载失败：{error}</p>
          <button className="btn-primary" onClick={loadData}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 className="page-title">知识图谱</h1>
      <p className="page-subtitle">系统架构师考试知识点体系，按大纲层级组织</p>

      <div className="kg-stats">
        <div className="kg-stat-card">
          <div className="kg-stat-value">{tree.length}</div>
          <div className="kg-stat-label">章节</div>
        </div>
        <div className="kg-stat-card">
          <div className="kg-stat-value">
            {tree.reduce((sum, ch) => sum + (ch.children?.length || 0), 0)}
          </div>
          <div className="kg-stat-label">小节</div>
        </div>
        <div className="kg-stat-card">
          <div className="kg-stat-value">
            {tree.reduce((sum, ch) => sum + (ch.children?.reduce((s, sec) => s + (sec.children?.length || 0), 0) || 0), 0)}
          </div>
          <div className="kg-stat-label">知识点</div>
        </div>
        <div className="kg-stat-card">
          <div className="kg-stat-value" style={{ color: '#4caf50' }}>
            {tree.length > 0 ? Math.round(
              tree.reduce((sum, ch) => sum + (ch.mastery_score || 0.5), 0) / tree.length * 100
            ) : 0}%
          </div>
          <div className="kg-stat-label">总体掌握度</div>
        </div>
      </div>

      <div className="kg-content">
        <div className="kg-tree-panel">
          <h2 className="section-title">知识树</h2>
          <div className="kg-tree">
            {tree.map((chapter) => (
              <div key={chapter.id} className="kg-chapter">
                <div
                  className="kg-chapter-header"
                  onClick={() => toggleChapter(chapter.id)}
                >
                  <span className="kg-toggle-icon">
                    {expandedChapters.has(chapter.id) ? '▼' : '▶'}
                  </span>
                  <span className="kg-chapter-name">{chapter.name}</span>
                  <span
                    className="kg-mastery-badge"
                    style={{ backgroundColor: getMasteryColor(chapter.mastery_score || 0.5) }}
                  >
                    {getMasteryLabel(chapter.mastery_score || 0.5)}
                  </span>
                </div>
                {expandedChapters.has(chapter.id) && chapter.children && (
                  <div className="kg-sections">
                    {chapter.children.map((section) => (
                      <div key={section.id} className="kg-section">
                        <div className="kg-section-header">
                          <span className="kg-section-name">{section.name}</span>
                          <span className="kg-section-count">
                            {section.children?.length || 0} 个知识点
                          </span>
                        </div>
                        <div className="kg-progress-bar">
                          <div
                            className="kg-progress-fill"
                            style={{
                              width: `${Math.round((section.mastery_score || 0.5) * 100)}%`,
                              backgroundColor: getMasteryColor(section.mastery_score || 0.5)
                            }}
                          />
                        </div>
                        {section.children && (
                          <div className="kg-kp-list">
                            {section.children.map((kp) => (
                              <div
                                key={kp.id}
                                className={`kg-kp-item ${selectedKp === kp.id ? 'selected' : ''}`}
                                onClick={() => setSelectedKp(kp.id)}
                              >
                                <span className="kg-kp-dot" style={{ backgroundColor: getMasteryColor(kp.mastery_score || 0.5) }} />
                                <span className="kg-kp-name">{kp.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="kg-side-panel">
          <div className="kg-side-card">
            <h3 className="side-card-title">🔥 最薄弱知识点</h3>
            <div className="weakest-list">
              {weakest.slice(0, 8).map((kp, index) => (
                <div key={kp.id} className="weakest-item">
                  <span className="weakest-rank">{index + 1}</span>
                  <span className="weakest-name">{kp.name}</span>
                  <span
                    className="weakest-score"
                    style={{ color: getMasteryColor(kp.mastery_score || 0.5) }}
                  >
                    {Math.round((kp.mastery_score || 0.5) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="kg-side-card">
            <h3 className="side-card-title">📈 各章节进度</h3>
            <div className="progress-list">
              {(progress.length > 0 ? progress : tree).map((ch) => (
                <div key={ch.id || ch.chapter_id} className="progress-item">
                  <span className="progress-name">{ch.name || ch.chapter_name}</span>
                  <div className="progress-bar-wrapper">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${Math.round((ch.mastery_score || ch.avg_mastery || 0.5) * 100)}%`,
                        backgroundColor: getMasteryColor(ch.mastery_score || ch.avg_mastery || 0.5)
                      }}
                    />
                  </div>
                  <span className="progress-text">
                    {Math.round((ch.mastery_score || ch.avg_mastery || 0.5) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KnowledgeGraph;
