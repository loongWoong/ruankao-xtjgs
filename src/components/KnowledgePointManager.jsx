import React, { useState, useEffect } from 'react';

function KnowledgePointManager() {
  // 知识点数据
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');

  // 初始化知识点数据
  useEffect(() => {
    // 从后端API加载知识点数据
    fetch('http://localhost:5001/api/knowledge')
      .then(response => response.json())
      .then(data => {
        if (data.length > 0) {
          setKnowledgePoints(data);
        } else {
          // 初始化默认知识点数据
          const initialPoints = [
            {
              id: 1,
              title: '计算机网络基础',
              description: 'OSI七层模型、TCP/IP协议栈、网络设备等',
              status: 'not-learned',
              category: '计算机基础'
            },
            {
              id: 2,
              title: '操作系统原理',
              description: '进程管理、内存管理、文件系统等',
              status: 'not-learned',
              category: '计算机基础'
            },
            {
              id: 3,
              title: '数据结构与算法',
              description: '常见数据结构、排序算法、查找算法等',
              status: 'not-learned',
              category: '计算机基础'
            },
            {
              id: 4,
              title: '数据库系统',
              description: '关系型数据库、SQL、数据库设计等',
              status: 'not-learned',
              category: '计算机基础'
            },
            {
              id: 5,
              title: '软件工程',
              description: '软件生命周期、需求分析、设计、测试等',
              status: 'not-learned',
              category: '软件设计'
            },
            {
              id: 6,
              title: '系统架构设计',
              description: '架构风格、设计模式、架构评估等',
              status: 'not-learned',
              category: '软件设计'
            },
            {
              id: 7,
              title: '面向对象设计',
              description: 'UML、设计原则、设计模式等',
              status: 'not-learned',
              category: '软件设计'
            },
            {
              id: 8,
              title: '分布式系统',
              description: '分布式架构、一致性、容错等',
              status: 'not-learned',
              category: '系统架构'
            },
            {
              id: 9,
              title: '云计算',
              description: '云服务模型、云架构、容器技术等',
              status: 'not-learned',
              category: '系统架构'
            },
            {
              id: 10,
              title: '信息安全',
              description: '安全威胁、加密技术、安全策略等',
              status: 'not-learned',
              category: '安全'
            },
            {
              id: 11,
              title: '项目管理',
              description: '项目计划、风险管理、团队管理等',
              status: 'not-learned',
              category: '管理'
            },
            {
              id: 12,
              title: '需求工程',
              description: '需求获取、分析、验证等',
              status: 'not-learned',
              category: '管理'
            }
          ];
          setKnowledgePoints(initialPoints);
          // 保存到后端
          initialPoints.forEach(point => {
            fetch('http://localhost:5001/api/knowledge', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(point)
            });
          });
        }
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

  // 保存知识点数据到localStorage
  useEffect(() => {
    localStorage.setItem('knowledgePoints', JSON.stringify(knowledgePoints));
  }, [knowledgePoints]);

  // 更新知识点状态
  const updateKnowledgeStatus = (id, status) => {
    // 更新前端状态
    setKnowledgePoints(prevPoints => 
      prevPoints.map(point => 
        point.id === id ? { ...point, status } : point
      )
    );
    // 更新后端状态
    fetch(`http://localhost:5001/api/knowledge/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    })
    .catch(error => {
      console.error('Error updating knowledge status:', error);
    });
  };

  // 过滤知识点
  const filteredPoints = knowledgePoints.filter(point => {
    const matchesSearch = point.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         point.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filter === 'all' || point.status === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="knowledge-container">
      <div className="knowledge-header">
        <h2>知识点管理</h2>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input
            type="text"
            placeholder="搜索知识点..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="knowledge-search"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
          >
            <option value="all">全部</option>
            <option value="learned">已学会</option>
            <option value="not-learned">未学会</option>
          </select>
        </div>
      </div>
      
      <div className="knowledge-list">
        {filteredPoints.map(point => (
          <div key={point.id} className="knowledge-card">
            <h3>{point.title}</h3>
            <p>{point.description}</p>
            <p style={{ fontSize: '0.8rem', color: '#999', marginBottom: '1rem' }}>
              分类: {point.category}
            </p>
            <div className="knowledge-status">
              <button
                className={`status-btn ${point.status === 'learned' ? 'learned' : ''}`}
                onClick={() => updateKnowledgeStatus(point.id, 'learned')}
              >
                已学会
              </button>
              <button
                className={`status-btn ${point.status === 'not-learned' ? 'not-learned' : ''}`}
                onClick={() => updateKnowledgeStatus(point.id, 'not-learned')}
              >
                未学会
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default KnowledgePointManager;