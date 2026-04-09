import React, { useState, useEffect } from 'react';

function PracticeQuestions() {
  // 题库数据
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState(0);

  // 初始化题库数据
  useEffect(() => {
    // 从后端API加载题库数据
    fetch('http://localhost:5001/api/questions')
      .then(response => response.json())
      .then(data => {
        if (data.length > 0) {
          setQuestions(data);
        } else {
          // 初始化默认题库数据
          const initialQuestions = [
            {
              id: 1,
              question: '在OSI七层模型中，负责端到端通信的是哪一层？',
              options: [
                '物理层',
                '数据链路层',
                '网络层',
                '传输层'
              ],
              answer: '传输层',
              category: '计算机基础'
            },
            {
              id: 2,
              question: '以下哪种设计模式属于创建型模式？',
              options: [
                '单例模式',
                '适配器模式',
                '观察者模式',
                '策略模式'
              ],
              answer: '单例模式',
              category: '软件设计'
            },
            {
              id: 3,
              question: '分布式系统中，CAP理论指的是什么？',
              options: [
                '一致性、可用性、分区容错性',
                '一致性、原子性、持久性',
                '可用性、可靠性、可扩展性',
                '一致性、可用性、可靠性'
              ],
              answer: '一致性、可用性、分区容错性',
              category: '系统架构'
            },
            {
              id: 4,
              question: '数据库设计中，第三范式的主要目的是什么？',
              options: [
                '减少数据冗余',
                '提高查询性能',
                '增强数据安全性',
                '简化数据库结构'
              ],
              answer: '减少数据冗余',
              category: '计算机基础'
            },
            {
              id: 5,
              question: '软件生命周期中，需求分析阶段的主要输出是什么？',
              options: [
                '需求规格说明书',
                '设计文档',
                '测试计划',
                '用户手册'
              ],
              answer: '需求规格说明书',
              category: '管理'
            }
          ];
          setQuestions(initialQuestions);
          // 保存到后端
          initialQuestions.forEach(question => {
            fetch('http://localhost:5001/api/questions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(question)
            });
          });
        }
      })
      .catch(error => {
        console.error('Error loading questions:', error);
        // 从localStorage加载作为备选
        const savedQuestions = localStorage.getItem('questions');
        if (savedQuestions) {
          setQuestions(JSON.parse(savedQuestions));
        }
      });
  }, []);

  // 处理用户答题
  const handleAnswerChange = (questionId, answer) => {
    setUserAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  // 提交答案并计算分数
  const submitAnswers = () => {
    let calculatedScore = 0;
    questions.forEach(question => {
      if (userAnswers[question.id] === question.answer) {
        calculatedScore++;
      } else {
        // 保存错题记录到后端
        fetch('http://localhost:5002/api/wrong-questions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            question_id: question.id,
            question: question.question,
            user_answer: userAnswers[question.id] || '未作答',
            correct_answer: question.answer,
            category: question.category
          })
        })
        .catch(error => {
          console.error('Error saving wrong question:', error);
        });
      }
    });
    setScore(calculatedScore);
    setShowResults(true);
  };

  // 重置答题
  const resetAnswers = () => {
    setUserAnswers({});
    setShowResults(false);
    setCurrentQuestionIndex(0);
    setScore(0);
  };

  // 切换到下一题
  const nextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  // 切换到上一题
  const prevQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  if (questions.length === 0) {
    return <div>加载中...</div>;
  }

  const currentQuestion = questions[currentQuestionIndex];

  return (
    <div className="practice-container">
      <div className="practice-header">
        <h2>题库练习</h2>
        {!showResults && (
          <button
            onClick={submitAnswers}
            style={{ padding: '0.5rem 1rem', borderRadius: '4px', background: '#646cff', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            提交答案
          </button>
        )}
        {showResults && (
          <button
            onClick={resetAnswers}
            style={{ padding: '0.5rem 1rem', borderRadius: '4px', background: '#646cff', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            重新答题
          </button>
        )}
      </div>

      {!showResults ? (
        <div className="question-card">
          <h3>第 {currentQuestionIndex + 1} 题 / 共 {questions.length} 题</h3>
          <p>{currentQuestion.question}</p>
          <ul className="question-options">
            {currentQuestion.options.map((option, index) => (
              <li key={index} className="question-option">
                <input
                  type="radio"
                  id={`option-${currentQuestion.id}-${index}`}
                  name={`question-${currentQuestion.id}`}
                  value={option}
                  checked={userAnswers[currentQuestion.id] === option}
                  onChange={() => handleAnswerChange(currentQuestion.id, option)}
                />
                <label htmlFor={`option-${currentQuestion.id}-${index}`}>{option}</label>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
            <button
              onClick={prevQuestion}
              disabled={currentQuestionIndex === 0}
              style={{ padding: '0.5rem 1rem', borderRadius: '4px', background: '#f0f0f0', border: '1px solid #ddd', cursor: 'pointer' }}
            >
              上一题
            </button>
            <button
              onClick={nextQuestion}
              disabled={currentQuestionIndex === questions.length - 1}
              style={{ padding: '0.5rem 1rem', borderRadius: '4px', background: '#f0f0f0', border: '1px solid #ddd', cursor: 'pointer' }}
            >
              下一题
            </button>
          </div>
        </div>
      ) : (
        <div className="question-card">
          <h3>答题结果</h3>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#646cff' }}>
            得分: {score} / {questions.length}
          </p>
          <div style={{ marginTop: '2rem' }}>
            <h4>详细解析</h4>
            {questions.map(question => (
              <div key={question.id} style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '4px' }}>
                <p><strong>题目:</strong> {question.question}</p>
                <p><strong>你的答案:</strong> {userAnswers[question.id] || '未作答'}</p>
                <p><strong>正确答案:</strong> {question.answer}</p>
                <p style={{ color: userAnswers[question.id] === question.answer ? '#4caf50' : '#f44336' }}>
                  {userAnswers[question.id] === question.answer ? '回答正确' : '回答错误'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PracticeQuestions;