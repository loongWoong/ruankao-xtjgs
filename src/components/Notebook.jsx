import React, { useState, useEffect } from 'react';
import {
  createNote,
  getNotes,
  updateNote,
  deleteNote,
  addFavorite,
  removeFavorite,
  getFavorites,
  getFlashcards,
  createFlashcard,
  reviewFlashcard,
  getFlashcardStats
} from '../utils/api';

const tagColors = [
  { bg: '#e3f2fd', text: '#1976d2' },
  { bg: '#f3e5f5', text: '#7b1fa2' },
  { bg: '#e8f5e9', text: '#388e3c' },
  { bg: '#fff3e0', text: '#f57c00' },
  { bg: '#ffebee', text: '#d32f2f' },
  { bg: '#e0f7fa', text: '#0097a7' },
  { bg: '#fce4ec', text: '#c2185b' },
  { bg: '#f1f8e9', text: '#689f38' }
];

const getTagColor = (tag) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return tagColors[Math.abs(hash) % tagColors.length];
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
};

// 后端 tags 字段为逗号分隔字符串，统一转为数组
const parseTags = (tags) => {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
};

// 后端 difficulty 为数字 1-5，转为标签
const difficultyLabel = (d) => {
  const n = Number(d);
  if (n >= 4) return 'hard';
  if (n === 3) return 'medium';
  return 'easy';
};

