import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'

// 导入组件
import KnowledgePointManager from './components/KnowledgePointManager.vue'
import StudyPlan from './components/StudyPlan.vue'
import PracticeQuestions from './components/PracticeQuestions.vue'
import ProgressTracking from './components/ProgressTracking.vue'

// 定义路由
const routes = [
  {
    path: '/',
    redirect: '/knowledge'
  },
  {
    path: '/knowledge',
    component: KnowledgePointManager
  },
  {
    path: '/plan',
    component: StudyPlan
  },
  {
    path: '/practice',
    component: PracticeQuestions
  },
  {
    path: '/progress',
    component: ProgressTracking
  }
]

// 创建路由实例
const router = createRouter({
  history: createWebHistory(),
  routes
})

// 创建并挂载应用
const app = createApp(App)
app.use(router)
app.mount('#app')