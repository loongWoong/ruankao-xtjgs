import React, { useState, useEffect } from 'react';
import {
  getRealExamQuestions,
  startRealExam,
  getRealExamStats,
  getMockExam,
  startMockExam,
  answerMockExam,
  submitMockExam,
  getMockExamResult
} from '../utils/api';

const STATUS_LABELS = {
  draft: '未开始',
  in_progress: '进行中',
  submitted: '已提交'
};

function RealExam() {
  const [view, setView] = useState('list');
  const [stats, setStats] = useState({ total_exams: 0, avg_score: 0, best_score: 0, total_questions: 0 });
  const [questions, setQuestions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterYear, setFilterYear] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [years, setYears] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [examConfig, setExamConfig] = useState({ year: '', question_count: 20, title: '真题模考' });
  const [currentExamId, setCurrentExamId] = useState(null);
  const [examData, setExamData] = useState(null);
  const [examQuestions, setExamQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [examResult, setExamResult] = useState(null);
  // 记录考试截止时间戳（ms），避免浏览器后台 setInterval 节流导致倒计时不准
  const [examEndAt, setExamEndAt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const PAGE_SIZE = 10;

  useEffect(() => {
    loadStats();
    loadQuestions(1);
  }, []);

  useEffect(() => {
    if (view !== 'exam' || !examData) return;
    if (timeLeft <= 0) {
      handleSubmitExam();
      return;
    }
    // 使用时间戳差值，避免浏览器后台/休眠时 setInterval 节流导致倒计时不准
    const timer = setInterval(() => {
      if (examEndAt > 0) {
        const remaining = Math.max(0, Math.floor((examEndAt - Date.now()) / 1000));
        setTimeLeft(remaining);
        // 倒计时归零时在回调内立即触发自动提交，避免依赖 useEffect 重新执行
        if (remaining <= 0) {
          clearInterval(timer);
          handleSubmitExam();
        }
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, examData, examEndAt]);

  const loadStats = async () => {
    try {
      const data = await getRealExamStats();
      setStats(data);
      if (data.category_distribution) setCategories(data.category_distribution.map(c => c.category));
    } catch (e) {
      console.error('加载统计失败', e);
    }
  };

  const loadQuestions = async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = { page: p, limit: PAGE_SIZE };
      if (filterYear) params.year = filterYear;
      if (filterCategory) params.category = filterCategory;
      const data = await getRealExamQuestions(params);
      setQuestions(data.items || []);
      setTotal(data.total || 0);
      setPage(p);
      if (data.years) setYears(data.years);
      if (data.categories) setCategories(data.categories);
    } catch (e) {
      setError(e.message || '加载题目失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStartExam = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        title: examConfig.title || '真题模考',
        question_count: parseInt(examConfig.question_count, 10) || 20
      };
      if (examConfig.year) payload.year = parseInt(examConfig.year, 10);

      const data = await startRealExam(payload);
      if (!data.success) throw new Error('创建真题模考失败');
      const examId = data.exam_id;

      const detail = await getMockExam(examId);
      setCurrentExamId(examId);
      setExamData(detail.exam);
      setExamQuestions(detail.questions || []);
      setAnswers({});
      setCurrentIndex(0);
      setExamResult(null);

      if (detail.exam.status === 'draft') {
        const startData = await startMockExam(examId);
        setExamData(startData.exam);
      }
      const durSec = (detail.exam.duration_minutes || 150) * 60;
      const startedAt = detail.exam.started_at ? new Date(detail.exam.started_at).getTime() : Date.now();
      const endAt = startedAt + durSec * 1000;
      setExamEndAt(endAt);
      setTimeLeft(Math.max(0, Math.floor((endAt - Date.now()) / 1000)));
      setView('exam');
    } catch (e) {
      setError(e.message || '开始考试失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAnswer = async (option) => {
    const newAnswers = { ...answers, [currentIndex]: option };
    setAnswers(newAnswers);
    try {
      await answerMockExam(currentExamId, currentIndex, option);
    } catch (e) {
      console.error('保存答案失败', e);
    }
  };

  const handleSubmitExam = async () => {
    if (submitting) return;
    setSubmitting(true);
    setShowSubmitConfirm(false);
    try {
      await submitMockExam(currentExamId);
      const result = await getMockExamResult(currentExamId);
      setExamResult(result);
      setView('result');
    } catch (e) {
      setError(e.message || '提交考试失败');
    } finally {
      setSubmitting(false);
    }
  };

  const answeredCount = Object.keys(answers).length;

  const handleBackToList = () => {
    setView('list');
    setExamData(null);
    setExamQuestions([]);
    setExamResult(null);
    loadStats();
    loadQuestions(1);
  };

  const formatTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const renderListView = () => (
    <div className="page-container">
      <h2 className="page-title">真题题库与真实模考</h2>
      <p className="page-subtitle">历年真题练习，全真模拟考场环境</p>

      {error && <div className="error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">真题总数</div>
          <div className="stat-card-value">{stats.total_questions || 0}</div>
          <div className="stat-card-sub">道真题</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">模考次数</div>
          <div className="stat-card-value">{stats.total_exams || 0}</div>
          <div className="stat-card-sub">已完成</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">平均分</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>{stats.avg_score || 0}</div>
          <div className="stat-card-sub">满分75</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">最高分</div>
          <div className="stat-card-value" style={{ color: '#4caf50' }}>{stats.best_score || 0}</div>
          <div className="stat-card-sub">满分75</div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title"><span>🎯</span>开始真题模考</h3>
        <div className="sp-form">
          <div className="sp-form-row">
            <div className="sp-form-group">
              <label className="sp-form-label">考试标题</label>
              <input
                type="text"
                className="sp-form-input"
                value={examConfig.title}
                onChange={e => setExamConfig(prev => ({ ...prev, title: e.target.value }))}
                placeholder="例如：2023年真题模考"
              />
            </div>
            <div className="sp-form-group">
              <label className="sp-form-label">年份（可选）</label>
              <select
                className="sp-form-input"
                value={examConfig.year}
                onChange={e => setExamConfig(prev => ({ ...prev, year: e.target.value }))}
              >
                <option value="">随机抽取</option>
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
            <div className="sp-form-group">
              <label className="sp-form-label">题量（5-75）</label>
              <input
                type="number"
                className="sp-form-input"
                min="5"
                max="75"
                value={examConfig.question_count}
                onChange={e => setExamConfig(prev => ({ ...prev, question_count: e.target.value }))}
              />
            </div>
          </div>
          <div className="sp-form-actions">
            <button className="btn btn-primary" onClick={handleStartExam} disabled={loading}>
              {loading ? '创建中...' : '🚀 开始模考'}
            </button>
          </div>
        </div>
      </div>

      {stats.recent_exams && stats.recent_exams.length > 0 && (
        <div className="section-card">
          <h3 className="section-title"><span>📋</span>最近模考记录</h3>
          <div className="me-exam-list">
            {stats.recent_exams.map(exam => (
              <div key={exam.id} className="me-exam-item">
                <div className="me-exam-info">
                  <div className="me-exam-title">{exam.title}</div>
                  <div className="me-exam-meta">
                    <span>{exam.total_questions} 题</span>
                    {exam.submitted_at && <span>{exam.submitted_at}</span>}
                  </div>
                </div>
                <div className="me-exam-score">
                  {exam.status === 'submitted' && (
                    <div className="me-score-value">{exam.score || 0}<span>分</span></div>
                  )}
                  <span className={`me-status me-status-${exam.status}`}>{STATUS_LABELS[exam.status] || exam.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-card">
        <h3 className="section-title"><span>📚</span>真题题库浏览</h3>
        <div className="filter-bar" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <select
            className="sp-form-input"
            style={{ width: 'auto' }}
            value={filterYear}
            onChange={e => { setFilterYear(e.target.value); }}
          >
            <option value="">全部年份</option>
            {years.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select
            className="sp-form-input"
            style={{ width: 'auto' }}
            value={filterCategory}
            onChange={e => { setFilterCategory(e.target.value); }}
          >
            <option value="">全部分类</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={() => loadQuestions(1)}>筛选</button>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : questions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div>暂无符合条件的真题</div>
          </div>
        ) : (
          <>
            <div className="question-list">
              {questions.map((q, idx) => (
                <div key={q.id} className="question-item" style={{ padding: '1rem', borderBottom: '1px solid #eee' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ color: '#667eea', fontWeight: 600 }}>第 {(page - 1) * PAGE_SIZE + idx + 1} 题</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {q.year && <span className="tag" style={{ background: '#eef1ff', color: '#667eea', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>{q.year}年</span>}
                      {q.category && <span className="tag" style={{ background: '#f0f0f0', color: '#666', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>{q.category}</span>}
                    </div>
                  </div>
                  <div style={{ marginBottom: '0.75rem', lineHeight: 1.6 }}>{q.question_text}</div>
                  {q.options && (() => {
                    let opts = q.options;
                    if (typeof opts === 'string') {
                      try { opts = JSON.parse(opts); } catch (e) { opts = []; }
                    }
                    if (Array.isArray(opts)) {
                      return (
                        <div style={{ fontSize: '0.9rem', color: '#555' }}>
                          {opts.map((opt, i) => <div key={i}>{opt}</div>)}
                        </div>
                      );
                    }
                    if (opts && typeof opts === 'object') {
                      return (
                        <div style={{ fontSize: '0.9rem', color: '#555' }}>
                          {Object.entries(opts).map(([k, v]) => <div key={k}>{k}. {v}</div>)}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
              <button
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => loadQuestions(page - 1)}
              >上一页</button>
              <span style={{ color: '#888' }}>第 {page} 页 / 共 {Math.ceil(total / PAGE_SIZE) || 1} 页 (总 {total} 题)</span>
              <button
                className="btn btn-secondary"
                disabled={page >= Math.ceil(total / PAGE_SIZE)}
                onClick={() => loadQuestions(page + 1)}
              >下一页</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderExamView = () => {
    if (!examData || examQuestions.length === 0) return (
      <div className="empty-state">
        <div className="empty-state-icon">📭</div>
        <p>暂无题目数据，请返回列表重新选择</p>
        <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={handleBackToList}>返回列表</button>
      </div>
    );
    const q = examQuestions[currentIndex];
    let options = q.options;
    if (typeof options === 'string') {
      try { options = JSON.parse(options); } catch { options = {}; }
    }
    const optionKeys = Object.keys(options || {});
    const answeredCount = Object.keys(answers).length;

    return (
      <div className="page-container">
        <div className="me-exam-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 className="page-title" style={{ marginBottom: '0.25rem' }}>{examData.title}</h2>
            <div style={{ color: '#888', fontSize: '0.9rem' }}>
              第 {currentIndex + 1} / {examQuestions.length} 题 · 已答 {answeredCount} 题
            </div>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: timeLeft < 300 ? '#f44336' : '#667eea', fontFamily: 'monospace' }}>
            ⏰ {formatTime(timeLeft)}
          </div>
        </div>

        <div className="section-card">
          <div style={{ marginBottom: '1.5rem', fontSize: '1.05rem', lineHeight: 1.7 }}>{q.question_text}</div>
          <div className="options-list">
            {optionKeys.map(key => (
              <div
                key={key}
                className={`option-item ${answers[currentIndex] === key ? 'selected' : ''}`}
                onClick={() => handleSelectAnswer(key)}
                style={{
                  padding: '0.85rem 1rem',
                  margin: '0.5rem 0',
                  border: answers[currentIndex] === key ? '2px solid #667eea' : '1px solid #ddd',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: answers[currentIndex] === key ? '#eef1ff' : '#fff'
                }}
              >
                <strong style={{ marginRight: '0.5rem' }}>{key}.</strong>{options[key]}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
          <button
            className="btn btn-secondary"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex(i => i - 1)}
          >上一题</button>
          {currentIndex < examQuestions.length - 1 ? (
            <button className="btn btn-primary" onClick={() => setCurrentIndex(i => i + 1)}>下一题</button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => setShowSubmitConfirm(true)}
              disabled={submitting}
            >
              {submitting ? '提交中...' : '交卷'}
            </button>
          )}
        </div>

        {showSubmitConfirm && (
          <div className="me-modal-overlay" onClick={() => setShowSubmitConfirm(false)}>
            <div className="me-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
              <h3 style={{ marginBottom: '0.75rem' }}>确认交卷？</h3>
              <p style={{ marginBottom: '0.5rem', color: '#666' }}>
                已答 <strong style={{ color: '#667eea' }}>{answeredCount}</strong> / {examQuestions.length} 题
              </p>
              {answeredCount < examQuestions.length && (
                <p style={{ marginBottom: '0.75rem', color: '#f44336', fontSize: '0.875rem' }}>
                  ⚠️ 还有 {examQuestions.length - answeredCount} 题未作答，提交后无法修改
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setShowSubmitConfirm(false)}>再答会</button>
                <button className="btn btn-primary" onClick={handleSubmitExam} disabled={submitting}>
                  {submitting ? '提交中...' : '确认交卷'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: '1rem' }}>
          <details>
            <summary style={{ cursor: 'pointer', color: '#667eea' }}>题目导航 ({answeredCount}/{examQuestions.length} 已答)</summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
              {examQuestions.map((_, idx) => (
                <button
                  key={idx}
                  className="btn"
                  style={{
                    width: '36px', height: '36px', padding: 0,
                    background: idx === currentIndex ? '#667eea' : (answers[idx] ? '#e8f5e9' : '#f0f0f0'),
                    color: idx === currentIndex ? '#fff' : '#333',
                    border: 'none', borderRadius: '4px', cursor: 'pointer'
                  }}
                  onClick={() => setCurrentIndex(idx)}
                >{idx + 1}</button>
              ))}
            </div>
          </details>
        </div>
      </div>
    );
  };

  const renderResultView = () => {
    if (!examResult) return <div className="loading">加载结果中...</div>;
    const { exam = {}, questions: resultQuestions = [], correct_count = 0, score = 0 } = examResult;
    // 后端 total_questions 在 exam.total_questions 内，顶层无此字段；以题目数量兜底
    const total_questions = resultQuestions.length || exam.total_questions || 0;
    const pass = score >= 45;

    return (
      <div className="page-container">
        <h2 className="page-title">模考成绩</h2>
        <div className="section-card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{
            fontSize: '3rem', fontWeight: 700,
            color: pass ? '#4caf50' : '#f44336',
            marginBottom: '0.5rem'
          }}>
            {score}
            <span style={{ fontSize: '1.2rem', color: '#888' }}> / 75</span>
          </div>
          <div style={{
            display: 'inline-block', padding: '0.4rem 1rem', borderRadius: '20px',
            background: pass ? '#e8f5e9' : '#ffebee',
            color: pass ? '#4caf50' : '#f44336',
            fontWeight: 600
          }}>
            {pass ? '✓ 通过' : '✗ 未通过（需≥45分）'}
          </div>
          <div style={{ marginTop: '1rem', color: '#666' }}>
            答对 {correct_count} / {total_questions} 题 · 正确率 {total_questions > 0 ? Math.round(correct_count / total_questions * 100) : 0}%
          </div>
        </div>

        <div className="section-card">
          <h3 className="section-title"><span>📝</span>题目回顾</h3>
          {resultQuestions.map((q, idx) => {
            const isCorrect = q.is_correct;
            return (
              <div key={idx} style={{ padding: '1rem', borderBottom: '1px solid #eee' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>第 {idx + 1} 题</span>
                  <span style={{ color: isCorrect ? '#4caf50' : '#f44336', fontWeight: 600 }}>
                    {isCorrect ? '✓ 正确' : '✗ 错误'}
                  </span>
                </div>
                <div style={{ marginBottom: '0.5rem' }}>{q.question_text}</div>
                <div style={{ fontSize: '0.9rem', color: '#555' }}>
                  <div>你的答案: <strong style={{ color: isCorrect ? '#4caf50' : '#f44336' }}>{q.user_answer || '未作答'}</strong></div>
                  {!isCorrect && <div style={{ color: '#4caf50' }}>正确答案: <strong>{q.correct_answer}</strong></div>}
                  {q.explanation && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#f9fafb', borderRadius: '4px' }}>
                      💡 {q.explanation}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={handleBackToList}>返回题库</button>
        </div>
      </div>
    );
  };

  if (view === 'exam') return renderExamView();
  if (view === 'result') return renderResultView();
  return renderListView();
}

export default RealExam;
