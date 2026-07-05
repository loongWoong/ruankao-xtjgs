import React, { useState, useEffect, useRef } from 'react';
import {
  getWrongQuestions,
  deleteWrongQuestion,
  updateWrongQuestion,
  batchDelete,
  batchMaster,
  getExportUrl,
  autoClassifyWrongQuestions
} from '../utils/api';
import LoadingSpinner from './LoadingSpinner';

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
  // 搜索防抖：filter.search 立即更新输入框，debouncedSearch 300ms 后才触发请求
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef(null);
  const [toast, setToast] = useState(null);
  const [classifying, setClassifying] = useState(false);

  const handleAutoClassify = async (questionIds = []) => {
    setClassifying(true);
    try {
      const result = await autoClassifyWrongQuestions(questionIds);
      const msg = questionIds.length > 0
        ? `已补全 ${questionIds.length} 题：${result.updated} 个分类更新，${result.mappings_created} 个知识点关联`
        : `扫描 ${result.total} 道未分类错题：${result.updated} 个分类补全，${result.mappings_created} 个知识点关联建立`;
      showToast(msg, 'success');
      fetchQuestions();
    } catch (e) {
      showToast('自动分类失败: ' + e.message, 'error');
    } finally {
      setClassifying(false);
    }
  };

  // 输入时清掉旧 timer，300ms 后才把 search 同步到 debouncedSearch
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(filter.search);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [filter.search]);

  useEffect(() => {
    fetchQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filter.category, filter.is_mastered, debouncedSearch]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const params = {
        page: page,
        limit: 50,
        category: filter.category,
        is_mastered: filter.is_mastered,
        search: debouncedSearch
      };

      const data = await getWrongQuestions(params);

      setQuestions(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(Math.ceil((data.total || 0) / 50));
      setSelectedIds(new Set());
    } catch (error) {
      console.error('获取错题失败:', error);
      showToast('获取错题失败: ' + error.message, 'error');
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
      await batchDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
      if (selectedQuestion && selectedIds.has(selectedQuestion.id)) {
        setSelectedQuestion(null);
      }
      fetchQuestions();
      showToast('批量删除成功');
    } catch (error) {
      console.error('批量删除失败:', error);
      showToast('批量删除失败: ' + error.message, 'error');
    }
  };

  const handleBatchMaster = async (mastered = true) => {
    if (selectedIds.size === 0) return;
    try {
      await batchMaster(Array.from(selectedIds), mastered);
      setSelectedIds(new Set());
      fetchQuestions();
      showToast(mastered ? '批量标记已掌握成功' : '批量取消掌握成功');
    } catch (error) {
      console.error('批量标记失败:', error);
      showToast('批量标记失败: ' + error.message, 'error');
    }
  };

  const handleExport = (format) => {
    const url = getExportUrl(format);
    window.open(url, '_blank');
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('确定要删除这道错题吗？')) return;

    try {
      await deleteWrongQuestion(id);
      if (selectedQuestion?.id === id) {
        setSelectedQuestion(null);
      }
      fetchQuestions();
      showToast('删除成功');
    } catch (error) {
      console.error('删除失败:', error);
      showToast('删除失败: ' + error.message, 'error');
    }
  };

  const handleMarkMastered = async (e, q) => {
    e.stopPropagation();
    try {
      await updateWrongQuestion(q.id, { is_mastered: !q.is_mastered });
      fetchQuestions();
      if (selectedQuestion?.id === q.id) {
        setSelectedQuestion({ ...selectedQuestion, is_mastered: !q.is_mastered });
      }
      showToast(!q.is_mastered ? '标记掌握成功' : '取消掌握成功');
    } catch (error) {
      console.error('标记失败:', error);
      showToast('标记失败: ' + error.message, 'error');
    }
  };

  return (
    <div className="page-container">
      {toast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '12px 24px',
          borderRadius: '8px',
          color: '#fff',
          backgroundColor: toast.type === 'error' ? '#f44336' : '#4caf50',
          zIndex: 1000,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
        }}>
          {toast.message}
        </div>
      )}
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
          <button
            className="btn btn-secondary"
            onClick={() => handleAutoClassify([])}
            disabled={classifying}
            title="扫描所有未分类错题，自动匹配知识点并补全分类/章节"
          >
            {classifying ? '⏳ 分类中...' : '🤖 一键补全分类'}
          </button>
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
          <button
            className="btn btn-secondary"
            onClick={() => handleAutoClassify(Array.from(selectedIds))}
            disabled={classifying}
          >
            🤖 补全选中分类
          </button>
          <button className="btn btn-danger" onClick={handleBatchDelete} style={{ color: '#fff', background: '#f44336' }}>
            🗑 删除选中
          </button>
        </div>
      )}

      <div className="split-view">
        <div className="split-view-list">
          {loading ? (
            <div className="empty-state"><LoadingSpinner /></div>
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
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(q.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelect(q.id)}
                          style={{ margin: 0 }}
                        />
                        <span className="question-category" style={!q.category ? { color: '#999', fontStyle: 'italic' } : {}}>
                          {q.category || '未分类'}
                        </span>
                        {q.chapter && (
                          <span style={{ fontSize: '0.7rem', color: '#666', background: '#f0f0f0', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                            {q.chapter}
                          </span>
                        )}
                        <span className={`question-status ${q.is_mastered ? 'mastered' : 'not-mastered'}`}>
                          {q.is_mastered ? '✓ 已掌握' : '✗ 未掌握'}
                        </span>
                        {q.srs_stage > 0 && (
                          <span style={{ fontSize: '0.7rem', color: '#fff', background: '#2196f3', padding: '0.1rem 0.4rem', borderRadius: '4px' }} title="SRS 复习阶段">
                            SRS·{q.srs_stage}
                          </span>
                        )}
                        {q.wrong_count > 1 && (
                          <span style={{ fontSize: '0.7rem', color: '#f44336', background: '#fee2e2', padding: '0.1rem 0.4rem', borderRadius: '4px' }} title="累计错误次数">
                            ❌ {q.wrong_count}
                          </span>
                        )}
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
                  {selectedQuestion.options && selectedQuestion.options.map((opt, i) => {
                    // 提取选项前缀字母（如 "A.xxx" → "A"，"B、xxx" → "B"）与正确答案比对
                    const optPrefix = (opt.match(/^([A-Za-z])/) || [])[1] || '';
                    const correctLetters = (selectedQuestion.correct_answer || '').toUpperCase().split('');
                    const isCorrect = optPrefix && correctLetters.includes(optPrefix.toUpperCase());
                    const userLetters = (selectedQuestion.user_answer || '').toUpperCase().split('');
                    const isUserChoice = optPrefix && userLetters.includes(optPrefix.toUpperCase());
                    return (
                      <div
                        key={i}
                        className={`detail-option ${
                          isCorrect ? 'correct' :
                          isUserChoice ? 'wrong' : ''
                        }`}
                      >
                        {opt}
                      </div>
                    );
                  })}
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
                <h4>分类与章节</h4>
                <p>
                  <span style={{ fontWeight: 600 }}>分类：</span>
                  {selectedQuestion.category || <span style={{ color: '#999', fontStyle: 'italic' }}>未分类</span>}
                </p>
                <p style={{ marginTop: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>章节：</span>
                  {selectedQuestion.chapter || <span style={{ color: '#999', fontStyle: 'italic' }}>未指定</span>}
                </p>
                {(!selectedQuestion.category || !selectedQuestion.chapter) && (
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: '0.5rem', padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                    onClick={(e) => { e.stopPropagation(); handleAutoClassify([selectedQuestion.id]); }}
                    disabled={classifying}
                  >
                    🤖 自动补全此题分类
                  </button>
                )}
              </div>

              {selectedQuestion.next_review_time && (
                <div className="detail-section">
                  <h4>复习计划</h4>
                  <p>
                    <span style={{ fontWeight: 600 }}>SRS 阶段：</span>
                    第 {selectedQuestion.srs_stage || 0} 阶段
                  </p>
                  <p style={{ marginTop: '0.25rem' }}>
                    <span style={{ fontWeight: 600 }}>下次复习：</span>
                    {selectedQuestion.next_review_time}
                  </p>
                  {selectedQuestion.last_review_time && (
                    <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: '#888' }}>
                      上次复习：{selectedQuestion.last_review_time}
                    </p>
                  )}
                </div>
              )}

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