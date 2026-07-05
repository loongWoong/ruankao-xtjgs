import React, { useState, useEffect } from 'react';
import {
  checkin,
  getTodayCheckin,
  getCheckinStreak,
  getCheckinCalendar,
  getStudySessionStats
} from '../utils/api';

function StudyCheckin() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [streak, setStreak] = useState({ current_streak: 0, longest_streak: 0, total_checkin_days: 0, total_study_minutes: 0 });
  const [today, setToday] = useState({ checked_in: false, study_minutes: 0, note: '' });
  const [calendarMonth, setCalendarMonth] = useState(new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [calendar, setCalendar] = useState([]);
  const [sessionStats, setSessionStats] = useState({ total_minutes: 0, active_days: 0, avg_minutes_per_day: 0, by_module: [] });
  const [checkinMinutes, setCheckinMinutes] = useState(60);
  const [checkinNote, setCheckinNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statsDays, setStatsDays] = useState(30);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadCalendar();
  }, [calendarMonth]);

  useEffect(() => {
    loadSessionStats();
  }, [statsDays]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [streakData, todayData] = await Promise.all([
        getCheckinStreak(),
        getTodayCheckin()
      ]);
      setStreak(prev => ({ ...prev, ...streakData }));
      setToday(prev => ({ ...prev, ...todayData }));
      if (todayData.checked_in !== false) {
        setCheckinMinutes(todayData.study_minutes || 60);
        setCheckinNote(todayData.note || '');
      }
    } catch (e) {
      setError(e.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const loadCalendar = async () => {
    try {
      const data = await getCheckinCalendar(calendarMonth);
      setCalendar(data.records || []);
    } catch (e) {
      console.error('加载日历失败', e);
    }
  };

  const loadSessionStats = async () => {
    try {
      const data = await getStudySessionStats(statsDays);
      setSessionStats(prev => ({ ...prev, ...data }));
    } catch (e) {
      console.error('加载时长统计失败', e);
    }
  };

  const handleCheckin = async () => {
    // 学习时长范围校验：0-1440 分钟（一天）
    const minutes = parseInt(checkinMinutes, 10);
    if (isNaN(minutes) || minutes < 0 || minutes > 1440) {
      setError('学习时长必须在 0-1440 分钟之间');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await checkin({
        study_minutes: minutes,
        note: checkinNote
      });
      setStreak(prev => ({ ...prev, current_streak: data.streak, total_checkin_days: data.total_days, total_study_minutes: data.total_minutes, longest_streak: data.longest_streak || prev.longest_streak }));
      setToday({ checked_in: true, study_minutes: minutes, note: checkinNote });
      loadCalendar();
      // 打卡成功后刷新学习时长统计，避免"总时长""活跃天数"不更新
      loadSessionStats();
    } catch (e) {
      setError(e.message || '打卡失败');
    } finally {
      setSubmitting(false);
    }
  };

  const formatMinutes = (m) => {
    if (!m) return '0 分钟';
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    const min = m % 60;
    return min > 0 ? `${h} 小时 ${min} 分钟` : `${h} 小时`;
  };

  const renderCalendar = () => {
    const [year, month] = calendarMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayStr = new Date().toLocaleDateString('en-CA');
    const checkinMap = {};
    calendar.forEach(r => { checkinMap[r.checkin_date] = r; });

    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} style={{ background: 'transparent' }} />);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calendarMonth}-${String(d).padStart(2, '0')}`;
      const record = checkinMap[dateStr];
      const isToday = dateStr === todayStr;
      cells.push(
        <div key={d} style={{
          minHeight: '56px', padding: '0.4rem', border: '1px solid #f0f0f0',
          background: record ? '#eef1ff' : '#fff',
          borderColor: isToday ? '#667eea' : '#f0f0f0',
          borderWidth: isToday ? '2px' : '1px'
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: isToday ? '#667eea' : '#555' }}>{d}</div>
          {record && (
            <div style={{ fontSize: '0.75rem', color: '#667eea', marginTop: '0.2rem' }}>
              {formatMinutes(record.study_minutes)}
            </div>
          )}
        </div>
      );
    }

    return (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '2px', marginTop: '0.75rem'
      }}>
        {weekdays.map(w => (
          <div key={w} style={{ textAlign: 'center', padding: '0.4rem', fontWeight: 600, color: '#888', fontSize: '0.85rem' }}>{w}</div>
        ))}
        {cells}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2 className="page-title">学习打卡与激励</h2>
      <p className="page-subtitle">坚持每日打卡，量化学习投入</p>

      {error && <div className="error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">当前连续</div>
          <div className="stat-card-value" style={{ color: '#f59e0b' }}>{streak.current_streak || 0}</div>
          <div className="stat-card-sub">天 🔥</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">最长连续</div>
          <div className="stat-card-value">{streak.longest_streak || 0}</div>
          <div className="stat-card-sub">天</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">累计打卡</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>{streak.total_checkin_days || 0}</div>
          <div className="stat-card-sub">天</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">累计时长</div>
          <div className="stat-card-value" style={{ color: '#10b981' }}>{formatMinutes(streak.total_study_minutes || 0)}</div>
          <div className="stat-card-sub">总学习时长</div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">
          <span>✅</span>今日打卡
          {today.checked_in && (
            <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>
              ✓ 今日已打卡
            </span>
          )}
        </h3>
        <div className="sp-form">
          <div className="sp-form-row">
            <div className="sp-form-group">
              <label className="sp-form-label">今日学习时长（分钟）</label>
              <input
                type="number"
                className="sp-form-input"
                min="0" max="1440"
                value={checkinMinutes}
                onChange={e => setCheckinMinutes(e.target.value)}
              />
            </div>
            <div className="sp-form-group" style={{ flex: 2 }}>
              <label className="sp-form-label">学习心得（可选）</label>
              <input
                type="text"
                className="sp-form-input"
                maxLength={200}
                value={checkinNote}
                onChange={e => setCheckinNote(e.target.value)}
                placeholder="例如：复习了架构设计模式"
              />
            </div>
          </div>
          <div className="sp-form-actions">
            <button className="btn btn-primary" onClick={handleCheckin} disabled={submitting}>
              {submitting ? '提交中...' : (today.checked_in ? '更新今日打卡' : '✅ 立即打卡')}
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">
          <span>📅</span>打卡日历
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 'normal' }}>
            <input
              type="month"
              value={calendarMonth}
              max={new Date().toLocaleDateString('en-CA').slice(0, 7)}
              onChange={e => setCalendarMonth(e.target.value)}
              style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '0.25rem' }}
            />
          </span>
        </h3>
        {renderCalendar()}
      </div>

      <div className="section-card">
        <h3 className="section-title">
          <span>📊</span>学习时长统计
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', fontWeight: 'normal' }}>
            <select
              value={statsDays}
              onChange={e => setStatsDays(parseInt(e.target.value, 10))}
              style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '0.25rem' }}
            >
              <option value={7}>近 7 天</option>
              <option value={30}>近 30 天</option>
              <option value={90}>近 90 天</option>
            </select>
          </span>
        </h3>
        <div className="stats-grid" style={{ marginBottom: '1rem' }}>
          <div className="stat-card">
            <div className="stat-card-title">总时长</div>
            <div className="stat-card-value">{formatMinutes(sessionStats.total_minutes || 0)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-title">活跃天数</div>
            <div className="stat-card-value" style={{ color: '#667eea' }}>{sessionStats.active_days || 0}</div>
            <div className="stat-card-sub">/ {statsDays} 天</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-title">日均</div>
            <div className="stat-card-value" style={{ color: '#10b981' }}>{sessionStats.avg_minutes_per_day || 0}</div>
            <div className="stat-card-sub">分钟/天</div>
          </div>
        </div>

        {sessionStats.by_module && sessionStats.by_module.length > 0 ? (
          <div>
            <h4 style={{ marginBottom: '0.5rem', color: '#555' }}>按模块分布</h4>
            {sessionStats.by_module.map((m, idx) => {
              const maxMin = Math.max(...sessionStats.by_module.map(x => x.total_minutes || 0), 1);
              const pct = ((m.total_minutes || 0) / maxMin * 100).toFixed(0);
              return (
                <div key={idx} style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                    <span>{m.module || '未分类'}</span>
                    <span style={{ color: '#888' }}>{formatMinutes(m.total_minutes || 0)} ({m.cnt || 0} 次)</span>
                  </div>
                  <div style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#667eea' }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '1rem', color: '#999', textAlign: 'center', fontSize: '0.85rem' }}>
            暂无模块学习数据
          </div>
        )}
      </div>
    </div>
  );
}

export default StudyCheckin;
