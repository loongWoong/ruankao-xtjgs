import React, { useState, useEffect } from 'react';
import {
  createMockExam,
  getMockExam,
  startMockExam,
  answerMockExam,
  submitMockExam,
  getMockExamResult,
  getMockExamList,
  getMockExamStats
} from '../utils/api';

function MockExam() {
  const [view, setView] = useState('list');
  const [stats, setStats] = useState({ total_exams: 0, avg_score: 0, max_score: 0 });
  const [examList, setExamList] = useState([]);
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: '',
    exam_type: 'full',
    question_count: 10,
    duration_minutes: 30
  });

  const [currentExamId, setCurrentExamId] = useState(null);
  const [examData, setExamData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  // 记录考试截止时间戳（ms），用于 setInterval 被后台节流时仍能正确倒计时
  const [examEndAt, setExamEndAt] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [examResult, setExamResult] = useState(null);
  const [expandedQuestions, setExpandedQuestions] = useState({});

  useEffect(() => {
    loadStats();
    loadExamList();
  }, []);

  useEffect(() => {
    if (view !== 'exam' || !examData) return;

    if (timeLeft <= 0) {
      handleSubmit();
      return;
    }

    // 使用时间戳差值计算剩余时间，避免浏览器后台/休眠时 setInterval 节流导致倒计时不准
    const timer = setInterval(() => {
      if (examEndAt > 0) {
        const remaining = Math.max(0, Math.floor((examEndAt - Date.now()) / 1000));
        setTimeLeft(remaining);
      }
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, examData, examEndAt]);

  const loadStats = async () => {
    try {
      const data = await getMockExamStats();
      setStats(data);
    } catch (e) {
      console.error('加载统计数据失败', e);
    }
  };

  const loadExamList = async (page = 1) => {
    setLoading(true);
    try {
      const data = await getMockExamList(page, 10);
      setExamList(data.items || []);
      setListTotal(data.total || 0);
      setListPage(page);
    } catch (e) {
      console.error('加载考试列表失败', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateExam = async () => {
    if (!createForm.title.trim()) {
      alert('请输入考试标题');
      return;
    }
    try {
      const data = await createMockExam({
        title: createForm.title,
        exam_type: createForm.exam_type,
        question_count: createForm.question_count,
        duration_minutes: createForm.duration_minutes
      });
      if (data.success) {
        setShowCreateModal(false);
        setCreateForm({ title: '', exam_type: 'full', question_count: 10, duration_minutes: 30 });
        loadStats();
        loadExamList(listPage);
      }
    } catch (e) {
      console.error('创建考试失败', e);
      alert('创建考试失败');
    }
  };

  const handleStartExam = async (examId) => {
    try {
      const detail = await getMockExam(examId);
      setCurrentExamId(examId);
      setExamData(detail.exam);
      setQuestions(detail.questions || []);
      setAnswers({});
      setCurrentIndex(0);

      if (detail.exam.status === 'draft') {
        const startData = await startMockExam(examId);
        setExamData(startData.exam);
        const durSec = (detail.exam.duration_minutes || 30) * 60;
        setTimeLeft(durSec);
        setExamEndAt(Date.now() + durSec * 1000);
      } else if (detail.exam.status === 'in_progress') {
        const startTime = new Date(detail.exam.started_at).getTime();
        const durSec = (detail.exam.duration_minutes || 30) * 60;
        const endAt = startTime + durSec * 1000;
        const remaining = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
        setTimeLeft(remaining);
        setExamEndAt(endAt);

        const savedAnswers = {};
        (detail.questions || []).forEach((q, idx) => {
          if (q.user_answer) {
            savedAnswers[idx] = q.user_answer;
          }
        });
        setAnswers(savedAnswers);
      }

      setView('exam');
    } catch (e) {
      console.error('开始考试失败', e);
      alert('开始考试失败');
    }
  };

  const handleContinueExam = (examId) => {
    handleStartExam(examId);
  };

  const handleViewResult = async (examId) => {
    try {
      const result = await getMockExamResult(examId);
      setExamResult(result);
      setCurrentExamId(examId);
      setView('result');
    } catch (e) {
      console.error('获取考试结果失败', e);
      alert('获取考试结果失败');
    }
  };

  const handleRetryExam = async (examId) => {
    if (!window.confirm('将基于本次考试配置创建一场新的模考，是否继续？')) {
      return;
    }
    try {
      const detail = await getMockExam(examId);
      const data = await createMockExam({
        title: detail.exam.title + ' (重做)',
        exam_type: detail.exam.exam_type,
        question_count: detail.exam.total_questions,
        duration_minutes: detail.exam.duration_minutes
      });
      if (data.success) {
        loadStats();
        loadExamList(listPage);
        handleStartExam(data.exam_id);
      }
    } catch (e) {
      console.error('重新考试失败', e);
      alert('重新考试失败');
    }
  };

  const handleSelectAnswer = async (answer) => {
    if (answers[currentIndex] === answer) return;

    setAnswers((prev) => ({ ...prev, [currentIndex]: answer }));

    try {
      await answerMockExam(currentExamId, currentIndex, answer);
    } catch (e) {
      console.error('提交答案失败', e);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setShowSubmitConfirm(false);
    try {
      await submitMockExam(currentExamId);
      const result = await getMockExamResult(currentExamId);
      setExamResult(result);
      setView('result');
      loadStats();
      loadExamList(listPage);
    } catch (e) {
      console.error('提交考试失败', e);
      alert('提交考试失败');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const getExamTypeLabel = (type) => {
    const map = { full: '全真模拟', chapter: '章节练习', custom: '自定义' };
    return map[type] || type;
  };

  const getStatusLabel = (status) => {
    const map = { draft: '未开始', in_progress: '进行中', submitted: '已提交' };
    return map[status] || status;
  };

  const toggleQuestionExpand = (index) => {
    setExpandedQuestions((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const answeredCount = Object.keys(answers).length;

  const renderListView = () => (
    <div className="me-container">
      <div className="me-header">
        <h1 className="page-title">模拟考试</h1>
        <button className="btn btn-primary me-create-btn" onClick={() => setShowCreateModal(true)}>
          + 创建考试
        </button>
      </div>

      <div className="stats-grid me-stats">
        <div className="stat-card">
          <div className="stat-card-title">总考试次数</div>
          <div className="stat-card-value">{stats.total_exams || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">平均分</div>
          <div className="stat-card-value">{stats.avg_score || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">最高分</div>
          <div className="stat-card-value">{stats.max_score || 0}</div>
        </div>
      </div>

      <div className="section-card">
        <h2 className="section-title">考试记录</h2>
        {loading ? (
          <div className="empty-state">加载中...</div>
        ) : examList.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <p>暂无考试记录</p>
            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setShowCreateModal(true)}>
              创建第一场考试
            </button>
          </div>
        ) : (
          <>
            <div className="me-exam-list">
              {examList.map((exam) => (
                <div key={exam.id} className="me-exam-item">
                  <div className="me-exam-info">
                    <div className="me-exam-title">{exam.title}</div>
                    <div className="me-exam-meta">
                      <span className="me-exam-type">{getExamTypeLabel(exam.exam_type)}</span>
                      <span>{exam.total_questions} 题</span>
                      <span>{formatDate(exam.created_at)}</span>
                    </div>
                  </div>
                  <div className="me-exam-score">
                    {exam.status === 'submitted' && (
                      <div className="me-score-value">{exam.score || 0}<span>分</span></div>
                    )}
                    <span className={`me-status me-status-${exam.status}`}>{getStatusLabel(exam.status)}</span>
                  </div>
                  <div className="me-exam-actions">
                    {exam.status === 'in_progress' && (
                      <button className="btn btn-primary" onClick={() => handleContinueExam(exam.id)}>
                        继续考试
                      </button>
                    )}
                    {exam.status === 'submitted' && (
                      <button className="btn btn-secondary" onClick={() => handleViewResult(exam.id)}>
                        查看结果
                      </button>
                    )}
                    {exam.status === 'draft' && (
                      <button className="btn btn-primary" onClick={() => handleStartExam(exam.id)}>
                        开始考试
                      </button>
                    )}
                    <button className="btn btn-secondary" onClick={() => handleRetryExam(exam.id)}>
                      重新考试
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {listTotal > 10 && (
              <div className="pagination">
                <button
                  onClick={() => loadExamList(listPage - 1)}
                  disabled={listPage <= 1}
                >
                  上一页
                </button>
                <span style={{ padding: '0.5rem' }}>
                  第 {listPage} 页 / 共 {Math.ceil(listTotal / 10)} 页
                </span>
                <button
                  onClick={() => loadExamList(listPage + 1)}
                  disabled={listPage >= Math.ceil(listTotal / 10)}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showCreateModal && (
        <div className="me-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="me-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="me-modal-title">创建模拟考试</h3>
            <div className="me-form">
              <div className="me-form-group">
                <label className="me-form-label">考试标题</label>
                <input
                  type="text"
                  className="me-form-input"
                  placeholder="请输入考试标题"
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                />
              </div>
              <div className="me-form-group">
                <label className="me-form-label">考试类型</label>
                <select
                  className="me-form-input"
                  value={createForm.exam_type}
                  onChange={(e) => setCreateForm({ ...createForm, exam_type: e.target.value })}
                >
                  <option value="full">全真模拟</option>
                  <option value="chapter">章节练习</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
              <div className="me-form-row">
                <div className="me-form-group">
                  <label className="me-form-label">题目数量</label>
                  <select
                    className="me-form-input"
                    value={createForm.question_count}
                    onChange={(e) => setCreateForm({ ...createForm, question_count: parseInt(e.target.value) })}
                  >
                    <option value={5}>5 题</option>
                    <option value={10}>10 题</option>
                    <option value={20}>20 题</option>
                    <option value={50}>50 题</option>
                    <option value={100}>100 题</option>
                  </select>
                </div>
                <div className="me-form-group">
                  <label className="me-form-label">考试时长</label>
                  <select
                    className="me-form-input"
                    value={createForm.duration_minutes}
                    onChange={(e) => setCreateForm({ ...createForm, duration_minutes: parseInt(e.target.value) })}
                  >
                    <option value={15}>15 分钟</option>
                    <option value={30}>30 分钟</option>
                    <option value={60}>60 分钟</option>
                    <option value={90}>90 分钟</option>
                    <option value={120}>120 分钟</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="me-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreateExam}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderExamView = () => {
    if (!examData || questions.length === 0) {
      return <div className="empty-state">加载中...</div>;
    }

    const currentQuestion = questions[currentIndex];
    const isTimeWarning = timeLeft < 300;

    return (
      <div className="me-exam-container">
        <div className="me-exam-header">
          <div className="me-exam-title-bar">
            <button className="btn btn-secondary me-back-btn" onClick={() => setView('list')}>
              ← 返回列表
            </button>
            <h2 className="me-exam-title-text">{examData.title}</h2>
          </div>
          <div className={`me-timer ${isTimeWarning ? 'me-timer-warning' : ''}`}>
            <span className="me-timer-icon">⏱</span>
            <span className="me-timer-text">{formatTime(timeLeft)}</span>
          </div>
        </div>

        <div className="me-exam-body">
          <div className="me-question-nav">
            <div className="me-nav-title">题目导航</div>
            <div className="me-nav-grid">
              {questions.map((_, idx) => {
                let cls = 'me-nav-dot';
                if (idx === currentIndex) cls += ' me-nav-current';
                if (answers[idx]) cls += ' me-nav-answered';
                return (
                  <button
                    key={idx}
                    className={cls}
                    onClick={() => setCurrentIndex(idx)}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            <div className="me-nav-legend">
              <div className="me-legend-item">
                <span className="me-legend-dot me-nav-answered"></span>
                <span>已答</span>
              </div>
              <div className="me-legend-item">
                <span className="me-legend-dot me-nav-current"></span>
                <span>当前</span>
              </div>
              <div className="me-legend-item">
                <span className="me-legend-dot"></span>
                <span>未答</span>
              </div>
            </div>
            <div className="me-nav-progress">
              已答: {answeredCount} / {questions.length}
            </div>
          </div>

          <div className="me-question-area">
            <div className="practice-card me-question-card">
              <div className="me-question-header">
                <span className="me-question-number">第 {currentIndex + 1} 题</span>
                <span className="question-category">
                  {currentQuestion.category || '未分类'}
                </span>
              </div>
              <div className="practice-question me-question-text">
                {currentQuestion.question_text || currentQuestion.question}
              </div>
              <div className="practice-options me-options">
                {(currentQuestion.options || []).map((opt, idx) => {
                  const optionLabel = opt.charAt(0);
                  const isSelected = answers[currentIndex] === optionLabel;
                  return (
                    <div
                      key={idx}
                      className={`practice-option me-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectAnswer(optionLabel)}
                    >
                      <span className="practice-option-label">{optionLabel}</span>
                      <span className="practice-option-content">{opt.substring(3)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="me-question-nav-buttons">
              <button
                className="btn btn-secondary"
                onClick={() => setCurrentIndex(currentIndex - 1)}
                disabled={currentIndex === 0}
              >
                上一题
              </button>
              {currentIndex < questions.length - 1 ? (
                <button
                  className="btn btn-primary"
                  onClick={() => setCurrentIndex(currentIndex + 1)}
                >
                  下一题
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => setShowSubmitConfirm(true)}
                >
                  提交试卷
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="me-exam-footer">
          <button
            className="btn btn-danger me-submit-btn"
            onClick={() => setShowSubmitConfirm(true)}
          >
            提交试卷
          </button>
        </div>

        {showSubmitConfirm && (
          <div className="me-modal-overlay" onClick={() => setShowSubmitConfirm(false)}>
            <div className="me-modal me-modal-small" onClick={(e) => e.stopPropagation()}>
              <h3 className="me-modal-title">确认提交</h3>
              <p className="me-modal-text">
                已答 {answeredCount} / {questions.length} 题
                {answeredCount < questions.length && (
                  <span style={{ color: '#f44336' }}>
                    ，还有 {questions.length - answeredCount} 题未作答
                  </span>
                )}
              </p>
              <p className="me-modal-text">确定要提交试卷吗？</p>
              <div className="me-modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowSubmitConfirm(false)}>
                  继续答题
                </button>
                <button className="btn btn-primary" onClick={handleSubmit}>
                  确认提交
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderResultView = () => {
    if (!examResult) {
      return <div className="empty-state">加载中...</div>;
    }

    const { exam, questions: resultQuestions, kp_accuracy, correct_count, wrong_count, score } = examResult;
    const isPassed = score >= 60;

    return (
      <div className="me-result-container">
        <div className="me-result-header">
          <button className="btn btn-secondary me-back-btn" onClick={() => setView('list')}>
            ← 返回列表
          </button>
          <h1 className="page-title" style={{ flex: 1, textAlign: 'center' }}>考试结果</h1>
          <div style={{ width: '100px' }}></div>
        </div>

        <div className={`me-score-card ${isPassed ? 'me-score-pass' : 'me-score-fail'}`}>
          <div className="me-score-main">
            <div className="me-score-number">{score || 0}</div>
            <div className="me-score-unit">分</div>
          </div>
          <div className={`me-score-status ${isPassed ? 'me-status-pass' : 'me-status-fail'}`}>
            {isPassed ? '✓ 及格' : '✗ 不及格'}
          </div>
          <div className="me-score-stats">
            <div className="me-score-stat">
              <div className="me-score-stat-value">{correct_count || 0}</div>
              <div className="me-score-stat-label">正确</div>
            </div>
            <div className="me-score-stat">
              <div className="me-score-stat-value">{wrong_count || 0}</div>
              <div className="me-score-stat-label">错误</div>
            </div>
            <div className="me-score-stat">
              <div className="me-score-stat-value">{resultQuestions?.length || 0}</div>
              <div className="me-score-stat-label">总题数</div>
            </div>
            <div className="me-score-stat">
              <div className="me-score-stat-value">
                {resultQuestions?.length ? Math.round((correct_count / resultQuestions.length) * 100) : 0}%
              </div>
              <div className="me-score-stat-label">正确率</div>
            </div>
          </div>
        </div>

        <div className="section-card">
          <h2 className="section-title">答题详情</h2>
          <div className="me-result-list">
            {(resultQuestions || []).map((q, idx) => {
              const isCorrect = q.is_correct;
              const isExpanded = expandedQuestions[idx];
              return (
                <div key={idx} className={`me-result-item ${isCorrect ? 'me-correct' : 'me-wrong'}`}>
                  <div className="me-result-item-header" onClick={() => toggleQuestionExpand(idx)}>
                    <div className="me-result-item-left">
                      <span className={`me-result-icon ${isCorrect ? 'me-icon-correct' : 'me-icon-wrong'}`}>
                        {isCorrect ? '✓' : '✗'}
                      </span>
                      <span className="me-result-number">第 {idx + 1} 题</span>
                      <span className="me-result-question">
                        {(q.question_text || q.question || '').substring(0, 60)}...
                      </span>
                    </div>
                    <span className="me-result-expand">{isExpanded ? '收起' : '展开'}</span>
                  </div>
                  {isExpanded && (
                    <div className="me-result-detail">
                      <div className="me-detail-question">
                        {q.question_text || q.question}
                      </div>
                      <div className="me-detail-options">
                        {(q.options || []).map((opt, oidx) => {
                          const label = opt.charAt(0);
                          const isCorrectOpt = label === q.correct_answer;
                          const isUserOpt = label === q.user_answer;
                          let cls = 'practice-option';
                          if (isCorrectOpt) cls += ' correct';
                          if (isUserOpt && !isCorrectOpt) cls += ' wrong';
                          return (
                            <div key={oidx} className={cls}>
                              <span className="practice-option-label">{label}</span>
                              <span className="practice-option-content">{opt.substring(3)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="me-detail-answers">
                        <div className="me-detail-answer-row">
                          <span className="me-detail-label">你的答案：</span>
                          <span className={isCorrect ? 'answer-correct' : 'answer-wrong'}>
                            {q.user_answer || '未作答'}
                          </span>
                        </div>
                        <div className="me-detail-answer-row">
                          <span className="me-detail-label">正确答案：</span>
                          <span className="answer-correct">{q.correct_answer}</span>
                        </div>
                      </div>
                      {q.explanation && (
                        <div className="practice-analysis">
                          <h4 style={{ color: '#667eea' }}>📖 解析</h4>
                          <p>{q.explanation}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {kp_accuracy && kp_accuracy.length > 0 && (
          <div className="section-card">
            <h2 className="section-title">知识点掌握分析</h2>
            <div className="me-kp-list">
              {kp_accuracy.map((kp, idx) => {
                const accuracy = kp.accuracy || 0;
                const isWeak = accuracy < 60;
                return (
                  <div key={idx} className="me-kp-item">
                    <div className="me-kp-header">
                      <span className="me-kp-name">{kp.name || kp.kp_name}</span>
                      <span className={`me-kp-rate ${isWeak ? 'me-kp-weak' : ''}`}>
                        {accuracy}%
                      </span>
                    </div>
                    <div className="category-bar">
                      <div
                        className={`category-bar-fill ${isWeak ? 'me-bar-weak' : ''}`}
                        style={{ width: `${accuracy}%` }}
                      ></div>
                    </div>
                    <div className="me-kp-meta">
                      {kp.correct || 0} / {kp.total || 0} 题
                    </div>
                  </div>
                );
              })}
            </div>
            {kp_accuracy.filter(kp => (kp.accuracy || 0) < 60).length > 0 && (
              <div className="me-weak-tip">
                💡 提示：以上标红的知识点为薄弱知识点，建议重点复习
              </div>
            )}
          </div>
        )}

        <div className="me-result-actions">
          <button className="btn btn-secondary" onClick={() => setView('list')}>
            返回列表
          </button>
          <button className="btn btn-primary" onClick={() => handleRetryExam(currentExamId)}>
            重新考试
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page-container">
      {view === 'list' && renderListView()}
      {view === 'exam' && renderExamView()}
      {view === 'result' && renderResultView()}
    </div>
  );
}

export default MockExam;
