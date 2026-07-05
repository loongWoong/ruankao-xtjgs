import React, { useState, useEffect } from 'react';
import {
  getCustomQuestions,
  createCustomQuestion,
  updateCustomQuestion,
  deleteCustomQuestion,
  importCustomQuestions
} from '../utils/api';

const PAGE_SIZE = 10;

function CustomQuestions() {
  const [view, setView] = useState('list');
  const [questions, setQuestions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const [formData, setFormData] = useState({
    question_text: '',
    question_type: 'single_choice',
    options: { A: '', B: '', C: '', D: '' },
    correct_answer: 'A',
    explanation: '',
    category: ''
  });

  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadQuestions(1);
  }, []);

  const loadQuestions = async (p = 1, cat = filterCategory) => {
    setLoading(true);
    setError(null);
    try {
      const params = { page: p, limit: PAGE_SIZE };
      if (cat) params.category = cat;
      const data = await getCustomQuestions(params);
      setQuestions(data.items || []);
      setTotal(data.total || 0);
      setPage(p);
      setCategories(data.categories || []);
    } catch (e) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      question_text: '',
      question_type: 'single_choice',
      options: { A: '', B: '', C: '', D: '' },
      correct_answer: 'A',
      explanation: '',
      category: ''
    });
    setEditingId(null);
  };

  const handleEdit = (q) => {
    let opts = q.options;
    if (typeof opts === 'string') {
      try { opts = JSON.parse(opts); } catch { opts = { A: '', B: '', C: '', D: '' }; }
    }
    setFormData({
      question_text: q.question_text || '',
      question_type: q.question_type || 'single_choice',
      options: opts || { A: '', B: '', C: '', D: '' },
      correct_answer: q.correct_answer || '',
      explanation: q.explanation || '',
      category: q.category || ''
    });
    setEditingId(q.id);
    setView('form');
  };

  const handleSubmit = async () => {
    if (!formData.question_text.trim()) {
      setError('题目内容不能为空');
      return;
    }
    if (!formData.correct_answer.trim()) {
      setError('正确答案不能为空');
      return;
    }
    // 单选题校验：至少 2 个非空选项，且正确答案必须在选项键中
    if (formData.question_type === 'single_choice') {
      const filledKeys = Object.keys(formData.options).filter(k => (formData.options[k] || '').trim());
      if (filledKeys.length < 2) {
        setError('单选题至少需要 2 个非空选项');
        return;
      }
      if (!filledKeys.includes(formData.correct_answer.trim())) {
        setError(`正确答案 "${formData.correct_answer}" 必须对应已填写的选项（${filledKeys.join('/')}）`);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        ...formData,
        options: formData.question_type === 'single_choice' ? formData.options : null
      };
      if (editingId) {
        const data = await updateCustomQuestion(editingId, payload);
        if (data && data.success === false) {
          throw new Error(data.error || data.message || '更新失败');
        }
      } else {
        const data = await createCustomQuestion(payload);
        if (data && data.success === false) {
          throw new Error(data.error || data.message || '创建失败');
        }
      }
      resetForm();
      setView('list');
      loadQuestions(1);
    } catch (e) {
      setError(e.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确认删除这道题？')) return;
    try {
      await deleteCustomQuestion(id);
      // 删除后判断当前页是否还有数据，若为空则回退上一页（避免停留在空列表页）
      const remaining = total - 1;
      const maxPage = Math.max(1, Math.ceil(remaining / PAGE_SIZE));
      const targetPage = page > maxPage ? maxPage : page;
      loadQuestions(targetPage);
    } catch (e) {
      setError(e.message || '删除失败');
    }
  };

  const handleImport = async () => {
    setSubmitting(true);
    setError(null);
    setImportResult(null);
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed)) {
        throw new Error('导入内容必须是 JSON 数组');
      }
      const data = await importCustomQuestions(parsed);
      setImportResult(data);
      if (data.imported > 0) {
        loadQuestions(1);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        setError('JSON 格式错误: ' + e.message);
      } else {
        setError(e.message || '导入失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const optionKeys = ['A', 'B', 'C', 'D', 'E'];

  const renderListView = () => (
    <div className="page-container">
      <h2 className="page-title">自定义题库</h2>
      <p className="page-subtitle">手动录入或批量导入题目，构建专属题库</p>

      {error && <div className="error">{error}</div>}

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => { resetForm(); setView('form'); }}>
          + 手动录入
        </button>
        <button className="btn btn-secondary" onClick={() => { setImportText(''); setImportResult(null); setView('import'); }}>
          📥 批量导入
        </button>
      </div>

      <div className="section-card">
        <h3 className="section-title">
          <span>📚</span>我的题目
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#888', fontWeight: 'normal' }}>
            共 {total} 道
          </span>
        </h3>

        <div style={{ marginBottom: '1rem' }}>
          <select
            className="sp-form-input"
            style={{ width: 'auto' }}
            value={filterCategory}
            onChange={e => { setFilterCategory(e.target.value); loadQuestions(1, e.target.value); }}
          >
            <option value="">全部分类</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : questions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div>暂无题目，点击上方按钮开始录入</div>
          </div>
        ) : (
          <>
            {questions.map((q, idx) => {
              let opts = q.options;
              if (typeof opts === 'string') {
                try { opts = JSON.parse(opts); } catch { opts = null; }
              }
              return (
                <div key={q.id} style={{ padding: '1rem', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ color: '#667eea', fontWeight: 600 }}>第 {(page - 1) * PAGE_SIZE + idx + 1} 题</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {q.category && <span style={{ background: '#f0f0f0', color: '#666', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>{q.category}</span>}
                      <span style={{ background: '#eef1ff', color: '#667eea', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>{q.source || '手动'}</span>
                    </div>
                  </div>
                  <div style={{ marginBottom: '0.5rem', lineHeight: 1.6 }}>{q.question_text || '（无题干）'}</div>
                  {opts && (
                    <div style={{ fontSize: '0.9rem', color: '#555', marginBottom: '0.5rem' }}>
                      {Object.entries(opts).filter(([k, v]) => v && v.trim()).map(([k, v]) => (
                        <div key={k} style={{ padding: '0.15rem 0' }}>
                          <strong style={{ color: q.correct_answer === k ? '#10b981' : '#888' }}>{k}.</strong> {v}
                          {q.correct_answer === k && <span style={{ color: '#10b981', marginLeft: '0.5rem' }}>✓ 正确答案</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {q.explanation && (
                    <div style={{ fontSize: '0.85rem', color: '#888', padding: '0.5rem', background: '#f9fafb', borderRadius: '4px' }}>
                      💡 {q.explanation}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '0.25rem 0.75rem' }} onClick={() => handleEdit(q)}>编辑</button>
                    <button className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '0.25rem 0.75rem', color: '#ef4444' }} onClick={() => handleDelete(q.id)}>删除</button>
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
              <button className="btn btn-secondary" disabled={page <= 1} onClick={() => loadQuestions(page - 1)}>上一页</button>
              <span style={{ color: '#888' }}>第 {page} 页 / 共 {Math.ceil(total / PAGE_SIZE) || 1} 页</span>
              <button className="btn btn-secondary" disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => loadQuestions(page + 1)}>下一页</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderFormView = () => (
    <div className="page-container">
      <h2 className="page-title">{editingId ? '编辑题目' : '录入新题'}</h2>
      <p className="page-subtitle">填写题目信息，支持单选题与判断题</p>

      {error && <div className="error">{error}</div>}

      <div className="section-card">
        <div className="sp-form">
          <div className="sp-form-group">
            <label className="sp-form-label">题目内容 *</label>
            <textarea
              className="sp-form-input"
              rows={3}
              maxLength={5000}
              value={formData.question_text}
              onChange={e => setFormData(prev => ({ ...prev, question_text: e.target.value }))}
              placeholder="输入题干..."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div className="sp-form-row">
            <div className="sp-form-group">
              <label className="sp-form-label">题型</label>
              <select
                className="sp-form-input"
                value={formData.question_type}
                onChange={e => {
                  const newType = e.target.value;
                  setFormData(prev => {
                    // 切换题型时重置 correct_answer，避免单选 'A' 带入判断题导致非法数据
                    if (newType === 'true_false') {
                      return { ...prev, question_type: newType, correct_answer: '正确' };
                    }
                    return { ...prev, question_type: newType, correct_answer: '' };
                  });
                }}
              >
                <option value="single_choice">单选题</option>
                <option value="true_false">判断题</option>
              </select>
            </div>
            <div className="sp-form-group">
              <label className="sp-form-label">分类</label>
              <input
                type="text"
                className="sp-form-input"
                maxLength={100}
                value={formData.category}
                onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                placeholder="如：架构设计"
              />
            </div>
          </div>

          {formData.question_type === 'single_choice' && (
            <div className="sp-form-group">
              <label className="sp-form-label">选项（至少2个）</label>
              {optionKeys.map(k => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input
                    type="radio"
                    name="correct"
                    checked={formData.correct_answer === k}
                    onChange={() => setFormData(prev => ({ ...prev, correct_answer: k }))}
                  />
                  <span style={{ fontWeight: 600, color: formData.correct_answer === k ? '#10b981' : '#888' }}>{k}.</span>
                  <input
                    type="text"
                    className="sp-form-input"
                    value={formData.options[k] || ''}
                    onChange={e => setFormData(prev => ({ ...prev, options: { ...prev.options, [k]: e.target.value } }))}
                    placeholder={`选项 ${k} 内容`}
                  />
                </div>
              ))}
              <div style={{ fontSize: '0.85rem', color: '#888' }}>选中单选框标记正确答案</div>
            </div>
          )}

          {formData.question_type === 'true_false' && (
            <div className="sp-form-group">
              <label className="sp-form-label">正确答案</label>
              <select
                className="sp-form-input"
                style={{ width: 'auto' }}
                value={formData.correct_answer}
                onChange={e => setFormData(prev => ({ ...prev, correct_answer: e.target.value }))}
              >
                <option value="正确">正确</option>
                <option value="错误">错误</option>
              </select>
            </div>
          )}

          <div className="sp-form-group">
            <label className="sp-form-label">解析（可选）</label>
            <textarea
              className="sp-form-input"
              rows={2}
              maxLength={5000}
              value={formData.explanation}
              onChange={e => setFormData(prev => ({ ...prev, explanation: e.target.value }))}
              placeholder="答案解析..."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div className="sp-form-actions">
            <button className="btn btn-secondary" onClick={() => { resetForm(); setView('list'); }}>取消</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? '保存中...' : (editingId ? '更新' : '保存')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderImportView = () => (
    <div className="page-container">
      <h2 className="page-title">批量导入题目</h2>
      <p className="page-subtitle">粘贴 JSON 数组，一次最多 500 道</p>

      {error && <div className="error">{error}</div>}

      <div className="section-card">
        <div className="sp-form">
          <div className="sp-form-group">
            <label className="sp-form-label">JSON 数据 *</label>
            <textarea
              className="sp-form-input"
              rows={12}
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={`[
  {
    "question_text": "题目内容",
    "question_type": "single_choice",
    "options": {"A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D"},
    "correct_answer": "B",
    "explanation": "解析",
    "category": "分类"
  }
]`}
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </div>

          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', color: '#667eea' }}>查看完整字段说明</summary>
            <div style={{ padding: '0.75rem', background: '#f9fafb', borderRadius: '4px', fontSize: '0.85rem', color: '#555', marginTop: '0.5rem' }}>
              <div>• <code>question_text</code>（必填）题目内容</div>
              <div>• <code>correct_answer</code>（必填）正确答案，如 "A" 或 "正确"</div>
              <div>• <code>question_type</code>（可选）单选题 single_choice / 判断题 true_false</div>
              <div>• <code>options</code>（可选）对象格式 {"{"}"A":"...","B":"..."{"}"}</div>
              <div>• <code>explanation</code>（可选）答案解析</div>
              <div>• <code>category</code>（可选）分类标签</div>
            </div>
          </details>

          <div className="sp-form-actions">
            <button className="btn btn-secondary" onClick={() => setView('list')}>返回</button>
            <button className="btn btn-primary" onClick={handleImport} disabled={submitting || !importText.trim()}>
              {submitting ? '导入中...' : '📥 导入'}
            </button>
          </div>
        </div>
      </div>

      {importResult && (
        <div className="section-card">
          <h3 className="section-title"><span>📋</span>导入结果</h3>
          <div style={{ padding: '1rem' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              ✅ 成功导入: <strong style={{ color: '#10b981' }}>{importResult.imported}</strong> / {importResult.total}
            </div>
            {importResult.errors && importResult.errors.length > 0 && (
              <div>
                <div style={{ color: '#ef4444', marginBottom: '0.5rem' }}>❌ 失败 {importResult.errors.length} 条:</div>
                <ul style={{ color: '#ef4444', fontSize: '0.85rem', paddingLeft: '1.5rem' }}>
                  {importResult.errors.map((err, idx) => <li key={idx}>{err}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (view === 'form') return renderFormView();
  if (view === 'import') return renderImportView();
  return renderListView();
}

export default CustomQuestions;
