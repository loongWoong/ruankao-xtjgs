import React, { useState, useEffect } from 'react';

function WrongQuestionsAnalysis() {
  const [analysisData, setAnalysisData] = useState({
    total_wrong: 0,
    category_stats: [],
    daily_stats: []
  });
  const [wrongQuestions, setWrongQuestions] = useState([]);

  // 加载错题分析数据
  useEffect(() => {
    fetch('http://localhost:5002/api/wrong-questions/analysis')
      .then(response => response.json())
      .then(data => {
        setAnalysisData(data);
      })
      .catch(error => {
        console.error('Error loading analysis data:', error);
      });

    // 加载错题列表
    fetch('http://localhost:5002/api/wrong-questions')
      .then(response => response.json())
      .then(data => {
        setWrongQuestions(data);
      })
      .catch(error => {
        console.error('Error loading wrong questions:', error);
      });
  }, []);

  return (
    <div className="wrong-questions-container">
      <div className="wrong-questions-header">
        <h2>错题统计与分析</h2>
      </div>

      <div className="wrong-questions-stats">
        <div className="wrong-question-stat">
          <h3>总错题数</h3>
          <p>{analysisData.total_wrong}</p>
        </div>
      </div>

      <div className="analysis-section">
        <h3>按分类分析</h3>
        <div className="category-analysis">
          {analysisData.category_stats.length > 0 ? (
            analysisData.category_stats.map((item, index) => (
              <div key={index} className="category-item">
                <div className="category-info">
                  <span className="category-name">{item.category}</span>
                  <span className="category-count">{item.count}题</span>
                  <span className="category-percentage">{item.percentage}%</span>
                </div>
                <div className="category-progress">
                  <div 
                    className="category-progress-bar" 
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p>暂无错题数据</p>
          )}
        </div>
      </div>

      <div className="analysis-section">
        <h3>最近7天错题趋势</h3>
        <div className="daily-analysis">
          {analysisData.daily_stats.length > 0 ? (
            <div style={{ height: '300px', display: 'flex', alignItems: 'end', gap: '1rem', padding: '2rem' }}>
              {analysisData.daily_stats.map((day, index) => (
                <div key={index} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: '60px',
                      backgroundColor: '#f44336',
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 0.3s ease',
                      height: `${day.count * 30}px`
                    }}
                  />
                  <p style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>{day.date}</p>
                  <p style={{ fontSize: '0.8rem', color: '#666' }}>{day.count}题</p>
                </div>
              ))}
            </div>
          ) : (
            <p>暂无最近7天的错题数据</p>
          )}
        </div>
      </div>

      <div className="analysis-section">
        <h3>错题详情</h3>
        <div className="wrong-questions-list">
          {wrongQuestions.length > 0 ? (
            wrongQuestions.map((question, index) => (
              <div key={index} className="wrong-question-item">
                <div className="wrong-question-header">
                  <span className="wrong-question-category">{question.category}</span>
                  <span className="wrong-question-date">{new Date(question.timestamp).toLocaleString()}</span>
                </div>
                <p className="wrong-question-content">{question.question}</p>
                <div className="wrong-question-answers">
                  <p><strong>你的答案:</strong> <span style={{ color: '#f44336' }}>{question.user_answer}</span></p>
                  <p><strong>正确答案:</strong> <span style={{ color: '#4caf50' }}>{question.correct_answer}</span></p>
                </div>
              </div>
            ))
          ) : (
            <p>暂无错题记录</p>
          )}
        </div>
      </div>

      <div className="analysis-section">
        <h3>学习建议</h3>
        <div className="learning-suggestions">
          {analysisData.total_wrong > 0 ? (
            <ul>
              {analysisData.category_stats.length > 0 && (
                <li>重点关注错题最多的类别：{analysisData.category_stats[0].category}（{analysisData.category_stats[0].count}题）</li>
              )}
              <li>建议定期回顾错题，加深对知识点的理解</li>
              <li>针对错题类别进行专项练习，提高薄弱环节</li>
              <li>建立错题本，记录错误原因和解题思路</li>
              <li>定期检测学习效果，验证错题是否已经掌握</li>
            </ul>
          ) : (
            <p>恭喜你！暂无错题记录，继续保持良好的学习状态。</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default WrongQuestionsAnalysis;