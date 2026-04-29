import React, { useState, useEffect } from 'react';

function Practice() {
  const [mode, setMode] = useState('today');
  const [userId, setUserId] = useState('');
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [practiceResult, setPracticeResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ correct: 0, wrong: 0 });
  const [errorPatterns, setErrorPatterns] = useState([]);
  const [selectedPattern, setSelectedPattern] = useState(null);
  const [reflectionGateEnabled, setReflectionGateEnabled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('ruankao_user_id');
    if (stored) {
      setUserId(stored);
      fetchFeatureFlags(stored);
      return;
    }
    const generated = `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('ruankao_user_id', generated);
    setUserId(generated);
    fetchFeatureFlags(generated);
  }, []);

  useEffect(() => {
    fetchErrorPatterns();
    if (userId) {
      loadQuestions();
    }
  }, [mode, userId]);

  const fetchFeatureFlags = async (id) => {
    try {
      const res = await fetch(`http://localhost:5002/api/feature-flags?user_id=${encodeURIComponent(id)}`);
      const data = await res.json();
      setReflectionGateEnabled(Boolean(data?.reflection_gate?.enabled));
    } catch (e) {
      console.error('加载功能开关失败', e);
      setReflectionGateEnabled(false);
    }
  };

  const fetchErrorPatterns = async () => {
    try {
      const res = await fetch('http://localhost:5002/api/error-patterns');
      const data = await res.json();
      setErrorPatterns(data.patterns || []);
    } catch (e) {
      console.error('加载错误模式失败', e);
    }
  };

  const loadQuestions = async () => {
    setLoading(true);
    try {
      let url = 'http://localhost:5002/api/practice/random?limit=10';
      if (mode === 'today') url = 'http://localhost:5002/api/practice/today?limit=10';
      if (mode === 'recommend') url = 'http://localhost:5002/api/practice/recommend';

      const res = await fetch(url);
      const data = await res.json();

      setQuestions(data.questions || []);
      setCurrentIndex(0);
      setSelectedAnswer(null);
      setShowResult(false);
      setPracticeResult(null);
      setSelectedPattern(null);
      setStats({ correct: 0, wrong: 0 });
    } catch (error) {
      console.error('加载题目失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAnswer = (answer) => {
    if (showResult) return;
    setSelectedAnswer(answer);
  };

  const handleSubmit = async () => {
    if (!selectedAnswer) return;
    const question = questions[currentIndex];
    const isCorrect = selectedAnswer === question.correct_answer;

    try {
      const res = await fetch('http://localhost:5002/api/practice/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: question.id,
          answer: selectedAnswer,
          error_pattern_id: selectedPattern,
          time_spent: 0,
          user_id: userId
        })
      });

      const result = await res.json();
      setPracticeResult(result);
      setShowResult(true);
      setStats((prev) => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1)
      }));
    } catch (error) {
      console.error('提交失败:', error);
    }
  };

  const submitReflectionIfNeeded = async () => {
    const currentQuestion = questions[currentIndex];
    const needReflection = reflectionGateEnabled && showResult && !practiceResult?.is_correct;
    if (!needReflection) return true;

    if (!selectedPattern) {
      window.alert('请先选择错误反思，再进入下一题');
      return false;
    }
    if (!practiceResult?.attempt_id) {
      window.alert('反思事件缺少 attempt_id，请刷新后重试');
      return false;
    }

    try {
      const res = await fetch('http://localhost:5002/api/practice/reflection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: practiceResult.attempt_id,
          question_id: currentQuestion.id,
          error_pattern_id: selectedPattern,
          user_id: userId
        })
      });
      if (!res.ok) {
        throw new Error('submit reflection failed');
      }
      return true;
    } catch (error) {
      console.error('提交反思失败:', error);
      window.alert('反思提交失败，请重试');
      return false;
    }
  };

  const handleNext = async () => {
    const canContinue = await submitReflectionIfNeeded();
    if (!canContinue) return;

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
      setPracticeResult(null);
      setSelectedPattern(null);
    }
  };

  const handleRestart = async () => {
    const canContinue = await submitReflectionIfNeeded();
    if (!canContinue) return;
    loadQuestions();
  };

  if (loading) return <div className="empty-state">加载中...</div>;

  if (questions.length === 0) {
    return (
      <div className="practice">
        <h1 className="page-title">认知强化练习</h1>
        <div className="practice-modes">
          <button className={`mode-btn ${mode === 'today' ? 'active' : ''}`} onClick={() => setMode('today')}>今日待练</button>
          <button className={`mode-btn ${mode === 'recommend' ? 'active' : ''}`} onClick={() => setMode('recommend')}>🔥 击破薄弱点</button>
          <button className={`mode-btn ${mode === 'random' ? 'active' : ''}`} onClick={() => setMode('random')}>随机练习</button>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">✍️</div>
          <p>暂无待练习题目</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={loadQuestions}>刷新</button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];

  return (
    <div className="practice">
      <h1 className="page-title">认知强化练习</h1>

      <div className="practice-modes">
        <button className={`mode-btn ${mode === 'today' ? 'active' : ''}`} onClick={() => setMode('today')}>今日待练</button>
        <button className={`mode-btn ${mode === 'recommend' ? 'active' : ''}`} onClick={() => setMode('recommend')}>🔥 击破薄弱点</button>
        <button className={`mode-btn ${mode === 'random' ? 'active' : ''}`} onClick={() => setMode('random')}>随机练习</button>
      </div>

      <div className="practice-progress">
        <span>进度: {currentIndex + 1} / {questions.length}</span>
        <span>正确: {stats.correct} | 错误: {stats.wrong}</span>
      </div>

      <div className="practice-card">
        <div className="practice-question">
          <span className="question-category">{currentQuestion.category || '未分类'}</span>
          <p style={{ marginTop: '1rem' }}>{currentQuestion.question}</p>
        </div>

        <div className="practice-options">
          {currentQuestion.options && currentQuestion.options.map((opt, index) => {
            let className = 'practice-option';
            if (showResult) {
              if (opt.startsWith(currentQuestion.correct_answer)) className += ' correct';
              else if (opt === selectedAnswer) className += ' wrong';
            } else if (opt === selectedAnswer) className += ' selected';
            return (
              <div key={index} className={className} onClick={() => handleSelectAnswer(opt)}>
                <span className="practice-option-label">{opt.charAt(0)}</span>
                <span className="practice-option-content">{opt.substring(3)}</span>
              </div>
            );
          })}
        </div>

        {showResult && reflectionGateEnabled && !practiceResult?.is_correct && (
          <div className="metacognition-section" style={{ marginTop: '1rem', padding: '1rem', background: '#f9f9f9', borderRadius: '8px', border: '1px solid #ddd' }}>
            <h4 style={{ marginBottom: '0.5rem', color: '#666' }}>💡 错误反思 (元认知)</h4>
            <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>这次为什么没做对？（必选）</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {errorPatterns.map((p) => (
                <button
                  key={p.id}
                  className={`btn ${selectedPattern === p.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                  onClick={() => setSelectedPattern(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {showResult && (
          <div className={`practice-result ${practiceResult?.is_correct ? 'correct' : 'wrong'}`}>
            <p style={{ fontWeight: 'bold', fontSize: '1.125rem' }}>
              {practiceResult?.is_correct ? '回答正确！' : '回答错误'}
            </p>
          </div>
        )}

        {showResult && currentQuestion.analysis && (
          <div className="practice-analysis">
            <h4 style={{ color: '#4caf50' }}>🎯 认知纠偏 (解析)</h4>
            <p>{currentQuestion.analysis}</p>
          </div>
        )}

        <div className="practice-actions">
          {!showResult ? (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!selectedAnswer}>提交答案</button>
          ) : (
            <div className="practice-nav">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setCurrentIndex(currentIndex - 1);
                  setSelectedAnswer(null);
                  setShowResult(false);
                  setPracticeResult(null);
                  setSelectedPattern(null);
                }}
                disabled={currentIndex === 0}
              >
                上一题
              </button>
              {currentIndex < questions.length - 1 ? (
                <button className="btn btn-primary" onClick={handleNext}>下一题</button>
              ) : (
                <button className="btn btn-primary" onClick={handleRestart}>重新开始</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Practice;
