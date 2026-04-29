import React, { useState, useEffect } from 'react';

function WrongQuestionsAnalysis() {
  const [analysisData, setAnalysisData] = useState({
    total_wrong: 0,
    category_stats: [],
    daily_stats: []
  });
  const [wrongQuestions, setWrongQuestions] = useState([]);

  useEffect(() => {
    fetch('http://localhost:5002/api/wrong-questions/analysis')
      .then(response => response.json())
      .then(data => setAnalysisData(data))
      .catch(error => console.error('Error loading analysis data:', error));

    fetch('http://localhost:5002/api/wrong-questions')
      .then(response => response.json())
      .then(data => setWrongQuestions(data.items || []))
      .catch(error => console.error('Error loading wrong questions:', error));
  }, []);

  return (
    <div className=\"wrong-questions-container\">\n      <div className=\"wrong-questions-header\">\n        <h2 style={{ color: '#333' }}>认知缺口分析</h2>\n      </div>\n\n      <div className=\"wrong-questions-stats\">\n        <div className=\"wrong-question-stat\">\n          <h3>总错题数</h3>\n          <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f44336' }}>{analysisData.total_wrong}</p>\n        </div>\n      </div>\n\n      <div className=\"analysis-section\">\n        <h3 style={{ borderLeft: '4px solid #f44336', paddingLeft: '0.5rem' }}>认知重点分析 (按分类)</h3>\n        <div className=\"category-analysis\">\n          {analysisData.category_stats.length > 0 ? (\n            analysisData.category_stats.map((item, index) => (\n              <div key={index} className=\"category-item\">\n                <div className=\"category-info\">\n                  <span className=\"category-name\">{item.category}</span>\n                  <span className=\"category-count\">{item.count}题</span>\n                  <span className=\"category-percentage\">认知缺口: {item.percentage}%</span>\n                </div>\n                <div className=\"category-progress\">\n                  <div className=\"category-progress-bar\" style={{ width: `${item.percentage}%`, backgroundColor: '#f44336' }} />\n                </div>\n              </div>\n            ))\n          ) : (\n            <p>正在通过学习激活认知数据...</p>\n          )}\n        </div>\n      </div>\n\n      <div className=\"analysis-section\">\n        <h3 style={{ borderLeft: '4px solid #f44336', paddingLeft: '0.5rem' }}>错题详情 (证据链)</h3>\n        <div className=\"wrong-questions-list\">\n          {wrongQuestions.length > 0 ? (\n            wrongQuestions.map((question, index) => (\n              <div key={index} className=\"wrong-question-item\">\n                <div className=\"wrong-question-header\">\n                  <span className=\"wrong-question-category\">{question.category}</span>\n                  <span className=\"wrong-question-date\">{new Date(question.created_at).toLocaleString()}</span>\n                </div>\n                <p className=\"wrong-question-content\">{question.question}</p>\n                <div className=\"wrong-question-answers\">\n                  <p><strong>你的认知结果:</strong> <span style={{ color: '#f44336' }}>{question.user_answer}</span></p>\n                  <p><strong>正确认知结果:</strong> <span style={{ color: '#4caf50' }}>{question.correct_answer}</span></p>\n                </div>\n              </div>\n            ))\n          ) : (\n            <p>暂无认知缺陷记录</p>\n          )}\n        </div>\n      </div>\n\n      <div className=\"analysis-section\">\n        <h3 style={{ borderLeft: '4px solid #4caf50', paddingLeft: '0.5rem' }}>认知升级建议</h3>\n        <div className=\"learning-suggestions\">\n          <ul style={{ lineHeight: '1.6' }}>\n            <li>🔥 <b>优先攻克：</b> 建议点击 Dashboard 的“击破薄弱点”进行针对性强化</li>\n            <li>🛠 <b>反思模式：</b> 在练习时，请务必在“错误反思”中标记具体原因，以便系统精准调整权重</li>\n            <li>📈 <b>稳定性提升：</b> 当知识点颜色由红转绿时，说明该认知点已进入长期记忆</li>\n          </ul>\n        </div>\n      </div>\n    </div>\n  );\n}\n\nexport default WrongQuestionsAnalysis;
