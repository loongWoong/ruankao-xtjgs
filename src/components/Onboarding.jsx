import React, { useState } from 'react';
import { createStudyPlan } from '../utils/api';

const ONBOARD_KEY = 'ruankao_onboarded';

const STEPS = [
  { id: 'welcome', title: '欢迎使用软考备考系统', icon: '🎓' },
  { id: 'exam', title: '设置考试信息', icon: '📅' },
  { id: 'goal', title: '设定学习目标', icon: '🎯' },
  { id: 'done', title: '准备就绪', icon: '🚀' }
];

function Onboarding({ onClose }) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    exam_date: '',
    daily_target: 20,
    daily_kp_target: 3
  });

  const currentStep = STEPS[step];

  const handleNext = () => {
    if (step === 1 && !formData.exam_date) {
      setError('请选择考试日期');
      return;
    }
    setError(null);
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const handlePrev = () => {
    setError(null);
    setStep(s => Math.max(s - 1, 0));
  };

  const handleFinish = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (formData.exam_date) {
        await createStudyPlan(formData);
      }
      localStorage.setItem(ONBOARD_KEY, '1');
      localStorage.setItem('ruankao_onboarded_at', new Date().toISOString());
      onClose();
    } catch (e) {
      // 创建计划失败时提示用户，但不阻塞引导流程
      console.error('Onboarding 创建学习计划失败:', e);
      setError('学习计划创建失败：' + (e.message || '未知错误') + '。可在「学习计划」页稍后重试。');
      // 仍标记已完成引导，避免反复弹窗
      localStorage.setItem(ONBOARD_KEY, '1');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem(ONBOARD_KEY, '1');
    onClose();
  };

  const defaultExamDate = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().split('T')[0];
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem'
    }}>
      <div style={{
        background: '#fff', borderRadius: '12px',
        maxWidth: '520px', width: '100%',
        maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        {/* 步骤指示器 */}
        <div style={{
          display: 'flex', padding: '1.5rem 1.5rem 0',
          gap: '0.5rem'
        }}>
          {STEPS.map((s, idx) => (
            <div key={s.id} style={{
              flex: 1, height: '4px', borderRadius: '2px',
              background: idx <= step ? '#667eea' : '#e5e7eb',
              transition: 'background 0.3s'
            }} />
          ))}
        </div>

        <div style={{ padding: '2rem 2.5rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>{currentStep.icon}</div>
            <h2 style={{ margin: 0, color: '#1f2937' }}>{currentStep.title}</h2>
            <div style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
              第 {step + 1} / {STEPS.length} 步
            </div>
          </div>

          {error && (
            <div style={{
              padding: '0.75rem 1rem', background: '#fee2e2',
              color: '#ef4444', borderRadius: '6px', marginBottom: '1rem',
              fontSize: '0.9rem'
            }}>{error}</div>
          )}

          {step === 0 && (
            <div style={{ color: '#555', lineHeight: 1.8 }}>
              <p style={{ marginBottom: '1rem' }}>
                本系统覆盖<strong>系统架构设计师</strong>考试三大科目：
              </p>
              <ul style={{ paddingLeft: '1.5rem', marginBottom: '1rem' }}>
                <li>📚 上午综合知识（75道选择题）</li>
                <li>🔍 下午案例分析（主观题）</li>
                <li>✏️ 下午论文（写作题）</li>
              </ul>
              <p style={{ marginBottom: '0.5rem' }}>提供以下功能助你高效备考：</p>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem',
                fontSize: '0.9rem', color: '#667eea'
              }}>
                <div>📖 教材系统学习</div>
                <div>🏆 历年真题模考</div>
                <div>📊 错题智能分析</div>
                <div>🗓️ 考纲覆盖追踪</div>
                <div>📝 论文/案例训练</div>
                <div>📅 间隔复习计划</div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="sp-form-group" style={{ marginBottom: '1rem' }}>
                <label className="sp-form-label">考试日期</label>
                <input
                  type="date"
                  className="sp-form-input"
                  value={formData.exam_date}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setFormData(prev => ({ ...prev, exam_date: e.target.value }))}
                />
                <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.4rem' }}>
                  系统会根据考试日期自动倒计时并分配每日学习任务
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem' }}
                onClick={() => setFormData(prev => ({ ...prev, exam_date: defaultExamDate() }))}
              >
                设为3个月后（默认）
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="sp-form-row" style={{ marginBottom: '1rem' }}>
                <div className="sp-form-group">
                  <label className="sp-form-label">每日目标题数</label>
                  <input
                    type="number"
                    className="sp-form-input"
                    min="5" max="100"
                    value={formData.daily_target}
                    onChange={e => setFormData(prev => ({ ...prev, daily_target: parseInt(e.target.value) || 20 }))}
                  />
                </div>
                <div className="sp-form-group">
                  <label className="sp-form-label">每日知识点数</label>
                  <input
                    type="number"
                    className="sp-form-input"
                    min="1" max="10"
                    value={formData.daily_kp_target}
                    onChange={e => setFormData(prev => ({ ...prev, daily_kp_target: parseInt(e.target.value) || 3 }))}
                  />
                </div>
              </div>
              <div style={{
                padding: '0.85rem', background: '#eef1ff', borderRadius: '6px',
                fontSize: '0.85rem', color: '#555'
              }}>
                💡 建议：每天 20 题 + 3 个新知识点，约需 1.5 小时。可根据个人时间调整。
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ textAlign: 'center', color: '#555' }}>
              <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎉</div>
              <p style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
                一切准备就绪！
              </p>
              <div style={{
                display: 'inline-block', textAlign: 'left',
                padding: '1rem 1.5rem', background: '#f9fafb',
                borderRadius: '6px', fontSize: '0.9rem'
              }}>
                <div>📅 考试日期：{formData.exam_date || '未设置'}</div>
                <div>🎯 每日题数：{formData.daily_target}</div>
                <div>📚 每日知识点：{formData.daily_kp_target}</div>
              </div>
              <div style={{ marginTop: '1rem', color: '#888', fontSize: '0.85rem' }}>
                点击下方按钮开始你的备考之旅
              </div>
            </div>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: '2rem', gap: '0.75rem'
          }}>
            {step > 0 ? (
              <button className="btn btn-secondary" onClick={handlePrev} disabled={submitting}>
                上一步
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={handleSkip}>
                跳过引导
              </button>
            )}

            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" onClick={handleNext}>
                下一步
              </button>
            ) : (
              <button className="btn btn-primary" onClick={handleFinish} disabled={submitting}>
                {submitting ? '创建中...' : '🚀 开始备考'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Onboarding;
export { ONBOARD_KEY };
