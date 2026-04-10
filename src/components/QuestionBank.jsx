import React, { useState, useEffect } from 'react';

function QuestionBank() {
  const [questions, setQuestions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [filter, setFilter] = useState({
    category: '',
    is_mastered: '',
    search: ''
  });
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [noteContent, setNoteContent] = useState('');

  useEffect(() => {
    fetchQuestions();
  }, [page, filter]);

  useEffect(() => {
    if (selectedQuestion) {
      loadNote(selectedQuestion.id);
    }
  }, [selectedQuestion]);

  const loadNote = (questionId) => {
    fetch(`http://localhost:5002/api/notes/${questionId}`)
      .then(res => res.json())
      .then(data => {
        setNote(data.content || '');
      })
      .catch(err => console.error('Error loading note:', err));
  };

  const saveNote = () => {
    if (!selectedQuestion) return;
    fetch('http://localhost:5002/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: selectedQuestion.id, content: noteContent })
    })
      .then(res => res.json())
      .then(() => {
        setNote(noteContent);
        setEditingNote(false);
      })
      .catch(err => console.error('Error saving note:', err));
  };

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page,
        limit: 50,
        ...filter
      });

      const res = await fetch(`http://localhost:5002/api/wrong-questions?${params}`);
      const data = await res.json();

      setQuestions(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(Math.ceil((data.total || 0) / 50));
    } catch (error) {
      console.error('获取错题失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('确定要删除这道错题吗？')) return;

    try {
      await fetch(`http://localhost:5002/api/wrong-questions/${id}`, {
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
      await fetch(`http://localhost:5002/api/wrong-questions/${q.id}`, {
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
          placeholder="搜索题目..."
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
      </div>

      <div className="split-view">
        <div className="split-view-list">
          {loading ? (
            <div className="empty-state">加载中...</div>
          ) : questions.length > 0 ? (
            <>
              <div className="question-list">
                {questions.map((q) => (
                  <div
                    key={q.id}
                    className={`question-item ${q.is_mastered ? 'mastered' : 'not-mastered'} ${selectedQuestion?.id === q.id ? 'active' : ''}`}
                    onClick={() => setSelectedQuestion(q)}
                  >
                    <div className="question-item-header">
                      <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4>笔记</h4>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setNoteContent(note);
                      setEditingNote(!editingNote);
                    }}
                  >
                    {editingNote ? '取消' : (note ? '编辑笔记' : '添加笔记')}
                  </button>
                </div>
                {editingNote ? (
                  <div style={{ marginTop: '0.5rem' }}>
                    <textarea
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="写下你的笔记..."
                      rows={4}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={saveNote}
                      style={{ marginTop: '0.5rem' }}
                    >
                      保存
                    </button>
                  </div>
                ) : (
                  note && <p style={{ marginTop: '0.5rem', color: '#666' }}>{note}</p>
                )}
              </div>

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