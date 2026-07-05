import React, { useState, useEffect, useRef } from 'react';
import {
  getCaseQuestions,
  getCaseQuestion,
  submitCase,
  getCaseSubmissions,
  getCaseSubmission,
  updateCaseSubmission,
  getCaseStats
} from '../utils/api.js';

const STATUS_MAP = {
  draft: { label: '草稿', color: '#6b7280', bg: '#f3f4f6' },
  submitted: { label: '已提交', color: '#10b981', bg: '#d1fae5' }
};

function CaseAnalysis() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('list'); // list | answer | detail | submissions
  const [questions, setQuestions] = useState([]);
  const [filters, setFilters] = useState({ year: '', category: '', search: '' });
  const [categories, setCategories] = useState([]);
  const [years, setYears] = useState([]);
  const [currentCase, setCurrentCase] = useState(null);
  const [currentSubmission, setCurrentSubmission] = useState(null);
  const [stats, setStats] = useState(null);
  const [submissions, setSubmissions] = useState([]);

  // 答题状态：answers 是 { "0": "回答内容", "1": "..." } 按问题索引
  const [answers, setAnswers] = useState({});
  const [selfScore, setSelfScore] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingSubId, setEditingSubId] = useState(null);
  const startTimeRef = useRef(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [qData, statsData] = await Promise.all([
        getCaseQuestions(filters),
        getCaseStats().catch(() => null)
      ]);
      setQuestions(qData.items || []);
      setCategories(qData.categories || []);
      setYears(qData.years || []);
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

  // 搜索防抖：filters.search 变化 300ms 后才查询
  const filterTimer = useRef(null);
  useEffect(() => {
    if (filterTimer.current) clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => {
      getCaseQuestions(filters).then(data => {
        setQuestions(data.items || []);
        setCategories(data.categories || []);
        setYears(data.years || []);
      }).catch(() => {});
    }, 300);
    return () => {
      if (filterTimer.current) clearTimeout(filterTimer.current);
    };
  }, [filters]);

  const handleFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const startAnswering = async (caseId) => {
    try {
      setLoading(true);
      const detail = await getCaseQuestion(caseId);
      setCurrentCase(detail);
      setAnswers({});
      setSelfScore('');
      setEditingSubId(null);
      setView('answer');
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
      const sub = await getCaseSubmission(subId);
      setCurrentCase({
        id: sub.case_id,
        case_title: sub.case_title,
        category: sub.category,
        year: sub.year,
        background: sub.background,
        questions_list: sub.questions_list,
        key_points: sub.key_points
      });
      setAnswers(sub.answers_list || {});
      setSelfScore(sub.self_score ? String(sub.self_score) : '');
      setEditingSubId(subId);
      setView('answer');
      startTimeRef.current = Date.now();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (status = 'draft') => {
    setSubmitting(true);
    setError(null);
    const timeSpent = startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0;
    const payload = {
      case_id: currentCase.id,
      answers,
      time_spent: timeSpent,
      self_score: selfScore ? Number(selfScore) : null,
      status
    };
    try {
      if (editingSubId) {
        await updateCaseSubmission(editingSubId, payload);
      } else {
        await submitCase(payload);
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
      const sub = await getCaseSubmission(subId);
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
      const data = await getCaseSubmissions();
      setSubmissions(data.items || []);
      setView('submissions');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateAnswer = (idx, value) => {
    setAnswers(prev => ({ ...prev, [idx]: value }));
  };

  if (loading && view === 'list') {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="page case-analysis">
      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      {/* 列表视图 */}
      {view === 'list' && (
        <>
          <div className="page-header">
            <h2>案例分析训练</h2>
            <div className="header-actions">
              <button className="btn btn-secondary" onClick={loadSubmissions}>我的练习</button>
            </div>
          </div>

          {stats && (
            <div className="stats-cards">
              <div className="stat-card">
                <div className="stat-value">{stats.total_cases}</div>
                <div className="stat-label">案例题目</div>
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
            </div>
          )}

          <div className="filter-bar">
            <input
              type="text"
              placeholder="搜索案例..."
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
            {questions.length === 0 ? (
              <div className="empty-state">暂无案例题目</div>
            ) : questions.map(q => (
              <div key={q.id} className="topic-card">
                <div className="topic-card-header">
                  <span className="topic-year">{q.year}年</span>
                  <span className="topic-category">{q.category}</span>
                </div>
                <h3 className="topic-title">{q.case_title}</h3>
                <p className="topic-background">{q.background}</p>
                {q.key_points && (
                  <div className="topic-keypoints">
                    <strong>考点：</strong>{q.key_points}
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => startAnswering(q.id)}>
                  开始作答
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 答题视图 */}
      {view === 'answer' && currentCase && (
        <div className="answer-view">
          <div className="writing-header">
            <button className="btn btn-back" onClick={() => setView('list')}>← 返回</button>
            <h2>{currentCase.case_title}</h2>
            <span className="topic-year">{currentCase.year}年 · {currentCase.category}</span>
          </div>

          <div className="case-background">
            <strong>案例背景：</strong>
            <p>{currentCase.background}</p>
          </div>

          <div className="questions-list">
            {(currentCase.questions_list || []).map((q, idx) => (
              <div key={idx} className="question-block">
                <h4>问题 {idx + 1}：</h4>
                <p className="question-text">{q.q}</p>
                <textarea
                  placeholder="请在此输入你的答案..."
                  value={answers[String(idx)] || ''}
                  onChange={(e) => updateAnswer(String(idx), e.target.value)}
                  className="answer-input"
                  rows={6}
                />
              </div>
            ))}
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
          </div>

          <div className="writing-actions">
            <button className="btn btn-secondary" onClick={() => handleSave('draft')} disabled={submitting}>
              保存草稿
            </button>
            <button className="btn btn-primary" onClick={() => handleSave('submitted')} disabled={submitting}>
              {submitting ? '提交中...' : '提交答案'}
            </button>
          </div>
        </div>
      )}

      {/* 提交记录列表 */}
      {view === 'submissions' && (
        <>
          <div className="page-header">
            <h2>我的案例练习</h2>
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
                      <h4>{sub.case_title || '（无标题草稿）'}</h4>
                      <div className="sub-meta">
                        <span>{sub.year}年</span>
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
            <h2>{currentSubmission.case_title || '（无标题草稿）'}</h2>
          </div>
          <div className="detail-meta">
            <span>{currentSubmission.year}年</span>
            {currentSubmission.self_score && <span>自评 {currentSubmission.self_score}分</span>}
            {currentSubmission.time_spent && <span>用时 {Math.round(currentSubmission.time_spent / 60)}分钟</span>}
          </div>

          <div className="case-background">
            <strong>案例背景：</strong>
            <p>{currentSubmission.background}</p>
          </div>

          {(currentSubmission.questions_list || []).map((q, idx) => (
            <div key={idx} className="answer-compare">
              <h4>问题 {idx + 1}：{q.q}</h4>
              <div className="answer-block my-answer">
                <strong>我的答案：</strong>
                <pre>{(currentSubmission.answers_list || {})[String(idx)] || '（未作答）'}</pre>
              </div>
              {q.ref && (
                <div className="answer-block ref-answer">
                  <strong>参考要点：</strong>
                  <pre>{q.ref}</pre>
                </div>
              )}
            </div>
          ))}

          <div className="reference-essay">
            <h4>参考答案</h4>
            <pre>{currentSubmission.reference_answer}</pre>
          </div>

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

export default CaseAnalysis;
