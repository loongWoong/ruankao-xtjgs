import React, { useState, useEffect } from 'react';

function ProgressTracking() {
  // 学习进度数据
  const [progress, setProgress] = useState({
    totalPoints: 0,
    learnedPoints: 0,
    notLearnedPoints: 0,
    progressPercentage: 0,
    dailyProgress: []
  });
  const [knowledgePoints, setKnowledgePoints] = useState([]);

  // 初始化知识点数据
  useEffect(() => {
    // 从后端API加载知识点数据
    fetch('http://localhost:5001/api/knowledge')
      .then(response => response.json())
      .then(data => {
        setKnowledgePoints(data);
      })
      .catch(error => {
        console.error('Error loading knowledge points:', error);
        // 从localStorage加载作为备选
        const savedPoints = localStorage.getItem('knowledgePoints');
        if (savedPoints) {
          setKnowledgePoints(JSON.parse(savedPoints));
        }
      });
  }, []);

  // 加载学习进度
  useEffect(() => {
    // 从后端API加载学习进度数据
    fetch('http://localhost:5001/api/progress')
      .then(response => response.json())
      .then(data => {
        setProgress(data);
      })
      .catch(error => {
        console.error('Error loading progress:', error);
        if (knowledgePoints.length > 0) {
          calculateProgress();
        }
      });
  }, [knowledgePoints]);

  // 计算学习进度
  const calculateProgress = () => {
    const totalPoints = knowledgePoints.length;
    const learnedPoints = knowledgePoints.filter(point => point.status === 'learned').length;
    const notLearnedPoints = totalPoints - learnedPoints;
    const progressPercentage = totalPoints > 0 ? Math.round((learnedPoints / totalPoints) * 100) : 0;

    // 生成每日学习进度数据（模拟最近7天）
    const dailyProgress = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const learned = Math.floor(Math.random() * 3); // 模拟每天学习1-3个知识点
      dailyProgress.push({
        date: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
        learned
      });

      // 保存到后端
      fetch('http://localhost:5001/api/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          date: date.toLocaleDateString('zh-CN'),
          learned_count: learned
        })
      })
      .catch(error => {
        console.error('Error saving progress:', error);
      });
    }

    setProgress({
      totalPoints,
      learnedPoints,
      notLearnedPoints,
      progressPercentage,
      dailyProgress
    });
  };

  return (
    <div className="progress-container">
      <div className="progress-header">
        <h2>学习进度追踪</h2>
      </div>

      <div className="progress-stats">
        <div className="progress-stat">
          <h3>总知识点</h3>
          <p>{progress.totalPoints}</p>
        </div>
        <div className="progress-stat">
          <h3>已学会</h3>
          <p>{progress.learnedPoints}</p>
        </div>
        <div className="progress-stat">
          <h3>未学会</h3>
          <p>{progress.notLearnedPoints}</p>
        </div>
        <div className="progress-stat">
          <h3>完成率</h3>
          <p>{progress.progressPercentage}%</p>
        </div>
      </div>

      <div className="progress-chart">
        <h3>最近7天学习进度</h3>
        <div style={{ height: '300px', display: 'flex', alignItems: 'end', gap: '1rem', padding: '2rem' }}>
          {progress.dailyProgress.map((day, index) => (
            <div key={index} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: '60px',
                  backgroundColor: '#646cff',
                  borderRadius: '4px 4px 0 0',
                  transition: 'height 0.3s ease',
                  height: `${day.learned * 30}px`
                }}
              />
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>{day.date}</p>
              <p style={{ fontSize: '0.8rem', color: '#666' }}>{day.learned}个</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: '2rem', background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)' }}>
        <h3>学习建议</h3>
        <ul style={{ marginTop: '1rem' }}>
          {progress.progressPercentage < 30 && (
            <li>建议增加学习时间，加快知识点的学习进度。</li>
          )}
          {progress.progressPercentage >= 30 && progress.progressPercentage < 70 && (
            <li>学习进度良好，继续保持当前的学习节奏。</li>
          )}
          {progress.progressPercentage >= 70 && (
            <li>学习进度优秀，建议多做练习题巩固知识点。</li>
          )}
          <li>每天至少学习3个知识点，确保一个月内完成所有知识点的学习。</li>
          <li>定期复习已学会的知识点，避免遗忘。</li>
          <li>结合题库练习，检验学习效果。</li>
        </ul>
      </div>
    </div>
  );
}

export default ProgressTracking;