import React, { useState, useEffect } from 'react';
import {
  getStudyPlan,
  createStudyPlan,
  getTodayTasks,
  completeTask,
  getStudyPlanOverview,
  regeneratePlan
} from '../utils/api.js';

const TASK_TYPE_MAP = {
  learn: { label: '新学', color: '#667eea', bgColor: '#eef1ff' },
  review: { label: '复习', color: '#ff9800', bgColor: '#fff3e0' },
  practice: { label: '练习', color: '#4caf50', bgColor: '#e8f5e9' }
};

const STUDY_TIPS = [
  '每天坚持学习比突击学习效果更好',
  '复习是记忆之母，定期回顾学过的知识',
  '做题后及时总结错题，找出知识盲区',
  '合理安排作息，保持良好的精神状态',
  '多做真题，熟悉考试题型和出题规律'
];

function StudyPlan() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [todayTasks, setTodayTasks] = useState([]);
  const [todayStats, setTodayStats] = useState({ total_tasks: 0, completed_tasks: 0 });
  const [overview, setOverview] = useState(null);
  const [weekOverview, setWeekOverview] = useState([]);
  const [formData, setFormData] = useState({
    exam_date: '',
    daily_target: 20,
    daily_kp_target: 3
  });
  const [submitting, setSubmitting] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex(prev => (prev + 1) % STUDY_TIPS.length);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [planData, todayData, overviewData] = await Promise.all([
        getStudyPlan().catch(() => ({})),
        getTodayTasks().catch(() => ({ tasks: [], stats: { total_tasks: 0, completed_tasks: 0 } })),
        getStudyPlanOverview().catch(() => null)
      ]);

      const plan = planData?.plan || null;
      setPlan(plan);
      setTodayTasks(todayData?.tasks || []);
      setTodayStats(todayData?.stats || { total_tasks: 0, completed_tasks: 0 });
      setWeekOverview(planData?.week_overview || []);
      setOverview(overviewData);

      if (plan && plan.exam_date) {
        setFormData({
          exam_date: plan.exam_date,
          daily_target: plan.daily_target || 20,
          daily_kp_target: plan.daily_kp_target || 3
        });
      }
    } catch (err) {
      setError(err.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePlan = async () => {
    if (!formData.exam_date) {
      setError('请选择考试日期');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await createStudyPlan(formData);
      if (data.success) {
        setPlan(data.plan);
        await loadData();
      }
    } catch (err) {
      setError(err.message || '创建计划失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = async () => {
    if (!window.confirm('重新生成将清空当前今日任务及未来排程，已完成的任务记录会保留，是否继续？')) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await regeneratePlan();
      await loadData();
    } catch (err) {
      setError(err.message || '重新生成失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteTask = async (taskId) => {
    try {
      const result = await completeTask(taskId);
      if (result.success) {
        // 基于 prev state 计算更新后的列表，避免 stale closure 导致 completed_tasks 计数少 1
        let updatedList = [];
        setTodayTasks(prev => {
          updatedList = prev.map(t => t.id === taskId ? result.task : t);
          return updatedList;
        });
        const completedCount = updatedList.filter(t => t.status === 'completed').length;
        setTodayStats(prev => ({ ...prev, completed_tasks: completedCount }));
      }
    } catch (err) {
      console.error('完成任务失败', err);
      setError(err.message || '完成任务失败，请重试');
    }
  };

  const groupedTasks = todayTasks.reduce((acc, task) => {
    const type = task.task_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(task);
    return acc;
  }, {});

  const daysUntilExam = overview?.days_until_exam ?? (plan && plan.exam_date ? Math.ceil((new Date(plan.exam_date) - new Date()) / (1000 * 60 * 60 * 24)) : 0);
  const totalProgress = overview?.total_progress ?? 0;

  const getWeekDays = () => {
    const days = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = date.toLocaleDateString('en-CA');
      const dayData = weekOverview.find(w => w.task_date === dateStr) || { total_tasks: 0, completed_tasks: 0 };
      days.push({
        date: dateStr,
        label: i === 0 ? '今天' : ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
        total: dayData.total_tasks || 0,
        completed: dayData.completed_tasks || 0
      });
    }
    return days;
  };

  const weekDays = getWeekDays();
  const maxTasks = Math.max(...weekDays.map(d => d.total), 1);

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2 className="page-title">学习计划</h2>
      <p className="page-subtitle">科学规划，高效备考</p>

      {error && <div className="error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-title">考试倒计时</div>
          <div className="stat-card-value" style={{ color: '#667eea' }}>
            {daysUntilExam > 0 ? daysUntilExam : '已到'}
          </div>
          <div className="stat-card-sub">{daysUntilExam > 0 ? '天' : '考试日期已到'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">今日任务</div>
          <div className="stat-card-value">{todayStats.total_tasks}</div>
          <div className="stat-card-sub">个任务</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">今日完成</div>
          <div className="stat-card-value" style={{ color: '#4caf50' }}>
            {todayStats.completed_tasks}
          </div>
          <div className="stat-card-sub">
            {todayStats.total_tasks > 0 ? Math.round(todayStats.completed_tasks / todayStats.total_tasks * 100) : 0}% 完成率
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-title">总进度</div>
          <div className="stat-card-value" style={{ color: '#ff9800' }}>{totalProgress}%</div>
          <div className="stat-card-sub">整体完成进度</div>
        </div>
      </div>

      <div className="sp-content">
        <div className="sp-main">
          <div className="section-card">
            <h3 className="section-title">
              <span>📋</span>
              {plan ? '学习计划设置' : '创建学习计划'}
            </h3>
            <div className="sp-form">
              <div className="sp-form-group">
                <label className="sp-form-label">考试日期</label>
                <input
                  type="date"
                  className="sp-form-input"
                  value={formData.exam_date}
                  onChange={e => setFormData(prev => ({ ...prev, exam_date: e.target.value }))}
                />
              </div>
              <div className="sp-form-row">
                <div className="sp-form-group">
                  <label className="sp-form-label">每日目标题数</label>
                  <input
                    type="number"
                    className="sp-form-input"
                    min="5"
                    max="100"
                    value={formData.daily_target}
                    onChange={e => setFormData(prev => ({ ...prev, daily_target: parseInt(e.target.value) || 20 }))}
                  />
                </div>
                <div className="sp-form-group">
                  <label className="sp-form-label">每日知识点数</label>
                  <input
                    type="number"
                    className="sp-form-input"
                    min="1"
                    max="10"
                    value={formData.daily_kp_target}
                    onChange={e => setFormData(prev => ({ ...prev, daily_kp_target: parseInt(e.target.value) || 3 }))}
                  />
                </div>
              </div>
              <div className="sp-form-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleCreatePlan}
                  disabled={submitting}
                >
                  {submitting ? '处理中...' : plan ? '更新计划' : '创建计划'}
                </button>
                {plan && (
                  <button
                    className="btn btn-secondary"
                    onClick={handleRegenerate}
                    disabled={submitting}
                  >
                    🔄 重新生成
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="section-card">
            <h3 className="section-title">
              <span>📝</span>
              今日任务
              {todayStats.total_tasks > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#888', fontWeight: 'normal' }}>
                  {todayStats.completed_tasks}/{todayStats.total_tasks} 已完成
                </span>
              )}
            </h3>

            {todayTasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📭</div>
                <div>{plan ? '今日暂无任务' : '创建学习计划后自动生成任务'}</div>
              </div>
            ) : (
              <div className="sp-task-groups">
                {Object.entries(groupedTasks).map(([type, tasks]) => {
                  const typeInfo = TASK_TYPE_MAP[type] || { label: type, color: '#666', bgColor: '#f0f0f0' };
                  return (
                    <div key={type} className="sp-task-group">
                      <div className="sp-task-group-header" style={{ background: typeInfo.bgColor }}>
                        <span className="sp-task-type-badge" style={{ background: typeInfo.color }}>
                          {typeInfo.label}
                        </span>
                        <span className="sp-task-group-count">{tasks.length} 个任务</span>
                      </div>
                      <div className="sp-task-list">
                        {tasks.map(task => {
                          const progress = task.question_count > 0
                            ? Math.round(task.completed_count / task.question_count * 100)
                            : 0;
                          const isCompleted = task.status === 'completed';
                          return (
                            <div key={task.id} className={`sp-task-item ${isCompleted ? 'completed' : ''}`}>
                              <div className="sp-task-info">
                                <div className="sp-task-name">
                                  {task.kp_name || (task.task_type === 'practice' ? '综合练习' : '未知知识点')}
                                </div>
                                {task.kp_category && (
                                  <div className="sp-task-category">{task.kp_category}</div>
                                )}
                                <div className="sp-task-progress-bar">
                                  <div
                                    className="sp-task-progress-fill"
                                    style={{
                                      width: `${progress}%`,
                                      background: isCompleted ? '#4caf50' : typeInfo.color
                                    }}
                                  />
                                </div>
                                <div className="sp-task-meta">
                                  {task.completed_count}/{task.question_count} 题
                                </div>
                              </div>
                              <button
                                className={`sp-task-btn ${isCompleted ? 'done' : ''}`}
                                onClick={() => handleCompleteTask(task.id)}
                                disabled={isCompleted}
                              >
                                {isCompleted ? '✓ 已完成' : '完成'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="sp-sidebar">
          <div className="section-card">
            <h3 className="section-title"><span>📅</span>本周概览</h3>
            <div className="sp-week-chart">
              {weekDays.map((day, idx) => (
                <div key={idx} className="sp-week-day">
                  <div className="sp-week-bar-wrapper">
                    <div
                      className="sp-week-bar"
                      style={{ height: `${(day.total / maxTasks) * 100}%` }}
                    >
                      <div
                        className="sp-week-bar-fill"
                        style={{ height: day.total > 0 ? `${(day.completed / day.total) * 100}%` : '0%' }}
                      />
                    </div>
                  </div>
                  <div className="sp-week-label">{day.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="section-card">
            <h3 className="section-title"><span>📊</span>章节进度</h3>
            {overview?.chapter_progress && overview.chapter_progress.length > 0 ? (
              <div className="sp-chapter-list">
                {overview.chapter_progress.map((chapter, idx) => (
                  <div key={idx} className="sp-chapter-item">
                    <div className="sp-chapter-header">
                      <span className="sp-chapter-name" title={chapter.chapter_name}>
                        {chapter.chapter_name}
                      </span>
                      <span className="sp-chapter-percent">{chapter.progress}%</span>
                    </div>
                    <div className="sp-chapter-bar">
                      <div
                        className="sp-chapter-bar-fill"
                        style={{ width: `${chapter.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '1.5rem' }}>
                <div className="empty-state-icon" style={{ fontSize: '2rem' }}>📖</div>
                <div style={{ fontSize: '0.85rem' }}>暂无数据</div>
              </div>
            )}
          </div>

          <div className="section-card">
            <h3 className="section-title"><span>💡</span>学习小贴士</h3>
            <div className="sp-tip">
              <div className="sp-tip-icon">💡</div>
              <div className="sp-tip-text">{STUDY_TIPS[tipIndex]}</div>
            </div>
            <div className="sp-tip-dots">
              {STUDY_TIPS.map((_, idx) => (
                <span
                  key={idx}
                  className={`sp-tip-dot ${idx === tipIndex ? 'active' : ''}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StudyPlan;
