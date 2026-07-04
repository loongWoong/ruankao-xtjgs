export const API_BASE = 'http://localhost:5002';

export const getUserId = () => {
  const stored = localStorage.getItem('ruankao_user_id');
  return stored || 'default_user';
};

export const fetchAPI = async (url, options = {}) => {
  const separator = url.includes('?') ? '&' : '?';
  const userId = getUserId();
  const fullUrl = `${API_BASE}${url}${separator}user_id=${encodeURIComponent(userId)}`;

  const response = await fetch(fullUrl, options);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

export const getStatsOverview = () => {
  return fetchAPI('/api/stats/overview');
};

export const getStatsCognition = () => {
  return fetchAPI('/api/stats/cognition');
};

export const getStatsDaily = (days = 7) => {
  return fetchAPI(`/api/stats/daily?days=${days}`);
};

export const getStatsCategory = () => {
  return fetchAPI('/api/stats/category');
};

export const getStatsChapter = () => {
  return fetchAPI('/api/stats/chapter');
};

export const getStatsWeakPoints = () => {
  return fetchAPI('/api/stats/weak-points');
};

export const getRepracticeConversion = (days = 7, hours = 72) => {
  return fetchAPI(`/api/metrics/repractice-conversion?days=${days}&hours=${hours}`);
};

export const getWrongQuestions = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/wrong-questions${queryString ? `?${queryString}` : ''}`);
};

export const deleteWrongQuestion = (id) => {
  return fetchAPI(`/api/wrong-questions/${id}`, {
    method: 'DELETE'
  });
};

export const updateWrongQuestion = (id, data) => {
  return fetchAPI(`/api/wrong-questions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const batchDelete = (ids) => {
  return fetchAPI('/api/wrong-questions/batch/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
};

export const batchMaster = (ids, isMastered) => {
  return fetchAPI('/api/wrong-questions/batch/master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, is_mastered: isMastered ? 1 : 0 })
  });
};

export const getPracticeRandom = (limit = 10) => {
  return fetchAPI(`/api/practice/random?limit=${limit}`);
};

export const getPracticeToday = (limit = 10) => {
  return fetchAPI(`/api/practice/today?limit=${limit}`);
};

export const getPracticeRecommend = () => {
  return fetchAPI('/api/practice/recommend');
};

export const submitPractice = (data) => {
  return fetchAPI('/api/practice/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const submitReflection = (data) => {
  return fetchAPI('/api/practice/reflection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getErrorPatterns = () => {
  return fetchAPI('/api/error-patterns');
};

export const getKnowledgeTree = () => {
  return fetchAPI('/api/knowledge/tree');
};

export const getKnowledgePoint = (kpId) => {
  return fetchAPI(`/api/knowledge/${kpId}`);
};

export const getWeakestKnowledge = (limit = 10) => {
  return fetchAPI(`/api/knowledge/weakest?limit=${limit}`);
};

export const getKnowledgeProgress = () => {
  return fetchAPI('/api/knowledge/progress');
};

export const getFeatureFlags = () => {
  return fetchAPI('/api/feature-flags');
};

export const getWrongQuestionsAnalysis = () => {
  return fetchAPI('/api/wrong-questions/analysis');
};

export const getExportUrl = (format) => {
  const userId = getUserId();
  return `${API_BASE}/api/wrong-questions/export/${format}?user_id=${encodeURIComponent(userId)}`;
};

export const getStudyPlan = () => {
  return fetchAPI('/api/study-plan');
};

export const createStudyPlan = (data) => {
  return fetchAPI('/api/study-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getTodayTasks = () => {
  return fetchAPI('/api/study-plan/today');
};

export const completeTask = (taskId, count) => {
  const body = count !== undefined ? { completed_count: count } : {};
  return fetchAPI(`/api/study-plan/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
};

export const getStudyPlanOverview = () => {
  return fetchAPI('/api/study-plan/overview');
};

export const regeneratePlan = () => {
  return fetchAPI('/api/study-plan/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
};

export const createMockExam = (data) => {
  return fetchAPI('/api/mock-exam/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getMockExam = (examId) => {
  return fetchAPI(`/api/mock-exam/${examId}`);
};

export const startMockExam = (examId) => {
  return fetchAPI(`/api/mock-exam/${examId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
};

export const answerMockExam = (examId, questionIndex, userAnswer) => {
  return fetchAPI(`/api/mock-exam/${examId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_index: questionIndex, user_answer: userAnswer })
  });
};

export const submitMockExam = (examId) => {
  return fetchAPI(`/api/mock-exam/${examId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
};

export const getMockExamResult = (examId) => {
  return fetchAPI(`/api/mock-exam/${examId}/result`);
};

export const getMockExamList = (page = 1, pageSize = 10) => {
  return fetchAPI(`/api/mock-exam/list?page=${page}&page_size=${pageSize}`);
};

export const getMockExamStats = () => {
  return fetchAPI('/api/mock-exam/stats');
};
