import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

import Dashboard from './components/Dashboard.jsx'
import KnowledgeGraph from './components/KnowledgeGraph.jsx'
import QuestionBank from './components/QuestionBank.jsx'
import Practice from './components/Practice.jsx'
import Statistics from './components/Statistics.jsx'
import StudyPlan from './components/StudyPlan.jsx'
import MockExam from './components/MockExam.jsx'
import ErrorAnalysis from './components/ErrorAnalysis.jsx'
import EssayTraining from './components/EssayTraining.jsx'
import CaseAnalysis from './components/CaseAnalysis.jsx'
import Textbook from './components/Textbook.jsx'
import RealExam from './components/RealExam.jsx'
import SyllabusCoverage from './components/SyllabusCoverage.jsx'
import StudyCheckin from './components/StudyCheckin.jsx'
import CustomQuestions from './components/CustomQuestions.jsx'
import ReviewQueue from './components/ReviewQueue.jsx'
import AbilityRadar from './components/AbilityRadar.jsx'
import ErrorDiagnosis from './components/ErrorDiagnosis.jsx'
import LearningPath from './components/LearningPath.jsx'
import LearningReport from './components/LearningReport.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <App>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/knowledge" element={<KnowledgeGraph />} />
          <Route path="/questions" element={<QuestionBank />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/statistics" element={<Statistics />} />
          <Route path="/plan" element={<StudyPlan />} />
          <Route path="/exam" element={<MockExam />} />
          <Route path="/analysis" element={<ErrorAnalysis />} />
          <Route path="/essay" element={<EssayTraining />} />
          <Route path="/case" element={<CaseAnalysis />} />
          <Route path="/textbook" element={<Textbook />} />
          <Route path="/real-exam" element={<RealExam />} />
          <Route path="/syllabus" element={<SyllabusCoverage />} />
          <Route path="/checkin" element={<StudyCheckin />} />
          <Route path="/custom-questions" element={<CustomQuestions />} />
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/radar" element={<AbilityRadar />} />
          <Route path="/diagnosis" element={<ErrorDiagnosis />} />
          <Route path="/learning-path" element={<LearningPath />} />
          <Route path="/report" element={<LearningReport />} />
        </Routes>
      </App>
    </Router>
  </React.StrictMode>,
)