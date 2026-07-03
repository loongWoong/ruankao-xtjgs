import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5002';

function QuestionBank() {
  const [questions, setQuestions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filter, setFilter] = useState({
    category: '',
    is_mastered: '',
    search: ''
  });

  useEffect(() => {
    fetchQuestions();
  }, [page, filter]);

  const getUserId = () => {
    const stored = localStorage.getItem('ruankao_user_id');
    return stored || 'default_user';
  };

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page,
        limit: 50,
        user_id: getUserId(),
        ...filter
      });

      const res = await fetch(`${API_BASE}/api/wrong-questions?${params}`);
      const data = await res.json();

      setQuestions(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(Math.ceil((data.total || 0) / 50));
      setSelectedIds(new Set());
    } catch (error) {
      console.error('获取错题失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === questions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(questions.map(q => q.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 道错题吗？`)) return;

    try {
      await fetch(`${API_BASE}/api/wrong-questions/batch/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      setSelectedIds(new Set());
      if (selectedQuestion && selectedIds.has(selectedQuestion.id)) {
        setSelectedQuestion(null);
      }
      fetchQuestions();
    } catch (error) {
      console.error('批量删除失败:', error);
    }
  };

  const handleBatchMaster = async (mastered = true) => {
    if (selectedIds.size === 0) return;
    try {
      await fetch(`${API_BASE}/api/wrong-questions/batch/master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), is_mastered: mastered ? 1 : 0 })
      });
      setSelectedIds(new Set());
      fetchQuestions();
    } catch (error) {
      console.error('批量标记失败:', error);
    }
  };

  const handleExport = (format) => {
    const userId = getUserId();
    const url = `${API_BASE}/api/wrong-questions/export/${format}?user_id=${encodeURIComponent(userId)}`;
    window.open(url, '_blank');
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('确定要删除这道错题吗？')) return;

    try {
      await fetch(`${API_BASE}/api/wrong-questions/${id}`, {
        method: 'DELETE'
      });
      if (selectedQuestion?.id === id) {
        setSelectedQuestion(null);
      }
      fetchQuestions();
    } catch (error) {
      console.error('删除失败:', error);
    }
  };

  const handleMarkMastered = async (e, q) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/api/wrong-questions/${q.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_mastered: !q.is_mastered })
      });
      fetchQuestions();
      if (selectedQuestion?.id === q.id) {
        setSelectedQuestion({ ...selectedQuestion, is_mastered: !q.is_mastered });
      }
    } catch (error) {
      console.error('标记失败:', error);
    }
  };

  return (
    <div className="page-container">
      <h1 className="page-title">错题库</h1>

      <div className="filters">
        <input
          type="text"
          placeholder="搜索题目/选项/分类..."
          value={filter.search}
          onChange={(e) => {
            setFilter({ ...filter, search: e.target.value });
            setPage(1);
          }}
          className="search-input"
        />

        <select
          value={filter.is_mastered}
          onChange={(e) => {
            setFilter({ ...filter, is_mastered: e.target.value });
            setPage(1);
          }}
          className="filter-select"
        >
          <option value="">全部状态</option>
          <option value="0">未掌握</option>
          <option value="1">已掌握</option>
        </select>

        <div className="filter-actions">
          <button className="btn btn-secondary" onClick={() => handleExport('csv')}>
            📊 导出CSV
          </button>
          <button className="btn btn-secondary" onClick={() => handleExport('json')}>
            📄 导出JSON
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="batch-toolbar">
          <span>已选 {selectedIds.size} 项</span>
          <button className="btn btn-primary" onClick={() => handleBatchMaster(true)}>
            ✓ 标记已掌握
          </button>
          <button className="btn btn-secondary" onClick={() => handleBatchMaster(false)}>
            ✗ 取消掌握
          </button>
          <button className="btn btn-danger" onClick={handleBatchDelete} style={{ color: '#fff', background: '#f44336' }}>
            🗑 删除选中
          </button>
        </div>
      )}

      <div className="split-view">
        <div className="split-view-list">
          {loading ? (
            <div className="empty-state">加载中...</div>
          ) : questions.length > 0 ? (
            <>
              <div className="question-list-header">
                <label className="select-all-label">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === questions.length && questions.length > 0}
                    onChange={toggleSelectAll}
                  />
                  全选
                </label>
              </div>
              <div className="question-list">
                {questions.map((q) => (
                  <div
                    key={q.id}
                    className={`question-item ${q.is_mastered ? 'mastered' : 'not-mastered'} ${selectedQuestion?.id === q.id ? 'active' : ''}`}
                    onClick={() => setSelectedQuestion(q)}
                  >
                    <div className="question-item-header">
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(q.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelect(q.id)}
                          style={{ margin: 0 }}
                        />
                        <span className="question-category">{q.category || '未分类'}</span>
                        <span className={`question-status ${q.is_mastered ? 'mastered' : 'not-mastered'}`}>
                          {q.is_mastered ? '✓ 已掌握' : '✗ 未掌握'}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#999' }}>#{q.id}</span>
                    </div>
                    <div className="question-content">{q.question}</div>
                    <div className="question-answer">
                      <span>正确答案: </span>
                      <span className="answer-correct">{q.correct_answer}</span>
                      <span style={{ marginLeft: '0.75rem' }}>你的答案: </span>
                      <span className={q.user_answer === q.correct_answer ? 'answer-correct' : 'answer-wrong'}>
                        {q.user_answer}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pagination">
                <button onClick={() => setPage(1)} disabled={page === 1}>首页</button>
                <button onClick={() => setPage(page - 1)} disabled={page === 1}>上一页</button>
                <span style={{ padding: '0.5rem' }}>
                  第 {page} / {totalPages} 页 (共 {total} 题)
                </span>
                <button onClick={() => setPage(page + 1)} disabled={page >= totalPages}>下一页</button>
                <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}>末页</button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📚</div>
              <p>暂无错题</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                使用浏览器插件采集错题后，这里将显示您的错题列表
              </p>
            </div>
          )}
        </div>

        <div className="split-view-detail">
          {selectedQuestion ? (
            <>
              <div className="detail-header">
                <span className="detail-title">题目详情</span>
                <span className={`question-status ${selectedQuestion.is_mastered ? 'mastered' : 'not-mastered'}`}>
                  {selectedQuestion.is_mastered ? '已掌握' : '未掌握'}
                </span>
              </div>

              <div className="detail-section">
                <h4>题目</h4>
                <p>{selectedQuestion.question}</p>
              </div>

              <div className="detail-section">
                <h4>选项</h4>
                <div className="detail-options">
                  {selectedQuestion.options && selectedQuestion.options.map((opt, i) => (
                    <div
                      key={i}
                      className={`detail-option ${
                        opt.startsWith(selectedQuestion.correct_answer) ? 'correct' :
                        opt === selectedQuestion.user_answer ? 'wrong' : ''
                      }`}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              </div>

              <div className="detail-section">
                <h4>答案</h4>
                <p>
                  <span style={{ fontWeight: 600 }}>正确答案: </span>
                  <span className="answer-correct">{selectedQuestion.correct_answer}</span>
                </p>
                <p style={{ marginTop: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>你的答案: </span>
                  <span className={selectedQuestion.user_answer === selectedQuestion.correct_answer ? 'answer-correct' : 'answer-wrong'}>
                    {selectedQuestion.user_answer}
                  </span>
                </p>
              </div>

              {selectedQuestion.analysis && (
                <div className="detail-section">
                  <h4>解析</h4>
                  <p>{selectedQuestion.analysis}</p>
                </div>
              )}

              <div className="detail-section">
                <h4>统计</h4>
                <div className="detail-stats">
                  <div className="detail-stat">
                    <div className="detail-stat-value">{selectedQuestion.review_count}</div>
                    <div className="detail-stat-label">复习次数</div>
                  </div>
                  <div className="detail-stat">
                    <div className="detail-stat-value" style={{ color: '#4caf50' }}>{selectedQuestion.correct_count}</div>
                    <div className="detail-stat-label">正确次数</div>
                  </div>
                  <div className="detail-stat">
                    <div className="detail-stat-value" style={{ color: '#f44336' }}>{selectedQuestion.wrong_count}</div>
                    <div className="detail-stat-label">错误次数</div>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h4>分类</h4>
                <p>{selectedQuestion.category || '未分类'}</p>
              </div>

              <div className="detail-actions">
                <button
                  className="btn btn-primary"
                  onClick={(e) => handleMarkMastered(e, selectedQuestion)}
                >
                  {selectedQuestion.is_mastered ? '取消掌握' : '标记掌握'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={(e) => handleDelete(e, selectedQuestion.id)}
                  style={{ color: '#f44336' }}
                >
                  删除
                </button>
              </div>
            </>
          ) : (
            <div className="no-selection">
              <div className="no-selection-icon">👈</div>
              <p>请从左侧列表选择一道题目</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>点击题目可以查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuestionBank;