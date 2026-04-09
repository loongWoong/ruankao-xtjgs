import React, { useState, useEffect } from 'react';

function Practice() {
  const [mode, setMode] = useState('today');
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [practiceResult, setPracticeResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ correct: 0, wrong: 0 });

  useEffect(() => {
    loadQuestions();
  }, [mode]);

  const loadQuestions = async () => {
    setLoading(true);
    try {
      let url = mode === 'today'
        ? 'http://localhost:5002/api/practice/today?limit=10'
        : 'http://localhost:5002/api/practice/random?limit=10';

      const res = await fetch(url);
      const data = await res.json();

      setQuestions(data.questions || []);
      setCurrentIndex(0);
      setSelectedAnswer(null);
      setShowResult(false);
      setPracticeResult(null);
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
          time_spent: 0
        })
      });

      const result = await res.json();
      setPracticeResult(result);
      setShowResult(true);
      setStats(prev => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1)
      }));
    } catch (error) {
      console.error('提交失败:', error);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
      setPracticeResult(null);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setSelectedAnswer(null);
      setShowResult(false);
      setPracticeResult(null);
    }
  };

  if (loading) {
    return <div className="empty-state">加载中...</div>;
  }

  if (questions.length === 0) {
    return (
      <div className="practice">
        <h1 className="page-title">练习</h1>

        <div className="practice-modes">
          <button
            className={`mode-btn ${mode === 'today' ? 'active' : ''}`}
            onClick={() => setMode('today')}
          >
            今日待练
          </button>
          <button
            className={`mode-btn ${mode === 'random' ? 'active' : ''}`}
            onClick={() => setMode('random')}
          >
            随机练习
          </button>
        </div>

        <div className="empty-state">
          <div className="empty-state-icon">✍️</div>
          <p>暂无待练习题目</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            {mode === 'today'
              ? '今天的练习任务已完成，或请先采集错题'
              : '请先采集错题后再进行练习'}
          </p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={loadQuestions}>
            刷新
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];

  return (
    <div className="practice">
      <h1 className="page-title">练习</h1>

      <div className="practice-modes">
        <button
          className={`mode-btn ${mode === 'today' ? 'active' : ''}`}
          onClick={() => { setMode('today'); loadQuestions(); }}
        >
          今日待练
        </button>
        <button
          className={`mode-btn ${mode === 'random' ? 'active' : ''}`}
          onClick={() => { setMode('random'); loadQuestions(); }}
        >
          随机练习
        </button>
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
              if (opt.startsWith(currentQuestion.correct_answer)) {
                className += ' correct';
              } else if (opt === selectedAnswer) {
                className += ' wrong';
              }
            } else if (opt === selectedAnswer) {
              className += ' selected';
            }

            return (
              <div
                key={index}
                className={className}
                onClick={() => handleSelectAnswer(opt)}
              >
                <span className="practice-option-label">{opt.charAt(0)}</span>
                <span className="practice-option-content">{opt.substring(3)}</span>
              </div>
            );
          })}
        </div>

        {showResult && practiceResult && (
          <div className={`practice-result ${practiceResult.is_correct ? 'correct' : 'wrong'}`}>
            <p style={{ fontWeight: 'bold', fontSize: '1.125rem' }}>
              {practiceResult.is_correct ? '回答正确！' : '回答错误'}
            </p>
            {practiceResult.is_mastered && (
              <p style={{ color: '#4caf50', marginTop: '0.5rem' }}>
                恭喜！这道题已标记为掌握
              </p>
            )}
            {!practiceResult.is_correct && (
              <p style={{ marginTop: '0.5rem' }}>
                下次复习时间：{practiceResult.next_review_interval} 天后
              </p>
            )}
          </div>
        )}

        {showResult && currentQuestion.analysis && (
          <div className="practice-analysis">
            <h4>解析</h4>
            <p>{currentQuestion.analysis}</p>
          </div>
        )}

        <div className="practice-actions">
          {!showResult ? (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!selectedAnswer}
            >
              提交答案
            </button>
          ) : (
            <div className="practice-nav">
              <button
                className="btn btn-secondary"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                上一题
              </button>
              {currentIndex < questions.length - 1 ? (
                <button className="btn btn-primary" onClick={handleNext}>
                  下一题
                </button>
              ) : (
                <button className="btn btn-primary" onClick={loadQuestions}>
                  重新开始
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Practice;