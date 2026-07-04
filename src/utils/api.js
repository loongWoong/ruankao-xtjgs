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
