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

export const analyzeError = (questionId) => {
  return fetchAPI(`/api/error-analysis/analyze/${questionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
};

export const batchAnalyzeErrors = () => {
  return fetchAPI('/api/error-analysis/batch-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
};

export const getErrorTags = () => {
  return fetchAPI('/api/error-analysis/tags');
};

export const getErrorDistribution = () => {
  return fetchAPI('/api/error-analysis/distribution');
};

export const getErrorTrend = (days = 30) => {
  return fetchAPI(`/api/error-analysis/trend?days=${days}`);
};

export const getErrorRecommendations = (limit = 5) => {
  return fetchAPI(`/api/error-analysis/recommendations?limit=${limit}`);
};

export const setQuestionTags = (questionId, tagIds) => {
  return fetchAPI(`/api/error-analysis/questions/${questionId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_ids: tagIds })
  });
};

export const getQuestionErrorDetail = (questionId) => {
  return fetchAPI(`/api/error-analysis/questions/${questionId}`);
};

export const createNote = (data) => {
  return fetchAPI('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getNotes = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/notes${queryString ? `?${queryString}` : ''}`);
};

export const getNote = (noteId) => {
  return fetchAPI(`/api/notes/${noteId}`);
};

export const updateNote = (noteId, data) => {
  return fetchAPI(`/api/notes/${noteId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const deleteNote = (noteId) => {
  return fetchAPI(`/api/notes/${noteId}`, {
    method: 'DELETE'
  });
};

export const addFavorite = (targetType, targetId) => {
  return fetchAPI('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_type: targetType, target_id: targetId })
  });
};

export const removeFavorite = (targetType, targetId) => {
  return fetchAPI(`/api/favorites/${targetType}/${targetId}`, {
    method: 'DELETE'
  });
};

export const getFavorites = (targetType) => {
  return fetchAPI(`/api/favorites?target_type=${targetType}`);
};

export const checkFavorite = (targetType, targetId) => {
  return fetchAPI(`/api/favorites/check/${targetType}/${targetId}`);
};

export const getFlashcards = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/flashcards${queryString ? `?${queryString}` : ''}`);
};

export const createFlashcard = (data) => {
  return fetchAPI('/api/flashcards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const updateFlashcard = (cardId, data) => {
  return fetchAPI(`/api/flashcards/${cardId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const deleteFlashcard = (cardId) => {
  return fetchAPI(`/api/flashcards/${cardId}`, {
    method: 'DELETE'
  });
};

export const reviewFlashcard = (cardId, quality) => {
  return fetchAPI(`/api/flashcards/${cardId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quality })
  });
};

export const getFlashcardStats = () => {
  return fetchAPI('/api/flashcards/stats');
};

// ==================== 论文训练 ====================

export const getEssayTopics = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/essay/topics${queryString ? `?${queryString}` : ''}`);
};

export const getEssayTopic = (topicId) => {
  return fetchAPI(`/api/essay/topics/${topicId}`);
};

export const submitEssay = (data) => {
  return fetchAPI('/api/essay/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getEssaySubmissions = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/essay/submissions${queryString ? `?${queryString}` : ''}`);
};

export const getEssaySubmission = (subId) => {
  return fetchAPI(`/api/essay/submissions/${subId}`);
};

export const updateEssaySubmission = (subId, data) => {
  return fetchAPI(`/api/essay/submissions/${subId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getEssayStats = () => {
  return fetchAPI('/api/essay/stats');
};

// ==================== 案例分析训练 ====================

export const getCaseQuestions = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/case/questions${queryString ? `?${queryString}` : ''}`);
};

export const getCaseQuestion = (caseId) => {
  return fetchAPI(`/api/case/questions/${caseId}`);
};

export const submitCase = (data) => {
  return fetchAPI('/api/case/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getCaseSubmissions = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/case/submissions${queryString ? `?${queryString}` : ''}`);
};

export const getCaseSubmission = (subId) => {
  return fetchAPI(`/api/case/submissions/${subId}`);
};

export const updateCaseSubmission = (subId, data) => {
  return fetchAPI(`/api/case/submissions/${subId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getCaseStats = () => {
  return fetchAPI('/api/case/stats');
};

// ==================== 教材学习 ====================

export const getTextbookChapters = () => {
  return fetchAPI('/api/textbook/chapters');
};

export const getTextbookChapter = (chapterId) => {
  return fetchAPI(`/api/textbook/chapters/${chapterId}`);
};

export const updateReadingProgress = (chapterId, data) => {
  return fetchAPI(`/api/textbook/chapters/${chapterId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getTextbookProgress = () => {
  return fetchAPI('/api/textbook/progress');
};

export const searchTextbook = (keyword, page = 1) => {
  return fetchAPI(`/api/textbook/search?q=${encodeURIComponent(keyword)}&page=${page}`);
};

// ==================== 真题题库与真实模考 ====================

export const getRealExamQuestions = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/real-exam/questions${queryString ? `?${queryString}` : ''}`);
};

export const startRealExam = (data) => {
  return fetchAPI('/api/real-exam/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getRealExamStats = () => {
  return fetchAPI('/api/real-exam/stats');
};

// ==================== 考纲覆盖度仪表盘 ====================

export const getSyllabusCoverage = () => {
  return fetchAPI('/api/syllabus/coverage');
};

// ==================== 学习激励（打卡+时长） ====================

export const checkin = (data) => {
  return fetchAPI('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getTodayCheckin = () => {
  return fetchAPI('/api/checkin/today');
};

export const getCheckinStreak = () => {
  return fetchAPI('/api/checkin/streak');
};

export const getCheckinCalendar = (month) => {
  return fetchAPI(`/api/checkin/calendar?month=${month}`);
};

export const recordStudySession = (data) => {
  return fetchAPI('/api/study-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getStudySessionStats = (days = 30) => {
  return fetchAPI(`/api/study-session/stats?days=${days}`);
};

// ==================== 自定义题目（手动录入/导入） ====================

export const createCustomQuestion = (data) => {
  return fetchAPI('/api/custom-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const getCustomQuestions = (params = {}) => {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return fetchAPI(`/api/custom-questions${queryString ? `?${queryString}` : ''}`);
};

export const getCustomQuestion = (qid) => {
  return fetchAPI(`/api/custom-questions/${qid}`);
};

export const updateCustomQuestion = (qid, data) => {
  return fetchAPI(`/api/custom-questions/${qid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
};

export const deleteCustomQuestion = (qid) => {
  return fetchAPI(`/api/custom-questions/${qid}`, {
    method: 'DELETE'
  });
};

export const importCustomQuestions = (questions) => {
  return fetchAPI('/api/custom-questions/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions })
  });
};

// ==================== 复习优先级队列 ====================

export const getReviewQueue = (limit = 20) => {
  return fetchAPI(`/api/review/queue?limit=${limit}`);
};

export const getReviewUpcoming = (days = 7) => {
  return fetchAPI(`/api/review/upcoming?days=${days}`);
};

// ==================== 能力雷达图 ====================

export const getAbilityRadar = () => {
  return fetchAPI('/api/stats/radar');
};
