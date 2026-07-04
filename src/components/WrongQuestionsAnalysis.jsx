import React, { useState, useEffect } from 'react';
import { getWrongQuestionsAnalysis, getWrongQuestions } from '../utils/api';
import LoadingSpinner from './LoadingSpinner';

function WrongQuestionsAnalysis() {
  const [analysisData, setAnalysisData] = useState({
    total_wrong: 0,
    category_stats: [],
    daily_stats: []
  });
  const [wrongQuestions, setWrongQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [analysis, questionsData] = await Promise.all([
          getWrongQuestionsAnalysis(),
          getWrongQuestions({ limit: 50 })
        ]);
        if (cancelled) return;
        setAnalysisData(analysis);
        setWrongQuestions(questionsData.items || []);
      } catch (e) {
        if (!cancelled) setError(e.message || '加载分析数据失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="page-container">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2 className="page-title">认知缺口分析</h2>
      <p className="page-subtitle">基于错题分类聚合，识别最薄弱的知识领域</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">总错题数</div>
          <div className="stat-card-value" style={{ color: '#f44336' }}>{analysisData.total_wrong}</div>
          <div className="stat-card-sub">道</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">涉及分类</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>{analysisData.category_stats.length}</div>
          <div className="stat-card-sub">个</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">近30天新增</div>
          <div className="stat-card-value" style={{ color: '#f59e0b' }}>
            {(analysisData.daily_stats || []).reduce((s, x) => s + (x.count || 0), 0)}
          </div>
          <div className="stat-card-sub">道</div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title"><span>🎯</span>认知重点分析（按分类）</h3>
        {analysisData.category_stats.length > 0 ? (
          analysisData.category_stats.map((item, index) => (
            <div key={index} style={{ padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ fontWeight: 600, color: '#333' }}>{item.category}</span>
                <span style={{ color: '#888', fontSize: '0.85rem' }}>{item.count} 题 · 占比 {item.percentage}%</span>
              </div>
              <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                <div style={{ width: `${item.percentage}%`, background: '#f44336', height: '100%' }} />
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div>暂无错题分类数据，先去做些练习吧</div>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 className="section-title"><span>📚</span>错题详情（证据链）</h3>
        {wrongQuestions.length > 0 ? (
          wrongQuestions.map((question, index) => (
            <div key={index} style={{ padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.8rem' }}>
                <span style={{ background: '#eef1ff', color: '#667eea', padding: '2px 8px', borderRadius: '4px' }}>
                  {question.category || '未分类'}
                </span>
                <span style={{ color: '#888' }}>{question.created_at && new Date(question.created_at).toLocaleString()}</span>
              </div>
              <p style={{ lineHeight: 1.5, color: '#333', margin: '0.5rem 0' }}>{question.question}</p>
              <div style={{ fontSize: '0.85rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span>你的答案：<span style={{ color: '#f44336' }}>{question.user_answer}</span></span>
                <span>正确答案：<span style={{ color: '#4caf50' }}>{question.correct_answer}</span></span>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">✨</div>
            <div>暂无错题记录</div>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 className="section-title"><span>💡</span>认知升级建议</h3>
        <ul style={{ lineHeight: 1.8, color: '#555', paddingLeft: '1.5rem' }}>
          <li>🔥 <b>优先攻克：</b>建议点击 Dashboard 的"击破薄弱点"进行针对性强化</li>
          <li>🛠 <b>反思模式：</b>在练习时，请务必在"错误反思"中标记具体原因，以便系统精准调整权重</li>
          <li>📈 <b>稳定性提升：</b>当知识点颜色由红转绿时，说明该认知点已进入长期记忆</li>
        </ul>
      </div>
    </div>
  );
}

export default WrongQuestionsAnalysis;
