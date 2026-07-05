import React, { useState, useEffect, useRef } from 'react';
import {
  getTextbookChapters,
  getTextbookChapter,
  updateReadingProgress,
  getTextbookProgress,
  searchTextbook
} from '../utils/api.js';

const STATUS_MAP = {
  unread: { label: '未读', color: '#6b7280', bg: '#f3f4f6' },
  reading: { label: '阅读中', color: '#f59e0b', bg: '#fef3c7' },
  completed: { label: '已完成', color: '#10b981', bg: '#d1fae5' }
};

function Textbook() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('list'); // list | reading | search
  const [chapters, setChapters] = useState([]);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [progressOverview, setProgressOverview] = useState(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  // 记录当前章节打开时的时间戳，用于计算实际阅读秒数
  const chapterOpenAtRef = useRef(0);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [chaptersData, progressData] = await Promise.all([
        getTextbookChapters(),
        getTextbookProgress().catch(() => null)
      ]);
      setChapters(chaptersData.items || []);
      setProgressOverview(progressData);
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openChapter = async (chapterId) => {
    try {
      setLoading(true);
      const chapter = await getTextbookChapter(chapterId);
      setCurrentChapter(chapter);
      setView('reading');
      // 记录打开时刻，markCompleted 时用于计算实际阅读时长
      chapterOpenAtRef.current = Date.now();
      // 标记为阅读中（不传 read_time，由后端保留历史累计值）
      updateReadingProgress(chapterId, { status: 'reading' }).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const markCompleted = async () => {
    if (!currentChapter) return;
    try {
      // 计算本次会话实际阅读秒数：从打开章节到现在
      const sessionSec = chapterOpenAtRef.current > 0
        ? Math.round((Date.now() - chapterOpenAtRef.current) / 1000)
        : 0;
      // 转为分钟（最少 1 分钟避免 0）
      const readMinutes = Math.max(1, Math.round(sessionSec / 60));
      await updateReadingProgress(currentChapter.id, { status: 'completed', read_time: readMinutes });
      const updated = await getTextbookChapter(currentChapter.id);
      setCurrentChapter(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const goPrev = () => {
    if (currentChapter?.prev_chapter) openChapter(currentChapter.prev_chapter.id);
  };

  const goNext = () => {
    if (currentChapter?.next_chapter) openChapter(currentChapter.next_chapter.id);
  };

  const handleSearch = async () => {
    if (!searchKeyword.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      setLoading(true);
      const data = await searchTextbook(searchKeyword);
      setSearchResults(data.items || []);
      setView('search');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getChapterStatus = (chapterId) => {
    if (!progressOverview?.recent_chapters) return null;
    const found = progressOverview.recent_chapters.find(c => c.id === chapterId);
    return found ? found.status : null;
  };

  if (loading && view === 'list') {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="page textbook">
      {error && <div className="error-banner" onClick={() => setError(null)}>{error}</div>}

      {/* 目录视图 */}
      {view === 'list' && (
        <>
          <div className="page-header">
            <h2>教材学习</h2>
          </div>

          {progressOverview && (
            <div className="progress-overview">
              <div className="stats-cards">
                <div className="stat-card">
                  <div className="stat-value">{progressOverview.total_chapters}</div>
                  <div className="stat-label">总章节</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{progressOverview.completed_count}</div>
                  <div className="stat-label">已完成</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{progressOverview.reading_count}</div>
                  <div className="stat-label">阅读中</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{progressOverview.completion_rate}%</div>
                  <div className="stat-label">完成率</div>
                </div>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar" style={{ width: `${progressOverview.completion_rate}%` }}></div>
              </div>
            </div>
          )}

          <div className="filter-bar">
            <input
              type="text"
              placeholder="搜索教材内容..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="filter-input"
            />
            <button className="btn btn-primary" onClick={handleSearch}>搜索</button>
          </div>

          <div className="chapter-list">
            {chapters.length === 0 ? (
              <div className="empty-state">暂无教材内容</div>
            ) : chapters.map(ch => {
              const status = getChapterStatus(ch.id);
              const st = status ? STATUS_MAP[status] : null;
              return (
                <div key={ch.id} className="chapter-item" onClick={() => openChapter(ch.id)}>
                  <div className="chapter-num">第{ch.chapter_num}章</div>
                  <div className="chapter-info">
                    <h4>{ch.title}</h4>
                    {ch.summary && <p className="chapter-summary">{ch.summary}</p>}
                    <div className="chapter-meta">
                      <span>{ch.word_count}字</span>
                      {st && <span className="status-tag" style={{ color: st.color, background: st.bg }}>{st.label}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 阅读视图 */}
      {view === 'reading' && currentChapter && (
        <div className="reading-view">
          <div className="reading-header">
            <button className="btn btn-back" onClick={() => { setView('list'); loadData(); }}>← 返回目录</button>
            <h2>第{currentChapter.chapter_num}章 {currentChapter.title}</h2>
            <div className="reading-actions">
              {currentChapter.progress?.status !== 'completed' && (
                <button className="btn btn-primary" onClick={markCompleted}>标记完成</button>
              )}
            </div>
          </div>

          {currentChapter.progress?.status === 'completed' && (
            <div className="completed-banner">✓ 已完成本章学习</div>
          )}

          <div className="chapter-content">
            <pre className="content-text">{currentChapter.content}</pre>
          </div>

          <div className="reading-nav">
            <button className="btn btn-secondary" onClick={goPrev} disabled={!currentChapter.prev_chapter}>
              ← 上一章 {currentChapter.prev_chapter ? `: ${currentChapter.prev_chapter.title}` : ''}
            </button>
            <button className="btn btn-secondary" onClick={goNext} disabled={!currentChapter.next_chapter}>
              下一章 {currentChapter.next_chapter ? `: ${currentChapter.next_chapter.title}` : ''} →
            </button>
          </div>
        </div>
      )}

      {/* 搜索结果 */}
      {view === 'search' && (
        <>
          <div className="page-header">
            <h2>搜索结果：{searchKeyword}</h2>
            <button className="btn btn-secondary" onClick={() => setView('list')}>返回目录</button>
          </div>
          {searchResults.length === 0 ? (
            <div className="empty-state">未找到相关内容</div>
          ) : (
            <div className="chapter-list">
              {searchResults.map(ch => (
                <div key={ch.id} className="chapter-item" onClick={() => openChapter(ch.id)}>
                  <div className="chapter-num">第{ch.chapter_num}章</div>
                  <div className="chapter-info">
                    <h4>{ch.title}</h4>
                    {ch.summary && <p className="chapter-summary">{ch.summary}</p>}
                    <div className="chapter-meta">
                      <span>{ch.word_count}字</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Textbook;