const NoteTab = () => {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [search, setSearch] = useState('');
  const [noteType, setNoteType] = useState('');
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const params = {};
      if (noteType) params.note_type = noteType;
      if (search) params.search = search;
      const data = await getNotes(params);
      setNotes(data.items || []);
    } catch (err) {
      console.error('获取笔记失败:', err);
      setNotes([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchNotes();
  }, [noteType, search]);

  const handleSelectNote = async (note) => {
    setSelectedNote(note);
    setTitle(note.title);
    setContent(note.content);
    setTagsInput(parseTags(note.tags).join(', '));
    setIsFavorite(note.is_favorite || false);
    setIsEditing(false);
  };

  const handleNewNote = () => {
    setSelectedNote(null);
    setTitle('');
    setContent('');
    setTagsInput('');
    setIsFavorite(false);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert('请输入笔记标题');
      return;
    }
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
    try {
      if (selectedNote) {
        await updateNote(selectedNote.id, {
          title,
          content,
          tags,
          is_favorite: isFavorite
        });
      } else {
        await createNote({
          title,
          content,
          note_type: noteType || 'general',
          tags,
          is_favorite: isFavorite
        });
      }
      fetchNotes();
      setIsEditing(false);
    } catch (err) {
      console.error('保存笔记失败:', err);
      alert('保存笔记失败: ' + (err.message || '未知错误'));
    }
  };

  const handleDelete = async () => {
    if (!selectedNote || deleting) return;
    if (!confirm('确定要删除这篇笔记吗？')) return;
    setDeleting(true);
    try {
      await deleteNote(selectedNote.id);
      setSelectedNote(null);
      fetchNotes();
    } catch (err) {
      console.error('删除笔记失败:', err);
      alert('删除笔记失败：' + (err.message || '未知错误'));
    } finally {
      setDeleting(false);
    }
  };

  const toggleFavorite = async () => {
    if (!selectedNote) return;
    try {
      if (isFavorite) {
        await removeFavorite('note', selectedNote.id);
      } else {
        await addFavorite('note', selectedNote.id);
      }
      setIsFavorite(!isFavorite);
      fetchNotes();
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  return (
    <div className="nb-notes-container">
      <div className="nb-notes-sidebar">
        <div className="nb-notes-toolbar">
          <input
            type="text"
            className="nb-search-input"
            placeholder="搜索笔记..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="nb-toolbar-actions">
            <select
              className="nb-filter-select"
              value={noteType}
              onChange={(e) => setNoteType(e.target.value)}
            >
              <option value="">全部类型</option>
              <option value="general">普通笔记</option>
              <option value="question">题目笔记</option>
              <option value="kp">知识点笔记</option>
            </select>
            <button className="btn btn-primary nb-new-btn" onClick={handleNewNote}>
              + 新建笔记
            </button>
          </div>
        </div>
        <div className="nb-notes-list">
          {loading ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <p>加载中...</p>
            </div>
          ) : notes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <p>暂无笔记</p>
            </div>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                className={`nb-note-item ${selectedNote?.id === note.id ? 'active' : ''}`}
                onClick={() => handleSelectNote(note)}
              >
                <div className="nb-note-item-header">
                  <span className="nb-note-title">{note.title || '无标题'}</span>
                  <span className="nb-favorite-star" onClick={(e) => {
                    e.stopPropagation();
                  }}>
                    {note.is_favorite ? '⭐' : '☆'}
                  </span>
                </div>
                <p className="nb-note-summary">
                  {note.content ? note.content.substring(0, 80) + '...' : '暂无内容'}
                </p>
                <div className="nb-note-meta">
                  <div className="nb-note-tags">
                    {parseTags(note.tags).slice(0, 3).map((tag, idx) => {
                      const color = getTagColor(tag);
                      return (
                        <span
                          key={idx}
                          className="nb-tag-chip"
                          style={{ background: color.bg, color: color.text }}
                        >
                          {tag}
                        </span>
                      );
                    })}
                  </div>
                  <span className="nb-note-time">{formatDate(note.updated_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="nb-notes-detail">
        {!selectedNote && !isEditing ? (
          <div className="no-selection">
            <div className="no-selection-icon">📝</div>
            <p>选择一篇笔记查看详情</p>
            <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>或点击「新建笔记」开始记录</p>
          </div>
        ) : (
          <div className="nb-note-editor">
            <div className="nb-editor-header">
              <input
                type="text"
                className="nb-title-input"
                placeholder="输入笔记标题..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                readOnly={!isEditing}
              />
              <div className="nb-editor-actions">
                <button
                  className="nb-favorite-btn"
                  onClick={toggleFavorite}
                  title={isFavorite ? '取消收藏' : '收藏'}
                >
                  {isFavorite ? '⭐' : '☆'}
                </button>
                {isEditing ? (
                  <button className="btn btn-primary" onClick={handleSave}>
                    保存
                  </button>
                ) : (
                  <button className="btn btn-secondary" onClick={() => setIsEditing(true)}>
                    编辑
                  </button>
                )}
                {selectedNote && (
                  <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                    {deleting ? '删除中...' : '删除'}
                  </button>
                )}
              </div>
            </div>

            <div className="nb-tags-section">
              <span className="nb-tags-label">标签：</span>
              <input
                type="text"
                className="nb-tags-input"
                placeholder="用逗号分隔多个标签..."
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                readOnly={!isEditing}
              />
            </div>

            <textarea
              className="nb-content-textarea"
              placeholder="在这里记录你的笔记内容..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              readOnly={!isEditing}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const FavoriteTab = () => {
  const [activeType, setActiveType] = useState('question');
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchFavorites = async (type) => {
    setLoading(true);
    try {
      const data = await getFavorites(type);
      setFavorites(data.items || []);
    } catch (err) {
      console.error('获取收藏失败:', err);
      setFavorites([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFavorites(activeType);
  }, [activeType]);

  const handleRemoveFavorite = async (targetId) => {
    try {
      await removeFavorite(activeType, targetId);
      fetchFavorites(activeType);
    } catch (err) {
      console.error('取消收藏失败:', err);
    }
  };

  const typeLabels = {
    question: '题目',
    kp: '知识点',
    note: '笔记'
  };

  return (
    <div className="nb-favorites-container">
      <div className="nb-favorites-tabs">
        {Object.entries(typeLabels).map(([type, label]) => (
          <button
            key={type}
            className={`nb-fav-type-btn ${activeType === type ? 'active' : ''}`}
            onClick={() => setActiveType(type)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="nb-favorites-grid">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">⭐</div>
            <p>加载中...</p>
          </div>
        ) : favorites.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⭐</div>
            <p>暂无收藏</p>
          </div>
        ) : (
          favorites.map((item) => (
            <div key={item.id || item.target_id} className="nb-favorite-card">
              <div className="nb-fav-card-header">
                <span className="nb-fav-type-badge">{typeLabels[activeType]}</span>
                <button
                  className="nb-fav-remove-btn"
                  onClick={() => handleRemoveFavorite(item.id || item.target_id)}
                  title="取消收藏"
                >
                  ✕
                </button>
              </div>
              <div className="nb-fav-card-title">
                {item.title || item.question_text || item.name || '无标题'}
              </div>
              <div className="nb-fav-card-footer">
                <span className="nb-fav-time">
                  收藏于 {formatDate(item.created_at || item.favorited_at)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const FlashcardTab = () => {
  const [stats, setStats] = useState({ total: 0, mastered: 0, due: 0, today: 0 });
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [newKpId, setNewKpId] = useState('');
  const [newDifficulty, setNewDifficulty] = useState('medium');

  const fetchStats = async () => {
    try {
      const data = await getFlashcardStats();
      // 后端字段：total_cards / mastered_count / due_count / today_review_count
      setStats({
        total: data.total_cards || 0,
        mastered: data.mastered_count || 0,
        due: data.due_count || 0,
        today: data.today_review_count || 0
      });
    } catch (err) {
      console.error('获取卡片统计失败:', err);
    }
  };

  const fetchCards = async () => {
    try {
      const data = await getFlashcards({ due_only: 1, page_size: 50 });
      setCards(data.items || []);
      setCurrentIndex(0);
      setIsFlipped(false);
    } catch (err) {
      console.error('获取卡片失败:', err);
      setCards([]);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchCards();
  }, []);

  const handleReview = async (quality) => {
    const currentCard = cards[currentIndex];
    if (!currentCard) return;
    try {
      await reviewFlashcard(currentCard.id, quality);
      fetchStats();
      if (currentIndex < cards.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setIsFlipped(false);
      } else {
        alert('今日复习完成！🎉');
        fetchCards();
      }
    } catch (err) {
      console.error('复习卡片失败:', err);
      alert('复习卡片失败: ' + (err.message || '未知错误'));
    }
  };

  const handleAddCard = async () => {
    if (!newFront.trim() || !newBack.trim()) {
      alert('请填写卡片正面和背面内容');
      return;
    }
    try {
      // 后端 difficulty 字段是 INTEGER (1-5)，前端 select 值是字符串 easy/medium/hard，需映射为数字
      const difficultyMap = { easy: 1, medium: 3, hard: 5 };
      const difficultyValue = difficultyMap[newDifficulty] || 3;
      await createFlashcard({
        kp_id: newKpId || null,
        front: newFront,
        back: newBack,
        difficulty: difficultyValue
      });
      setShowAddModal(false);
      setNewFront('');
      setNewBack('');
      setNewKpId('');
      fetchStats();
      fetchCards();
    } catch (err) {
      console.error('创建卡片失败:', err);
      alert('创建卡片失败: ' + (err.message || '未知错误'));
    }
  };

  const currentCard = cards[currentIndex];

  return (
    <div className="nb-flashcards-container">
      <div className="nb-flashcard-stats">
        <div className="stat-card">
          <div className="stat-card-title">总卡片数</div>
          <div className="stat-card-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">已掌握</div>
          <div className="stat-card-value" style={{ color: '#4caf50' }}>{stats.mastered}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">待复习</div>
          <div className="stat-card-value" style={{ color: '#ff9800' }}>{stats.due}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">今日需复习</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>{stats.today}</div>
        </div>
      </div>

      <div className="nb-flashcard-review-section">
        <div className="nb-review-header">
          <h3>卡片复习</h3>
          <div className="nb-review-progress">
            {cards.length > 0 ? `${currentIndex + 1} / ${cards.length}` : '0 / 0'}
          </div>
        </div>

        {cards.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🃏</div>
            <p>今日没有需要复习的卡片</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              onClick={() => setShowAddModal(true)}
            >
              添加卡片
            </button>
          </div>
        ) : (
          <>
            <div
              className="nb-flip-card"
              onClick={() => setIsFlipped(!isFlipped)}
            >
              <div className={`nb-flip-inner ${isFlipped ? 'flipped' : ''}`}>
                <div className="nb-flip-front">
                  <div className="nb-flip-label">问题</div>
                  <div className="nb-flip-content">{currentCard?.front || '暂无内容'}</div>
                  <div className="nb-flip-hint">点击翻转查看答案</div>
                </div>
                <div className="nb-flip-back">
                  <div className="nb-flip-label">答案</div>
                  <div className="nb-flip-content">{currentCard?.back || '暂无内容'}</div>
                  <div className="nb-flip-hint">点击翻转返回问题</div>
                </div>
              </div>
            </div>

            <div className="nb-rating-buttons">
              <button
                className="nb-rating-btn nb-rating-1"
                onClick={() => handleReview(1)}
              >
                忘了 (1)
              </button>
              <button
                className="nb-rating-btn nb-rating-3"
                onClick={() => handleReview(3)}
              >
                模糊 (3)
              </button>
              <button
                className="nb-rating-btn nb-rating-4"
                onClick={() => handleReview(4)}
              >
                记得 (4)
              </button>
              <button
                className="nb-rating-btn nb-rating-5"
                onClick={() => handleReview(5)}
              >
                完美 (5)
              </button>
            </div>
          </>
        )}
      </div>

      <div className="nb-flashcard-list-section">
        <div className="section-card">
          <div className="section-title">
            <span>卡片列表</span>
            <button
              className="btn btn-primary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setShowAddModal(true)}
            >
              + 添加卡片
            </button>
          </div>
          <div className="nb-card-list">
            {cards.length === 0 ? (
              <p style={{ color: '#999', textAlign: 'center', padding: '1rem' }}>暂无卡片</p>
            ) : (
              cards.map((card, idx) => (
                <div key={card.id} className="nb-card-list-item">
                  <div className="nb-card-list-front">{card.front}</div>
                  <div className="nb-card-list-back">{card.back}</div>
                  <div className="nb-card-list-meta">
                    {(() => {
                      const d = difficultyLabel(card.difficulty);
                      return (
                        <span className={`nb-difficulty-badge nb-difficulty-${d}`}>
                          {d === 'easy' ? '简单' : d === 'medium' ? '中等' : '困难'}
                        </span>
                      );
                    })()}
                    <span className="nb-card-next-review">
                      下次复习：{formatDate(card.next_review_at)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="me-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="me-modal" onClick={(e) => e.stopPropagation()}>
            <div className="me-modal-title">添加知识卡片</div>
            <div className="me-form">
              <div className="me-form-group">
                <label className="me-form-label">正面（问题）</label>
                <textarea
                  className="me-form-input"
                  rows={3}
                  value={newFront}
                  onChange={(e) => setNewFront(e.target.value)}
                  placeholder="输入问题..."
                />
              </div>
              <div className="me-form-group">
                <label className="me-form-label">背面（答案）</label>
                <textarea
                  className="me-form-input"
                  rows={4}
                  value={newBack}
                  onChange={(e) => setNewBack(e.target.value)}
                  placeholder="输入答案..."
                />
              </div>
              <div className="me-form-row">
                <div className="me-form-group">
                  <label className="me-form-label">知识点ID（可选）</label>
                  <input
                    type="text"
                    className="me-form-input"
                    value={newKpId}
                    onChange={(e) => setNewKpId(e.target.value)}
                    placeholder="kp_xxx"
                  />
                </div>
                <div className="me-form-group">
                  <label className="me-form-label">难度</label>
                  <select
                    className="me-form-input"
                    value={newDifficulty}
                    onChange={(e) => setNewDifficulty(e.target.value)}
                  >
                    <option value="easy">简单</option>
                    <option value="medium">中等</option>
                    <option value="hard">困难</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="me-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleAddCard}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Notebook = () => {
  const [activeTab, setActiveTab] = useState('notes');

  const tabs = [
    { key: 'notes', label: '笔记', icon: '📝' },
    { key: 'favorites', label: '收藏', icon: '⭐' },
    { key: 'flashcards', label: '知识卡片', icon: '🃏' }
  ];

  return (
    <div className="page-container">
      <h1 className="page-title">笔记标注系统</h1>
      <p className="page-subtitle">记录学习笔记，收藏重要内容，用知识卡片巩固记忆</p>

      <div className="nb-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`nb-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="nb-tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="nb-tab-content">
        {activeTab === 'notes' && <NoteTab />}
        {activeTab === 'favorites' && <FavoriteTab />}
        {activeTab === 'flashcards' && <FlashcardTab />}
      </div>
    </div>
  );
};

export default Notebook;
