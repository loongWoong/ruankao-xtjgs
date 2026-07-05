import React, { useState, useEffect, useRef } from 'react';
import {
  getEssayTopics,
  getEssayTopic,
  submitEssay,
  getEssaySubmissions,
  getEssaySubmission,
  updateEssaySubmission,
  getEssayStats
} from '../utils/api.js';

const STATUS_MAP = {
  draft: { label: '草稿', color: '#6b7280', bg: '#f3f4f6' },
  submitted: { label: '已提交', color: '#10b981', bg: '#d1fae5' }
};

function EssayTraining() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('list'); // list | writing | detail | submissions
  const [topics, setTopics] = useState([]);
  const [filters, setFilters] = useState({ year: '', category: '', search: '' });
  const [categories, setCategories] = useState([]);
  const [years, setYears] = useState([]);
  const [currentTopic, setCurrentTopic] = useState(null);
  const [currentSubmission, setCurrentSubmission] = useState(null);
  const [stats, setStats] = useState(null);
  const [submissions, setSubmissions] = useState([]);

  // 写作状态
  const [essayTitle, setEssayTitle] = useState('');
  const [essayContent, setEssayContent] = useState('');
  const [selfScore, setSelfScore] = useState('');
  const [selfEvaluation, setSelfEvaluation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingSubId, setEditingSubId] = useState(null);
  const startTimeRef = useRef(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [topicsData, statsData] = await Promise.all([
        getEssayTopics(filters),
        getEssayStats().catch(() => null)
      ]);
      setTopics(topicsData.items || []);
      setCategories(topicsData.categories || []);
      setYears(topicsData.years || []);
      setStats(statsData);
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFilter = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    getEssayTopics(newFilters).then(data => {
      setTopics(data.items || []);
      setCategories(data.categories || []);
      setYears(data.years || []);
    }).catch(() => {});
  };

  const startWriting = async (topicId) => {
    try {
      setLoading(true);
      const topic = await getEssayTopic(topicId);
      setCurrentTopic(topic);
      setEssayTitle('');
      setEssayContent('');
      setSelfScore('');
      setSelfEvaluation('');
      setEditingSubId(null);
      setView('writing');
      startTimeRef.current = Date.now();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const editSubmission = async (subId) => {
    try {
      setLoading(true);
      const sub = await getEssaySubmission(subId);
      setCurrentTopic({
        id: sub.topic_id,
        topic_title: sub.topic_title,
        topic_category: sub.topic_category,
        year: sub.year,
        background: sub.background,
        requirements: sub.requirements,
        key_points: sub.key_points,
        reference_essay: sub.reference_essay
      });
      setEssayTitle(sub.title || '');
      setEssayContent(sub.content || '');
      setSelfScore(sub.self_score ? String(sub.self_score) : '');
      setSelfEvaluation(sub.self_evaluation || '');
      setEditingSubId(subId);
      setView('writing');
      startTimeRef.current = Date.now();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (status = 'draft') => {
    if (!essayContent.trim()) {
      setError('论文内容不能为空');
      return;
    }
    // 自评分数范围校验：0-75 分（软考论文满分 75）
    let scoreValue = null;
    if (selfScore && selfScore.trim() !== '') {
      scoreValue = Number(selfScore);
      if (isNaN(scoreValue) || scoreValue < 0 || scoreValue > 75) {
        setError('自评分数必须在 0-75 分之间');
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    const timeSpent = startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0;
    const payload = {
      topic_id: currentTopic.id,
      title: essayTitle,
      content: essayContent,
      time_spent: timeSpent,
      self_score: scoreValue,
      self_evaluation: selfEvaluation,
      status
    };
    try {
      if (editingSubId) {
        await updateEssaySubmission(editingSubId, payload);
      } else {
        await submitEssay(payload);
      }
      setView('list');
      loadData();
    } catch (err) {
      setError(err.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const viewSubmissionDetail = async (subId) => {
    try {
      setLoading(true);
      const sub = await getEssaySubmission(subId);
      setCurrentSubmission(sub);
      setView('detail');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSubmissions = async () => {
    try {
      setLoading(true);
      const data = await getEssaySubmissions();
      setSubmissions(data.items || []);
      setView('submissions');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const wordCount = essayContent.length;

  if (loading && view === 'list') {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="page essay-training">
      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      {/* 列表视图 */}
      {view === 'list' && (
        <>
          <div className="page-header">
            <h2>论文训练</h2>
            <div className="header-actions">
              <button className="btn btn-secondary" onClick={loadSubmissions}>我的论文</button>
            </div>
          </div>

          {stats && (
            <div className="stats-cards">
              <div className="stat-card">
                <div className="stat-value">{stats.total_topics}</div>
                <div className="stat-label">论文题目</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.total_submissions}</div>
                <div className="stat-label">练习次数</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.submitted_count}</div>
                <div className="stat-label">已提交</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.avg_self_score}</div>
                <div className="stat-label">平均自评</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.total_words}</div>
                <div className="stat-label">总字数</div>
              </div>
            </div>
          )}

          <div className="filter-bar">
            <input
              type="text"
              placeholder="搜索题目..."
              value={filters.search}
              onChange={(e) => handleFilter('search', e.target.value)}
              className="filter-input"
            />
            <select value={filters.year} onChange={(e) => handleFilter('year', e.target.value)} className="filter-select">
              <option value="">全部年份</option>
              {years.map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select value={filters.category} onChange={(e) => handleFilter('category', e.target.value)} className="filter-select">
              <option value="">全部类别</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="topic-list">
            {topics.length === 0 ? (
              <div className="empty-state">暂无论文题目</div>
            ) : topics.map(topic => (
              <div key={topic.id} className="topic-card">
                <div className="topic-card-header">
                  <span className="topic-year">{topic.year}年</span>
                  <span className="topic-category">{topic.topic_category}</span>
                </div>
                <h3 className="topic-title">{topic.topic_title}</h3>
                <p className="topic-background">{topic.background}</p>
                {topic.key_points && (
                  <div className="topic-keypoints">
                    <strong>考点：</strong>{topic.key_points}
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => startWriting(topic.id)}>
                  开始写作
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 写作视图 */}
      {view === 'writing' && currentTopic && (
        <div className="writing-view">
          <div className="writing-header">
            <button className="btn btn-back" onClick={() => setView('list')}>← 返回</button>
            <h2>{currentTopic.topic_title}</h2>
            <span className="topic-year">{currentTopic.year}年 · {currentTopic.topic_category}</span>
          </div>

          <div className="writing-meta">
            <div className="meta-block">
              <strong>背景：</strong>
              <p>{currentTopic.background}</p>
            </div>
            <div className="meta-block">
              <strong>要求：</strong>
              <pre className="requirements-text">{currentTopic.requirements}</pre>
            </div>
            {currentTopic.key_points && (
              <div className="meta-block keypoints">
                <strong>关键考点：</strong>
                <p>{currentTopic.key_points}</p>
              </div>
            )}
          </div>

          <div className="writing-form">
            <input
              type="text"
              placeholder="论文标题（选填）"
              value={essayTitle}
              onChange={(e) => setEssayTitle(e.target.value)}
              className="essay-title-input"
            />
            <textarea
              placeholder="在此撰写论文，建议字数 2000-3000 字..."
              value={essayContent}
              onChange={(e) => setEssayContent(e.target.value)}
              className="essay-content-input"
              rows={20}
            />
            <div className="word-count">
              字数：{wordCount} {wordCount < 2000 ? '(建议继续扩充)' : wordCount > 3000 ? '(已达要求)' : '(字数达标)'}
            </div>

            <div className="self-eval-section">
              <h4>自评（提交后填写）</h4>
              <div className="self-eval-row">
                <label>自评分数（0-75）：</label>
                <input
                  type="number"
                  min="0"
                  max="75"
                  value={selfScore}
                  onChange={(e) => setSelfScore(e.target.value)}
                  className="score-input"
                />
              </div>
              <textarea
                placeholder="自我评价：对照评分要点分析自己的论文..."
                value={selfEvaluation}
                onChange={(e) => setSelfEvaluation(e.target.value)}
                className="eval-input"
                rows={4}
              />
            </div>

            <div className="writing-actions">
              <button className="btn btn-secondary" onClick={() => handleSave('draft')} disabled={submitting}>
                保存草稿
              </button>
              <button className="btn btn-primary" onClick={() => handleSave('submitted')} disabled={submitting}>
                {submitting ? '提交中...' : '提交论文'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提交记录列表 */}
      {view === 'submissions' && (
        <>
          <div className="page-header">
            <h2>我的论文练习</h2>
            <button className="btn btn-secondary" onClick={() => setView('list')}>返回题目</button>
          </div>
          {submissions.length === 0 ? (
            <div className="empty-state">暂无练习记录</div>
          ) : (
            <div className="submission-list">
              {submissions.map(sub => {
                const st = STATUS_MAP[sub.status] || STATUS_MAP.draft;
                return (
                  <div key={sub.id} className="submission-item" onClick={() => viewSubmissionDetail(sub.id)}>
                    <div className="sub-info">
                      <h4>{sub.topic_title || '（无标题草稿）'}</h4>
                      <div className="sub-meta">
                        <span>{sub.year}年</span>
                        <span>{sub.word_count}字</span>
                        {sub.self_score && <span>自评 {sub.self_score}分</span>}
                        <span className="status-tag" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                      </div>
                    </div>
                    <div className="sub-time">
                      {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : new Date(sub.created_at).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 提交详情 */}
      {view === 'detail' && currentSubmission && (
        <div className="submission-detail">
          <div className="writing-header">
            <button className="btn btn-back" onClick={() => setView('submissions')}>← 返回列表</button>
            <h2>{currentSubmission.topic_title || '（无标题草稿）'}</h2>
          </div>
          <div className="detail-meta">
            <span>{currentSubmission.year}年</span>
            <span>{currentSubmission.word_count}字</span>
            {currentSubmission.self_score && <span>自评 {currentSubmission.self_score}分</span>}
            {currentSubmission.time_spent && <span>用时 {Math.round(currentSubmission.time_spent / 60)}分钟</span>}
          </div>
          {currentSubmission.title && <h3 className="detail-title">{currentSubmission.title}</h3>}
          <pre className="detail-content">{currentSubmission.content}</pre>

          {currentSubmission.self_evaluation && (
            <div className="detail-eval">
              <strong>自我评价：</strong>
              <p>{currentSubmission.self_evaluation}</p>
            </div>
          )}

          {currentSubmission.reference_essay && (
            <div className="reference-essay">
              <h4>参考范文</h4>
              <pre>{currentSubmission.reference_essay}</pre>
            </div>
          )}

          <div className="detail-keypoints">
            <strong>关键考点：</strong>
            <p>{currentSubmission.key_points}</p>
          </div>

          <button className="btn btn-primary" onClick={() => editSubmission(currentSubmission.id)}>继续编辑</button>
        </div>
      )}
    </div>
  );
}

export default EssayTraining;
