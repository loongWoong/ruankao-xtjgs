import React, { useState, useEffect } from 'react';

function StudyPlan() {
  // 学习计划数据
  const [studyPlan, setStudyPlan] = useState([]);
  const [knowledgePoints, setKnowledgePoints] = useState([]);

  // 初始化知识点数据
  useEffect(() => {
    // 从后端API加载知识点数据
    fetch('http://localhost:5001/api/knowledge')
      .then(response => response.json())
      .then(data => {
        setKnowledgePoints(data);
      })
      .catch(error => {
        console.error('Error loading knowledge points:', error);
        // 从localStorage加载作为备选
        const savedPoints = localStorage.getItem('knowledgePoints');
        if (savedPoints) {
          setKnowledgePoints(JSON.parse(savedPoints));
        }
      });
  }, []);

  // 加载学习计划
  useEffect(() => {
    // 从后端API加载学习计划
    fetch('http://localhost:5001/api/plan')
      .then(response => response.json())
      .then(data => {
        if (data.length > 0) {
          setStudyPlan(data);
        } else if (knowledgePoints.length > 0) {
          generateStudyPlan();
        }
      })
      .catch(error => {
        console.error('Error loading study plan:', error);
        if (knowledgePoints.length > 0) {
          generateStudyPlan();
        }
      });
  }, [knowledgePoints]);

  // 生成一个月的学习计划
  const generateStudyPlan = () => {
    // 过滤未学会的知识点
    const notLearnedPoints = knowledgePoints.filter(point => point.status === 'not-learned');
    
    // 按分类分组
    const pointsByCategory = notLearnedPoints.reduce((acc, point) => {
      if (!acc[point.category]) {
        acc[point.category] = [];
      }
      acc[point.category].push(point);
      return acc;
    }, {});

    // 生成30天的学习计划
    const plan = [];
    const categories = Object.keys(pointsByCategory);
    const categoryIndex = {};
    
    // 初始化每个分类的索引
    categories.forEach(category => {
      categoryIndex[category] = 0;
    });

    // 为每天分配学习任务
    for (let i = 1; i <= 30; i++) {
      const dayTasks = [];
      
      // 从每个分类中分配一个知识点
      categories.forEach(category => {
        const points = pointsByCategory[category];
        if (categoryIndex[category] < points.length) {
          dayTasks.push(points[categoryIndex[category]]);
          categoryIndex[category]++;
        }
      });

      // 如果当天没有任务，从已分配的任务中重复分配
      if (dayTasks.length === 0) {
        // 从所有未学会的知识点中随机选择
        if (notLearnedPoints.length > 0) {
          const randomIndex = Math.floor(Math.random() * notLearnedPoints.length);
          dayTasks.push(notLearnedPoints[randomIndex]);
        }
      }

      const dayPlan = {
        day: i,
        date: new Date(Date.now() + (i - 1) * 24 * 60 * 60 * 1000).toLocaleDateString('zh-CN'),
        tasks: dayTasks
      };

      plan.push(dayPlan);

      // 保存到后端
      fetch('http://localhost:5001/api/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dayPlan)
      })
      .catch(error => {
        console.error('Error saving study plan:', error);
      });
    }

    setStudyPlan(plan);
  };

  // 标记任务完成
  const toggleTaskComplete = (dayIndex, taskId) => {
    setStudyPlan(prevPlan => {
      const updatedPlan = [...prevPlan];
      const day = updatedPlan[dayIndex];
      
      // 更新任务状态
      day.tasks = day.tasks.map(task => 
        task.id === taskId ? { ...task, completed: !task.completed } : task
      );
      
      return updatedPlan;
    });
  };

  return (
    <div className="plan-container">
      <div className="plan-header">
        <h2>学习计划</h2>
        <button
          onClick={generateStudyPlan}
          style={{ padding: '0.5rem 1rem', borderRadius: '4px', background: '#646cff', color: 'white', border: 'none', cursor: 'pointer' }}
        >
          重新生成计划
        </button>
      </div>
      
      <div className="plan-days">
        {studyPlan.map((day, index) => (
          <div key={day.day} className="plan-day">
            <h3>第 {day.day} 天 ({day.date})</h3>
            <ul className="plan-tasks">
              {day.tasks.map(task => (
                <li key={task.id} className="plan-task">
                  <input
                    type="checkbox"
                    checked={task.completed || false}
                    onChange={() => toggleTaskComplete(index, task.id)}
                  />
                  <span style={{ textDecoration: task.completed ? 'line-through' : 'none' }}>
                    {task.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StudyPlan;