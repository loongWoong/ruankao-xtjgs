from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import sqlite3
import json
import os
import hashlib
import csv
import io
import re
import html
import random
from datetime import datetime, timedelta
from contextlib import contextmanager
from functools import wraps
from collections import defaultdict

app = Flask(__name__)

ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'chrome-extension://'
]

CORS(app, resources={
    r"/api/*": {
        "origins": ALLOWED_ORIGINS,
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'ruankao.db')
REFLECTION_ROLLOUT_PERCENT = 10

MAX_PAGE_LIMIT = 100
DEFAULT_PAGE_LIMIT = 20
MAX_SEARCH_LENGTH = 200
MAX_BATCH_SIZE = 500
MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024

RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX_REQUESTS = 120

_rate_limit_store = defaultdict(list)

def rate_limit(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        client_ip = request.remote_addr or 'unknown'
        now = datetime.now()
        window_start = now - timedelta(seconds=RATE_LIMIT_WINDOW)
        
        _rate_limit_store[client_ip] = [
            t for t in _rate_limit_store[client_ip] if t > window_start
        ]
        
        if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_MAX_REQUESTS:
            return jsonify({'error': 'Too many requests, please try again later'}), 429
        
        _rate_limit_store[client_ip].append(now)
        return func(*args, **kwargs)
    return wrapper

def sanitize_string(value, max_length=5000):
    if not isinstance(value, str):
        return ''
    value = value.strip()
    if len(value) > max_length:
        value = value[:max_length]
    value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)
    return value

def sanitize_search_query(query):
    query = sanitize_string(query, MAX_SEARCH_LENGTH)
    query = query.replace('%', r'\%').replace('_', r'\_')
    return query

@contextmanager
def get_db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def api_response(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        except KeyError as e:
            return jsonify({'error': f'Missing required field: {e}'}), 400
        except Exception as e:
            app.logger.exception(f'API error in {func.__name__}')
            return jsonify({'error': 'Internal server error'}), 500
    return wrapper

def get_pagination_params():
    page = max(1, request.args.get('page', 1, type=int))
    limit = min(MAX_PAGE_LIMIT, max(1, request.args.get('limit', DEFAULT_PAGE_LIMIT, type=int)))
    return page, limit

def get_user_id():
    return request.args.get('user_id', 'default_user') or 'default_user'

def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def ensure_schema():
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS wrong_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id TEXT,
                question TEXT,
                options TEXT,
                user_answer TEXT,
                correct_answer TEXT,
                analysis TEXT,
                category TEXT,
                chapter TEXT,
                source_url TEXT,
                is_mastered INTEGER DEFAULT 0,
                review_count INTEGER DEFAULT 0,
                last_review_time DATETIME,
                correct_count INTEGER DEFAULT 0,
                wrong_count INTEGER DEFAULT 0,
                srs_stage INTEGER DEFAULT 0,
                next_review_time DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                user_id TEXT DEFAULT 'default_user'
            )
        ''')

        columns_to_add = [
            ('srs_stage', 'INTEGER DEFAULT 0'),
            ('next_review_time', 'DATETIME')
        ]
        for col_name, col_def in columns_to_add:
            cursor.execute("PRAGMA table_info(wrong_questions)")
            existing = {row["name"] for row in cursor.fetchall()}
            if col_name not in existing:
                cursor.execute(f"ALTER TABLE wrong_questions ADD COLUMN {col_name} {col_def}")

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS knowledge_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT,
                chapter TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        kp_columns_to_add = [
            ('parent_id', 'INTEGER'),
            ('level', 'INTEGER DEFAULT 1'),
            ('sort_order', 'INTEGER DEFAULT 0'),
            ('exam_weight', 'REAL DEFAULT 0'),
            ('difficulty', 'REAL DEFAULT 0.5'),
            ('is_active', 'INTEGER DEFAULT 1')
        ]
        cursor.execute("PRAGMA table_info(knowledge_points)")
        existing_kp_columns = {row["name"] for row in cursor.fetchall()}
        for col_name, col_def in kp_columns_to_add:
            if col_name not in existing_kp_columns:
                cursor.execute(f"ALTER TABLE knowledge_points ADD COLUMN {col_name} {col_def}")

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_kp_parent_id ON knowledge_points(parent_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_kp_level ON knowledge_points(level)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_kp_category_level ON knowledge_points(category, level)')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_cognition (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kp_id INTEGER NOT NULL,
                user_id TEXT DEFAULT 'default_user',
                mastery_score REAL DEFAULT 0.5,
                stability REAL DEFAULT 1.0,
                last_visit DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(kp_id, user_id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS question_mapping (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id INTEGER NOT NULL,
                kp_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS error_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS practice_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                question_id INTEGER NOT NULL,
                selected_answer TEXT,
                is_correct INTEGER NOT NULL,
                error_pattern_id INTEGER,
                time_spent INTEGER DEFAULT 0,
                first_wrong_at TEXT,
                completed INTEGER NOT NULL DEFAULT 0,
                attempted_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS practice_reflections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                attempt_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                question_id INTEGER NOT NULL,
                error_pattern_id INTEGER NOT NULL,
                reflected_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_practice_attempts_user_question_time ON practice_attempts(user_id, question_id, attempted_at)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_practice_reflections_attempt ON practice_reflections(attempt_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_kp_name ON knowledge_points(name)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_user_cognition_kp ON user_cognition(kp_id, user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_question_mapping_q ON question_mapping(question_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_question_mapping_kp ON question_mapping(kp_id)')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_wq_user_id ON wrong_questions(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_wq_user_mastered ON wrong_questions(user_id, is_mastered)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_wq_user_category ON wrong_questions(user_id, category)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_wq_user_chapter ON wrong_questions(user_id, chapter)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_wq_user_created ON wrong_questions(user_id, created_at DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_wq_user_srs ON wrong_questions(user_id, is_mastered, next_review_time)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_wq_user_srs_stage ON wrong_questions(user_id, srs_stage)')

        default_patterns = [
            ('概念理解错误', '对基本概念、定义理解不准确'),
            ('计算错误', '计算过程中出现失误'),
            ('审题不清', '没有正确理解题目要求'),
            ('知识遗忘', '相关知识点记忆模糊'),
            ('方法不当', '解题思路或方法选择错误'),
            ('粗心大意', '因疏忽导致的低级错误'),
            ('逻辑错误', '推理过程存在逻辑漏洞')
        ]
        for name, desc in default_patterns:
            cursor.execute('INSERT OR IGNORE INTO error_patterns (pattern_name, description) VALUES (?, ?)', (name, desc))

        _seed_knowledge_outline(cursor)
        _migrate_legacy_knowledge_points(cursor)

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS study_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                exam_date DATE,
                daily_target INTEGER DEFAULT 20,
                daily_kp_target INTEGER DEFAULT 3,
                start_date DATE DEFAULT CURRENT_DATE,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS daily_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                task_date DATE NOT NULL,
                task_type TEXT NOT NULL,
                kp_id INTEGER,
                question_count INTEGER DEFAULT 5,
                completed_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_study_plans_user ON study_plans(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date ON daily_tasks(user_id, task_date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_daily_tasks_plan ON daily_tasks(plan_id)')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS mock_exams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                exam_type TEXT DEFAULT 'custom',
                total_questions INTEGER NOT NULL,
                duration_minutes INTEGER DEFAULT 150,
                score REAL,
                correct_count INTEGER DEFAULT 0,
                wrong_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft',
                started_at DATETIME,
                submitted_at DATETIME,
                time_spent INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS mock_exam_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exam_id INTEGER NOT NULL,
                question_id INTEGER NOT NULL,
                question_text TEXT NOT NULL,
                question_type TEXT,
                options TEXT,
                correct_answer TEXT,
                user_answer TEXT,
                is_correct INTEGER,
                order_index INTEGER NOT NULL,
                kp_id INTEGER,
                explanation TEXT
            )
        ''')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_mock_exams_user ON mock_exams(user_id, created_at)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_mock_exam_questions_exam ON mock_exam_questions(exam_id, order_index)')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS error_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS question_error_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                confidence REAL DEFAULT 1.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(question_id, tag_id)
            )
        ''')

        wq_columns_to_add = [
            ('error_count', 'INTEGER DEFAULT 1'),
            ('last_error_at', 'DATETIME'),
            ('difficulty_estimate', 'REAL DEFAULT 0.5')
        ]
        cursor.execute("PRAGMA table_info(wrong_questions)")
        existing_wq_columns = {row["name"] for row in cursor.fetchall()}
        for col_name, col_def in wq_columns_to_add:
            if col_name not in existing_wq_columns:
                try:
                    cursor.execute(f"ALTER TABLE wrong_questions ADD COLUMN {col_name} {col_def}")
                except Exception:
                    pass

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_error_tags_category ON error_tags(category)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_qet_question ON question_error_tags(question_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_qet_tag ON question_error_tags(tag_id)')

        _init_error_tags(cursor)

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                question_id INTEGER,
                kp_id INTEGER,
                title TEXT,
                content TEXT NOT NULL,
                note_type TEXT DEFAULT 'general',
                tags TEXT,
                is_favorite INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, target_type, target_id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS flashcards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                kp_id INTEGER,
                front TEXT NOT NULL,
                back TEXT NOT NULL,
                difficulty INTEGER DEFAULT 3,
                srs_stage INTEGER DEFAULT 0,
                next_review_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_reviewed_at DATETIME,
                review_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, updated_at)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_notes_question ON notes(question_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_notes_kp ON notes(kp_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, target_type)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_flashcards_user ON flashcards(user_id, next_review_at)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_flashcards_kp ON flashcards(kp_id)')

        _init_default_flashcards(cursor)

        # 论文训练模块
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS essay_topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER,
                topic_title TEXT NOT NULL,
                topic_category TEXT,
                background TEXT,
                requirements TEXT,
                key_points TEXT,
                reference_essay TEXT,
                source TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS essay_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                topic_id INTEGER NOT NULL,
                title TEXT,
                content TEXT,
                word_count INTEGER DEFAULT 0,
                time_spent INTEGER DEFAULT 0,
                self_score INTEGER,
                self_evaluation TEXT,
                status TEXT DEFAULT 'draft',
                submitted_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_essay_topics_year ON essay_topics(year)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_essay_topics_category ON essay_topics(topic_category)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_essay_submissions_user ON essay_submissions(user_id, created_at DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_essay_submissions_topic ON essay_submissions(topic_id)')

        # 案例分析训练模块
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS case_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER,
                case_title TEXT NOT NULL,
                background TEXT,
                questions TEXT,
                reference_answer TEXT,
                key_points TEXT,
                category TEXT,
                source TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS case_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                case_id INTEGER NOT NULL,
                answers TEXT,
                self_score INTEGER,
                time_spent INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft',
                submitted_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_case_questions_year ON case_questions(year)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_case_questions_category ON case_questions(category)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_case_submissions_user ON case_submissions(user_id, created_at DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_case_submissions_case ON case_submissions(case_id)')

        # 教材知识学习模块
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS textbook_chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chapter_num TEXT,
                title TEXT NOT NULL,
                content TEXT,
                summary TEXT,
                word_count INTEGER DEFAULT 0,
                parent_id INTEGER,
                level INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS reading_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                chapter_id INTEGER NOT NULL,
                status TEXT DEFAULT 'unread',
                read_time INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, chapter_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_textbook_chapters_parent ON textbook_chapters(parent_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_textbook_chapters_level ON textbook_chapters(level, sort_order)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress(user_id, chapter_id)')

        _seed_essay_topics(cursor)
        _seed_case_questions(cursor)

        # 真题题库模块
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS real_exam_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER,
                question_text TEXT NOT NULL,
                options TEXT,
                correct_answer TEXT NOT NULL,
                explanation TEXT,
                category TEXT,
                kp_id INTEGER,
                source TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_real_exam_year ON real_exam_questions(year)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_real_exam_category ON real_exam_questions(category)')
        _seed_real_exam_questions(cursor)

        # 学习打卡（每日一次）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS study_checkins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                checkin_date DATE NOT NULL,
                study_minutes INTEGER DEFAULT 0,
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, checkin_date)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_checkin_user_date ON study_checkins(user_id, checkin_date)')

        # 学习会话（计时模块）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS study_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                module TEXT,
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                duration_minutes INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_session_user_start ON study_sessions(user_id, start_time)')

        # 自定义题目（手动录入/导入）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS custom_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                question_text TEXT NOT NULL,
                question_type TEXT DEFAULT 'single_choice',
                options TEXT,
                correct_answer TEXT NOT NULL,
                explanation TEXT,
                category TEXT,
                kp_id INTEGER,
                source TEXT DEFAULT 'manual',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_custom_q_user ON custom_questions(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_custom_q_category ON custom_questions(category)')

        conn.commit()

def _init_error_tags(cursor):
    error_tags = [
        ('概念混淆', 'concept', '对相似概念产生混淆，区分不清'),
        ('定义不清', 'concept', '对基本定义、概念理解不清晰'),
        ('原理误解', 'concept', '对基本原理、机制理解有误'),
        ('分类混淆', 'concept', '对分类、归类产生混淆'),
        ('适用场景错误', 'concept', '对技术或方法的适用场景判断错误'),
        ('公式记错', 'memory', '公式、定理记忆错误'),
        ('数值记混', 'memory', '数值、参数记忆混淆'),
        ('术语遗忘', 'memory', '专业术语、名称记忆不牢'),
        ('步骤遗漏', 'memory', '解题步骤或流程遗漏'),
        ('计算错误', 'calculation', '数值计算过程出错'),
        ('单位换算错', 'calculation', '单位换算或转换错误'),
        ('公式套用错', 'calculation', '公式选择或套用错误'),
        ('漏看条件', 'reading', '审题时遗漏题目给出的条件'),
        ('理解偏差', 'reading', '对题目意思理解有偏差'),
        ('选非题看错', 'reading', '选非题（不正确的是）看错要求'),
        ('推理错误', 'logic', '推理过程存在逻辑错误'),
        ('因果倒置', 'logic', '原因和结果关系颠倒'),
        ('以偏概全', 'logic', '用片面的情况概括整体')
    ]
    for name, category, description in error_tags:
        cursor.execute('''
            INSERT OR IGNORE INTO error_tags (name, category, description)
            VALUES (?, ?, ?)
        ''', (name, category, description))

def calculate_next_review(srs_stage, quality):
    max_stage = 10
    if quality < 3:
        new_stage = 0
        days = 1
    elif quality == 3:
        new_stage = srs_stage
        days = max(1, srs_stage * 2)
    elif quality == 4:
        new_stage = min(srs_stage + 1, max_stage)
        days = srs_stage * 3 if srs_stage > 0 else 1
    elif quality == 5:
        new_stage = min(srs_stage + 2, max_stage)
        days = srs_stage * 5 if srs_stage > 0 else 1
    else:
        new_stage = srs_stage
        days = 1
    return new_stage, days

def _init_default_flashcards(cursor):
    cursor.execute('SELECT COUNT(*) FROM flashcards WHERE user_id = ?', ('system_default',))
    count = cursor.fetchone()[0]
    if count > 0:
        return

    default_cards = [
        (13, 'Cache的作用是什么？', 'Cache（高速缓冲存储器）的主要作用是提高CPU访问存储器的速度。它利用程序访问的局部性原理（时间局部性和空间局部性），将主存中CPU近期可能访问的数据复制到Cache中，使CPU可以直接从Cache快速读取数据，从而减少访问主存的时间开销。', 3),
        (12, '简述存储器层次结构', '存储器层次结构从上到下依次为：寄存器→Cache→主存→辅存。每层的特点：速度越来越慢，容量越来越大，单位成本越来越低。设计目标是在成本、容量和速度之间取得平衡，使整个存储系统的速度接近最快层，容量接近最大层。', 3),
        (14, '虚拟存储器的工作原理是什么？', '虚拟存储器由主存和辅存构成，通过虚拟地址空间使用户感觉有一个很大的主存。其工作原理基于程序的局部性原理：程序运行时只将当前需要的部分装入主存，其余部分暂存于辅存。当需要访问不在主存的内容时，由操作系统自动将其从辅存调入主存。', 3),
        (18, '总线系统的分类和作用', '总线是计算机各部件之间传输信息的公共通路。按传输内容分为：数据总线（传输数据）、地址总线（传输地址）、控制总线（传输控制信号）。按连接对象分为：内部总线、系统总线、I/O总线。总线性能指标包括：总线宽度、总线频率、带宽。', 2),
        (21, '进程和线程的区别是什么？', '进程是资源分配的基本单位，线程是CPU调度的基本单位。主要区别：1) 进程有独立的地址空间，同一进程内的线程共享进程的地址空间；2) 进程切换开销大，线程切换开销小；3) 进程间通信复杂，线程间通信简单；4) 一个进程可以包含多个线程。', 2),
        (22, 'PV操作的作用和基本原理', 'PV操作是一种信号量机制，用于解决进程间的同步与互斥问题。P操作（wait）：信号量减1，若结果小于0则进程阻塞；V操作（signal）：信号量加1，若结果小于等于0则唤醒一个阻塞进程。信号量S>0表示可用资源数，S<0表示等待进程数。', 4),
        (23, '常见的进程调度算法有哪些？', '常见进程调度算法：1) 先来先服务（FCFS）：按到达顺序调度；2) 短作业优先（SJF）：优先调度短作业；3) 优先级调度：按优先级高低调度；4) 时间片轮转（RR）：每个进程轮流执行一个时间片；5) 多级反馈队列：综合多种算法的优点。', 2),
        (24, '死锁的四个必要条件是什么？', '死锁的四个必要条件：1) 互斥条件：资源只能被一个进程占有；2) 不可剥夺条件：资源不能被强行剥夺；3) 请求和保持条件（部分分配）：进程占有资源的同时又请求新资源；4) 循环等待条件：进程间形成循环等待链。四个条件同时满足时才会发生死锁。', 3),
        (27, '分页存储管理的基本原理', '分页存储管理将主存划分为大小相等的物理块，将进程的逻辑地址空间划分为与物理块大小相等的页。程序运行时，通过页表实现逻辑页号到物理块号的地址映射。页表记录了每个逻辑页对应的物理块号，用于实现逻辑地址到物理地址的转换。', 3),
        (30, '文件的逻辑结构和物理结构', '文件的逻辑结构：从用户角度看文件的组织形式，分为有结构文件（记录式文件）和无结构文件（流式文件）。文件的物理结构：文件在外存上的存储组织方式，包括：连续结构、链接结构、索引结构、多重索引结构。', 2),
        (35, '数据库三级模式两级映射是什么？', '三级模式：1) 外模式（用户模式）：用户看到的数据视图；2) 模式（概念模式）：数据库中全体数据的逻辑结构；3) 内模式（存储模式）：数据的物理存储结构。两级映射：1) 外模式/模式映射：保证数据的逻辑独立性；2) 模式/内模式映射：保证数据的物理独立性。', 3),
        (38, '关系模型的基本概念', '关系模型用二维表（关系）来表示实体及实体间的联系。基本概念：关系（二维表）、元组（行）、属性（列）、域（属性的取值范围）、主键（唯一标识元组）、外键（引用另一个表的主键）。关系的特点：列同质、列序无关、行序无关、元组唯一。', 2),
        (43, '数据库范式理论要点', '第一范式（1NF）：属性不可再分；第二范式（2NF）：在1NF基础上，消除非主属性对码的部分函数依赖；第三范式（3NF）：在2NF基础上，消除非主属性对码的传递函数依赖；BC范式（BCNF）：在3NF基础上，消除主属性对码的部分和传递函数依赖。', 4),
        (39, '关系代数的基本运算有哪些？', '关系代数的基本运算包括：选择（σ）：从关系中选择满足条件的元组；投影（π）：从关系中选择若干属性列；并（∪）：两个关系的元组合并；差（-）：从一个关系中去掉另一个关系的元组；笛卡尔积（×）：两个关系的元组组合。其他运算如交、连接、除等可由基本运算导出。', 3),
        (42, 'ER模型的基本概念', 'ER模型（实体-联系模型）是数据库概念设计的工具。基本概念：实体（客观存在并可相互区分的事物）、属性（实体的特征）、联系（实体间的关系）。实体间的联系类型：一对一（1:1）、一对多（1:n）、多对多（m:n）。ER图用矩形表示实体，椭圆表示属性，菱形表示联系。', 2),
        (47, 'OSI七层模型各层的功能', 'OSI七层模型从下到上：1) 物理层：传输比特流；2) 数据链路层：帧传输、差错控制、流量控制；3) 网络层：路由选择、拥塞控制、网际互连；4) 传输层：端到端通信、可靠传输；5) 会话层：会话管理、同步；6) 表示层：数据格式转换、加密解密、压缩解压；7) 应用层：为应用程序提供网络服务。', 3),
        (48, 'TCP/IP协议栈的层次结构', 'TCP/IP协议栈分为四层：1) 网络接口层（链路层）：对应OSI的物理层和数据链路层；2) 网际层（网络层）：主要协议有IP、ICMP、ARP等；3) 传输层：主要协议有TCP（可靠面向连接）和UDP（不可靠无连接）；4) 应用层：对应OSI的会话层、表示层、应用层，主要协议有HTTP、FTP、SMTP、DNS等。', 3),
        (52, '网络层的主要功能和协议', '网络层的主要功能：路由选择（选择合适的传输路径）、拥塞控制（防止网络过载）、网际互连（不同网络之间的连接）。主要协议：IP协议（网际协议，提供不可靠的数据报服务）、ICMP（互联网控制报文协议）、ARP（地址解析协议，IP转MAC）、RARP（反向地址解析）。', 3),
        (53, 'TCP和UDP的区别', 'TCP（传输控制协议）：面向连接、可靠传输、流量控制、拥塞控制、首部开销大（20字节以上）、适合对可靠性要求高的场景。UDP（用户数据报协议）：无连接、不可靠、首部开销小（8字节）、速度快、适合实时应用（视频、语音、直播等）。', 2),
        (56, '常见的加密技术有哪些？', '加密技术分为对称加密和非对称加密。对称加密：加密和解密使用同一密钥，速度快，密钥分发困难。常见算法：DES、3DES、AES、RC4。非对称加密：使用公钥和私钥一对密钥，公钥加密私钥解密，或私钥签名公钥验证。安全性高，速度慢。常见算法：RSA、ECC、DSA。', 3),
        (62, '常见的软件架构风格有哪些？', '常见的软件架构风格：1) 数据流风格：管道-过滤器、批处理；2) 调用返回风格：主程序-子程序、面向对象、层次结构；3) 独立构件风格：进程通信、事件驱动系统；4) 虚拟机风格：解释器、规则系统；5) 仓库风格：数据库系统、超文本系统、黑板系统。', 3),
        (65, '软件质量属性——性能', '性能是指系统的响应能力，包括响应时间（请求到响应的时间）、吞吐量（单位时间处理的请求数）、资源利用率（CPU、内存等的使用情况）。性能设计策略：优先级队列、资源池、缓存、并行计算、负载均衡、异步通信、数据分片、算法优化。', 2),
        (66, '软件质量属性——可用性', '可用性是系统正常运行时间所占的比例，通常用百分比表示（如99.9%）。衡量指标：平均故障间隔时间（MTBF）、平均修复时间（MTTR）。可用性 = MTBF / (MTBF + MTTR)。提高可用性的策略：错误检测（心跳、ping）、错误恢复（冗余、重试、回滚）、错误预防（进程监控、心跳检测）。', 3),
        (67, '软件质量属性——安全性', '安全性是指系统在遭受恶意攻击时仍能正常运行的能力。包括：机密性（信息不被未授权访问）、完整性（信息不被篡改）、可用性（服务不被中断）、不可否认性（操作不可抵赖）。安全性策略：身份认证、访问控制、加密、数字签名、防火墙、入侵检测、安全审计。', 3),
        (68, '软件质量属性——可修改性', '可修改性是指系统能够快速地以较高的性能价格比对系统进行变更的能力。包括：可维护性（修复缺陷）、可扩展性（添加新功能）、可移植性（迁移到不同环境）、可重组性（改变组件组合）。提高可修改性的策略：模块化、抽象、信息隐藏、高内聚低耦合、设计模式、接口与实现分离。', 3),
        (70, 'ATAM架构评估方法', 'ATAM（架构权衡分析方法）是一种质量属性导向的架构评估方法。步骤：1) 描述业务需求和质量属性；2) 描述架构；3) 识别架构策略和模式；4) 通过质量属性效用树确定优先级；5) 分析架构方法对质量属性的影响；6) 识别风险点、敏感点、权衡点；7) 形成评估报告。', 4),
        (76, '敏捷开发的核心价值观和原则', '敏捷开发的核心价值观（敏捷宣言）：1) 个体和交互 胜过 过程和工具；2) 可工作的软件 胜过 详尽的文档；3) 客户合作 胜过 合同谈判；4) 响应变化 胜过 遵循计划。12条原则包括：尽早持续交付、欢迎需求变化、频繁交付、业务人员与开发者共同工作、激励个体、面对面沟通、可工作软件是首要进度度量等。', 3),
        (74, '瀑布模型的特点', '瀑布模型是经典的软件开发生命周期模型，将开发过程分为：需求分析、概要设计、详细设计、编码、测试、维护六个阶段，各阶段按顺序进行，前一阶段的输出是后一阶段的输入。特点：线性顺序、文档驱动、每个阶段结束有评审。适用于需求明确、稳定的项目。缺点：不适应需求变化、后期才能看到结果。', 2),
        (78, '需求工程的主要活动', '需求工程包括：1) 需求获取：收集、识别用户需求；2) 需求分析：对需求进行分析、建立分析模型（数据流图、ER图等）；3) 需求规格说明：编写需求规格说明书（SRS）；4) 需求验证：对需求进行评审、验证其正确性和完整性；5) 需求管理：对需求变更进行控制和管理。', 3),
        (61, '软件架构的定义和作用', '软件架构是系统的组织结构，包括：系统由哪些构件组成、构件之间的连接方式、构件之间的交互和协作方式、指导设计演进的原则。架构的作用：是系统设计的早期决策、是系统质量属性的载体、是利益相关者沟通的桥梁、是系统开发和维护的蓝图、是产品线复用的基础。', 2),
    ]

    for kp_id, front, back, difficulty in default_cards:
        cursor.execute('''
            INSERT INTO flashcards (user_id, kp_id, front, back, difficulty, srs_stage, next_review_at)
            VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
        ''', ('system_default', kp_id, front, back, difficulty))


def _seed_essay_topics(cursor):
    """初始化论文题目（系统架构设计师历年真题与典型考点）"""
    topics = [
        {
            'year': 2022, 'topic_category': '软件架构设计',
            'topic_title': '论企业应用系统集成中的架构设计',
            'background': '某大型制造企业经过多年信息化建设，已建设了ERP、CRM、SCM、OA等多个业务系统。由于各系统独立建设，数据无法共享，业务流程割裂，形成信息孤岛。企业决定进行应用系统集成，构建统一的企业信息平台，实现数据共享和业务协同。',
            'requirements': '请围绕"企业应用系统集成中的架构设计"论题，依次从以下三个方面进行论述：\n1. 概要叙述你参与管理或开发的企业应用系统集成项目以及你所担任的主要工作。\n2. 详细论述企业应用系统集成可以采用的架构风格及其特点。\n3. 具体阐述你参与管理或开发的项目中所采用的企业应用系统集成架构设计方案，并说明实施效果。',
            'key_points': '集成架构风格：数据集成（数据仓库、联邦数据库）、应用集成（RPC、消息中间件、SOA）、界面集成（门户）；ESB企业服务总线；SOA服务编排；微服务集成；数据一致性；接口规范（REST、SOAP）；消息队列异步解耦',
            'reference_essay': '摘要：本文以笔者参与的某制造企业应用集成项目为例，论述了企业应用系统集成中的架构设计。项目采用基于ESB的SOA架构，通过服务编排实现业务协同，采用消息队列实现异步解耦，最终实现各业务系统的数据共享与流程贯通。\n正文：\n一、项目概述...\n二、集成架构风格分析：1.数据集成 2.应用集成 3.界面集成 4.过程集成...\n三、本项目的架构设计方案：采用SOA+ESB架构...\n四、实施效果与总结...',
            'source': '系统架构设计师教程第二版'
        },
        {
            'year': 2021, 'topic_category': '系统质量属性与架构评估',
            'topic_title': '论软件架构风格及其应用',
            'background': '软件架构风格是描述某一特定应用领域中系统组织方式的惯用模式。架构风格定义了一组构件类型、连接件类型、拓扑结构及约束。不同的架构风格适用于不同的应用场景，选择合适的架构风格是架构设计的关键。',
            'requirements': '请围绕"软件架构风格及其应用"论题，依次从以下三个方面进行论述：\n1. 概要叙述你参与管理或开发的软件项目以及你所担任的主要工作。\n2. 详细论述常见的软件架构风格及其特点。\n3. 具体阐述你参与管理或开发的项目中所采用的软件架构风格，并说明选择该架构风格的原因和实施效果。',
            'key_points': '管道-过滤器风格、客户机/服务器风格、分层架构、面向对象架构、事件驱动架构、解释器风格、黑板架构、SOA、微服务；质量属性驱动选型；ATAM评估方法',
            'reference_essay': '',
            'source': '系统架构设计师教程第二版'
        },
        {
            'year': 2020, 'topic_category': '系统架构设计',
            'topic_title': '论微服务架构及其应用',
            'background': '随着互联网技术的发展和业务规模的扩大，传统单体架构面临部署困难、扩展性差、技术栈单一等问题。微服务架构将应用拆分为一组小的、自治的服务，每个服务独立部署、独立扩展、独立技术选型，已成为云原生应用的主流架构。',
            'requirements': '请围绕"微服务架构及其应用"论题，依次从以下三个方面进行论述：\n1. 概要叙述你参与管理或开发的采用微服务架构的软件项目以及你所担任的主要工作。\n2. 详细论述微服务架构的特点、优点和缺点。\n3. 具体阐述你参与管理或开发的项目中所采用的微服务架构设计方案，并说明实施效果。',
            'key_points': '微服务特点：单一职责、独立部署、去中心化、轻量级通信；优点：独立扩展、技术异构、故障隔离、团队自治；缺点：分布式复杂性、数据一致性、运维成本、服务间通信；服务注册发现、API网关、配置中心、链路追踪、熔断降级',
            'reference_essay': '',
            'source': '系统架构设计师教程第二版'
        },
        {
            'year': 2019, 'topic_category': '系统质量属性与架构评估',
            'topic_title': '论软件架构评估方法及其应用',
            'background': '软件架构评估是在架构设计之后、系统实现之前对架构方案进行分析和评价的过程，目的是在早期发现架构设计中的风险点、敏感点和权衡点，降低返工成本。常用的架构评估方法有SAAM、ATAM等。',
            'requirements': '请围绕"软件架构评估方法及其应用"论题，依次从以下三个方面进行论述：\n1. 概要叙述你参与管理或开发的需要进行架构评估的软件项目以及你所担任的主要工作。\n2. 详细论述软件架构评估的主要方法及其特点。\n3. 具体阐述你参与管理或开发的项目中所采用的架构评估方法、评估过程和评估结果。',
            'key_points': 'SAAM（软件架构分析方法）：场景驱动、非质量属性细分；ATAM（架构权衡分析方法）：质量属性效用树、风险点/敏感点/权衡点识别；CBAM成本效益分析；评估步骤：场景收集、架构描述、方法分析、结果报告',
            'reference_essay': '',
            'source': '系统架构设计师教程第二版'
        },
        {
            'year': 2018, 'topic_category': '软件工程',
            'topic_title': '论软件需求获取方法及其应用',
            'background': '软件需求是软件开发的起点和基础，需求获取的充分性和准确性直接影响软件项目的成败。常用的需求获取方法包括用户访谈、问卷调查、观察、原型法、头脑风暴等，不同方法适用于不同场景。',
            'requirements': '请围绕"软件需求获取方法及其应用"论题，依次从以下三个方面进行论述：\n1. 概要叙述你参与管理或开发的软件项目以及你所担任的主要工作。\n2. 详细论述软件需求获取的主要方法及其特点。\n3. 具体阐述你参与管理或开发的项目中所采用的需求获取方法、过程和效果。',
            'key_points': '用户访谈（结构化/非结构化）、问卷调查、观察法、原型法（抛弃式/演化式）、头脑风暴、JAD联合需求开发、用例驱动；需求获取难点：需求模糊、冲突、变更',
            'reference_essay': '',
            'source': '系统架构设计师教程第二版'
        },
        {
            'year': 2023, 'topic_category': '云原生架构',
            'topic_title': '论云原生架构设计及其应用',
            'background': '云原生（Cloud Native）是一套利用云计算交付模型的优势来构建和运行应用的方法论。云原生架构融合了微服务、容器、DevOps、持续交付等技术理念，使应用具备弹性、可观测、容错、自动伸缩等云特性，是当前企业数字化转型的关键技术。',
            'requirements': '请围绕"云原生架构设计及其应用"论题，依次从以下三个方面进行论述：\n1. 概要叙述你参与管理或开发的采用云原生架构的软件项目以及你所担任的主要工作。\n2. 详细论述云原生架构的核心特征和关键技术。\n3. 具体阐述你参与管理或开发的项目中所采用的云原生架构设计方案，并说明实施效果。',
            'key_points': '云原生核心特征：高弹性、高可用、高可观测、自动化；关键技术：容器（Docker）、容器编排（Kubernetes）、微服务、服务网格（Istio）、不可变基础设施、声明式API、DevOps、CI/CD、Serverless',
            'reference_essay': '',
            'source': '系统架构设计师教程第二版'
        },
    ]
    for t in topics:
        cursor.execute('SELECT id FROM essay_topics WHERE topic_title = ?', (t['topic_title'],))
        if cursor.fetchone():
            continue
        cursor.execute('''
            INSERT INTO essay_topics
            (year, topic_category, topic_title, background, requirements, key_points, reference_essay, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            t['year'], t['topic_category'], t['topic_title'],
            t['background'], t['requirements'], t['key_points'],
            t.get('reference_essay', ''), t['source']
        ))


def _seed_case_questions(cursor):
    """初始化案例分析题目（系统架构设计师典型题型）"""
    cases = [
        {
            'year': 2022, 'category': '系统质量属性与架构评估',
            'case_title': '在线交易系统的架构评估',
            'background': '某电商公司的在线交易系统需要支撑双十一大促活动。系统当前采用三层架构（表示层、业务逻辑层、数据访问层），平时日订单量100万，大促期间峰值订单量预计达到平时的20倍。架构师需要对系统进行评估，确保满足性能、可用性、可修改性等质量属性需求。公司提出了以下质量属性需求：(1) 峰值期间响应时间不超过2秒；(2) 系统可用性不低于99.95%；(3) 新支付方式可在1周内集成上线；(4) 系统应能防止SQL注入等常见攻击。',
            'questions': '[{"q":"请说明该系统涉及哪些质量属性，并分别给出对应的场景描述。","ref":"性能(响应时间2秒)、可用性(99.95%)、可修改性(1周集成新支付)、安全性(防SQL注入)"},{"q":"针对性能质量属性，列举至少3种提升性能的架构策略。","ref":"缓存、负载均衡、数据库读写分离、分库分表、异步消息队列、CDN静态资源加速、连接池"},{"q":"简述ATAM架构评估方法的步骤，并说明在该项目中如何应用。","ref":"ATAM步骤：1.描述业务动机 2.描述架构 3.生成质量属性效用树 4.分析架构方法 5.讨论和排序场景 6.分析架构方法 7.识别风险点敏感点权衡点"}]',
            'reference_answer': '问题1：性能（场景：峰值期间用户下单响应时间不超过2秒）、可用性（场景：系统全年可用性不低于99.95%，单点故障不影响整体服务）、可修改性（场景：新增一种支付方式可在1周内完成集成并上线）、安全性（场景：系统能够防御SQL注入、XSS等常见Web攻击）。\n问题2：提升性能的架构策略：①缓存策略（Redis缓存热点商品和会话）；②负载均衡（Nginx+应用层负载均衡）；③数据库优化（读写分离、分库分表）；④异步处理（消息队列削峰填谷）；⑤CDN加速静态资源；⑥连接池复用。\n问题3：ATAM评估步骤：①展示ATAM方法；②描述业务驱动因素；③描述架构方案；④创建质量属性效用树，对场景排序；⑤分析架构方法对高优先级场景的影响；⑥识别风险点、敏感点、权衡点；⑦形成评估报告。在该项目中，通过效用树确定"峰值响应时间<2秒"为最高优先级场景，分析现有架构的瓶颈，识别数据库访问为敏感点，缓存层缺失为风险点。',
            'key_points': '质量属性识别、性能策略、ATAM评估、效用树、风险点敏感点权衡点',
            'source': '系统架构设计师教程第二版'
        },
        {
            'year': 2021, 'category': '系统架构设计',
            'case_title': '从单体到微服务的架构演进',
            'background': '某互联网公司的订单系统采用单体架构，随着业务增长，系统出现部署慢、扩展困难、技术栈受限等问题。公司决定将单体系统拆分为微服务架构。目前系统包括用户服务、商品服务、订单服务、支付服务、库存服务等模块。架构师需要设计微服务拆分方案、服务间通信机制和数据一致性方案。',
            'questions': '[{"q":"请说明在微服务拆分时应遵循哪些原则？","ref":"单一职责、服务自治、数据库独立、松耦合高内聚、按业务能力拆分"},{"q":"针对服务间通信，比较同步通信与异步通信的优缺点及适用场景。","ref":"同步(RPC/REST)：实时性强、耦合度高；异步(消息队列)：解耦削峰、最终一致"},{"q":"在订单服务调用支付服务和库存服务时，如何保证分布式数据一致性？请给出方案。","ref":"Saga模式/TCC/可靠消息最终一致性/两阶段提交"}]',
            'reference_answer': '问题1：微服务拆分原则：①单一职责原则，每个服务只负责一个业务能力；②服务自治，独立开发、部署、运维；③数据库独立，每个服务拥有自己的数据库；④松耦合高内聚，服务间通过标准接口通信；⑤按业务能力或领域驱动设计的限界上下文拆分；⑥合适的粒度，避免过细导致管理复杂。\n问题2：同步通信（如REST、gRPC）：优点是调用直观、实时性强、易于调试；缺点是耦合度高、可用性受依赖服务影响、不支持削峰；适用于强依赖、需即时返回结果的场景。异步通信（如消息队列Kafka/RabbitMQ）：优点是解耦、削峰填谷、提高可用性、支持最终一致性；缺点是增加复杂度、调试困难、消息可能丢失或重复；适用于非即时、可异步处理的场景，如订单创建后发送通知。\n问题3：分布式数据一致性方案：①Saga模式（长事务拆分为多个本地事务，通过补偿事务回滚），适合长流程业务；②TCC（Try-Confirm-Cancel），强一致性好但开发成本高；③可靠消息最终一致性（本地消息表+消息队列），适合可接受最终一致性的场景；④两阶段提交（2PC），强一致但性能差。本项目订单+支付+库存建议采用Saga模式或可靠消息最终一致性方案。',
            'key_points': '微服务拆分原则、服务通信、分布式事务、Saga、TCC、最终一致性',
            'source': '系统架构设计师教程第二版'
        },
        {
            'year': 2020, 'category': '信息安全技术',
            'case_title': '企业数据安全架构设计',
            'background': '某金融机构需要建设一套数据安全防护体系，保护客户敏感数据。系统涉及数据采集、存储、传输、使用、共享、销毁等全生命周期。监管要求满足等保三级标准。数据包括客户身份信息、账户信息、交易记录等。架构师需要设计涵盖数据全生命周期的安全防护方案。',
            'questions': '[{"q":"请说明数据全生命周期各阶段的安全防护要点。","ref":"采集(脱敏验证)、存储(加密访问控制)、传输(加密通道)、使用(权限最小化)、共享(审计脱敏)、销毁(彻底清除)"},{"q":"列举至少4种数据加密技术及其适用场景。","ref":"对称加密AES(大数据量)、非对称RSA(密钥交换签名)、哈希SHA(完整性)、数字签名(不可否认性)"},{"q":"简述等保三级对数据安全的要求，并说明本系统如何满足。","ref":"数据完整性、保密性、可用性要求；通过加密、访问控制、备份、审计实现"}]',
            'reference_answer': '问题1：数据全生命周期安全防护：①采集阶段：数据源身份认证、输入校验、敏感数据脱敏；②存储阶段：数据库加密、字段级加密、访问控制、备份加密；③传输阶段：TLS/SSL加密通道、VPN、数据完整性校验；④使用阶段：最小权限原则、基于角色的访问控制、数据掩码、操作审计；⑤共享阶段：数据脱敏、数字水印、共享协议、审计日志；⑥销毁阶段：安全擦除、介质物理销毁、销毁记录。\n问题2：数据加密技术：①对称加密（AES、DES），加解密速度快，适合大数据量加密；②非对称加密（RSA、ECC），使用公私钥对，适合密钥交换和数字签名；③哈希算法（SHA-256、MD5），单向不可逆，用于数据完整性校验和密码存储；④数字签名，结合非对称加密和哈希，提供身份认证和不可否认性；⑤国密算法（SM2/SM3/SM4），金融行业合规要求。\n问题3：等保三级数据安全要求：①数据保密性：传输和存储加密；②数据完整性：校验机制防篡改；③数据可用性：冗余备份、容灾；④剩余信息保护：存储空间重用前清除；⑤个人信息保护：最小化收集、脱敏展示。本系统通过AES加密存储敏感字段、TLS加密传输、基于RBAC的访问控制、异地备份容灾、操作审计日志、客户信息脱敏展示等措施满足等保三级要求。',
            'key_points': '数据生命周期、加密技术、等保三级、访问控制、审计',
            'source': '系统架构设计师教程第二版'
        },
    ]
    for c in cases:
        cursor.execute('SELECT id FROM case_questions WHERE case_title = ?', (c['case_title'],))
        if cursor.fetchone():
            continue
        cursor.execute('''
            INSERT INTO case_questions
            (year, category, case_title, background, questions, reference_answer, key_points, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            c['year'], c['category'], c['case_title'],
            c['background'], c['questions'], c['reference_answer'],
            c['key_points'], c['source']
        ))


def _seed_real_exam_questions(cursor):
    """初始化真题选择题（系统架构设计师上午综合知识典型真题）"""
    questions = [
        {
            'year': 2022, 'category': '系统架构设计',
            'question_text': '在软件架构设计中，() 不属于构件级设计模式。',
            'options': '["A. 单例模式","B. 适配器模式","C. MVC模式","D. 工厂方法模式"]',
            'correct_answer': 'C',
            'explanation': 'MVC是架构模式（更宏观），属于架构层而非构件级设计模式。单例、适配器、工厂方法都是GoF设计模式，属于构件级。',
            'source': '2022年系统架构设计师真题'
        },
        {
            'year': 2022, 'category': '系统质量属性与架构评估',
            'question_text': 'ATAM架构评估方法中，() 用于描述架构决策对质量属性的影响程度。',
            'options': '["A. 风险点","B. 敏感点","C. 权衡点","D. 非风险点"]',
            'correct_answer': 'B',
            'explanation': '敏感点是指影响某个质量属性的架构决策；风险点是可能引起问题的决策；权衡点是同时影响多个质量属性的决策。',
            'source': '2022年系统架构设计师真题'
        },
        {
            'year': 2021, 'category': '系统架构设计',
            'question_text': '微服务架构中，() 模式用于解决服务实例的注册与发现问题。',
            'options': '["A. API网关","B. 服务注册中心","C. 断路器","D. 配置中心"]',
            'correct_answer': 'B',
            'explanation': '服务注册中心负责服务实例的注册与发现。API网关负责请求路由，断路器负责故障隔离，配置中心负责配置管理。',
            'source': '2021年系统架构设计师真题'
        },
        {
            'year': 2021, 'category': '软件工程',
            'question_text': '在敏捷开发中，() 不属于Scrum的核心角色。',
            'options': '["A. 产品负责人","B. Scrum主管","C. 开发团队","D. 项目经理"]',
            'correct_answer': 'D',
            'explanation': 'Scrum的三个核心角色是：产品负责人(Product Owner)、Scrum主管(Scrum Master)、开发团队。项目经理不是Scrum角色。',
            'source': '2021年系统架构设计师真题'
        },
        {
            'year': 2020, 'category': '云原生架构',
            'question_text': '关于云原生架构，() 是错误的描述。',
            'options': '["A. 容器是云原生的核心技术","B. 微服务是云原生的应用架构","C. 不可变基础设施指运行时不能修改","D. DevOps是云原生的文化实践"]',
            'correct_answer': 'C',
            'explanation': '不可变基础设施指部署后不再修改，需要更新时替换为新实例，而非"运行时不能修改"（运行时状态可变）。容器、微服务、DevOps都是云原生核心。',
            'source': '2020年系统架构设计师真题'
        },
        {
            'year': 2020, 'category': '信息安全技术',
            'question_text': '在公钥加密体系中，发送方用 () 对消息加密，接收方用 () 解密。',
            'options': '["A. 接收方公钥；接收方私钥","B. 接收方私钥；接收方公钥","C. 发送方公钥；发送方私钥","D. 发送方私钥；发送方公钥"]',
            'correct_answer': 'A',
            'explanation': '加密通信时，发送方用接收方的公钥加密，接收方用自己的私钥解密。数字签名则相反：发送方用自己私钥签名，接收方用发送方公钥验证。',
            'source': '2020年系统架构设计师真题'
        },
        {
            'year': 2019, 'category': '数据库设计',
            'question_text': '在分布式数据库中，() 不属于CAP定理的三个特性。',
            'options': '["A. 一致性","B. 可用性","C. 持久性","D. 分区容错性"]',
            'correct_answer': 'C',
            'explanation': 'CAP定理的三个特性是：一致性(Consistency)、可用性(Availability)、分区容错性(Partition tolerance)。持久性不属于CAP。',
            'source': '2019年系统架构设计师真题'
        },
        {
            'year': 2019, 'category': '系统架构设计',
            'question_text': 'SOA（面向服务架构）中，() 用于服务之间的松耦合集成。',
            'options': '["A. ESB企业服务总线","B. RPC远程调用","C. 数据库共享","D. 直接方法调用"]',
            'correct_answer': 'A',
            'explanation': 'ESB(Enterprise Service Bus)是SOA的核心组件，提供服务路由、协议转换、消息转换，实现服务间松耦合集成。',
            'source': '2019年系统架构设计师真题'
        },
        {
            'year': 2018, 'category': '软件工程',
            'question_text': '在软件测试中，() 测试用于验证模块间的接口和交互。',
            'options': '["A. 单元测试","B. 集成测试","C. 系统测试","D. 验收测试"]',
            'correct_answer': 'B',
            'explanation': '集成测试验证模块间的接口和交互。单元测试验证单个模块，系统测试验证整个系统，验收测试由用户验证需求。',
            'source': '2018年系统架构设计师真题'
        },
        {
            'year': 2018, 'category': '系统质量属性与架构评估',
            'question_text': '提高系统可用性的架构策略不包括 ()。',
            'options': '["A. 心跳检测","B. 冗余部署","C. 数据库索引","D. 故障转移"]',
            'correct_answer': 'C',
            'explanation': '数据库索引是提高性能（查询效率）的策略，与可用性无关。心跳检测、冗余部署、故障转移都是提高可用性的策略。',
            'source': '2018年系统架构设计师真题'
        },
        {
            'year': 2022, 'category': '计算机系统基础知识',
            'question_text': '在计算机存储体系中，Cache命中率主要取决于 ()。',
            'options': '["A. Cache容量","B. 程序的局部性原理","C. 主存速度","D. CPU主频"]',
            'correct_answer': 'B',
            'explanation': 'Cache基于程序的局部性原理（时间局部性和空间局部性）工作，命中率主要取决于程序访问模式对局部性的利用程度。',
            'source': '2022年系统架构设计师真题'
        },
        {
            'year': 2021, 'category': '信息系统基础知识',
            'question_text': '在ERP系统中，() 不属于其核心功能模块。',
            'options': '["A. 财务管理","B. 人力资源管理","C. 视频会议","D. 供应链管理"]',
            'correct_answer': 'C',
            'explanation': 'ERP核心模块包括财务、人力资源、供应链、生产制造、销售管理等。视频会议不属于ERP核心功能，属于办公自动化范畴。',
            'source': '2021年系统架构设计师真题'
        },
        {
            'year': 2023, 'category': '系统架构设计',
            'question_text': '在领域驱动设计(DDD)中，() 用于划分系统的业务边界。',
            'options': '["A. 聚合根","B. 限界上下文","C. 值对象","D. 领域事件"]',
            'correct_answer': 'B',
            'explanation': '限界上下文(Bounded Context)是DDD中划分系统业务边界的核心概念，每个限界上下文对应一个业务子域。聚合根、值对象、领域事件是上下文内的概念。',
            'source': '2023年系统架构设计师真题'
        },
        {
            'year': 2023, 'category': '云原生架构',
            'question_text': 'Kubernetes中，() 资源用于声明应用的期望状态并保证Pod副本数。',
            'options': '["A. Service","B. Deployment","C. ConfigMap","D. Ingress"]',
            'correct_answer': 'B',
            'explanation': 'Deployment声明应用的期望状态，保证指定数量的Pod副本运行。Service提供网络访问，ConfigMap管理配置，Ingress管理外部访问。',
            'source': '2023年系统架构设计师真题'
        },
        {
            'year': 2022, 'category': '软件工程',
            'question_text': '持续集成(CI)的核心实践不包括 ()。',
            'options': '["A. 频繁提交代码","B. 自动化构建","C. 自动化测试","D. 手工发布部署"]',
            'correct_answer': 'D',
            'explanation': 'CI核心实践包括频繁提交、自动化构建、自动化测试。手工发布部署不属于CI（持续集成），自动化部署属于CD（持续交付/部署）。',
            'source': '2022年系统架构设计师真题'
        },
        {
            'year': 2020, 'category': '系统架构设计',
            'question_text': '在RESTful API设计中，() 应使用HTTP POST方法。',
            'options': '["A. 获取资源列表","B. 获取单个资源","C. 创建新资源","D. 删除资源"]',
            'correct_answer': 'C',
            'explanation': 'RESTful规范：GET用于获取资源(列表/单个)，POST用于创建新资源，PUT用于更新，DELETE用于删除。',
            'source': '2020年系统架构设计师真题'
        },
        {
            'year': 2019, 'category': '系统质量属性与架构评估',
            'question_text': '系统响应时间属于 () 质量属性。',
            'options': '["A. 性能","B. 可用性","C. 安全性","D. 可修改性"]',
            'correct_answer': 'A',
            'explanation': '响应时间是性能质量属性的核心指标。可用性看MTBF/MTTR，安全性看机密性/完整性，可修改性看变更成本。',
            'source': '2019年系统架构设计师真题'
        },
        {
            'year': 2021, 'category': '数据库设计',
            'question_text': '在数据库事务的ACID特性中，() 保证事务执行后的数据一致性。',
            'options': '["A. 原子性","B. 一致性","C. 隔离性","D. 持久性"]',
            'correct_answer': 'B',
            'explanation': '一致性(Consistency)保证事务执行后数据库从一个一致状态变为另一个一致状态。原子性是全做或全不做，隔离性是并发互不干扰，持久性是提交后永久保存。',
            'source': '2021年系统架构设计师真题'
        },
        {
            'year': 2023, 'category': '信息安全技术',
            'question_text': '() 不属于等保2.0的安全等级。',
            'options': '["A. 第一级（自主保护级）","B. 第三级（监督保护级）","C. 第五级（专控保护级）","D. 第六级（强制保护级）"]',
            'correct_answer': 'D',
            'explanation': '等保2.0分为五级：1自主保护、2指导保护、3监督保护、4强制保护、5专控保护。不存在第六级。',
            'source': '2023年系统架构设计师真题'
        },
        {
            'year': 2022, 'category': '系统架构设计',
            'question_text': '在分层架构中，() 层负责业务规则的实现。',
            'options': '["A. 表示层","B. 业务逻辑层","C. 数据访问层","D. 数据库层"]',
            'correct_answer': 'B',
            'explanation': '分层架构中，表示层负责UI，业务逻辑层负责业务规则，数据访问层负责数据持久化，数据库层负责数据存储。',
            'source': '2022年系统架构设计师真题'
        },
    ]
    for q in questions:
        cursor.execute('SELECT id FROM real_exam_questions WHERE question_text = ?', (q['question_text'],))
        if cursor.fetchone():
            continue
        cursor.execute('''
            INSERT INTO real_exam_questions
            (year, category, question_text, options, correct_answer, explanation, source)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            q['year'], q['category'], q['question_text'],
            q['options'], q['correct_answer'], q['explanation'], q['source']
        ))


def auto_analyze_error(cursor, question_id, question_text, user_answer, correct_answer, kp_id=None):
    question_text = question_text or ''
    user_answer = user_answer or ''
    correct_answer = correct_answer or ''
    
    results = []
    
    def get_tag_id(tag_name):
        cursor.execute('SELECT id FROM error_tags WHERE name = ?', (tag_name,))
        row = cursor.fetchone()
        return row['id'] if row else None
    
    q_lower = question_text.lower()
    ua_lower = user_answer.lower()
    ca_lower = correct_answer.lower()
    
    is_multiple_choice = len(correct_answer) > 1 and correct_answer.isalpha() and correct_answer.upper() == correct_answer
    is_numeric = bool(re.search(r'\d+', question_text)) and bool(re.search(r'\d+', correct_answer))
    
    ua_chars = set(ua_lower)
    ca_chars = set(ca_lower)
    if ua_chars and ca_chars:
        overlap = len(ua_chars & ca_chars) / len(ua_chars | ca_chars)
    else:
        overlap = 0
    
    if is_multiple_choice:
        ua_set = set(user_answer.upper())
        ca_set = set(correct_answer.upper())
        if ua_set < ca_set:
            tag_id = get_tag_id('步骤遗漏')
            if tag_id:
                results.append((tag_id, 0.75))
            tag_id = get_tag_id('术语遗忘')
            if tag_id:
                results.append((tag_id, 0.6))
    
    if is_numeric:
        ua_nums = re.findall(r'[\d.]+', user_answer)
        ca_nums = re.findall(r'[\d.]+', correct_answer)
        if ua_nums and ca_nums:
            try:
                ua_val = float(ua_nums[0])
                ca_val = float(ca_nums[0])
                if ca_val != 0:
                    diff_ratio = abs(ua_val - ca_val) / abs(ca_val)
                    if diff_ratio < 0.5:
                        tag_id = get_tag_id('计算错误')
                        if tag_id:
                            results.append((tag_id, 0.8))
                        tag_id = get_tag_id('单位换算错')
                        if tag_id:
                            results.append((tag_id, 0.4))
                    else:
                        tag_id = get_tag_id('公式套用错')
                        if tag_id:
                            results.append((tag_id, 0.6))
            except (ValueError, ZeroDivisionError):
                pass
    
    concept_keywords = {
        '概念混淆': ['区别', '不同', 'vs', '比较', '混淆', '分别是', '包括'],
        '定义不清': ['定义', '是什么', '概念', '含义', '指的是'],
        '原理误解': ['原理', '机制', '工作', '如何', '为什么', '原因'],
        '分类混淆': ['分类', '类型', '种类', '属于', '归类'],
        '适用场景错误': ['适用', '应用', '场景', '用于', '适合', '情况下']
    }
    
    for tag_name, keywords in concept_keywords.items():
        for kw in keywords:
            if kw in q_lower:
                tag_id = get_tag_id(tag_name)
                if tag_id:
                    confidence = 0.5 + 0.1 * min(2, sum(1 for k in keywords if k in q_lower))
                    results.append((tag_id, min(confidence, 0.85)))
                break
    
    memory_keywords = {
        '公式记错': ['公式', '定理', '定律', '计算式'],
        '数值记混': ['数值', '参数', '大小', '多少', '比例'],
        '术语遗忘': ['术语', '名称', '叫做', '称为', '简称'],
        '步骤遗漏': ['步骤', '流程', '过程', '阶段', '顺序']
    }
    
    for tag_name, keywords in memory_keywords.items():
        for kw in keywords:
            if kw in q_lower:
                tag_id = get_tag_id(tag_name)
                if tag_id:
                    confidence = 0.5 + 0.1 * min(2, sum(1 for k in keywords if k in q_lower))
                    results.append((tag_id, min(confidence, 0.8)))
                break
    
    reading_keywords = {
        '漏看条件': ['条件', '前提', '假设', '已知', '给定'],
        '理解偏差': ['正确的是', '错误的是', '不正确', '不属于', '不包括'],
        '选非题看错': ['不正确', '错误的是', '不属于', '不包括', '不是']
    }
    
    for tag_name, keywords in reading_keywords.items():
        for kw in keywords:
            if kw in q_lower:
                tag_id = get_tag_id(tag_name)
                if tag_id:
                    confidence = 0.6 + 0.1 * min(2, sum(1 for k in keywords if k in q_lower))
                    results.append((tag_id, min(confidence, 0.85)))
                break
    
    logic_keywords = {
        '推理错误': ['推理', '推断', '推出', '结论', '因此'],
        '因果倒置': ['因为', '所以', '导致', '引起', '原因'],
        '以偏概全': ['都', '所有', '全部', '一般', '通常']
    }
    
    for tag_name, keywords in logic_keywords.items():
        for kw in keywords:
            if kw in q_lower:
                tag_id = get_tag_id(tag_name)
                if tag_id:
                    confidence = 0.5 + 0.1 * min(2, sum(1 for k in keywords if k in q_lower))
                    results.append((tag_id, min(confidence, 0.8)))
                break
    
    if overlap > 0.5 and len(user_answer) > 1 and len(correct_answer) > 1:
        tag_id = get_tag_id('概念混淆')
        if tag_id:
            if not any(tid == tag_id for tid, _ in results):
                results.append((tag_id, 0.7))
    
    if len(results) == 0:
        tag_id = get_tag_id('定义不清')
        if tag_id:
            results.append((tag_id, 0.5))
    
    seen = set()
    unique_results = []
    for tag_id, conf in results:
        if tag_id not in seen:
            seen.add(tag_id)
            unique_results.append((tag_id, round(conf, 2)))
    
    unique_results.sort(key=lambda x: x[1], reverse=True)
    
    return unique_results[:5]

def generate_recommendations(cursor, user_id, limit=10):
    cursor.execute('''
        SELECT et.id, et.name, et.category, COUNT(qet.question_id) as error_count
        FROM error_tags et
        JOIN question_error_tags qet ON et.id = qet.tag_id
        JOIN wrong_questions wq ON qet.question_id = wq.id
        WHERE wq.user_id = ?
        GROUP BY et.id, et.name, et.category
        ORDER BY error_count DESC
        LIMIT 3
    ''', (user_id,))
    top_error_types = cursor.fetchall()
    
    cursor.execute('''
        SELECT kp.id, kp.name, kp.category, COALESCE(uc.mastery_score, 0.5) as mastery_score
        FROM knowledge_points kp
        LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
        WHERE kp.is_active = 1 AND kp.level = 3
        ORDER BY mastery_score ASC
        LIMIT 5
    ''', (user_id,))
    weak_kps = cursor.fetchall()
    
    builtin_questions = _get_builtin_questions()
    
    weak_kp_ids = [kp['id'] for kp in weak_kps]
    
    error_type_weights = {}
    for idx, et in enumerate(top_error_types):
        error_type_weights[et['category']] = 1.0 - idx * 0.2
    
    kp_weights = {}
    for idx, kp in enumerate(weak_kps):
        kp_weights[kp['id']] = 1.0 - idx * 0.15
    
    scored_questions = []
    for q in builtin_questions:
        q_kp_id = q.get('kp_id')
        if not q_kp_id:
            continue
        
        score = 0.0
        matched_kp = False
        matched_error = False
        
        if q_kp_id in kp_weights:
            score += kp_weights[q_kp_id] * 2.0
            matched_kp = True
        
        q_text = q.get('question_text', '')
        q_lower = q_text.lower()
        
        for cat, weight in error_type_weights.items():
            cat_keywords = {
                'concept': ['概念', '定义', '原理', '分类', '区别', '不同'],
                'memory': ['公式', '数值', '术语', '步骤', '记住'],
                'calculation': ['计算', '数值', '等于', '多少', '单位'],
                'reading': ['正确的是', '错误的是', '不正确', '属于', '包括'],
                'logic': ['推理', '因为', '所以', '结论', '因此']
            }
            keywords = cat_keywords.get(cat, [])
            if any(kw in q_lower for kw in keywords):
                score += weight * 1.0
                matched_error = True
                break
        
        if matched_kp or matched_error:
            scored_questions.append((q, score))
    
    scored_questions.sort(key=lambda x: x[1], reverse=True)
    
    recommendations = []
    for q, score in scored_questions[:limit]:
        kp_id = q.get('kp_id')
        kp_name = ''
        if kp_id:
            cursor.execute('SELECT name FROM knowledge_points WHERE id = ?', (kp_id,))
            kp_row = cursor.fetchone()
            if kp_row:
                kp_name = kp_row['name']
        
        related_tags = []
        q_lower = q.get('question_text', '').lower()
        cursor.execute('SELECT id, name, category FROM error_tags')
        all_tags = cursor.fetchall()
        for tag in all_tags:
            tag_name_lower = tag['name'].lower()
            if any(kw in q_lower for kw in tag_name_lower):
                related_tags.append({'id': tag['id'], 'name': tag['name'], 'category': tag['category']})
        
        suggestions = []
        if top_error_types:
            for et in top_error_types:
                suggestions.append(f'重点加强{et["name"]}类错误的练习')
        if weak_kps:
            for kp in weak_kps[:2]:
                suggestions.append(f'巩固知识点：{kp["name"]}')
        
        recommendations.append({
            'question': q,
            'kp_name': kp_name,
            'score': round(score, 2),
            'related_tags': related_tags[:3],
            'suggestions': suggestions[:3]
        })
    
    weak_kp_list = []
    for kp in weak_kps:
        weak_kp_list.append({
            'id': kp['id'],
            'name': kp['name'],
            'category': kp['category'],
            'mastery_score': kp['mastery_score']
        })
    
    top_error_list = []
    for et in top_error_types:
        top_error_list.append({
            'id': et['id'],
            'name': et['name'],
            'category': et['category'],
            'error_count': et['error_count']
        })
    
    return {
        'questions': recommendations,
        'weak_knowledge_points': weak_kp_list,
        'top_error_types': top_error_list
    }

def _get_builtin_questions():
    questions = [
        {"id": -1, "question_text": "计算机系统中，CPU的基本组成不包括以下哪项？", "question_type": "single",
         "options": ["A. 运算器", "B. 控制器", "C. 存储器", "D. 寄存器组"], "correct_answer": "C",
         "kp_id": 1, "explanation": "CPU由运算器、控制器和寄存器组组成，存储器是独立于CPU的部件。"},
        {"id": -2, "question_text": "在Cache-主存层次结构中，Cache的作用是？", "question_type": "single",
         "options": ["A. 扩大存储容量", "B. 提高存储速度", "C. 降低存储成本", "D. 增加存储密度"], "correct_answer": "B",
         "kp_id": 2, "explanation": "Cache是高速缓冲存储器，主要作用是提高CPU访问存储器的速度，利用程序访问的局部性原理。"},
        {"id": -3, "question_text": "虚拟存储器主要由哪两级存储器构成？", "question_type": "single",
         "options": ["A. 寄存器-Cache", "B. Cache-主存", "C. 主存-辅存", "D. 辅存-光盘"], "correct_answer": "C",
         "kp_id": 3, "explanation": "虚拟存储器由主存和辅存构成，通过虚拟地址空间，使用户感觉有一个很大的主存。"},
        {"id": -4, "question_text": "以下哪种总线结构更适合高速外设的访问？", "question_type": "single",
         "options": ["A. 单总线结构", "B. 双总线结构", "C. 三总线结构", "D. 星型结构"], "correct_answer": "C",
         "kp_id": 4, "explanation": "三总线结构中，高速外设可以通过高速总线直接与主存交换数据，提高了I/O速度。"},
        {"id": -5, "question_text": "进程和线程的主要区别是？", "question_type": "single",
         "options": ["A. 进程是资源分配的基本单位，线程是CPU调度的基本单位", "B. 进程是CPU调度的基本单位，线程是资源分配的基本单位", "C. 进程和线程没有本质区别", "D. 线程不能并发执行"], "correct_answer": "A",
         "kp_id": 5, "explanation": "进程是资源分配的基本单位，线程是CPU调度的基本单位，同一进程内的线程共享进程资源。"},
        {"id": -6, "question_text": "PV操作是用来解决什么问题的？", "question_type": "single",
         "options": ["A. 进程调度", "B. 进程同步与互斥", "C. 死锁检测", "D. 内存分配"], "correct_answer": "B",
         "kp_id": 6, "explanation": "PV操作是一种信号量机制，主要用于解决进程间的同步与互斥问题。"},
        {"id": -7, "question_text": "以下哪种进程调度算法可能导致饥饿现象？", "question_type": "single",
         "options": ["A. 先来先服务(FCFS)", "B. 时间片轮转(RR)", "C. 优先级调度", "D. 多级反馈队列"], "correct_answer": "C",
         "kp_id": 7, "explanation": "优先级调度中，低优先级进程可能长期得不到调度，产生饥饿现象。"},
        {"id": -8, "question_text": "死锁的四个必要条件不包括？", "question_type": "single",
         "options": ["A. 互斥条件", "B. 不可剥夺条件", "C. 部分分配条件", "D. 可抢占条件"], "correct_answer": "D",
         "kp_id": 8, "explanation": "死锁的四个必要条件是：互斥、不可剥夺、请求和保持（部分分配）、循环等待。"},
        {"id": -9, "question_text": "分页存储管理中，页表的主要作用是？", "question_type": "single",
         "options": ["A. 记录内存使用情况", "B. 实现逻辑地址到物理地址的转换", "C. 管理磁盘空间", "D. 进行页面置换"], "correct_answer": "B",
         "kp_id": 9, "explanation": "页表记录了逻辑页号与物理块号的对应关系，用于实现逻辑地址到物理地址的转换。"},
        {"id": -10, "question_text": "数据库系统的三级模式结构中，不包括？", "question_type": "single",
         "options": ["A. 外模式", "B. 模式", "C. 内模式", "D. 中间模式"], "correct_answer": "D",
         "kp_id": 10, "explanation": "数据库三级模式是：外模式（用户模式）、模式（概念模式）、内模式（存储模式）。"},
        {"id": -11, "question_text": "关系数据库中，实现实体之间联系的是？", "question_type": "single",
         "options": ["A. 指针", "B. 公共属性", "C. 链表", "D. 索引"], "correct_answer": "B",
         "kp_id": 11, "explanation": "关系数据库通过关系（表）中的公共属性（外键）来实现实体之间的联系。"},
        {"id": -12, "question_text": "SQL语言中，用于查询数据的语句是？", "question_type": "single",
         "options": ["A. INSERT", "B. UPDATE", "C. SELECT", "D. DELETE"], "correct_answer": "C",
         "kp_id": 12, "explanation": "SELECT语句用于查询数据，INSERT用于插入，UPDATE用于更新，DELETE用于删除。"},
        {"id": -13, "question_text": "ER模型中，实体之间的联系不包括？", "question_type": "single",
         "options": ["A. 一对一联系", "B. 一对多联系", "C. 多对多联系", "D. 多对一联系"], "correct_answer": "D",
         "kp_id": 13, "explanation": "ER模型中实体间的联系有：一对一、一对多、多对多。多对一是一对多的反向，不是独立类型。"},
        {"id": -14, "question_text": "关系模式规范化中，第二范式要求消除？", "question_type": "single",
         "options": ["A. 传递依赖", "B. 部分依赖", "C. 多值依赖", "D. 连接依赖"], "correct_answer": "B",
         "kp_id": 14, "explanation": "第二范式（2NF）要求在1NF基础上，消除非主属性对码的部分函数依赖。"},
        {"id": -15, "question_text": "OSI七层模型中，负责数据压缩和加密的是？", "question_type": "single",
         "options": ["A. 网络层", "B. 传输层", "C. 表示层", "D. 会话层"], "correct_answer": "C",
         "kp_id": 15, "explanation": "表示层负责数据格式转换、数据加密和解密、数据压缩和解压缩等。"},
        {"id": -16, "question_text": "TCP协议工作在OSI模型的哪一层？", "question_type": "single",
         "options": ["A. 网络层", "B. 传输层", "C. 会话层", "D. 应用层"], "correct_answer": "B",
         "kp_id": 16, "explanation": "TCP（传输控制协议）是传输层协议，提供可靠的面向连接的数据传输服务。"},
        {"id": -17, "question_text": "以下哪个IP地址属于B类地址？", "question_type": "single",
         "options": ["A. 10.0.0.1", "B. 172.16.0.1", "C. 192.168.1.1", "D. 224.0.0.1"], "correct_answer": "B",
         "kp_id": 17, "explanation": "B类地址范围是128.0.0.0到191.255.255.255，172.16.0.1属于B类地址。"},
        {"id": -18, "question_text": "软件架构风格中，管道-过滤器风格的主要特点是？", "question_type": "single",
         "options": ["A. 事件驱动", "B. 数据流驱动", "C. 调用返回", "D. 层次结构"], "correct_answer": "B",
         "kp_id": 18, "explanation": "管道-过滤器风格是数据流风格的一种，数据在各个过滤器之间通过管道传递，每个过滤器独立处理数据。"},
        {"id": -19, "question_text": "软件质量属性中，可修改性不包括？", "question_type": "single",
         "options": ["A. 可维护性", "B. 可扩展性", "C. 性能", "D. 可移植性"], "correct_answer": "C",
         "kp_id": 19, "explanation": "可修改性包括可维护性、可扩展性、可移植性等，性能是独立的质量属性。"},
        {"id": -20, "question_text": "ATAM架构评估方法主要关注？", "question_type": "single",
         "options": ["A. 功能需求", "B. 质量属性", "C. 项目进度", "D. 开发成本"], "correct_answer": "B",
         "kp_id": 20, "explanation": "ATAM（架构权衡分析方法）是一种质量属性导向的架构评估方法，关注系统的质量属性及其权衡。"},
        {"id": -21, "question_text": "以下哪些属于操作系统的功能？", "question_type": "multiple",
         "options": ["A. 进程管理", "B. 存储管理", "C. 文件管理", "D. 编译程序"], "correct_answer": "ABC",
         "kp_id": 5, "explanation": "操作系统的主要功能包括：进程管理、存储管理、文件管理、设备管理、作业管理。编译程序属于系统软件，不是操作系统功能。"},
        {"id": -22, "question_text": "以下哪些是关系数据库的基本运算？", "question_type": "multiple",
         "options": ["A. 选择", "B. 投影", "C. 连接", "D. 排序"], "correct_answer": "ABC",
         "kp_id": 11, "explanation": "关系代数的基本运算包括：选择、投影、并、差、笛卡尔积、连接等。排序不是基本运算，是输出时的操作。"},
        {"id": -23, "question_text": "TCP/IP协议栈包括以下哪些层？", "question_type": "multiple",
         "options": ["A. 应用层", "B. 传输层", "C. 网络层", "D. 会话层"], "correct_answer": "ABC",
         "kp_id": 16, "explanation": "TCP/IP协议栈分为四层：应用层、传输层、网络层（网际层）、网络接口层。会话层是OSI模型的概念。"},
        {"id": -24, "question_text": "以下哪些属于软件架构风格？", "question_type": "multiple",
         "options": ["A. 管道-过滤器", "B. 面向对象", "C. 客户机/服务器", "D. 瀑布模型"], "correct_answer": "ABC",
         "kp_id": 18, "explanation": "常见的架构风格包括：管道-过滤器、面向对象、客户机/服务器、分层、事件驱动等。瀑布模型是软件开发过程模型。"},
        {"id": -25, "question_text": "软件质量属性包括以下哪些？", "question_type": "multiple",
         "options": ["A. 性能", "B. 可用性", "C. 安全性", "D. 代码行数"], "correct_answer": "ABC",
         "kp_id": 19, "explanation": "软件质量属性包括：性能、可用性、安全性、可修改性、易用性、可测试性等。代码行数是度量指标，不是质量属性。"},
        {"id": -26, "question_text": "Cache的命中率越高，说明存储系统的访问效率越高。", "question_type": "judge",
         "options": ["正确", "错误"], "correct_answer": "正确",
         "kp_id": 2, "explanation": "Cache命中率是CPU在Cache中找到所需数据的概率，命中率越高，说明需要访问主存的次数越少，系统访问效率越高。"},
        {"id": -27, "question_text": "进程从运行态到就绪态的转换是由进程调度程序引起的。", "question_type": "judge",
         "options": ["正确", "错误"], "correct_answer": "错误",
         "kp_id": 7, "explanation": "进程从运行态到就绪态的转换通常是由时钟中断引起的（时间片用完），而进程调度引起的是从就绪态到运行态的转换。"},
        {"id": -28, "question_text": "在关系数据库中，外键的值可以为空。", "question_type": "judge",
         "options": ["正确", "错误"], "correct_answer": "正确",
         "kp_id": 11, "explanation": "外键允许为空值，表示该实体与另一实体之间没有关联。但如果外键有值，则该值必须参照主表中的主键值。"},
        {"id": -29, "question_text": "UDP协议是一种可靠的传输层协议。", "question_type": "judge",
         "options": ["正确", "错误"], "correct_answer": "错误",
         "kp_id": 16, "explanation": "UDP是用户数据报协议，提供不可靠的、无连接的数据报服务。TCP才是可靠的、面向连接的传输层协议。"},
        {"id": -30, "question_text": "软件架构设计只需考虑功能需求，不需要考虑质量属性。", "question_type": "judge",
         "options": ["正确", "错误"], "correct_answer": "错误",
         "kp_id": 19, "explanation": "软件架构设计不仅要考虑功能需求，更重要的是要满足质量属性需求，如性能、可用性、安全性、可修改性等。"},
        {"id": -31, "question_text": "敏捷开发的特点不包括？", "question_type": "single",
         "options": ["A. 迭代开发", "B. 响应变化", "C. 详细的文档", "D. 客户参与"], "correct_answer": "C",
         "kp_id": 21, "explanation": "敏捷开发强调可工作的软件高于详尽的文档，重视响应变化、迭代开发和客户参与。"},
        {"id": -32, "question_text": "软件需求工程中，需求分析的主要任务是？", "question_type": "single",
         "options": ["A. 获取用户需求", "B. 建立分析模型", "C. 编写需求规格说明", "D. 需求评审"], "correct_answer": "B",
         "kp_id": 22, "explanation": "需求分析的主要任务是对需求进行分析建模，建立各种分析模型（如数据流图、ER图等）。"}
    ]
    return questions


def generate_exam_questions(cursor, user_id, exam_type, question_count, kp_ids=None):
    builtin_questions = _get_builtin_questions()
    
    all_questions = list(builtin_questions)
    
    if exam_type == 'chapter' and kp_ids:
        kp_id_set = set(kp_ids)
        all_questions = [q for q in all_questions if q.get('kp_id') in kp_id_set]
    
    cursor.execute('''
        SELECT wq.id, wq.question as question_text, wq.options, wq.correct_answer, 
               wq.analysis as explanation, wq.category, wq.chapter
        FROM wrong_questions wq
        WHERE wq.user_id = ? AND wq.is_mastered = 0
        ORDER BY wq.wrong_count DESC, wq.srs_stage ASC
        LIMIT ?
    ''', (user_id, question_count))
    
    wrong_question_rows = cursor.fetchall()
    wrong_questions = []
    for row in wrong_question_rows:
        options_list = json.loads(row['options']) if row['options'] else []
        wrong_questions.append({
            'id': row['id'],
            'question_text': row['question_text'],
            'question_type': 'single' if len(options_list) > 0 else 'judge',
            'options': options_list,
            'correct_answer': row['correct_answer'],
            'kp_id': None,
            'explanation': row['explanation']
        })
    
    wrong_count = min(len(wrong_questions), int(question_count * 0.3))
    selected_wrong = wrong_questions[:wrong_count]
    
    remaining = question_count - wrong_count
    remaining = max(0, remaining)
    
    if len(all_questions) >= remaining:
        selected_builtin = random.sample(all_questions, remaining)
    else:
        selected_builtin = all_questions[:]
    
    final_questions = selected_builtin + selected_wrong
    random.shuffle(final_questions)
    
    if len(final_questions) > question_count:
        final_questions = final_questions[:question_count]
    
    return final_questions


def _seed_knowledge_outline(cursor):
    outline = [
        {
            "name": "第1章 计算机组成与体系结构",
            "category": "计算机组成与体系结构",
            "level": 1,
            "sort_order": 1,
            "exam_weight": 0.08,
            "difficulty": 0.6,
            "children": [
                {
                    "name": "1.1 计算机系统组成",
                    "category": "计算机组成与体系结构",
                    "level": 2,
                    "sort_order": 1,
                    "exam_weight": 0.025,
                    "difficulty": 0.5,
                    "children": [
                        {"name": "计算机硬件组成", "category": "计算机组成与体系结构", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.4},
                        {"name": "计算机软件组成", "category": "计算机组成与体系结构", "level": 3, "sort_order": 2, "exam_weight": 0.008, "difficulty": 0.5},
                        {"name": "计算机系统分类", "category": "计算机组成与体系结构", "level": 3, "sort_order": 3, "exam_weight": 0.007, "difficulty": 0.6}
                    ]
                },
                {
                    "name": "1.2 存储系统",
                    "category": "计算机组成与体系结构",
                    "level": 2,
                    "sort_order": 2,
                    "exam_weight": 0.03,
                    "difficulty": 0.65,
                    "children": [
                        {"name": "存储器层次结构", "category": "计算机组成与体系结构", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.5},
                        {"name": "Cache存储器", "category": "计算机组成与体系结构", "level": 3, "sort_order": 2, "exam_weight": 0.012, "difficulty": 0.7},
                        {"name": "虚拟存储器", "category": "计算机组成与体系结构", "level": 3, "sort_order": 3, "exam_weight": 0.008, "difficulty": 0.7}
                    ]
                },
                {
                    "name": "1.3 输入输出系统",
                    "category": "计算机组成与体系结构",
                    "level": 2,
                    "sort_order": 3,
                    "exam_weight": 0.025,
                    "difficulty": 0.6,
                    "children": [
                        {"name": "I/O接口", "category": "计算机组成与体系结构", "level": 3, "sort_order": 1, "exam_weight": 0.008, "difficulty": 0.6},
                        {"name": "I/O设备", "category": "计算机组成与体系结构", "level": 3, "sort_order": 2, "exam_weight": 0.007, "difficulty": 0.5},
                        {"name": "总线系统", "category": "计算机组成与体系结构", "level": 3, "sort_order": 3, "exam_weight": 0.01, "difficulty": 0.7}
                    ]
                }
            ]
        },
        {
            "name": "第2章 操作系统",
            "category": "操作系统",
            "level": 1,
            "sort_order": 2,
            "exam_weight": 0.10,
            "difficulty": 0.65,
            "children": [
                {
                    "name": "2.1 进程管理",
                    "category": "操作系统",
                    "level": 2,
                    "sort_order": 1,
                    "exam_weight": 0.04,
                    "difficulty": 0.7,
                    "children": [
                        {"name": "进程与线程", "category": "操作系统", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.6},
                        {"name": "进程同步与互斥", "category": "操作系统", "level": 3, "sort_order": 2, "exam_weight": 0.012, "difficulty": 0.8},
                        {"name": "进程调度", "category": "操作系统", "level": 3, "sort_order": 3, "exam_weight": 0.01, "difficulty": 0.7},
                        {"name": "死锁", "category": "操作系统", "level": 3, "sort_order": 4, "exam_weight": 0.008, "difficulty": 0.7}
                    ]
                },
                {
                    "name": "2.2 存储管理",
                    "category": "操作系统",
                    "level": 2,
                    "sort_order": 2,
                    "exam_weight": 0.03,
                    "difficulty": 0.65,
                    "children": [
                        {"name": "内存管理", "category": "操作系统", "level": 3, "sort_order": 1, "exam_weight": 0.008, "difficulty": 0.5},
                        {"name": "分页存储", "category": "操作系统", "level": 3, "sort_order": 2, "exam_weight": 0.012, "difficulty": 0.7},
                        {"name": "分段存储", "category": "操作系统", "level": 3, "sort_order": 3, "exam_weight": 0.01, "difficulty": 0.6}
                    ]
                },
                {
                    "name": "2.3 文件管理",
                    "category": "操作系统",
                    "level": 2,
                    "sort_order": 3,
                    "exam_weight": 0.03,
                    "difficulty": 0.6,
                    "children": [
                        {"name": "文件结构", "category": "操作系统", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.6},
                        {"name": "目录结构", "category": "操作系统", "level": 3, "sort_order": 2, "exam_weight": 0.01, "difficulty": 0.5},
                        {"name": "文件存取方法", "category": "操作系统", "level": 3, "sort_order": 3, "exam_weight": 0.01, "difficulty": 0.6}
                    ]
                }
            ]
        },
        {
            "name": "第3章 数据库系统",
            "category": "数据库系统",
            "level": 1,
            "sort_order": 3,
            "exam_weight": 0.10,
            "difficulty": 0.6,
            "children": [
                {
                    "name": "3.1 数据库模式",
                    "category": "数据库系统",
                    "level": 2,
                    "sort_order": 1,
                    "exam_weight": 0.025,
                    "difficulty": 0.55,
                    "children": [
                        {"name": "三级模式两级映射", "category": "数据库系统", "level": 3, "sort_order": 1, "exam_weight": 0.012, "difficulty": 0.6},
                        {"name": "数据独立性", "category": "数据库系统", "level": 3, "sort_order": 2, "exam_weight": 0.013, "difficulty": 0.5}
                    ]
                },
                {
                    "name": "3.2 关系数据库",
                    "category": "数据库系统",
                    "level": 2,
                    "sort_order": 2,
                    "exam_weight": 0.04,
                    "difficulty": 0.65,
                    "children": [
                        {"name": "关系模型", "category": "数据库系统", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.5},
                        {"name": "关系代数", "category": "数据库系统", "level": 3, "sort_order": 2, "exam_weight": 0.015, "difficulty": 0.7},
                        {"name": "SQL语言", "category": "数据库系统", "level": 3, "sort_order": 3, "exam_weight": 0.015, "difficulty": 0.7}
                    ]
                },
                {
                    "name": "3.3 数据库设计",
                    "category": "数据库系统",
                    "level": 2,
                    "sort_order": 3,
                    "exam_weight": 0.035,
                    "difficulty": 0.7,
                    "children": [
                        {"name": "ER模型", "category": "数据库系统", "level": 3, "sort_order": 1, "exam_weight": 0.012, "difficulty": 0.7},
                        {"name": "范式理论", "category": "数据库系统", "level": 3, "sort_order": 2, "exam_weight": 0.013, "difficulty": 0.75},
                        {"name": "数据库设计步骤", "category": "数据库系统", "level": 3, "sort_order": 3, "exam_weight": 0.01, "difficulty": 0.6}
                    ]
                }
            ]
        },
        {
            "name": "第4章 计算机网络",
            "category": "计算机网络",
            "level": 1,
            "sort_order": 4,
            "exam_weight": 0.08,
            "difficulty": 0.6,
            "children": [
                {
                    "name": "4.1 网络体系结构",
                    "category": "计算机网络",
                    "level": 2,
                    "sort_order": 1,
                    "exam_weight": 0.02,
                    "difficulty": 0.5,
                    "children": [
                        {"name": "OSI七层模型", "category": "计算机网络", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.5},
                        {"name": "TCP/IP协议栈", "category": "计算机网络", "level": 3, "sort_order": 2, "exam_weight": 0.01, "difficulty": 0.5}
                    ]
                },
                {
                    "name": "4.2 网络协议",
                    "category": "计算机网络",
                    "level": 2,
                    "sort_order": 2,
                    "exam_weight": 0.04,
                    "difficulty": 0.65,
                    "children": [
                        {"name": "物理层", "category": "计算机网络", "level": 3, "sort_order": 1, "exam_weight": 0.006, "difficulty": 0.5},
                        {"name": "数据链路层", "category": "计算机网络", "level": 3, "sort_order": 2, "exam_weight": 0.008, "difficulty": 0.6},
                        {"name": "网络层", "category": "计算机网络", "level": 3, "sort_order": 3, "exam_weight": 0.01, "difficulty": 0.7},
                        {"name": "传输层", "category": "计算机网络", "level": 3, "sort_order": 4, "exam_weight": 0.009, "difficulty": 0.7},
                        {"name": "应用层", "category": "计算机网络", "level": 3, "sort_order": 5, "exam_weight": 0.007, "difficulty": 0.6}
                    ]
                },
                {
                    "name": "4.3 网络安全",
                    "category": "计算机网络",
                    "level": 2,
                    "sort_order": 3,
                    "exam_weight": 0.02,
                    "difficulty": 0.7,
                    "children": [
                        {"name": "加密技术", "category": "计算机网络", "level": 3, "sort_order": 1, "exam_weight": 0.008, "difficulty": 0.75},
                        {"name": "认证技术", "category": "计算机网络", "level": 3, "sort_order": 2, "exam_weight": 0.006, "difficulty": 0.7},
                        {"name": "防火墙", "category": "计算机网络", "level": 3, "sort_order": 3, "exam_weight": 0.006, "difficulty": 0.65}
                    ]
                }
            ]
        },
        {
            "name": "第5章 系统架构设计",
            "category": "系统架构设计",
            "level": 1,
            "sort_order": 5,
            "exam_weight": 0.12,
            "difficulty": 0.7,
            "children": [
                {
                    "name": "5.1 架构基础",
                    "category": "系统架构设计",
                    "level": 2,
                    "sort_order": 1,
                    "exam_weight": 0.04,
                    "difficulty": 0.6,
                    "children": [
                        {"name": "架构定义", "category": "系统架构设计", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.5},
                        {"name": "架构风格", "category": "系统架构设计", "level": 3, "sort_order": 2, "exam_weight": 0.018, "difficulty": 0.7},
                        {"name": "架构视图", "category": "系统架构设计", "level": 3, "sort_order": 3, "exam_weight": 0.012, "difficulty": 0.6}
                    ]
                },
                {
                    "name": "5.2 质量属性",
                    "category": "系统架构设计",
                    "level": 2,
                    "sort_order": 2,
                    "exam_weight": 0.05,
                    "difficulty": 0.75,
                    "children": [
                        {"name": "性能", "category": "系统架构设计", "level": 3, "sort_order": 1, "exam_weight": 0.012, "difficulty": 0.7},
                        {"name": "可用性", "category": "系统架构设计", "level": 3, "sort_order": 2, "exam_weight": 0.013, "difficulty": 0.75},
                        {"name": "安全性", "category": "系统架构设计", "level": 3, "sort_order": 3, "exam_weight": 0.012, "difficulty": 0.75},
                        {"name": "可修改性", "category": "系统架构设计", "level": 3, "sort_order": 4, "exam_weight": 0.013, "difficulty": 0.8}
                    ]
                },
                {
                    "name": "5.3 架构评估",
                    "category": "系统架构设计",
                    "level": 2,
                    "sort_order": 3,
                    "exam_weight": 0.03,
                    "difficulty": 0.7,
                    "children": [
                        {"name": "ATAM方法", "category": "系统架构设计", "level": 3, "sort_order": 1, "exam_weight": 0.015, "difficulty": 0.75},
                        {"name": "SAAM方法", "category": "系统架构设计", "level": 3, "sort_order": 2, "exam_weight": 0.015, "difficulty": 0.7}
                    ]
                }
            ]
        },
        {
            "name": "第6章 软件工程",
            "category": "软件工程",
            "level": 1,
            "sort_order": 6,
            "exam_weight": 0.10,
            "difficulty": 0.65,
            "children": [
                {
                    "name": "6.1 开发模型",
                    "category": "软件工程",
                    "level": 2,
                    "sort_order": 1,
                    "exam_weight": 0.03,
                    "difficulty": 0.6,
                    "children": [
                        {"name": "瀑布模型", "category": "软件工程", "level": 3, "sort_order": 1, "exam_weight": 0.009, "difficulty": 0.5},
                        {"name": "螺旋模型", "category": "软件工程", "level": 3, "sort_order": 2, "exam_weight": 0.01, "difficulty": 0.6},
                        {"name": "敏捷开发", "category": "软件工程", "level": 3, "sort_order": 3, "exam_weight": 0.011, "difficulty": 0.7}
                    ]
                },
                {
                    "name": "6.2 需求工程",
                    "category": "软件工程",
                    "level": 2,
                    "sort_order": 2,
                    "exam_weight": 0.035,
                    "difficulty": 0.65,
                    "children": [
                        {"name": "需求获取", "category": "软件工程", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.6},
                        {"name": "需求分析", "category": "软件工程", "level": 3, "sort_order": 2, "exam_weight": 0.013, "difficulty": 0.7},
                        {"name": "需求规格说明", "category": "软件工程", "level": 3, "sort_order": 3, "exam_weight": 0.012, "difficulty": 0.65}
                    ]
                },
                {
                    "name": "6.3 系统设计",
                    "category": "软件工程",
                    "level": 2,
                    "sort_order": 3,
                    "exam_weight": 0.035,
                    "difficulty": 0.7,
                    "children": [
                        {"name": "概要设计", "category": "软件工程", "level": 3, "sort_order": 1, "exam_weight": 0.01, "difficulty": 0.65},
                        {"name": "详细设计", "category": "软件工程", "level": 3, "sort_order": 2, "exam_weight": 0.013, "difficulty": 0.75},
                        {"name": "界面设计", "category": "软件工程", "level": 3, "sort_order": 3, "exam_weight": 0.012, "difficulty": 0.7}
                    ]
                }
            ]
        }
    ]

    def insert_node(node, parent_id=None):
        cursor.execute('''
            INSERT OR IGNORE INTO knowledge_points 
            (name, category, level, parent_id, sort_order, exam_weight, difficulty, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ''', (
            node["name"],
            node["category"],
            node["level"],
            parent_id,
            node["sort_order"],
            node["exam_weight"],
            node["difficulty"]
        ))
        cursor.execute('SELECT id FROM knowledge_points WHERE name = ?', (node["name"],))
        row = cursor.fetchone()
        node_id = row["id"] if row else None
        if node_id and "children" in node:
            for child in node["children"]:
                insert_node(child, node_id)

    for chapter in outline:
        insert_node(chapter)


def get_kp_mastery(cursor, kp_id, user_id):
    cursor.execute('''
        SELECT mastery_score FROM user_cognition 
        WHERE kp_id = ? AND user_id = ?
    ''', (kp_id, user_id))
    row = cursor.fetchone()
    return row["mastery_score"] if row else 0.5


def _migrate_legacy_knowledge_points(cursor):
    cursor.execute('SELECT COUNT(*) FROM knowledge_points WHERE level = 1 AND parent_id IS NULL')
    root_count = cursor.fetchone()[0]
    if root_count <= 6:
        return
    
    cursor.execute('SELECT DISTINCT parent_id FROM knowledge_points WHERE parent_id IS NOT NULL AND level = 2')
    has_section_children = {row['parent_id'] for row in cursor.fetchall()}
    
    cursor.execute('SELECT id FROM knowledge_points WHERE level = 1 AND parent_id IS NULL')
    all_root_ids = [row['id'] for row in cursor.fetchall()]
    
    legacy_ids = [rid for rid in all_root_ids if rid not in has_section_children]
    
    if legacy_ids:
        placeholders = ','.join(['?'] * len(legacy_ids))
        cursor.execute(f'UPDATE knowledge_points SET is_active = 0 WHERE id IN ({placeholders})', legacy_ids)
        cursor.execute(f'''
            UPDATE knowledge_points SET is_active = 0 
            WHERE parent_id IN ({placeholders})
        ''', legacy_ids)


def build_knowledge_tree(rows, mastery_map=None):
    id_to_node = {}
    root_nodes = []
    
    for row in rows:
        node = {
            "id": row["id"],
            "name": row["name"],
            "category": row["category"] if "category" in row.keys() else None,
            "level": row["level"] if "level" in row.keys() else 1,
            "children": []
        }
        if mastery_map and row["id"] in mastery_map:
            node["mastery_score"] = mastery_map[row["id"]]
        else:
            node["mastery_score"] = 0.5
        id_to_node[row["id"]] = node
    
    for row in rows:
        parent_id = row["parent_id"] if "parent_id" in row.keys() else None
        if parent_id and parent_id in id_to_node:
            id_to_node[parent_id]["children"].append(id_to_node[row["id"]])
        else:
            root_nodes.append(id_to_node[row["id"]])
    
    def sort_children(nodes):
        nodes.sort(key=lambda x: x.get("level", 0) * 1000 + x.get("id", 0))
        for node in nodes:
            if node["children"]:
                sort_children(node["children"])
    
    sort_children(root_nodes)
    return root_nodes


SRS_REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]


def days_until_exam(exam_date):
    if isinstance(exam_date, str):
        exam_date = datetime.strptime(exam_date, '%Y-%m-%d').date()
    today = datetime.now().date()
    return (exam_date - today).days


def get_task_detail(cursor, task):
    task_dict = dict(task)
    if task_dict.get('kp_id'):
        cursor.execute('SELECT name, category, chapter FROM knowledge_points WHERE id = ?', (task_dict['kp_id'],))
        kp = cursor.fetchone()
        if kp:
            task_dict['kp_name'] = kp['name']
            task_dict['kp_category'] = kp['category']
    return task_dict


def calculate_daily_tasks(cursor, user_id, plan_id, start_date, kps_to_learn, daily_kp_target, daily_target):
    tasks = []
    learned_kps = []

    total_days = max(1, (len(kps_to_learn) + daily_kp_target - 1) // daily_kp_target)

    for day_idx in range(min(total_days, 60)):
        current_date = start_date + timedelta(days=day_idx)
        date_str = current_date.strftime('%Y-%m-%d')

        new_kps = kps_to_learn[day_idx * daily_kp_target:(day_idx + 1) * daily_kp_target]
        for kp in new_kps:
            tasks.append({
                'plan_id': plan_id,
                'user_id': user_id,
                'task_date': date_str,
                'task_type': 'learn',
                'kp_id': kp['id'],
                'question_count': 5,
                'completed_count': 0,
                'status': 'pending'
            })
            learned_kps.append({'kp_id': kp['id'], 'learned_day': day_idx})

        for learned in learned_kps[:-len(new_kps)] if new_kps else learned_kps:
            days_since_learn = day_idx - learned['learned_day']
            if days_since_learn in SRS_REVIEW_INTERVALS:
                tasks.append({
                    'plan_id': plan_id,
                    'user_id': user_id,
                    'task_date': date_str,
                    'task_type': 'review',
                    'kp_id': learned['kp_id'],
                    'question_count': 3,
                    'completed_count': 0,
                    'status': 'pending'
                })

        practice_count = max(0, daily_target - len([t for t in tasks if t['task_date'] == date_str]) * 5)
        if practice_count > 0:
            tasks.append({
                'plan_id': plan_id,
                'user_id': user_id,
                'task_date': date_str,
                'task_type': 'practice',
                'kp_id': None,
                'question_count': min(practice_count, 10),
                'completed_count': 0,
                'status': 'pending'
            })

    return tasks


def generate_study_plan(cursor, user_id, exam_date, daily_target=20, daily_kp_target=3):
    today = datetime.now().date()

    if isinstance(exam_date, str):
        exam_date_obj = datetime.strptime(exam_date, '%Y-%m-%d').date()
    else:
        exam_date_obj = exam_date

    total_days = days_until_exam(exam_date_obj)
    if total_days <= 0:
        total_days = 30

    cursor.execute('''
        SELECT kp.id, kp.name, kp.category, kp.exam_weight, kp.difficulty,
               COALESCE(uc.mastery_score, 0.5) as mastery_score
        FROM knowledge_points kp
        LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
        WHERE kp.is_active = 1 AND kp.level = 3
        ORDER BY (1 - COALESCE(uc.mastery_score, 0.5)) * kp.exam_weight DESC, kp.sort_order ASC
    ''', (user_id,))
    kps = [dict(row) for row in cursor.fetchall()]

    cursor.execute('SELECT id FROM study_plans WHERE user_id = ? AND status = "active"', (user_id,))
    existing = cursor.fetchone()

    if existing:
        plan_id = existing['id']
        cursor.execute('''
            UPDATE study_plans 
            SET exam_date = ?, daily_target = ?, daily_kp_target = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (exam_date_obj.strftime('%Y-%m-%d'), daily_target, daily_kp_target, plan_id))
        cursor.execute('DELETE FROM daily_tasks WHERE plan_id = ? AND task_date >= DATE("now")', (plan_id,))
    else:
        cursor.execute('''
            INSERT INTO study_plans (user_id, exam_date, daily_target, daily_kp_target, start_date, status)
            VALUES (?, ?, ?, ?, DATE("now"), 'active')
        ''', (user_id, exam_date_obj.strftime('%Y-%m-%d'), daily_target, daily_kp_target))
        plan_id = cursor.lastrowid

    tasks = calculate_daily_tasks(cursor, user_id, plan_id, today, kps, daily_kp_target, daily_target)

    for task in tasks:
        cursor.execute('''
            INSERT INTO daily_tasks (plan_id, user_id, task_date, task_type, kp_id, question_count, completed_count, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            task['plan_id'], task['user_id'], task['task_date'], task['task_type'],
            task['kp_id'], task['question_count'], task['completed_count'], task['status']
        ))

    return plan_id


def _format_question(row):
    return {
        'id': row['id'],
        'question_id': row['question_id'],
        'question': row['question'],
        'options': json.loads(row['options']) if row['options'] else [],
        'user_answer': row['user_answer'],
        'correct_answer': row['correct_answer'],
        'analysis': row['analysis'],
        'category': row['category'],
        'chapter': row['chapter'],
        'is_mastered': bool(row['is_mastered']),
        'review_count': row['review_count'],
        'correct_count': row['correct_count'] if 'correct_count' in row.keys() else 0,
        'wrong_count': row['wrong_count'] if 'wrong_count' in row.keys() else 0,
        'last_review_time': row['last_review_time'],
        'srs_stage': row['srs_stage'] if 'srs_stage' in row.keys() else 0,
        'next_review_time': row['next_review_time'] if 'next_review_time' in row.keys() else None,
        'source_url': row['source_url'] if 'source_url' in row.keys() else None,
        'created_at': row['created_at']
    }

SRS_INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120]

# 测试数据特征：用于过滤/清理早期开发留下的脏数据
TEST_CATEGORY_PATTERNS = {'测试章节', '测试分类', '测试类别', 'General', 'test', 'Test'}
TEST_QUESTION_KEYWORDS = ('测试题目', '测试XSS', '<script>', 'alert(1)', '新测试题目')


def is_test_data(category='', chapter='', question=''):
    """识别测试/开发残留的脏数据"""
    cat_chap = {category or '', chapter or ''}
    if cat_chap & TEST_CATEGORY_PATTERNS:
        return True
    q = question or ''
    return any(kw in q for kw in TEST_QUESTION_KEYWORDS)


def update_srs(cursor, question_id, is_correct):
    cursor.execute('SELECT srs_stage FROM wrong_questions WHERE id = ?', (question_id,))
    row = cursor.fetchone()
    if not row:
        return
    current_stage = row['srs_stage'] or 0

    if is_correct:
        new_stage = min(current_stage + 1, len(SRS_INTERVALS) - 1)
        is_mastered = 1 if new_stage >= len(SRS_INTERVALS) - 2 else 0
    else:
        new_stage = max(0, current_stage - 1)
        is_mastered = 0

    days = SRS_INTERVALS[new_stage]
    cursor.execute('''
        UPDATE wrong_questions 
        SET srs_stage = ?, 
            next_review_time = datetime('now', ?),
            last_review_time = CURRENT_TIMESTAMP,
            review_count = review_count + 1,
            correct_count = correct_count + ?,
            wrong_count = wrong_count + ?,
            is_mastered = ?
        WHERE id = ?
    ''', (new_stage, f'+{days} day', 1 if is_correct else 0, 0 if is_correct else 1, is_mastered, question_id))

    return new_stage

def is_reflection_required_for_user(user_id):
    normalized = user_id or 'default_user'
    bucket = int(hashlib.md5(normalized.encode('utf-8')).hexdigest()[:8], 16) % 100
    return bucket < REFLECTION_ROLLOUT_PERCENT

ensure_schema()

# --- Ontology Helper Functions ---

def get_or_create_kp(cursor, name, category=None, chapter=None):
    """Ensure a KnowledgePoint exists and return its ID"""
    cursor.execute('SELECT id FROM knowledge_points WHERE name = ?', (name,))
    row = cursor.fetchone()
    if row:
        return row['id']
    
    cursor.execute('''
        INSERT INTO knowledge_points (name, category, chapter) 
        VALUES (?, ?, ?)
    ''', (name, category, chapter))
    return cursor.lastrowid

def update_cognition(cursor, kp_id, result, error_pattern_id=None, user_id='default_user'):
    """Update user's cognitive state based on practice result"""
    cursor.execute('SELECT mastery_score, stability FROM user_cognition WHERE kp_id = ? AND user_id = ?', (kp_id, user_id))
    row = cursor.fetchone()
    
    if not row:
        cursor.execute('INSERT INTO user_cognition (kp_id, user_id, mastery_score, stability) VALUES (?, ?, 0.5, 1.0)', (kp_id, user_id))
        score, stability = 0.5, 1.0
    else:
        score, stability = row['mastery_score'], row['stability']

    if result:
        score = min(1.0, score + 0.1)
        stability = min(2.0, stability + 0.2)
    else:
        penalty = 0.15 if error_pattern_id else 0.1
        score = max(0.0, score - penalty)
        stability = max(0.1, stability - 0.3)

    cursor.execute('''
        UPDATE user_cognition 
        SET mastery_score = ?, stability = ?, last_visit = ? 
        WHERE kp_id = ? AND user_id = ?
    ''', (score, stability, datetime.now(), kp_id, user_id))

# --- API Routes ---

@app.route('/api/health', methods=['GET'])
@api_response
def health_check():
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/wrong-questions', methods=['POST'])
@api_response
def add_wrong_question():
    data = request.get_json() or {}
    
    clean_question = sanitize_string(data.get('question', ''), 5000)
    clean_user_answer = sanitize_string(data.get('user_answer', ''), 200)
    clean_correct_answer = sanitize_string(data.get('correct_answer', ''), 200)
    clean_analysis = sanitize_string(data.get('analysis', ''), 5000)
    clean_category = sanitize_string(data.get('category', ''), 200)
    clean_chapter = sanitize_string(data.get('chapter', ''), 200)
    clean_source_url = sanitize_string(data.get('source_url', ''), 1000)
    clean_question_id = sanitize_string(data.get('question_id', ''), 100)
    clean_user_id = sanitize_string(data.get('user_id', 'default_user'), 100) or 'default_user'
    
    raw_options = data.get('options', [])
    if isinstance(raw_options, list):
        clean_options = [sanitize_string(opt, 2000) for opt in raw_options[:20]]
    else:
        clean_options = []
    
    if not clean_question:
        return jsonify({'error': 'Question content is required'}), 400
    
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO wrong_questions (
                question_id, question, options, user_answer, correct_answer,
                analysis, category, chapter, source_url, user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            clean_question_id,
            clean_question,
            json.dumps(clean_options),
            clean_user_answer,
            clean_correct_answer,
            clean_analysis,
            clean_category,
            clean_chapter,
            clean_source_url,
            clean_user_id
        ))
        q_id = cursor.lastrowid

        cursor.execute('''
            UPDATE wrong_questions 
            SET next_review_time = CURRENT_TIMESTAMP,
                wrong_count = 1
            WHERE id = ?
        ''', (q_id,))

        kps = data.get('knowledge_points', [])
        if not kps:
            kp_name = clean_chapter or clean_category or 'General'
            kps = [kp_name]

        for kp_name in kps:
            clean_kp = sanitize_string(kp_name, 200)
            if clean_kp:
                kp_id = get_or_create_kp(cursor, clean_kp, clean_category, clean_chapter)
                cursor.execute('INSERT INTO question_mapping (question_id, kp_id) VALUES (?, ?)', (q_id, kp_id))
                cursor.execute('''
                    INSERT OR IGNORE INTO user_cognition (kp_id, user_id, mastery_score, stability, last_visit)
                    VALUES (?, ?, 0.3, 0.5, CURRENT_TIMESTAMP)
                ''', (kp_id, clean_user_id))

        conn.commit()
    return jsonify({'success': True, 'id': q_id})

@app.route('/api/wrong-questions', methods=['GET'])
@api_response
def get_wrong_questions():
    page, limit = get_pagination_params()
    category = request.args.get('category', '')
    chapter = request.args.get('chapter', '')
    is_mastered = request.args.get('is_mastered', '')
    search = request.args.get('search', '')
    user_id = get_user_id()
    sort_by = request.args.get('sort_by', 'created_at')
    sort_order = request.args.get('sort_order', 'desc')

    valid_sort_fields = ['created_at', 'review_count', 'srs_stage', 'next_review_time']
    if sort_by not in valid_sort_fields:
        sort_by = 'created_at'
    if sort_order not in ['asc', 'desc']:
        sort_order = 'desc'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['user_id = ?']
        params = [user_id]

        if category:
            where_clauses.append('category = ?')
            params.append(category)
        if chapter:
            where_clauses.append('chapter = ?')
            params.append(chapter)
        if is_mastered != '':
            where_clauses.append('is_mastered = ?')
            params.append(int(is_mastered))
        if search:
            safe_search = sanitize_search_query(search)
            if safe_search:
                where_clauses.append('(question LIKE ? ESCAPE \'\\\' OR analysis LIKE ? ESCAPE \'\\\' OR options LIKE ? ESCAPE \'\\\' OR category LIKE ? ESCAPE \'\\\' OR chapter LIKE ? ESCAPE \'\\\')')
                like_pattern = f'%{safe_search}%'
                params.extend([like_pattern, like_pattern, like_pattern, like_pattern, like_pattern])

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM wrong_questions WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT * FROM wrong_questions 
            WHERE {where_sql} 
            ORDER BY {sort_by} {sort_order}
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])
        
        questions = [_format_question(row) for row in cursor.fetchall()]
    return jsonify({'items': questions, 'total': total, 'page': page, 'limit': limit})

@app.route('/api/wrong-questions/analysis', methods=['GET'])
@api_response
def get_wrong_questions_analysis():
    """错题聚合分析：总数 + 按分类统计 + 近 N 天错题趋势。
    前端 WrongQuestionsAnalysis 组件依赖此接口。
    """
    user_id = get_user_id()
    days = request.args.get('days', 30, type=int)
    days = max(1, min(days, 180))

    with get_db_conn() as conn:
        cursor = conn.cursor()

        # 总错题数（过滤测试数据）
        cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE user_id = ?', (user_id,))
        total_wrong = cursor.fetchone()[0]

        # 按分类聚合（过滤空 + 测试数据）
        cursor.execute('''
            SELECT category, COUNT(*) as cnt
            FROM wrong_questions
            WHERE user_id = ? AND category != ""
            GROUP BY category
            ORDER BY cnt DESC
        ''', (user_id,))
        category_stats = []
        for row in cursor.fetchall():
            if row['category'] in TEST_CATEGORY_PATTERNS:
                continue
            percentage = round((row['cnt'] / total_wrong) * 100, 2) if total_wrong > 0 else 0
            category_stats.append({
                'category': row['category'],
                'count': row['cnt'],
                'percentage': percentage
            })

        # 近 N 天错题新增趋势
        cursor.execute('''
            SELECT DATE(created_at) as day, COUNT(*) as cnt
            FROM wrong_questions
            WHERE user_id = ?
              AND created_at >= datetime('now', ?)
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        ''', (user_id, f'-{days} days'))
        daily_stats = [{'date': r['day'], 'count': r['cnt']} for r in cursor.fetchall()]

    return jsonify({
        'total_wrong': total_wrong,
        'category_stats': category_stats,
        'daily_stats': daily_stats
    })

@app.route('/api/wrong-questions/<int:question_id>', methods=['GET'])
@api_response
def get_wrong_question(question_id):
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM wrong_questions WHERE id = ?', (question_id,))
        row = cursor.fetchone()
    if not row:
        return jsonify({'error': 'Question not found'}), 404
    return jsonify(_format_question(row))

@app.route('/api/wrong-questions/<int:question_id>', methods=['PUT'])
@api_response
def update_wrong_question(question_id):
    data = request.get_json()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT id FROM wrong_questions WHERE id = ?', (question_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Question not found'}), 404

        update_fields = []
        params = []
        allowed_fields = ['question', 'options', 'user_answer', 'correct_answer',
                          'analysis', 'category', 'chapter', 'is_mastered', 'review_count']
        for field in allowed_fields:
            if field in data:
                update_fields.append(f'{field} = ?')
                if field == 'options':
                    params.append(json.dumps(data[field]))
                elif field == 'is_mastered':
                    params.append(int(data[field]))
                else:
                    params.append(data[field])

        if update_fields:
            params.append(question_id)
            cursor.execute(f'UPDATE wrong_questions SET {", ".join(update_fields)}, last_review_time = CURRENT_TIMESTAMP WHERE id = ?', params)
            conn.commit()

        cursor.execute('SELECT * FROM wrong_questions WHERE id = ?', (question_id,))
        row = cursor.fetchone()
    return jsonify({'success': True, 'data': _format_question(row)})

@app.route('/api/wrong-questions/<int:question_id>', methods=['DELETE'])
@api_response
def delete_wrong_question(question_id):
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM wrong_questions WHERE id = ?', (question_id,))
        cursor.execute('DELETE FROM question_mapping WHERE question_id = ?', (question_id,))
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/wrong-questions/batch/delete', methods=['POST'])
@api_response
def batch_delete_questions():
    data = request.get_json()
    ids = data.get('ids', [])
    if not isinstance(ids, list):
        return jsonify({'error': 'ids must be a list'}), 400
    if len(ids) == 0:
        return jsonify({'error': 'No ids provided'}), 400
    if len(ids) > 500:
        return jsonify({'error': 'ids length must be <= 500'}), 400
    with get_db_conn() as conn:
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(ids))
        cursor.execute(f'DELETE FROM wrong_questions WHERE id IN ({placeholders})', ids)
        cursor.execute(f'DELETE FROM question_mapping WHERE question_id IN ({placeholders})', ids)
        conn.commit()
        deleted = cursor.rowcount
    return jsonify({'success': True, 'deleted': deleted})

@app.route('/api/wrong-questions/batch/master', methods=['POST'])
@api_response
def batch_mark_mastered():
    data = request.get_json()
    ids = data.get('ids', [])
    mastered = int(data.get('is_mastered', 1))
    if not isinstance(ids, list):
        return jsonify({'error': 'ids must be a list'}), 400
    if len(ids) == 0:
        return jsonify({'error': 'No ids provided'}), 400
    if len(ids) > 500:
        return jsonify({'error': 'ids length must be <= 500'}), 400
    with get_db_conn() as conn:
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(ids))
        cursor.execute(f'UPDATE wrong_questions SET is_mastered = ?, last_review_time = CURRENT_TIMESTAMP WHERE id IN ({placeholders})', [mastered] + ids)
        conn.commit()
        updated = cursor.rowcount
    return jsonify({'success': True, 'updated': updated})

@app.route('/api/wrong-questions/export/json', methods=['GET'])
@api_response
def export_questions_json():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM wrong_questions WHERE user_id = ? ORDER BY id ASC', (user_id,))
        rows = cursor.fetchall()
        questions = [_format_question(row) for row in rows]

    resp = make_response(json.dumps({'questions': questions}, ensure_ascii=False, indent=2))
    resp.headers['Content-Type'] = 'application/json; charset=utf-8'
    resp.headers['Content-Disposition'] = 'attachment; filename="wrong_questions.json"'
    return resp

@app.route('/api/wrong-questions/export/csv', methods=['GET'])
@api_response
def export_questions_csv():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM wrong_questions WHERE user_id = ? ORDER BY id ASC', (user_id,))
        rows = cursor.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', '题目', '选项', '你的答案', '正确答案', '解析', '分类', '章节', '是否掌握', '复习次数', '创建时间'])
    for row in rows:
        options = json.loads(row['options']) if row['options'] else []
        writer.writerow([
            row['id'],
            row['question'],
            ' | '.join(options),
            row['user_answer'],
            row['correct_answer'],
            row['analysis'],
            row['category'],
            row['chapter'],
            '是' if row['is_mastered'] else '否',
            row['review_count'],
            row['created_at']
        ])

    output.seek(0)
    resp = make_response('\ufeff' + output.getvalue())
    resp.headers['Content-Type'] = 'text/csv; charset=utf-8'
    resp.headers['Content-Disposition'] = 'attachment; filename="wrong_questions.csv"'
    return resp

@app.route('/api/stats/overview', methods=['GET'])
@api_response
def get_stats_overview():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE user_id = ?', (user_id,))
        total_questions = cursor.fetchone()[0]

        cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE user_id = ? AND is_mastered = 1', (user_id,))
        mastered_count = cursor.fetchone()[0]

        cursor.execute('SELECT COUNT(DISTINCT category) FROM wrong_questions WHERE category != "" AND user_id = ?', (user_id,))
        category_count = cursor.fetchone()[0]

        cursor.execute('SELECT COUNT(*) FROM practice_attempts WHERE user_id = ?', (user_id,))
        practice_count = cursor.fetchone()[0]

        cursor.execute('SELECT COUNT(*) FROM practice_attempts WHERE user_id = ? AND is_correct = 1', (user_id,))
        correct_count = cursor.fetchone()[0]

        accuracy = round((correct_count / practice_count) * 100, 2) if practice_count > 0 else 0

        cursor.execute('SELECT COUNT(*) FROM practice_attempts WHERE user_id = ? AND DATE(attempted_at) = DATE("now")', (user_id,))
        today_practiced = cursor.fetchone()[0]

        cursor.execute('''
            SELECT AVG(is_correct) FROM practice_attempts 
            WHERE user_id = ? AND DATE(attempted_at) = DATE("now")
        ''', (user_id,))
        today_avg = cursor.fetchone()[0]
        today_correct_rate = round(today_avg * 100, 2) if today_avg else 0

        mastery_rate = round((mastered_count / total_questions) * 100, 2) if total_questions > 0 else 0

        cursor.execute('SELECT COUNT(*) FROM knowledge_points')
        kp_count = cursor.fetchone()[0]

        cursor.execute('SELECT AVG(mastery_score) FROM user_cognition WHERE user_id = ?', (user_id,))
        avg_mastery = cursor.fetchone()[0]
        avg_mastery = round(avg_mastery, 2) if avg_mastery else 0

    return jsonify({
        'total_questions': total_questions,
        'total_wrong_questions': total_questions,
        'mastered_count': mastered_count,
        'total_mastered': mastered_count,
        'unmastered_count': total_questions - mastered_count,
        'total_not_mastered': total_questions - mastered_count,
        'mastery_rate': mastery_rate,
        'category_count': category_count,
        'practice_count': practice_count,
        'correct_count': correct_count,
        'accuracy': accuracy,
        'today_practiced': today_practiced,
        'today_correct_rate': today_correct_rate,
        'knowledge_point_count': kp_count,
        'avg_mastery_score': avg_mastery
    })

@app.route('/api/stats/daily', methods=['GET'])
@api_response
def get_stats_daily():
    days = request.args.get('days', 7, type=int)
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute(f'''
            SELECT 
                DATE(attempted_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct,
                SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as wrong
            FROM practice_attempts
            WHERE attempted_at >= datetime('now', ?)
            GROUP BY DATE(attempted_at)
            ORDER BY date DESC
        ''', (f'-{max(days, 1)} day',))

        rows = cursor.fetchall()
        daily_data = []
        for row in rows:
            total = row['total']
            correct = row['correct']
            accuracy = round((correct / total) * 100, 2) if total > 0 else 0
            daily_data.append({
                'date': row['date'],
                'total': total,
                'correct': correct,
                'wrong': row['wrong'],
                'accuracy': accuracy,
                'practiced': total,
                'correct_rate': accuracy
            })
    return jsonify({'daily': daily_data, 'daily_stats': daily_data})

@app.route('/api/stats/category', methods=['GET'])
@api_response
def get_stats_category():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT 
                category,
                COUNT(*) as total,
                SUM(CASE WHEN is_mastered = 1 THEN 1 ELSE 0 END) as mastered
            FROM wrong_questions
            WHERE category != ""
            AND user_id = ?
            GROUP BY category
            ORDER BY total DESC
        ''', (user_id,))

        rows = cursor.fetchall()
        categories = []
        for row in rows:
            total = row['total']
            mastered = row['mastered']
            categories.append({
                'name': row['category'],
                'total': total,
                'mastered': mastered,
                'not_mastered': total - mastered,
                'mastery_rate': round((mastered / total) * 100, 2) if total > 0 else 0
            })
    return jsonify({'categories': categories})

@app.route('/api/stats/chapter', methods=['GET'])
@api_response
def get_stats_chapter():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT 
                chapter,
                category,
                COUNT(*) as total,
                SUM(CASE WHEN is_mastered = 1 THEN 1 ELSE 0 END) as mastered
            FROM wrong_questions
            WHERE chapter != ""
            AND user_id = ?
            GROUP BY chapter, category
            ORDER BY total DESC
        ''', (user_id,))

        rows = cursor.fetchall()
        chapters = []
        for row in rows:
            total = row['total']
            mastered = row['mastered']
            chapters.append({
                'name': row['chapter'],
                'category': row['category'],
                'total': total,
                'mastered': mastered,
                'mastery_rate': round((mastered / total) * 100, 2) if total > 0 else 0
            })
    return jsonify({'chapters': chapters})

@app.route('/api/stats/weak-points', methods=['GET'])
@api_response
def get_stats_weak_points():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT 
                category,
                COUNT(*) as total,
                SUM(CASE WHEN is_mastered = 0 THEN 1 ELSE 0 END) as not_mastered
            FROM wrong_questions
            WHERE category != ""
            AND user_id = ?
            GROUP BY category
            HAVING not_mastered > 0
            ORDER BY not_mastered DESC
            LIMIT 10
        ''', (user_id,))

        rows = cursor.fetchall()
        weak_points = []
        for row in rows:
            # 过滤测试数据（测试章节/测试分类等）
            if row['category'] in TEST_CATEGORY_PATTERNS:
                continue
            total = row['total']
            not_mastered = row['not_mastered']
            weak_rate = round((not_mastered / total) * 100, 2) if total > 0 else 0
            weak_points.append({
                'name': row['category'],
                'total': total,
                'not_mastered': not_mastered,
                'weak_rate': weak_rate
            })
    return jsonify({'weak_points': weak_points})

@app.route('/api/stats/cognition', methods=['GET'])
@api_response
def get_cognition_stats():
    """New Ontology API: Return mastery levels of all knowledge points"""
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT kp.name, uc.mastery_score, uc.stability, kp.category 
            FROM knowledge_points kp
            JOIN user_cognition uc ON kp.id = uc.kp_id
            WHERE uc.user_id = ?
            ORDER BY uc.mastery_score ASC
        ''', (user_id,))
        
        stats = []
        for row in cursor.fetchall():
            category = row['category'] or ''
            # 过滤空 category 和测试数据
            if not category or category in TEST_CATEGORY_PATTERNS:
                continue
            stats.append({
                'name': row['name'],
                'score': row['mastery_score'],
                'stability': row['stability'],
                'category': category
            })
    return jsonify({'cognition_map': stats})

@app.route('/api/practice/submit', methods=['POST'])
@api_response
def submit_practice():
    data = request.get_json()
    question_id = data.get('question_id')
    answer = data.get('answer')
    error_pattern_id = data.get('error_pattern_id')
    user_id = data.get('user_id', 'default_user')
    time_spent = data.get('time_spent', 0)
    
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT correct_answer, created_at FROM wrong_questions WHERE id = ?', (question_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Question not found'}), 404
        
        is_correct = (answer == row['correct_answer'])
        
        cursor.execute('SELECT kp_id FROM question_mapping WHERE question_id = ?', (question_id,))
        mappings = cursor.fetchall()
        
        for m in mappings:
            update_cognition(cursor, m['kp_id'], is_correct, error_pattern_id, user_id)

        new_srs_stage = update_srs(cursor, question_id, is_correct)

        requires_reflection = (not is_correct) and is_reflection_required_for_user(user_id)
        completed = 1 if (is_correct or not requires_reflection) else 0
        cursor.execute('''
            INSERT INTO practice_attempts (
                user_id, question_id, selected_answer, is_correct, error_pattern_id,
                time_spent, first_wrong_at, completed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            user_id,
            question_id,
            answer,
            1 if is_correct else 0,
            error_pattern_id,
            time_spent,
            row['created_at'],
            completed
        ))
        attempt_id = cursor.lastrowid
        
        conn.commit()
    
    return jsonify({
        'is_correct': is_correct,
        'correct_answer': row['correct_answer'],
        'attempt_id': attempt_id,
        'requires_reflection': requires_reflection,
        'srs_stage': new_srs_stage,
        'next_review_days': SRS_INTERVALS[new_srs_stage] if new_srs_stage is not None else 0
    })

@app.route('/api/practice/reflection', methods=['POST'])
@api_response
def submit_reflection():
    data = request.get_json()
    attempt_id = data.get('attempt_id')
    question_id = data.get('question_id')
    error_pattern_id = data.get('error_pattern_id')
    user_id = data.get('user_id', 'default_user')

    if not attempt_id or not question_id or not error_pattern_id:
        return jsonify({'error': 'attempt_id, question_id, error_pattern_id are required'}), 400

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, is_correct
            FROM practice_attempts
            WHERE id = ? AND user_id = ? AND question_id = ?
        ''', (attempt_id, user_id, question_id))
        attempt = cursor.fetchone()
        if not attempt:
            return jsonify({'error': 'Attempt not found'}), 404

        if attempt['is_correct']:
            return jsonify({'error': 'Correct answer does not need reflection'}), 400

        cursor.execute('SELECT id FROM practice_reflections WHERE attempt_id = ?', (attempt_id,))
        existing = cursor.fetchone()
        if existing:
            cursor.execute('''
                UPDATE practice_reflections
                SET error_pattern_id = ?, reflected_at = CURRENT_TIMESTAMP
                WHERE attempt_id = ?
            ''', (error_pattern_id, attempt_id))
            reflection_id = existing['id']
        else:
            cursor.execute('''
                INSERT INTO practice_reflections (attempt_id, user_id, question_id, error_pattern_id)
                VALUES (?, ?, ?, ?)
            ''', (attempt_id, user_id, question_id, error_pattern_id))
            reflection_id = cursor.lastrowid

        cursor.execute('''
            UPDATE practice_attempts
            SET completed = 1, error_pattern_id = ?
            WHERE id = ?
        ''', (error_pattern_id, attempt_id))
        conn.commit()
    return jsonify({'success': True, 'reflection_id': reflection_id})

@app.route('/api/practice/random', methods=['GET'])
@api_response
def random_practice():
    limit = request.args.get('limit', 10, type=int)
    user_id = get_user_id()
    mastered_filter = request.args.get('is_mastered', '')
    with get_db_conn() as conn:
        cursor = conn.cursor()

        where_sql = 'user_id = ?'
        params = [user_id]
        if mastered_filter != '':
            where_sql += ' AND is_mastered = ?'
            params.append(int(mastered_filter))

        cursor.execute(f'SELECT * FROM wrong_questions WHERE {where_sql} ORDER BY RANDOM() LIMIT ?', params + [limit])
        rows = cursor.fetchall()
        questions = [_format_question(row) for row in rows]
    return jsonify({'questions': questions})

@app.route('/api/practice/today', methods=['GET'])
@api_response
def today_practice():
    limit = request.args.get('limit', 20, type=int)
    user_id = get_user_id()
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    today_str = datetime.now().strftime('%Y-%m-%d')
    today_end = today_str + ' 23:59:59'
    with get_db_conn() as conn:
        cursor = conn.cursor()
        # 与复习队列一致的优先级：逾期(srs>0且过期) > 今日到期 > 新错题(srs=0)
        cursor.execute('''
            SELECT *,
                   CASE
                       WHEN srs_stage > 0 AND next_review_time IS NOT NULL AND next_review_time < ? THEN 1
                       WHEN srs_stage = 0 OR next_review_time IS NULL THEN 3
                       WHEN next_review_time IS NOT NULL AND next_review_time <= ? THEN 2
                       ELSE 4
                   END as priority
            FROM wrong_questions
            WHERE user_id = ?
            AND is_mastered = 0
            AND (next_review_time IS NULL OR next_review_time <= ? OR srs_stage = 0)
            ORDER BY priority ASC, next_review_time ASC, wrong_count DESC, created_at ASC
            LIMIT ?
        ''', (now, today_end, user_id, today_end, limit))

        rows = cursor.fetchall()
        questions = [_format_question(row) for row in rows]
    return jsonify({'questions': questions})

@app.route('/api/practice/recommend', methods=['GET'])
@api_response
def recommend_practice():
    """Cognition-driven recommendation: find questions testing the weakest points"""
    user_id = get_user_id()
    limit = request.args.get('limit', 10, type=int)
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT kp_id FROM user_cognition 
            WHERE user_id = ?
            ORDER BY mastery_score ASC LIMIT 5
        ''', (user_id,))
        weak_kps = [row['kp_id'] for row in cursor.fetchall()]
        
        if not weak_kps:
            cursor.execute('SELECT * FROM wrong_questions WHERE user_id = ? ORDER BY RANDOM() LIMIT ?', (user_id, limit))
            rows = cursor.fetchall()
        else:
            placeholders = ','.join(['?'] * len(weak_kps))
            cursor.execute(f'''
                SELECT DISTINCT qw.* FROM wrong_questions qw
                JOIN question_mapping qm ON qw.id = qm.question_id
                WHERE qm.kp_id IN ({placeholders})
                AND qw.user_id = ?
                ORDER BY RANDOM() LIMIT ?
            ''', weak_kps + [user_id, limit])
            rows = cursor.fetchall()

        questions = [_format_question(row) for row in rows]
    return jsonify({'questions': questions})

@app.route('/api/error-patterns', methods=['GET'])
@api_response
def get_error_patterns():
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM error_patterns')
        patterns = [{'id': row['id'], 'name': row['pattern_name']} for row in cursor.fetchall()]
    return jsonify({'patterns': patterns})

@app.route('/api/feature-flags', methods=['GET'])
@api_response
def get_feature_flags():
    user_id = get_user_id()
    enabled = is_reflection_required_for_user(user_id)
    return jsonify({
        'reflection_gate': {
            'enabled': enabled,
            'rollout_percent': REFLECTION_ROLLOUT_PERCENT
        }
    })

@app.route('/api/metrics/repractice-conversion', methods=['GET'])
@api_response
def get_repractice_conversion():
    days = request.args.get('days', 7, type=int)
    hours = request.args.get('hours', 72, type=int)
    with get_db_conn() as conn:
        cursor = conn.cursor()

        window_expr = f'-{max(days, 1)} day'
        hour_expr = f'+{max(hours, 1)} hour'
        cursor.execute('''
            WITH base_wrong AS (
                SELECT DISTINCT user_id, id AS question_id, created_at
                FROM wrong_questions
                WHERE created_at >= datetime('now', ?)
            ),
            qualified AS (
                SELECT DISTINCT bw.user_id, bw.question_id
                FROM base_wrong bw
                JOIN practice_attempts pa
                  ON pa.user_id = bw.user_id
                 AND pa.question_id = bw.question_id
                 AND pa.completed = 1
                 AND pa.attempted_at >= bw.created_at
                 AND pa.attempted_at <= datetime(bw.created_at, ?)
            ),
            denominator_users AS (
                SELECT DISTINCT user_id FROM base_wrong
            ),
            numerator_users AS (
                SELECT DISTINCT user_id FROM qualified
            )
            SELECT
                (SELECT COUNT(*) FROM denominator_users) AS denominator,
                (SELECT COUNT(*) FROM numerator_users) AS numerator
        ''', (window_expr, hour_expr))
        row = cursor.fetchone()

    denominator = row['denominator'] if row else 0
    numerator = row['numerator'] if row else 0
    rate = round((numerator / denominator) * 100, 2) if denominator else 0
    return jsonify({
        'window_days': max(days, 1),
        'conversion_hours': max(hours, 1),
        'denominator_users': denominator,
        'numerator_users': numerator,
        'conversion_rate': rate
    })


@app.route('/api/knowledge/tree', methods=['GET'])
@api_response
def get_knowledge_tree():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT kp.*, uc.mastery_score
            FROM knowledge_points kp
            LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
            WHERE kp.is_active = 1
            ORDER BY kp.level ASC, kp.sort_order ASC, kp.id ASC
        ''', (user_id,))
        rows = cursor.fetchall()
        
        mastery_map = {}
        for row in rows:
            if row["mastery_score"] is not None:
                mastery_map[row["id"]] = row["mastery_score"]
        
        tree = build_knowledge_tree(rows, mastery_map)
    return jsonify({'tree': tree})


@app.route('/api/knowledge/<int:kp_id>', methods=['GET'])
@api_response
def get_knowledge_point(kp_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM knowledge_points WHERE id = ?', (kp_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Knowledge point not found'}), 404
        
        mastery_score = get_kp_mastery(cursor, kp_id, user_id)
        
        cursor.execute('''
            SELECT COUNT(*) as wrong_count
            FROM wrong_questions wq
            JOIN question_mapping qm ON wq.id = qm.question_id
            WHERE qm.kp_id = ? AND wq.user_id = ?
        ''', (kp_id, user_id))
        wrong_count_row = cursor.fetchone()
        wrong_count = wrong_count_row["wrong_count"] if wrong_count_row else 0
        
        result = {
            'id': row['id'],
            'name': row['name'],
            'category': row['category'] if 'category' in row.keys() else None,
            'level': row['level'] if 'level' in row.keys() else 1,
            'parent_id': row['parent_id'] if 'parent_id' in row.keys() else None,
            'sort_order': row['sort_order'] if 'sort_order' in row.keys() else 0,
            'exam_weight': row['exam_weight'] if 'exam_weight' in row.keys() else 0,
            'difficulty': row['difficulty'] if 'difficulty' in row.keys() else 0.5,
            'is_active': row['is_active'] if 'is_active' in row.keys() else 1,
            'mastery_score': mastery_score,
            'wrong_question_count': wrong_count
        }
    return jsonify(result)


@app.route('/api/knowledge/weakest', methods=['GET'])
@api_response
def get_weakest_knowledge():
    limit = request.args.get('limit', 10, type=int)
    limit = min(max(1, limit), 100)
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT kp.*, 
                   COALESCE(uc.mastery_score, 0.5) as mastery_score
            FROM knowledge_points kp
            LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
            WHERE kp.is_active = 1 AND kp.level = 3
            ORDER BY mastery_score ASC, kp.sort_order ASC
            LIMIT ?
        ''', (user_id, limit))
        rows = cursor.fetchall()
        
        result = []
        for row in rows:
            result.append({
                'id': row['id'],
                'name': row['name'],
                'category': row['category'] if 'category' in row.keys() else None,
                'level': row['level'] if 'level' in row.keys() else 1,
                'mastery_score': row['mastery_score'],
                'exam_weight': row['exam_weight'] if 'exam_weight' in row.keys() else 0,
                'difficulty': row['difficulty'] if 'difficulty' in row.keys() else 0.5
            })
    return jsonify({'weak_points': result})


@app.route('/api/knowledge/progress', methods=['GET'])
@api_response
def get_knowledge_progress():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                kp1.id as chapter_id,
                kp1.name as chapter_name,
                kp1.sort_order as chapter_order,
                kp2.id as section_id,
                kp2.name as section_name,
                kp2.sort_order as section_order,
                COUNT(kp3.id) as kp_total,
                AVG(COALESCE(uc.mastery_score, 0.5)) as avg_mastery
            FROM knowledge_points kp1
            LEFT JOIN knowledge_points kp2 ON kp2.parent_id = kp1.id AND kp2.level = 2 AND kp2.is_active = 1
            LEFT JOIN knowledge_points kp3 ON kp3.parent_id = kp2.id AND kp3.level = 3 AND kp3.is_active = 1
            LEFT JOIN user_cognition uc ON kp3.id = uc.kp_id AND uc.user_id = ?
            WHERE kp1.level = 1 AND kp1.is_active = 1
            GROUP BY kp1.id, kp1.name, kp1.sort_order, kp2.id, kp2.name, kp2.sort_order
            ORDER BY kp1.sort_order ASC, kp2.sort_order ASC
        ''', (user_id,))
        rows = cursor.fetchall()
        
        chapters = {}
        for row in rows:
            ch_id = row['chapter_id']
            if ch_id not in chapters:
                chapters[ch_id] = {
                    'id': ch_id,
                    'name': row['chapter_name'],
                    'sort_order': row['chapter_order'],
                    'sections': [],
                    'total_kps': 0,
                    'avg_mastery': 0.0
                }
            
            if row['section_id']:
                section = {
                    'id': row['section_id'],
                    'name': row['section_name'],
                    'sort_order': row['section_order'],
                    'kp_total': row['kp_total'] or 0,
                    'avg_mastery': round(row['avg_mastery'] or 0.5, 4)
                }
                chapters[ch_id]['sections'].append(section)
        
        result = []
        for ch_id in sorted(chapters.keys(), key=lambda x: chapters[x]['sort_order']):
            ch = chapters[ch_id]
            total_kps = sum(s['kp_total'] for s in ch['sections'])
            if total_kps > 0:
                weighted_sum = sum(s['avg_mastery'] * s['kp_total'] for s in ch['sections'])
                ch_avg = round(weighted_sum / total_kps, 4)
            else:
                ch_avg = 0.5
            ch['total_kps'] = total_kps
            ch['avg_mastery'] = ch_avg
            result.append(ch)
    
    return jsonify({'progress': result})


@app.route('/api/study-plan', methods=['POST'])
@api_response
def create_or_update_study_plan():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    exam_date = data.get('exam_date')
    daily_target = safe_int(data.get('daily_target', 20), 20)
    daily_kp_target = safe_int(data.get('daily_kp_target', 3), 3)

    if not exam_date:
        return jsonify({'error': 'exam_date is required'}), 400

    daily_target = max(5, min(100, daily_target))
    daily_kp_target = max(1, min(10, daily_kp_target))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        plan_id = generate_study_plan(cursor, user_id, exam_date, daily_target, daily_kp_target)
        conn.commit()

        cursor.execute('SELECT * FROM study_plans WHERE id = ?', (plan_id,))
        plan = cursor.fetchone()

        cursor.execute('SELECT COUNT(*) FROM daily_tasks WHERE plan_id = ?', (plan_id,))
        total_tasks = cursor.fetchone()[0]

    return jsonify({
        'success': True,
        'plan': dict(plan),
        'total_tasks_generated': total_tasks
    })


@app.route('/api/study-plan', methods=['GET'])
@api_response
def get_study_plan():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM study_plans WHERE user_id = ? AND status = "active"', (user_id,))
        plan = cursor.fetchone()

        if not plan:
            return jsonify({'plan': None, 'today_tasks': [], 'week_overview': []})

        cursor.execute('''
            SELECT * FROM daily_tasks 
            WHERE user_id = ? AND task_date = DATE("now")
            ORDER BY task_type, id
        ''', (user_id,))
        today_tasks = [get_task_detail(cursor, t) for t in cursor.fetchall()]

        cursor.execute('''
            SELECT task_date, 
                   COUNT(*) as total_tasks,
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
            FROM daily_tasks
            WHERE user_id = ? AND task_date >= DATE("now") AND task_date < DATE("now", "+7 day")
            GROUP BY task_date
            ORDER BY task_date
        ''', (user_id,))
        week_overview = [dict(row) for row in cursor.fetchall()]

    return jsonify({
        'plan': dict(plan),
        'today_tasks': today_tasks,
        'week_overview': week_overview
    })


@app.route('/api/study-plan/today', methods=['GET'])
@api_response
def get_today_tasks():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM daily_tasks 
            WHERE user_id = ? AND task_date = DATE("now")
            ORDER BY 
                CASE task_type 
                    WHEN 'learn' THEN 1 
                    WHEN 'review' THEN 2 
                    WHEN 'practice' THEN 3 
                    ELSE 4 
                END,
                id
        ''', (user_id,))
        tasks = [get_task_detail(cursor, t) for t in cursor.fetchall()]

        total_questions = sum(t['question_count'] for t in tasks)
        completed_questions = sum(t['completed_count'] for t in tasks)
        completed_tasks = sum(1 for t in tasks if t['status'] == 'completed')

    return jsonify({
        'tasks': tasks,
        'stats': {
            'total_tasks': len(tasks),
            'completed_tasks': completed_tasks,
            'total_questions': total_questions,
            'completed_questions': completed_questions,
            'progress': round((completed_questions / total_questions * 100), 2) if total_questions > 0 else 0
        }
    })


@app.route('/api/study-plan/tasks/<int:task_id>/complete', methods=['POST'])
@api_response
def complete_task(task_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    completed_count = data.get('completed_count')

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM daily_tasks WHERE id = ? AND user_id = ?', (task_id, user_id))
        task = cursor.fetchone()

        if not task:
            return jsonify({'error': 'Task not found'}), 404

        if completed_count is None:
            new_completed = task['question_count']
        else:
            new_completed = min(task['question_count'], max(0, safe_int(completed_count, 0)))

        new_status = 'completed' if new_completed >= task['question_count'] else 'in_progress'
        if new_completed == 0:
            new_status = 'pending'

        cursor.execute('''
            UPDATE daily_tasks 
            SET completed_count = ?, status = ?
            WHERE id = ?
        ''', (new_completed, new_status, task_id))
        conn.commit()

        cursor.execute('SELECT * FROM daily_tasks WHERE id = ?', (task_id,))
        updated_task = get_task_detail(cursor, cursor.fetchone())

    return jsonify({
        'success': True,
        'task': updated_task
    })


@app.route('/api/study-plan/overview', methods=['GET'])
@api_response
def get_study_plan_overview():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM study_plans WHERE user_id = ? AND status = "active"', (user_id,))
        plan = cursor.fetchone()

        if not plan:
            return jsonify({'error': 'No active study plan'}), 404

        days_left = days_until_exam(plan['exam_date'])

        cursor.execute('''
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(question_count) as total_questions,
                SUM(completed_count) as completed_questions,
                COUNT(DISTINCT task_date) as total_days,
                COUNT(DISTINCT CASE WHEN status = 'completed' THEN task_date END) as completed_days
            FROM daily_tasks 
            WHERE plan_id = ?
        ''', (plan['id'],))
        stats = cursor.fetchone()

        cursor.execute('''
            SELECT 
                kp1.name as chapter_name,
                COUNT(DISTINCT dt.kp_id) as total_kps,
                COUNT(DISTINCT CASE WHEN dt.status = 'completed' THEN dt.kp_id END) as completed_kps
            FROM daily_tasks dt
            LEFT JOIN knowledge_points kp3 ON dt.kp_id = kp3.id
            LEFT JOIN knowledge_points kp2 ON kp3.parent_id = kp2.id
            LEFT JOIN knowledge_points kp1 ON kp2.parent_id = kp1.id
            WHERE dt.plan_id = ? AND dt.task_type = 'learn' AND kp1.id IS NOT NULL
            GROUP BY kp1.id, kp1.name
            ORDER BY kp1.sort_order
        ''', (plan['id'],))
        chapter_progress = []
        for row in cursor.fetchall():
            total = row['total_kps'] or 0
            completed = row['completed_kps'] or 0
            chapter_progress.append({
                'chapter_name': row['chapter_name'],
                'total_kps': total,
                'completed_kps': completed,
                'progress': round((completed / total * 100), 2) if total > 0 else 0
            })

    total_tasks = stats['total_tasks'] or 0
    completed_tasks = stats['completed_tasks'] or 0

    return jsonify({
        'plan': dict(plan),
        'days_until_exam': days_left,
        'total_progress': round((completed_tasks / total_tasks * 100), 2) if total_tasks > 0 else 0,
        'completed_days': stats['completed_days'] or 0,
        'total_days': stats['total_days'] or 0,
        'total_tasks': total_tasks,
        'completed_tasks': completed_tasks,
        'total_questions': stats['total_questions'] or 0,
        'completed_questions': stats['completed_questions'] or 0,
        'chapter_progress': chapter_progress
    })


@app.route('/api/study-plan/regenerate', methods=['POST'])
@api_response
def regenerate_study_plan():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM study_plans WHERE user_id = ? AND status = "active"', (user_id,))
        plan = cursor.fetchone()

        if not plan:
            return jsonify({'error': 'No active study plan'}), 404

        plan_id = generate_study_plan(
            cursor, user_id, plan['exam_date'],
            plan['daily_target'], plan['daily_kp_target']
        )
        conn.commit()

        cursor.execute('SELECT * FROM study_plans WHERE id = ?', (plan_id,))
        updated_plan = cursor.fetchone()

        cursor.execute('SELECT COUNT(*) FROM daily_tasks WHERE plan_id = ?', (plan_id,))
        total_tasks = cursor.fetchone()[0]

    return jsonify({
        'success': True,
        'plan': dict(updated_plan),
        'total_tasks': total_tasks,
        'message': 'Study plan regenerated based on latest mastery data'
    })


@app.route('/api/mock-exam/create', methods=['POST'])
@api_response
def create_mock_exam():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    title = data.get('title', '模拟考试')
    exam_type = data.get('exam_type', 'custom')
    question_count = safe_int(data.get('question_count', 20), 20)
    duration_minutes = safe_int(data.get('duration_minutes', 150), 150)
    kp_ids = data.get('kp_ids')

    question_count = max(5, min(100, question_count))
    duration_minutes = max(10, min(300, duration_minutes))

    if exam_type not in ['full', 'chapter', 'custom']:
        exam_type = 'custom'

    with get_db_conn() as conn:
        cursor = conn.cursor()

        questions = generate_exam_questions(cursor, user_id, exam_type, question_count, kp_ids)

        cursor.execute('''
            INSERT INTO mock_exams (
                user_id, title, exam_type, total_questions, 
                duration_minutes, status
            ) VALUES (?, ?, ?, ?, ?, 'draft')
        ''', (user_id, title, exam_type, len(questions), duration_minutes))
        exam_id = cursor.lastrowid

        for idx, q in enumerate(questions):
            cursor.execute('''
                INSERT INTO mock_exam_questions (
                    exam_id, question_id, question_text, question_type,
                    options, correct_answer, order_index, kp_id, explanation
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                exam_id,
                q['id'],
                q['question_text'],
                q['question_type'],
                json.dumps(q['options'], ensure_ascii=False),
                q['correct_answer'],
                idx,
                q.get('kp_id'),
                q.get('explanation', '')
            ))

        conn.commit()

    return jsonify({
        'success': True,
        'exam_id': exam_id,
        'total_questions': len(questions)
    })


@app.route('/api/mock-exam/<int:exam_id>', methods=['GET'])
@api_response
def get_mock_exam(exam_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ? AND user_id = ?', (exam_id, user_id))
        exam = cursor.fetchone()
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        cursor.execute('''
            SELECT id, exam_id, question_id, question_text, question_type,
                   options, user_answer, is_correct, order_index, kp_id
            FROM mock_exam_questions 
            WHERE exam_id = ? 
            ORDER BY order_index ASC
        ''', (exam_id,))
        
        questions = []
        for row in cursor.fetchall():
            q = dict(row)
            q['options'] = json.loads(q['options']) if q['options'] else []
            if exam['status'] != 'submitted':
                q.pop('correct_answer', None)
                if 'explanation' in q:
                    q.pop('explanation', None)
            questions.append(q)

        exam_dict = dict(exam)

    return jsonify({
        'exam': exam_dict,
        'questions': questions
    })


@app.route('/api/mock-exam/<int:exam_id>/start', methods=['POST'])
@api_response
def start_mock_exam(exam_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ? AND user_id = ?', (exam_id, user_id))
        exam = cursor.fetchone()
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        if exam['status'] not in ['draft']:
            return jsonify({'error': 'Exam already started or submitted'}), 400

        cursor.execute('''
            UPDATE mock_exams 
            SET status = 'in_progress', started_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (exam_id,))
        conn.commit()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ?', (exam_id,))
        updated_exam = cursor.fetchone()

    return jsonify({
        'success': True,
        'exam': dict(updated_exam)
    })


@app.route('/api/mock-exam/<int:exam_id>/answer', methods=['POST'])
@api_response
def answer_mock_exam(exam_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    question_index = safe_int(data.get('question_index'), 0)
    user_answer = data.get('user_answer', '')

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ? AND user_id = ?', (exam_id, user_id))
        exam = cursor.fetchone()
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        if exam['status'] != 'in_progress':
            return jsonify({'error': 'Exam not in progress'}), 400

        cursor.execute('''
            SELECT id FROM mock_exam_questions 
            WHERE exam_id = ? AND order_index = ?
        ''', (exam_id, question_index))
        question = cursor.fetchone()
        if not question:
            return jsonify({'error': 'Question not found'}), 404

        cursor.execute('''
            UPDATE mock_exam_questions 
            SET user_answer = ?
            WHERE exam_id = ? AND order_index = ?
        ''', (user_answer, exam_id, question_index))
        conn.commit()

    return jsonify({
        'success': True,
        'question_index': question_index,
        'user_answer': user_answer
    })


@app.route('/api/mock-exam/<int:exam_id>/submit', methods=['POST'])
@api_response
def submit_mock_exam(exam_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ? AND user_id = ?', (exam_id, user_id))
        exam = cursor.fetchone()
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        if exam['status'] == 'submitted':
            return jsonify({'error': 'Exam already submitted'}), 400

        cursor.execute('''
            SELECT * FROM mock_exam_questions 
            WHERE exam_id = ? 
            ORDER BY order_index ASC
        ''', (exam_id,))
        questions = cursor.fetchall()

        correct_count = 0
        wrong_count = 0
        kp_stats = {}

        for q in questions:
            user_ans = q['user_answer'] or ''
            correct_ans = q['correct_answer'] or ''
            is_correct = 1 if (user_ans.strip() == correct_ans.strip() and user_ans != '') else 0

            cursor.execute('''
                UPDATE mock_exam_questions 
                SET is_correct = ?
                WHERE id = ?
            ''', (is_correct, q['id']))

            if is_correct:
                correct_count += 1
            else:
                wrong_count += 1

            kp_id = q['kp_id']
            if kp_id:
                if kp_id not in kp_stats:
                    kp_stats[kp_id] = {'total': 0, 'correct': 0}
                kp_stats[kp_id]['total'] += 1
                if is_correct:
                    kp_stats[kp_id]['correct'] += 1

            if not is_correct and user_ans:
                cursor.execute('''
                    SELECT id FROM wrong_questions 
                    WHERE question = ? AND user_id = ?
                ''', (q['question_text'], user_id))
                existing = cursor.fetchone()
                if existing:
                    cursor.execute('''
                        UPDATE wrong_questions 
                        SET wrong_count = wrong_count + 1,
                            user_answer = ?,
                            is_mastered = 0
                        WHERE id = ?
                    ''', (user_ans, existing['id']))
                else:
                    options_json = q['options'] if q['options'] else '[]'
                    cursor.execute('''
                        INSERT INTO wrong_questions (
                            question_id, question, options, user_answer, 
                            correct_answer, analysis, user_id, wrong_count
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    ''', (
                        f'mock_{q["id"]}',
                        q['question_text'],
                        options_json,
                        user_ans,
                        correct_ans,
                        q['explanation'] or '',
                        user_id
                    ))

        total_questions = len(questions)
        score = round((correct_count / total_questions) * 100, 2) if total_questions > 0 else 0

        time_spent = 0
        if exam['started_at']:
            started = datetime.strptime(exam['started_at'], '%Y-%m-%d %H:%M:%S')
            now = datetime.now()
            time_spent = int((now - started).total_seconds())

        cursor.execute('''
            UPDATE mock_exams 
            SET status = 'submitted', 
                score = ?, 
                correct_count = ?, 
                wrong_count = ?,
                submitted_at = CURRENT_TIMESTAMP,
                time_spent = ?
            WHERE id = ?
        ''', (score, correct_count, wrong_count, time_spent, exam_id))

        for kp_id, stats in kp_stats.items():
            if stats['total'] > 0:
                result = stats['correct'] == stats['total']
                update_cognition(cursor, kp_id, result, None, user_id)

        conn.commit()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ?', (exam_id,))
        updated_exam = cursor.fetchone()

    return jsonify({
        'success': True,
        'exam': dict(updated_exam),
        'correct_count': correct_count,
        'wrong_count': wrong_count,
        'score': score
    })


@app.route('/api/mock-exam/<int:exam_id>/result', methods=['GET'])
@api_response
def get_mock_exam_result(exam_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ? AND user_id = ?', (exam_id, user_id))
        exam = cursor.fetchone()
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        if exam['status'] != 'submitted':
            return jsonify({'error': 'Exam not submitted yet'}), 400

        cursor.execute('''
            SELECT * FROM mock_exam_questions 
            WHERE exam_id = ? 
            ORDER BY order_index ASC
        ''', (exam_id,))
        
        questions = []
        kp_stats = {}
        for row in cursor.fetchall():
            q = dict(row)
            q['options'] = json.loads(q['options']) if q['options'] else []
            questions.append(q)

            kp_id = q['kp_id']
            if kp_id:
                if kp_id not in kp_stats:
                    kp_stats[kp_id] = {'total': 0, 'correct': 0, 'kp_name': ''}
                kp_stats[kp_id]['total'] += 1
                if q['is_correct']:
                    kp_stats[kp_id]['correct'] += 1

        for kp_id in kp_stats:
            cursor.execute('SELECT name FROM knowledge_points WHERE id = ?', (kp_id,))
            kp_row = cursor.fetchone()
            if kp_row:
                kp_stats[kp_id]['kp_name'] = kp_row['name']

        kp_accuracy = []
        for kp_id, stats in kp_stats.items():
            accuracy = round((stats['correct'] / stats['total']) * 100, 2) if stats['total'] > 0 else 0
            kp_accuracy.append({
                'kp_id': kp_id,
                'kp_name': stats['kp_name'],
                'total': stats['total'],
                'correct': stats['correct'],
                'accuracy': accuracy
            })

    return jsonify({
        'exam': dict(exam),
        'questions': questions,
        'kp_accuracy': kp_accuracy,
        'correct_count': exam['correct_count'],
        'wrong_count': exam['wrong_count'],
        'score': exam['score']
    })


@app.route('/api/mock-exam/list', methods=['GET'])
@api_response
def get_mock_exam_list():
    page, limit = get_pagination_params()
    user_id = get_user_id()

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) FROM mock_exams WHERE user_id = ?', (user_id,))
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute('''
            SELECT * FROM mock_exams 
            WHERE user_id = ? 
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        ''', (user_id, limit, offset))

        exams = [dict(row) for row in cursor.fetchall()]

    return jsonify({
        'items': exams,
        'total': total,
        'page': page,
        'limit': limit
    })


@app.route('/api/mock-exam/stats', methods=['GET'])
@api_response
def get_mock_exam_stats():
    user_id = get_user_id()

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) FROM mock_exams WHERE user_id = ?', (user_id,))
        total_exams = cursor.fetchone()[0]

        cursor.execute('''
            SELECT AVG(score) as avg_score, MAX(score) as max_score
            FROM mock_exams 
            WHERE user_id = ? AND status = 'submitted'
        ''', (user_id,))
        score_row = cursor.fetchone()
        avg_score = round(score_row['avg_score'], 2) if score_row['avg_score'] is not None else 0
        max_score = round(score_row['max_score'], 2) if score_row['max_score'] is not None else 0

        cursor.execute('''
            SELECT DATE(created_at) as date, COUNT(*) as count, AVG(score) as avg_score
            FROM mock_exams
            WHERE user_id = ? AND status = 'submitted'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 10
        ''', (user_id,))
        
        recent_trend = []
        for row in cursor.fetchall():
            recent_trend.append({
                'date': row['date'],
                'count': row['count'],
                'avg_score': round(row['avg_score'], 2) if row['avg_score'] is not None else 0
            })

    return jsonify({
        'total_exams': total_exams,
        'avg_score': avg_score,
        'max_score': max_score,
        'recent_trend': recent_trend
    })


@app.route('/api/error-analysis/analyze/<int:question_id>', methods=['POST'])
@api_response
def analyze_single_question(question_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM wrong_questions WHERE id = ? AND user_id = ?', (question_id, user_id))
        question = cursor.fetchone()
        if not question:
            return jsonify({'error': 'Question not found'}), 404
        
        tags = auto_analyze_error(
            cursor,
            question_id,
            question['question'],
            question['user_answer'],
            question['correct_answer']
        )
        
        cursor.execute('DELETE FROM question_error_tags WHERE question_id = ?', (question_id,))
        
        for tag_id, confidence in tags:
            cursor.execute('''
                INSERT OR IGNORE INTO question_error_tags (question_id, tag_id, confidence)
                VALUES (?, ?, ?)
            ''', (question_id, tag_id, confidence))
        
        cursor.execute('''
            UPDATE wrong_questions 
            SET last_error_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (question_id,))
        
        conn.commit()
        
        cursor.execute('''
            SELECT et.id, et.name, et.category, et.description, qet.confidence
            FROM error_tags et
            JOIN question_error_tags qet ON et.id = qet.tag_id
            WHERE qet.question_id = ?
            ORDER BY qet.confidence DESC
        ''', (question_id,))
        result_tags = [dict(row) for row in cursor.fetchall()]
    
    return jsonify({
        'success': True,
        'question_id': question_id,
        'tags': result_tags
    })


@app.route('/api/error-analysis/batch-analyze', methods=['POST'])
@api_response
def batch_analyze_questions():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT wq.id, wq.question, wq.user_answer, wq.correct_answer
            FROM wrong_questions wq
            LEFT JOIN question_error_tags qet ON wq.id = qet.question_id
            WHERE wq.user_id = ?
            AND qet.id IS NULL
        ''', (user_id,))
        questions = cursor.fetchall()
        
        analyzed_count = 0
        for q in questions:
            tags = auto_analyze_error(
                cursor,
                q['id'],
                q['question'],
                q['user_answer'],
                q['correct_answer']
            )
            
            for tag_id, confidence in tags:
                cursor.execute('''
                    INSERT OR IGNORE INTO question_error_tags (question_id, tag_id, confidence)
                    VALUES (?, ?, ?)
                ''', (q['id'], tag_id, confidence))
            
            cursor.execute('''
                UPDATE wrong_questions 
                SET last_error_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (q['id'],))
            
            analyzed_count += 1
        
        conn.commit()
        
        cursor.execute('''
            SELECT COUNT(*) as total
            FROM wrong_questions 
            WHERE user_id = ?
        ''', (user_id,))
        total_count = cursor.fetchone()['total']
        
        cursor.execute('''
            SELECT COUNT(DISTINCT wq.id) as analyzed
            FROM wrong_questions wq
            JOIN question_error_tags qet ON wq.id = qet.question_id
            WHERE wq.user_id = ?
        ''', (user_id,))
        already_analyzed = cursor.fetchone()['analyzed']
    
    return jsonify({
        'success': True,
        'newly_analyzed': analyzed_count,
        'already_analyzed': already_analyzed,
        'total_questions': total_count,
        'unanalyzed': total_count - already_analyzed
    })


@app.route('/api/error-analysis/tags', methods=['GET'])
@api_response
def get_error_tags():
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, category, description, created_at
            FROM error_tags
            ORDER BY category, id
        ''')
        all_tags = [dict(row) for row in cursor.fetchall()]
        
        tags_by_category = defaultdict(list)
        for tag in all_tags:
            tags_by_category[tag['category']].append(tag)
        
        category_names = {
            'concept': '概念类',
            'memory': '记忆类',
            'calculation': '计算类',
            'reading': '审题类',
            'logic': '逻辑类'
        }
        
        result = []
        for cat_key, cat_name in category_names.items():
            if cat_key in tags_by_category:
                result.append({
                    'category': cat_key,
                    'category_name': cat_name,
                    'tags': tags_by_category[cat_key]
                })
    
    return jsonify({'categories': result, 'all_tags': all_tags})


@app.route('/api/error-analysis/distribution', methods=['GET'])
@api_response
def get_error_distribution():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                et.category,
                COUNT(DISTINCT qet.question_id) as count,
                COUNT(*) as tag_count
            FROM error_tags et
            JOIN question_error_tags qet ON et.id = qet.tag_id
            JOIN wrong_questions wq ON qet.question_id = wq.id
            WHERE wq.user_id = ?
            GROUP BY et.category
            ORDER BY count DESC
        ''', (user_id,))
        category_stats = [dict(row) for row in cursor.fetchall()]
        
        cursor.execute('''
            SELECT 
                et.id, et.name, et.category, et.description,
                COUNT(qet.question_id) as error_count
            FROM error_tags et
            LEFT JOIN question_error_tags qet ON et.id = qet.tag_id
            LEFT JOIN wrong_questions wq ON qet.question_id = wq.id AND wq.user_id = ?
            GROUP BY et.id, et.name, et.category, et.description
            ORDER BY error_count DESC
        ''', (user_id,))
        tag_stats = [dict(row) for row in cursor.fetchall()]
        
        category_names = {
            'concept': '概念类',
            'memory': '记忆类',
            'calculation': '计算类',
            'reading': '审题类',
            'logic': '逻辑类'
        }
        
        pie_data = []
        total_errors = sum(s['count'] for s in category_stats)
        for stat in category_stats:
            percentage = round((stat['count'] / total_errors * 100), 2) if total_errors > 0 else 0
            pie_data.append({
                'category': stat['category'],
                'category_name': category_names.get(stat['category'], stat['category']),
                'count': stat['count'],
                'percentage': percentage
            })
    
    return jsonify({
        'pie_data': pie_data,
        'tag_stats': tag_stats,
        'total_errors': total_errors
    })


@app.route('/api/error-analysis/trend', methods=['GET'])
@api_response
def get_error_trend():
    user_id = get_user_id()
    days = request.args.get('days', 30, type=int)
    days = max(7, min(90, days))
    
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute(f'''
            SELECT 
                DATE(wq.created_at) as date,
                COUNT(*) as total_errors
            FROM wrong_questions wq
            WHERE wq.user_id = ?
            AND wq.created_at >= datetime('now', ?)
            GROUP BY DATE(wq.created_at)
            ORDER BY date ASC
        ''', (user_id, f'-{days} day'))
        daily_errors = [dict(row) for row in cursor.fetchall()]
        
        date_map = {row['date']: row for row in daily_errors}
        trend_data = []
        for i in range(days - 1, -1, -1):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
            if date in date_map:
                trend_data.append({
                    'date': date,
                    'total_errors': date_map[date]['total_errors']
                })
            else:
                trend_data.append({
                    'date': date,
                    'total_errors': 0
                })
        
        cursor.execute('''
            SELECT 
                et.category,
                DATE(wq.created_at) as date,
                COUNT(DISTINCT wq.id) as count
            FROM error_tags et
            JOIN question_error_tags qet ON et.id = qet.tag_id
            JOIN wrong_questions wq ON qet.question_id = wq.id
            WHERE wq.user_id = ?
            AND wq.created_at >= datetime('now', ?)
            GROUP BY et.category, DATE(wq.created_at)
            ORDER BY date ASC
        ''', (user_id, f'-{days} day'))
        category_daily = cursor.fetchall()
        
        category_trend = defaultdict(lambda: defaultdict(int))
        for row in category_daily:
            category_trend[row['category']][row['date']] = row['count']
        
        category_names = {
            'concept': '概念类',
            'memory': '记忆类',
            'calculation': '计算类',
            'reading': '审题类',
            'logic': '逻辑类'
        }
        
        category_trend_list = []
        for cat_key, cat_name in category_names.items():
            cat_data = []
            for i in range(days - 1, -1, -1):
                date = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
                cat_data.append({
                    'date': date,
                    'count': category_trend[cat_key].get(date, 0)
                })
            category_trend_list.append({
                'category': cat_key,
                'category_name': cat_name,
                'data': cat_data
            })
    
    return jsonify({
        'days': days,
        'daily_trend': trend_data,
        'category_trend': category_trend_list
    })


@app.route('/api/error-analysis/recommendations', methods=['GET'])
@api_response
def get_recommendations():
    user_id = get_user_id()
    limit = request.args.get('limit', 10, type=int)
    limit = max(1, min(50, limit))
    
    with get_db_conn() as conn:
        cursor = conn.cursor()
        result = generate_recommendations(cursor, user_id, limit)
    
    return jsonify(result)


@app.route('/api/error-analysis/questions/<int:question_id>/tags', methods=['POST'])
@api_response
def update_question_tags(question_id):
    user_id = get_user_id()
    data = request.get_json() or {}
    tag_ids = data.get('tag_ids', [])
    
    if not isinstance(tag_ids, list):
        return jsonify({'error': 'tag_ids must be a list'}), 400
    
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM wrong_questions WHERE id = ? AND user_id = ?', (question_id, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Question not found'}), 404
        
        cursor.execute('DELETE FROM question_error_tags WHERE question_id = ?', (question_id,))
        
        for tag_id in tag_ids:
            try:
                tag_id_int = int(tag_id)
                cursor.execute('SELECT id FROM error_tags WHERE id = ?', (tag_id_int,))
                if cursor.fetchone():
                    cursor.execute('''
                        INSERT OR IGNORE INTO question_error_tags (question_id, tag_id, confidence)
                        VALUES (?, ?, 1.0)
                    ''', (question_id, tag_id_int))
            except (ValueError, TypeError):
                continue
        
        conn.commit()
        
        cursor.execute('''
            SELECT et.id, et.name, et.category, et.description, qet.confidence
            FROM error_tags et
            JOIN question_error_tags qet ON et.id = qet.tag_id
            WHERE qet.question_id = ?
            ORDER BY qet.confidence DESC
        ''', (question_id,))
        result_tags = [dict(row) for row in cursor.fetchall()]
    
    return jsonify({
        'success': True,
        'question_id': question_id,
        'tags': result_tags
    })


@app.route('/api/error-analysis/questions/<int:question_id>', methods=['GET'])
@api_response
def get_question_analysis(question_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM wrong_questions WHERE id = ? AND user_id = ?', (question_id, user_id))
        question = cursor.fetchone()
        if not question:
            return jsonify({'error': 'Question not found'}), 404
        
        cursor.execute('''
            SELECT et.id, et.name, et.category, et.description, qet.confidence
            FROM error_tags et
            JOIN question_error_tags qet ON et.id = qet.tag_id
            WHERE qet.question_id = ?
            ORDER BY qet.confidence DESC
        ''', (question_id,))
        tags = [dict(row) for row in cursor.fetchall()]
        
        suggestions = []
        category_names = {
            'concept': '概念类',
            'memory': '记忆类',
            'calculation': '计算类',
            'reading': '审题类',
            'logic': '逻辑类'
        }
        
        if tags:
            for tag in tags[:3]:
                cat_name = category_names.get(tag['category'], tag['category'])
                suggestions.append(f'针对{tag["name"]}问题，建议加强{cat_name}相关知识的学习和练习')
        else:
            suggestions.append('建议先进行错误归因分析，了解错误类型')
        
        cursor.execute('SELECT kp_id FROM question_mapping WHERE question_id = ?', (question_id,))
        kp_mappings = cursor.fetchall()
        
        related_kps = []
        for m in kp_mappings:
            cursor.execute('SELECT id, name, category FROM knowledge_points WHERE id = ?', (m['kp_id'],))
            kp = cursor.fetchone()
            if kp:
                related_kps.append(dict(kp))
        
        question_data = _format_question(question)
    
    return jsonify({
        'question': question_data,
        'tags': tags,
        'suggestions': suggestions,
        'related_knowledge_points': related_kps
    })


@app.route('/api/notes', methods=['POST'])
@api_response
def create_note():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    question_id = data.get('question_id')
    kp_id = data.get('kp_id')
    title = sanitize_string(data.get('title', ''), 200)
    content = sanitize_string(data.get('content', ''), 10000)
    note_type = sanitize_string(data.get('note_type', 'general'), 20)
    tags = sanitize_string(data.get('tags', ''), 500)
    is_favorite = safe_int(data.get('is_favorite', 0), 0)

    if not content:
        return jsonify({'error': 'content is required'}), 400

    if note_type not in ['question', 'kp', 'general']:
        note_type = 'general'

    is_favorite = 1 if is_favorite else 0

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO notes (
                user_id, question_id, kp_id, title, content,
                note_type, tags, is_favorite
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            user_id,
            question_id if question_id else None,
            kp_id if kp_id else None,
            title,
            content,
            note_type,
            tags,
            is_favorite
        ))
        note_id = cursor.lastrowid
        conn.commit()

        cursor.execute('SELECT * FROM notes WHERE id = ?', (note_id,))
        note = dict(cursor.fetchone())

    return jsonify({'success': True, 'note': note})


@app.route('/api/notes', methods=['GET'])
@api_response
def get_notes():
    page, limit = get_pagination_params()
    user_id = get_user_id()
    note_type = request.args.get('note_type', '')
    kp_id = request.args.get('kp_id', '')
    question_id = request.args.get('question_id', '')
    search = request.args.get('search', '')
    sort_by = request.args.get('sort_by', 'updated_at')
    sort_order = request.args.get('sort_order', 'desc')

    valid_sort_fields = ['created_at', 'updated_at', 'title']
    if sort_by not in valid_sort_fields:
        sort_by = 'updated_at'
    if sort_order not in ['asc', 'desc']:
        sort_order = 'desc'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['user_id = ?']
        params = [user_id]

        if note_type:
            where_clauses.append('note_type = ?')
            params.append(note_type)
        if kp_id:
            where_clauses.append('kp_id = ?')
            params.append(safe_int(kp_id, 0))
        if question_id:
            where_clauses.append('question_id = ?')
            params.append(safe_int(question_id, 0))
        if search:
            safe_search = sanitize_search_query(search)
            if safe_search:
                where_clauses.append('(title LIKE ? ESCAPE \'\\\' OR content LIKE ? ESCAPE \'\\\' OR tags LIKE ? ESCAPE \'\\\')')
                like_pattern = f'%{safe_search}%'
                params.extend([like_pattern, like_pattern, like_pattern])

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM notes WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT * FROM notes 
            WHERE {where_sql} 
            ORDER BY {sort_by} {sort_order}
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])

        notes = [dict(row) for row in cursor.fetchall()]

    return jsonify({'items': notes, 'total': total, 'page': page, 'limit': limit})


@app.route('/api/notes/<int:note_id>', methods=['GET'])
@api_response
def get_note(note_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM notes WHERE id = ? AND user_id = ?', (note_id, user_id))
        note = cursor.fetchone()
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    return jsonify(dict(note))


@app.route('/api/notes/<int:note_id>', methods=['PUT'])
@api_response
def update_note(note_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM notes WHERE id = ? AND user_id = ?', (note_id, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Note not found'}), 404

        update_fields = []
        params = []
        allowed_fields = ['title', 'content', 'note_type', 'tags', 'is_favorite', 'kp_id', 'question_id']
        for field in allowed_fields:
            if field in data:
                if field == 'is_favorite':
                    update_fields.append(f'{field} = ?')
                    params.append(1 if data[field] else 0)
                elif field == 'content':
                    update_fields.append(f'{field} = ?')
                    params.append(sanitize_string(data[field], 10000))
                elif field == 'title':
                    update_fields.append(f'{field} = ?')
                    params.append(sanitize_string(data[field], 200))
                elif field == 'tags':
                    update_fields.append(f'{field} = ?')
                    params.append(sanitize_string(data[field], 500))
                elif field == 'note_type':
                    nt = sanitize_string(data[field], 20)
                    if nt in ['question', 'kp', 'general']:
                        update_fields.append(f'{field} = ?')
                        params.append(nt)
                else:
                    update_fields.append(f'{field} = ?')
                    params.append(data[field] if data[field] else None)

        if update_fields:
            update_fields.append('updated_at = CURRENT_TIMESTAMP')
            params.append(note_id)
            cursor.execute(f'UPDATE notes SET {", ".join(update_fields)} WHERE id = ?', params)
            conn.commit()

        cursor.execute('SELECT * FROM notes WHERE id = ?', (note_id,))
        note = dict(cursor.fetchone())

    return jsonify({'success': True, 'note': note})


@app.route('/api/notes/<int:note_id>', methods=['DELETE'])
@api_response
def delete_note(note_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM notes WHERE id = ? AND user_id = ?', (note_id, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Note not found'}), 404
        cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        conn.commit()
    return jsonify({'success': True})


@app.route('/api/favorites', methods=['POST'])
@api_response
def add_favorite():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    target_type = sanitize_string(data.get('target_type', ''), 20)
    target_id = safe_int(data.get('target_id'), 0)

    if not target_type or target_id == 0:
        return jsonify({'error': 'target_type and target_id are required'}), 400

    if target_type not in ['question', 'kp', 'note']:
        return jsonify({'error': 'target_type must be question, kp, or note'}), 400

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR IGNORE INTO favorites (user_id, target_type, target_id)
            VALUES (?, ?, ?)
        ''', (user_id, target_type, target_id))
        conn.commit()

        cursor.execute('''
            SELECT * FROM favorites 
            WHERE user_id = ? AND target_type = ? AND target_id = ?
        ''', (user_id, target_type, target_id))
        favorite = dict(cursor.fetchone())

    return jsonify({'success': True, 'favorite': favorite})


@app.route('/api/favorites/<target_type>/<int:target_id>', methods=['DELETE'])
@api_response
def remove_favorite(target_type, target_id):
    user_id = get_user_id()

    if target_type not in ['question', 'kp', 'note']:
        return jsonify({'error': 'target_type must be question, kp, or note'}), 400

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id FROM favorites 
            WHERE user_id = ? AND target_type = ? AND target_id = ?
        ''', (user_id, target_type, target_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Favorite not found'}), 404
        cursor.execute('''
            DELETE FROM favorites 
            WHERE user_id = ? AND target_type = ? AND target_id = ?
        ''', (user_id, target_type, target_id))
        conn.commit()

    return jsonify({'success': True})


@app.route('/api/favorites', methods=['GET'])
@api_response
def get_favorites():
    page, limit = get_pagination_params()
    user_id = get_user_id()
    target_type = request.args.get('target_type', '')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['user_id = ?']
        params = [user_id]

        if target_type:
            where_clauses.append('target_type = ?')
            params.append(target_type)

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM favorites WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT * FROM favorites 
            WHERE {where_sql} 
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])

        favorites = [dict(row) for row in cursor.fetchall()]

    return jsonify({'items': favorites, 'total': total, 'page': page, 'limit': limit})


@app.route('/api/favorites/check/<target_type>/<int:target_id>', methods=['GET'])
@api_response
def check_favorite(target_type, target_id):
    user_id = get_user_id()

    if target_type not in ['question', 'kp', 'note']:
        return jsonify({'error': 'target_type must be question, kp, or note'}), 400

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id FROM favorites 
            WHERE user_id = ? AND target_type = ? AND target_id = ?
        ''', (user_id, target_type, target_id))
        is_favorited = cursor.fetchone() is not None

    return jsonify({'is_favorite': is_favorited})


@app.route('/api/flashcards', methods=['GET'])
@api_response
def get_flashcards():
    page, limit = get_pagination_params()
    user_id = get_user_id()
    kp_id = request.args.get('kp_id', '')
    due_only = request.args.get('due_only', '0')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['(user_id = ? OR user_id = ?)']
        params = [user_id, 'system_default']

        if kp_id:
            where_clauses.append('kp_id = ?')
            params.append(safe_int(kp_id, 0))
        if due_only == '1':
            where_clauses.append('next_review_at <= datetime(\'now\')')

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM flashcards WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT * FROM flashcards 
            WHERE {where_sql} 
            ORDER BY next_review_at ASC, id ASC
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])

        cards = [dict(row) for row in cursor.fetchall()]

    return jsonify({'items': cards, 'total': total, 'page': page, 'limit': limit})


@app.route('/api/flashcards', methods=['POST'])
@api_response
def create_flashcard():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    kp_id = data.get('kp_id')
    front = sanitize_string(data.get('front', ''), 1000)
    back = sanitize_string(data.get('back', ''), 5000)
    difficulty = safe_int(data.get('difficulty', 3), 3)

    if not front or not back:
        return jsonify({'error': 'front and back are required'}), 400

    difficulty = max(1, min(5, difficulty))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO flashcards (
                user_id, kp_id, front, back, difficulty
            ) VALUES (?, ?, ?, ?, ?)
        ''', (
            user_id,
            kp_id if kp_id else None,
            front,
            back,
            difficulty
        ))
        card_id = cursor.lastrowid
        conn.commit()

        cursor.execute('SELECT * FROM flashcards WHERE id = ?', (card_id,))
        card = dict(cursor.fetchone())

    return jsonify({'success': True, 'flashcard': card})


@app.route('/api/flashcards/<int:card_id>', methods=['PUT'])
@api_response
def update_flashcard(card_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM flashcards WHERE id = ? AND user_id = ?', (card_id, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Flashcard not found'}), 404

        update_fields = []
        params = []
        allowed_fields = ['front', 'back', 'difficulty', 'kp_id']
        for field in allowed_fields:
            if field in data:
                if field == 'front':
                    update_fields.append(f'{field} = ?')
                    params.append(sanitize_string(data[field], 1000))
                elif field == 'back':
                    update_fields.append(f'{field} = ?')
                    params.append(sanitize_string(data[field], 5000))
                elif field == 'difficulty':
                    diff = max(1, min(5, safe_int(data[field], 3)))
                    update_fields.append(f'{field} = ?')
                    params.append(diff)
                elif field == 'kp_id':
                    update_fields.append(f'{field} = ?')
                    params.append(data[field] if data[field] else None)

        if update_fields:
            update_fields.append('updated_at = CURRENT_TIMESTAMP')
            params.append(card_id)
            cursor.execute(f'UPDATE flashcards SET {", ".join(update_fields)} WHERE id = ?', params)
            conn.commit()

        cursor.execute('SELECT * FROM flashcards WHERE id = ?', (card_id,))
        card = dict(cursor.fetchone())

    return jsonify({'success': True, 'flashcard': card})


@app.route('/api/flashcards/<int:card_id>', methods=['DELETE'])
@api_response
def delete_flashcard(card_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM flashcards WHERE id = ? AND user_id = ?', (card_id, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Flashcard not found'}), 404
        cursor.execute('DELETE FROM flashcards WHERE id = ?', (card_id,))
        conn.commit()
    return jsonify({'success': True})


@app.route('/api/flashcards/<int:card_id>/review', methods=['POST'])
@api_response
def review_flashcard(card_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    quality = safe_int(data.get('quality', 3), 3)

    quality = max(1, min(5, quality))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM flashcards WHERE id = ? AND (user_id = ? OR user_id = ?)', (card_id, user_id, 'system_default'))
        card = cursor.fetchone()
        if not card:
            return jsonify({'error': 'Flashcard not found'}), 404

        srs_stage = card['srs_stage'] or 0
        new_stage, days = calculate_next_review(srs_stage, quality)

        if card['user_id'] == 'system_default':
            cursor.execute('''
                INSERT INTO flashcards (
                    user_id, kp_id, front, back, difficulty, srs_stage,
                    next_review_at, last_reviewed_at, review_count
                ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), CURRENT_TIMESTAMP, 1)
            ''', (
                user_id, card['kp_id'], card['front'], card['back'],
                card['difficulty'], new_stage, f'+{days} day'
            ))
            new_card_id = cursor.lastrowid
            card_id = new_card_id
        else:
            cursor.execute('''
                UPDATE flashcards 
                SET srs_stage = ?,
                    next_review_at = datetime('now', ?),
                    last_reviewed_at = CURRENT_TIMESTAMP,
                    review_count = review_count + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (new_stage, f'+{days} day', card_id))

        conn.commit()

        cursor.execute('SELECT * FROM flashcards WHERE id = ?', (card_id,))
        updated_card = dict(cursor.fetchone())

    return jsonify({
        'success': True,
        'flashcard': updated_card,
        'srs_stage': new_stage,
        'next_review_days': days
    })


@app.route('/api/flashcards/stats', methods=['GET'])
@api_response
def get_flashcard_stats():
    user_id = get_user_id()

    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT COUNT(*) FROM flashcards 
            WHERE user_id = ? OR user_id = ?
        ''', (user_id, 'system_default'))
        total_cards = cursor.fetchone()[0]

        cursor.execute('''
            SELECT COUNT(*) FROM flashcards 
            WHERE (user_id = ? OR user_id = ?)
            AND srs_stage >= 5
        ''', (user_id, 'system_default'))
        mastered_count = cursor.fetchone()[0]

        cursor.execute('''
            SELECT COUNT(*) FROM flashcards
            WHERE (user_id = ? OR user_id = ?)
            AND next_review_at <= datetime('now', 'localtime')
        ''', (user_id, 'system_default'))
        due_count = cursor.fetchone()[0]

        cursor.execute('''
            SELECT COUNT(*) FROM flashcards
            WHERE user_id = ?
            AND DATE(next_review_at, 'localtime') = DATE('now', 'localtime')
        ''', (user_id,))
        today_review = cursor.fetchone()[0]

        cursor.execute('SELECT SUM(review_count) FROM flashcards WHERE user_id = ?', (user_id,))
        total_reviews = cursor.fetchone()[0] or 0

    return jsonify({
        'total_cards': total_cards,
        'mastered_count': mastered_count,
        'due_count': due_count,
        'today_review_count': today_review,
        'total_reviews': total_reviews
    })


# ==================== 论文训练模块 ====================

@app.route('/api/essay/topics', methods=['GET'])
@api_response
def get_essay_topics():
    page, limit = get_pagination_params()
    year = request.args.get('year', '')
    category = request.args.get('category', '')
    search = request.args.get('search', '')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['1=1']
        params = []
        if year:
            where_clauses.append('year = ?')
            params.append(safe_int(year, 0))
        if category:
            where_clauses.append('topic_category = ?')
            params.append(sanitize_string(category, 50))
        if search:
            safe_search = sanitize_search_query(search)
            if safe_search:
                where_clauses.append("(topic_title LIKE ? ESCAPE '\\' OR background LIKE ? ESCAPE '\\')")
                like_pattern = f'%{safe_search}%'
                params.extend([like_pattern, like_pattern])

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM essay_topics WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT id, year, topic_title, topic_category, background, requirements, key_points, source
            FROM essay_topics
            WHERE {where_sql}
            ORDER BY year DESC, id ASC
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])
        topics = [dict(row) for row in cursor.fetchall()]

        cursor.execute('SELECT DISTINCT topic_category FROM essay_topics WHERE topic_category IS NOT NULL ORDER BY topic_category')
        categories = [row['topic_category'] for row in cursor.fetchall()]
        cursor.execute('SELECT DISTINCT year FROM essay_topics WHERE year IS NOT NULL ORDER BY year DESC')
        years = [row['year'] for row in cursor.fetchall()]

    return jsonify({'items': topics, 'total': total, 'page': page, 'limit': limit, 'categories': categories, 'years': years})


@app.route('/api/essay/topics/<int:topic_id>', methods=['GET'])
@api_response
def get_essay_topic_detail(topic_id):
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM essay_topics WHERE id = ?', (topic_id,))
        topic = cursor.fetchone()
        if not topic:
            return jsonify({'error': 'Essay topic not found'}), 404
        return jsonify(dict(topic))


@app.route('/api/essay/submit', methods=['POST'])
@api_response
def submit_essay():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    topic_id = safe_int(data.get('topic_id'), 0)
    title = sanitize_string(data.get('title', ''), 200)
    content = sanitize_string(data.get('content', ''), 50000)
    time_spent = safe_int(data.get('time_spent', 0), 0)
    self_score = data.get('self_score')
    self_evaluation = sanitize_string(data.get('self_evaluation', ''), 2000)
    status = sanitize_string(data.get('status', 'draft'), 20)

    if not topic_id:
        return jsonify({'error': 'topic_id is required'}), 400
    if status not in ['draft', 'submitted']:
        status = 'draft'

    word_count = len(content) if content else 0
    submitted_at = datetime.now().isoformat() if status == 'submitted' else None
    self_score = int(self_score) if self_score is not None else None

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM essay_topics WHERE id = ?', (topic_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Essay topic not found'}), 404

        cursor.execute('''
            INSERT INTO essay_submissions
            (user_id, topic_id, title, content, word_count, time_spent, self_score, self_evaluation, status, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, topic_id, title, content, word_count, time_spent, self_score, self_evaluation, status, submitted_at))
        sub_id = cursor.lastrowid
        conn.commit()

        cursor.execute('SELECT * FROM essay_submissions WHERE id = ?', (sub_id,))
        submission = dict(cursor.fetchone())

    return jsonify({'success': True, 'submission': submission})


@app.route('/api/essay/submissions', methods=['GET'])
@api_response
def get_essay_submissions():
    page, limit = get_pagination_params()
    user_id = get_user_id()
    topic_id = request.args.get('topic_id', '')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['user_id = ?']
        params = [user_id]
        if topic_id:
            where_clauses.append('topic_id = ?')
            params.append(safe_int(topic_id, 0))

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM essay_submissions WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT es.*, et.topic_title, et.topic_category, et.year
            FROM essay_submissions es
            LEFT JOIN essay_topics et ON es.topic_id = et.id
            WHERE {where_sql}
            ORDER BY es.created_at DESC
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])
        submissions = [dict(row) for row in cursor.fetchall()]

    return jsonify({'items': submissions, 'total': total, 'page': page, 'limit': limit})


@app.route('/api/essay/submissions/<int:sub_id>', methods=['GET'])
@api_response
def get_essay_submission_detail(sub_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT es.*, et.topic_title, et.topic_category, et.year, et.background, et.requirements, et.key_points, et.reference_essay
            FROM essay_submissions es
            LEFT JOIN essay_topics et ON es.topic_id = et.id
            WHERE es.id = ? AND es.user_id = ?
        ''', (sub_id, user_id))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Submission not found'}), 404
        return jsonify(dict(row))


@app.route('/api/essay/submissions/<int:sub_id>', methods=['PUT'])
@api_response
def update_essay_submission(sub_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM essay_submissions WHERE id = ? AND user_id = ?', (sub_id, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Submission not found'}), 404

        update_fields = []
        params = []
        if 'title' in data:
            update_fields.append('title = ?')
            params.append(sanitize_string(data['title'], 200))
        if 'content' in data:
            content = sanitize_string(data['content'], 50000)
            update_fields.append('content = ?')
            params.append(content)
            update_fields.append('word_count = ?')
            params.append(len(content) if content else 0)
        if 'time_spent' in data:
            update_fields.append('time_spent = ?')
            params.append(safe_int(data['time_spent'], 0))
        if 'self_score' in data:
            ss = data['self_score']
            update_fields.append('self_score = ?')
            params.append(int(ss) if ss is not None else None)
        if 'self_evaluation' in data:
            update_fields.append('self_evaluation = ?')
            params.append(sanitize_string(data['self_evaluation'], 2000))
        if 'status' in data:
            st = sanitize_string(data['status'], 20)
            if st in ['draft', 'submitted']:
                update_fields.append('status = ?')
                params.append(st)
                if st == 'submitted':
                    update_fields.append('submitted_at = ?')
                    params.append(datetime.now().isoformat())

        if update_fields:
            update_fields.append('updated_at = CURRENT_TIMESTAMP')
            params.append(sub_id)
            cursor.execute(f'UPDATE essay_submissions SET {", ".join(update_fields)} WHERE id = ?', params)
            conn.commit()

        cursor.execute('SELECT * FROM essay_submissions WHERE id = ?', (sub_id,))
        submission = dict(cursor.fetchone())

    return jsonify({'success': True, 'submission': submission})


@app.route('/api/essay/stats', methods=['GET'])
@api_response
def get_essay_stats():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM essay_submissions WHERE user_id = ?', (user_id,))
        total = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM essay_submissions WHERE user_id = ? AND status = 'submitted'", (user_id,))
        submitted = cursor.fetchone()[0]
        cursor.execute('SELECT AVG(self_score) FROM essay_submissions WHERE user_id = ? AND self_score IS NOT NULL', (user_id,))
        avg_score = cursor.fetchone()[0]
        cursor.execute('SELECT SUM(word_count) FROM essay_submissions WHERE user_id = ?', (user_id,))
        total_words = cursor.fetchone()[0] or 0
        cursor.execute('SELECT SUM(time_spent) FROM essay_submissions WHERE user_id = ?', (user_id,))
        total_time = cursor.fetchone()[0] or 0
        cursor.execute('SELECT COUNT(*) FROM essay_topics')
        total_topics = cursor.fetchone()[0]

    return jsonify({
        'total_submissions': total,
        'submitted_count': submitted,
        'avg_self_score': round(avg_score, 1) if avg_score else 0,
        'total_words': total_words,
        'total_time_spent': total_time,
        'total_topics': total_topics
    })


# ==================== 案例分析训练模块 ====================

@app.route('/api/case/questions', methods=['GET'])
@api_response
def get_case_questions():
    page, limit = get_pagination_params()
    year = request.args.get('year', '')
    category = request.args.get('category', '')
    search = request.args.get('search', '')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['1=1']
        params = []
        if year:
            where_clauses.append('year = ?')
            params.append(safe_int(year, 0))
        if category:
            where_clauses.append('category = ?')
            params.append(sanitize_string(category, 50))
        if search:
            safe_search = sanitize_search_query(search)
            if safe_search:
                where_clauses.append("(case_title LIKE ? ESCAPE '\\' OR background LIKE ? ESCAPE '\\')")
                like_pattern = f'%{safe_search}%'
                params.extend([like_pattern, like_pattern])

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM case_questions WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT id, year, case_title, category, background, key_points, source
            FROM case_questions
            WHERE {where_sql}
            ORDER BY year DESC, id ASC
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])
        questions = [dict(row) for row in cursor.fetchall()]

        cursor.execute('SELECT DISTINCT category FROM case_questions WHERE category IS NOT NULL ORDER BY category')
        categories = [row['category'] for row in cursor.fetchall()]
        cursor.execute('SELECT DISTINCT year FROM case_questions WHERE year IS NOT NULL ORDER BY year DESC')
        years = [row['year'] for row in cursor.fetchall()]

    return jsonify({'items': questions, 'total': total, 'page': page, 'limit': limit, 'categories': categories, 'years': years})


@app.route('/api/case/questions/<int:case_id>', methods=['GET'])
@api_response
def get_case_question_detail(case_id):
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM case_questions WHERE id = ?', (case_id,))
        case = cursor.fetchone()
        if not case:
            return jsonify({'error': 'Case question not found'}), 404
        result = dict(case)
        try:
            result['questions_list'] = json.loads(result['questions']) if result['questions'] else []
        except (json.JSONDecodeError, TypeError):
            result['questions_list'] = []
        return jsonify(result)


@app.route('/api/case/submit', methods=['POST'])
@api_response
def submit_case():
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    case_id = safe_int(data.get('case_id'), 0)
    answers = data.get('answers', {})
    time_spent = safe_int(data.get('time_spent', 0), 0)
    self_score = data.get('self_score')
    status = sanitize_string(data.get('status', 'draft'), 20)

    if not case_id:
        return jsonify({'error': 'case_id is required'}), 400
    if status not in ['draft', 'submitted']:
        status = 'draft'

    if not isinstance(answers, dict):
        answers = {}
    answers_json = json.dumps(answers, ensure_ascii=False)
    submitted_at = datetime.now().isoformat() if status == 'submitted' else None
    self_score = int(self_score) if self_score is not None else None

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM case_questions WHERE id = ?', (case_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Case question not found'}), 404

        cursor.execute('''
            INSERT INTO case_submissions
            (user_id, case_id, answers, self_score, time_spent, status, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, case_id, answers_json, self_score, time_spent, status, submitted_at))
        sub_id = cursor.lastrowid
        conn.commit()

        cursor.execute('SELECT * FROM case_submissions WHERE id = ?', (sub_id,))
        submission = dict(cursor.fetchone())

    return jsonify({'success': True, 'submission': submission})


@app.route('/api/case/submissions', methods=['GET'])
@api_response
def get_case_submissions():
    page, limit = get_pagination_params()
    user_id = get_user_id()
    case_id = request.args.get('case_id', '')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['user_id = ?']
        params = [user_id]
        if case_id:
            where_clauses.append('case_id = ?')
            params.append(safe_int(case_id, 0))

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM case_submissions WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT cs.*, cq.case_title, cq.category, cq.year
            FROM case_submissions cs
            LEFT JOIN case_questions cq ON cs.case_id = cq.id
            WHERE {where_sql}
            ORDER BY cs.created_at DESC
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])
        submissions = [dict(row) for row in cursor.fetchall()]

    return jsonify({'items': submissions, 'total': total, 'page': page, 'limit': limit})


@app.route('/api/case/submissions/<int:sub_id>', methods=['GET'])
@api_response
def get_case_submission_detail(sub_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT cs.*, cq.case_title, cq.category, cq.year, cq.background, cq.questions, cq.reference_answer, cq.key_points
            FROM case_submissions cs
            LEFT JOIN case_questions cq ON cs.case_id = cq.id
            WHERE cs.id = ? AND cs.user_id = ?
        ''', (sub_id, user_id))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Submission not found'}), 404
        result = dict(row)
        try:
            result['questions_list'] = json.loads(result['questions']) if result['questions'] else []
        except (json.JSONDecodeError, TypeError):
            result['questions_list'] = []
        try:
            result['answers_list'] = json.loads(result['answers']) if result['answers'] else {}
        except (json.JSONDecodeError, TypeError):
            result['answers_list'] = {}
        return jsonify(result)


@app.route('/api/case/submissions/<int:sub_id>', methods=['PUT'])
@api_response
def update_case_submission(sub_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM case_submissions WHERE id = ? AND user_id = ?', (sub_id, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Submission not found'}), 404

        update_fields = []
        params = []
        if 'answers' in data:
            answers = data['answers'] if isinstance(data['answers'], dict) else {}
            update_fields.append('answers = ?')
            params.append(json.dumps(answers, ensure_ascii=False))
        if 'time_spent' in data:
            update_fields.append('time_spent = ?')
            params.append(safe_int(data['time_spent'], 0))
        if 'self_score' in data:
            ss = data['self_score']
            update_fields.append('self_score = ?')
            params.append(int(ss) if ss is not None else None)
        if 'status' in data:
            st = sanitize_string(data['status'], 20)
            if st in ['draft', 'submitted']:
                update_fields.append('status = ?')
                params.append(st)
                if st == 'submitted':
                    update_fields.append('submitted_at = ?')
                    params.append(datetime.now().isoformat())

        if update_fields:
            update_fields.append('updated_at = CURRENT_TIMESTAMP')
            params.append(sub_id)
            cursor.execute(f'UPDATE case_submissions SET {", ".join(update_fields)} WHERE id = ?', params)
            conn.commit()

        cursor.execute('SELECT * FROM case_submissions WHERE id = ?', (sub_id,))
        submission = dict(cursor.fetchone())

    return jsonify({'success': True, 'submission': submission})


@app.route('/api/case/stats', methods=['GET'])
@api_response
def get_case_stats():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM case_submissions WHERE user_id = ?', (user_id,))
        total = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM case_submissions WHERE user_id = ? AND status = 'submitted'", (user_id,))
        submitted = cursor.fetchone()[0]
        cursor.execute('SELECT AVG(self_score) FROM case_submissions WHERE user_id = ? AND self_score IS NOT NULL', (user_id,))
        avg_score = cursor.fetchone()[0]
        cursor.execute('SELECT SUM(time_spent) FROM case_submissions WHERE user_id = ?', (user_id,))
        total_time = cursor.fetchone()[0] or 0
        cursor.execute('SELECT COUNT(*) FROM case_questions')
        total_cases = cursor.fetchone()[0]

    return jsonify({
        'total_submissions': total,
        'submitted_count': submitted,
        'avg_self_score': round(avg_score, 1) if avg_score else 0,
        'total_time_spent': total_time,
        'total_cases': total_cases
    })


# ==================== 教材知识学习模块 ====================

@app.route('/api/textbook/chapters', methods=['GET'])
@api_response
def get_textbook_chapters():
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, chapter_num, title, summary, word_count, parent_id, level, sort_order
            FROM textbook_chapters
            ORDER BY sort_order ASC, id ASC
        ''')
        chapters = [dict(row) for row in cursor.fetchall()]
    return jsonify({'items': chapters, 'total': len(chapters)})


@app.route('/api/textbook/chapters/<int:chapter_id>', methods=['GET'])
@api_response
def get_textbook_chapter_detail(chapter_id):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM textbook_chapters WHERE id = ?', (chapter_id,))
        chapter = cursor.fetchone()
        if not chapter:
            return jsonify({'error': 'Chapter not found'}), 404
        result = dict(chapter)

        cursor.execute('SELECT * FROM reading_progress WHERE user_id = ? AND chapter_id = ?', (user_id, chapter_id))
        progress = cursor.fetchone()
        result['progress'] = dict(progress) if progress else {'status': 'unread', 'read_time': 0}

        cursor.execute('SELECT id, title, chapter_num FROM textbook_chapters WHERE sort_order < ? ORDER BY sort_order DESC LIMIT 1', (chapter['sort_order'],))
        prev = cursor.fetchone()
        result['prev_chapter'] = dict(prev) if prev else None
        cursor.execute('SELECT id, title, chapter_num FROM textbook_chapters WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1', (chapter['sort_order'],))
        nxt = cursor.fetchone()
        result['next_chapter'] = dict(nxt) if nxt else None
    return jsonify(result)


@app.route('/api/textbook/chapters/<int:chapter_id>/progress', methods=['POST'])
@api_response
def update_reading_progress(chapter_id):
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    status = sanitize_string(data.get('status', 'reading'), 20)
    read_time = safe_int(data.get('read_time', 0), 0)

    if status not in ['unread', 'reading', 'completed']:
        status = 'reading'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM textbook_chapters WHERE id = ?', (chapter_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Chapter not found'}), 404

        cursor.execute('''
            INSERT INTO reading_progress (user_id, chapter_id, status, read_time, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, chapter_id) DO UPDATE SET
                status = excluded.status,
                read_time = reading_progress.read_time + excluded.read_time,
                updated_at = CURRENT_TIMESTAMP
        ''', (user_id, chapter_id, status, read_time))
        conn.commit()

        cursor.execute('SELECT * FROM reading_progress WHERE user_id = ? AND chapter_id = ?', (user_id, chapter_id))
        progress = dict(cursor.fetchone())

    return jsonify({'success': True, 'progress': progress})


@app.route('/api/textbook/progress', methods=['GET'])
@api_response
def get_textbook_progress():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM textbook_chapters')
        total_chapters = cursor.fetchone()[0]
        cursor.execute('''
            SELECT status, COUNT(*) as cnt
            FROM reading_progress
            WHERE user_id = ?
            GROUP BY status
        ''', (user_id,))
        status_counts = {row['status']: row['cnt'] for row in cursor.fetchall()}
        cursor.execute('SELECT SUM(read_time) FROM reading_progress WHERE user_id = ?', (user_id,))
        total_read_time = cursor.fetchone()[0] or 0

        cursor.execute('''
            SELECT rp.status, rp.read_time, rp.updated_at, tc.id, tc.chapter_num, tc.title, tc.word_count
            FROM reading_progress rp
            JOIN textbook_chapters tc ON rp.chapter_id = tc.id
            WHERE rp.user_id = ?
            ORDER BY rp.updated_at DESC
            LIMIT 10
        ''', (user_id,))
        recent = [dict(row) for row in cursor.fetchall()]

    completed = status_counts.get('completed', 0)
    reading = status_counts.get('reading', 0)
    return jsonify({
        'total_chapters': total_chapters,
        'completed_count': completed,
        'reading_count': reading,
        'unread_count': max(0, total_chapters - completed - reading),
        'total_read_time': total_read_time,
        'completion_rate': round(completed / total_chapters * 100, 2) if total_chapters > 0 else 0,
        'recent_chapters': recent
    })


@app.route('/api/textbook/search', methods=['GET'])
@api_response
def search_textbook():
    keyword = sanitize_search_query(request.args.get('q', ''))
    page, limit = get_pagination_params()
    if not keyword:
        return jsonify({'items': [], 'total': 0, 'page': page, 'limit': limit})

    with get_db_conn() as conn:
        cursor = conn.cursor()
        like_pattern = f'%{keyword}%'
        cursor.execute('''
            SELECT COUNT(*) FROM textbook_chapters
            WHERE content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
        ''', (like_pattern, like_pattern))
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute('''
            SELECT id, chapter_num, title, summary, word_count
            FROM textbook_chapters
            WHERE content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
            ORDER BY sort_order ASC
            LIMIT ? OFFSET ?
        ''', (like_pattern, like_pattern, limit, offset))
        chapters = [dict(row) for row in cursor.fetchall()]

    return jsonify({'items': chapters, 'total': total, 'page': page, 'limit': limit})


# ==================== 真题题库与真实模考 ====================

@app.route('/api/real-exam/questions', methods=['GET'])
@api_response
def get_real_exam_questions():
    page, limit = get_pagination_params()
    year = request.args.get('year', '')
    category = request.args.get('category', '')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_clauses = ['1=1']
        params = []
        if year:
            where_clauses.append('year = ?')
            params.append(safe_int(year, 0))
        if category:
            where_clauses.append('category = ?')
            params.append(sanitize_string(category, 50))

        where_sql = ' AND '.join(where_clauses)
        cursor.execute(f'SELECT COUNT(*) FROM real_exam_questions WHERE {where_sql}', params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * limit
        cursor.execute(f'''
            SELECT id, year, question_text, options, correct_answer, explanation, category, source
            FROM real_exam_questions
            WHERE {where_sql}
            ORDER BY year DESC, id ASC
            LIMIT ? OFFSET ?
        ''', params + [limit, offset])
        questions = []
        for row in cursor.fetchall():
            q = dict(row)
            try:
                q['options_list'] = json.loads(q['options']) if q['options'] else []
            except (json.JSONDecodeError, TypeError):
                q['options_list'] = []
            questions.append(q)

        cursor.execute('SELECT DISTINCT category FROM real_exam_questions WHERE category IS NOT NULL ORDER BY category')
        categories = [row['category'] for row in cursor.fetchall()]
        cursor.execute('SELECT DISTINCT year FROM real_exam_questions WHERE year IS NOT NULL ORDER BY year DESC')
        years = [row['year'] for row in cursor.fetchall()]

    return jsonify({'items': questions, 'total': total, 'page': page, 'limit': limit, 'categories': categories, 'years': years})


@app.route('/api/real-exam/start', methods=['POST'])
@api_response
def start_real_exam():
    """创建一次真题模考：从真题题库随机抽题，存入 mock_exams 表"""
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    year = data.get('year')
    question_count = safe_int(data.get('question_count', 20), 20)
    question_count = max(5, min(75, question_count))
    title = sanitize_string(data.get('title', '真题模考'), 100)

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM real_exam_questions')
        total_available = cursor.fetchone()[0]
        if total_available == 0:
            return jsonify({'error': 'No real exam questions available'}), 400

        if year:
            cursor.execute('SELECT * FROM real_exam_questions WHERE year = ? ORDER BY RANDOM() LIMIT ?', (safe_int(year, 0), question_count))
            rows = cursor.fetchall()
            if not rows:
                cursor.execute('SELECT * FROM real_exam_questions ORDER BY RANDOM() LIMIT ?', (question_count,))
                rows = cursor.fetchall()
        else:
            cursor.execute('SELECT * FROM real_exam_questions ORDER BY RANDOM() LIMIT ?', (question_count,))
            rows = cursor.fetchall()

        cursor.execute('''
            INSERT INTO mock_exams (user_id, title, exam_type, total_questions, duration_minutes, status, created_at)
            VALUES (?, ?, 'real', ?, 150, 'draft', CURRENT_TIMESTAMP)
        ''', (user_id, title, len(rows)))
        exam_id = cursor.lastrowid

        for idx, row in enumerate(rows):
            cursor.execute('''
                INSERT INTO mock_exam_questions
                (exam_id, question_id, question_text, question_type, options, correct_answer, order_index, kp_id, explanation)
                VALUES (?, ?, ?, 'single_choice', ?, ?, ?, NULL, ?)
            ''', (
                exam_id, row['id'], row['question_text'],
                row['options'], row['correct_answer'], idx, row['explanation']
            ))
        conn.commit()

        cursor.execute('SELECT * FROM mock_exams WHERE id = ?', (exam_id,))
        exam = dict(cursor.fetchone())

    return jsonify({'success': True, 'exam_id': exam_id, 'exam': exam})


@app.route('/api/real-exam/stats', methods=['GET'])
@api_response
def get_real_exam_stats():
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM mock_exams WHERE user_id = ? AND exam_type = 'real'", (user_id,))
        total_exams = cursor.fetchone()[0]
        cursor.execute("SELECT AVG(score) FROM mock_exams WHERE user_id = ? AND exam_type = 'real' AND score IS NOT NULL", (user_id,))
        avg_score = cursor.fetchone()[0]
        cursor.execute("SELECT MAX(score) FROM mock_exams WHERE user_id = ? AND exam_type = 'real' AND score IS NOT NULL", (user_id,))
        best_score = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM real_exam_questions')
        total_questions = cursor.fetchone()[0]

        cursor.execute('''
            SELECT id, title, score, correct_count, total_questions, submitted_at
            FROM mock_exams
            WHERE user_id = ? AND exam_type = 'real'
            ORDER BY created_at DESC LIMIT 10
        ''', (user_id,))
        recent = [dict(row) for row in cursor.fetchall()]

        cursor.execute('''
            SELECT category, COUNT(*) as cnt
            FROM real_exam_questions
            GROUP BY category ORDER BY cnt DESC
        ''')
        category_dist = [dict(row) for row in cursor.fetchall()]

    return jsonify({
        'total_exams': total_exams,
        'avg_score': round(avg_score, 1) if avg_score else 0,
        'best_score': round(best_score, 1) if best_score else 0,
        'total_questions': total_questions,
        'recent_exams': recent,
        'category_distribution': category_dist
    })


# ==================== 考纲覆盖度仪表盘 ====================

@app.route('/api/syllabus/coverage', methods=['GET'])
@api_response
def get_syllabus_coverage():
    """考纲覆盖度：基于 knowledge_points 树 + 用户认知 + 错题映射 + 教材阅读进度"""
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        # 取一级章节（level=1）
        cursor.execute('SELECT * FROM knowledge_points WHERE level = 1 ORDER BY sort_order ASC')
        chapters = [dict(row) for row in cursor.fetchall()]

        # 用户认知数据
        cursor.execute('SELECT kp_id, mastery_score FROM user_cognition WHERE user_id = ?', (user_id,))
        cognition_map = {row['kp_id']: row['mastery_score'] for row in cursor.fetchall()}

        # 错题映射：统计每个 kp_id 的错题数和正确率
        cursor.execute('''
            SELECT qm.kp_id,
                   COUNT(DISTINCT wq.id) as wrong_count,
                   SUM(wq.is_mastered) as mastered_count
            FROM question_mapping qm
            JOIN wrong_questions wq ON qm.question_id = wq.id
            WHERE wq.user_id = ?
            GROUP BY qm.kp_id
        ''', (user_id,))
        question_stats = {}
        for row in cursor.fetchall():
            question_stats[row['kp_id']] = {
                'wrong_count': row['wrong_count'],
                'mastered_count': row['mastered_count'] or 0
            }

        # 教材阅读进度
        cursor.execute('''
            SELECT rp.status, tc.title
            FROM reading_progress rp
            JOIN textbook_chapters tc ON rp.chapter_id = tc.id
            WHERE rp.user_id = ? AND rp.status = 'completed'
        ''', (user_id,))
        completed_chapters = [row['title'] for row in cursor.fetchall()]

        result = []
        for ch in chapters:
            # 递归统计该章节下所有后代的覆盖情况
            cursor.execute('''
                WITH RECURSIVE descendants AS (
                    SELECT id FROM knowledge_points WHERE id = ?
                    UNION ALL
                    SELECT kp.id FROM knowledge_points kp
                    JOIN descendants d ON kp.parent_id = d.id
                )
                SELECT COUNT(*) as total_kps,
                       SUM(CASE WHEN uc.mastery_score IS NOT NULL THEN 1 ELSE 0 END) as visited_kps,
                       AVG(uc.mastery_score) as avg_mastery
                FROM descendants d
                LEFT JOIN user_cognition uc ON d.id = uc.kp_id AND uc.user_id = ?
            ''', (ch['id'], user_id))
            stats = cursor.fetchone()

            cursor.execute('''
                WITH RECURSIVE descendants AS (
                    SELECT id FROM knowledge_points WHERE id = ?
                    UNION ALL
                    SELECT kp.id FROM knowledge_points kp
                    JOIN descendants d ON kp.parent_id = d.id
                )
                SELECT COUNT(DISTINCT wq.id) as total_wrong
                FROM descendants d
                JOIN question_mapping qm ON d.id = qm.kp_id
                JOIN wrong_questions wq ON qm.question_id = wq.id
                WHERE wq.user_id = ?
            ''', (ch['id'], user_id))
            wrong_stats = cursor.fetchone()

            total_kps = stats['total_kps'] or 0
            visited_kps = stats['visited_kps'] or 0
            avg_mastery = stats['avg_mastery'] or 0
            total_wrong = wrong_stats['total_wrong'] or 0

            # 覆盖度 = 已访问知识点 / 总知识点
            coverage_rate = round(visited_kps / total_kps * 100, 1) if total_kps > 0 else 0
            # 掌握度 = 平均认知得分（0-1 转 0-100）
            mastery_rate = round(avg_mastery * 100, 1) if avg_mastery else 0

            # 状态判定
            if coverage_rate == 0:
                status = 'unread'
            elif mastery_rate >= 80 and total_wrong == 0:
                status = 'mastered'
            elif coverage_rate >= 50:
                status = 'learning'
            else:
                status = 'weak'

            result.append({
                'id': ch['id'],
                'name': ch['name'],
                'category': ch['category'],
                'exam_weight': ch['exam_weight'],
                'total_kps': total_kps,
                'visited_kps': visited_kps,
                'coverage_rate': coverage_rate,
                'mastery_rate': mastery_rate,
                'wrong_count': total_wrong,
                'status': status
            })

        total_chapters = len(result)
        mastered = sum(1 for r in result if r['status'] == 'mastered')
        learning = sum(1 for r in result if r['status'] == 'learning')
        weak = sum(1 for r in result if r['status'] == 'weak')
        unread = sum(1 for r in result if r['status'] == 'unread')
        overall_coverage = round(sum(r['coverage_rate'] for r in result) / total_chapters, 1) if total_chapters else 0
        overall_mastery = round(sum(r['mastery_rate'] for r in result) / total_chapters, 1) if total_chapters else 0

    return jsonify({
        'chapters': result,
        'summary': {
            'total_chapters': total_chapters,
            'mastered_count': mastered,
            'learning_count': learning,
            'weak_count': weak,
            'unread_count': unread,
            'overall_coverage': overall_coverage,
            'overall_mastery': overall_mastery,
            'completed_textbook_chapters': len(completed_chapters)
        }
    })


# ==================== 学习激励体系（打卡+时长） ====================

@app.route('/api/checkin', methods=['POST'])
@api_response
def checkin():
    """每日打卡：记录当日学习时长"""
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    study_minutes = safe_int(data.get('study_minutes', 0), 0)
    study_minutes = max(0, min(1440, study_minutes))  # 单日上限 1440 分钟
    note = sanitize_string(data.get('note', ''), 500)
    today = datetime.now().strftime('%Y-%m-%d')

    with get_db_conn() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO study_checkins (user_id, checkin_date, study_minutes, note)
                VALUES (?, ?, ?, ?)
            ''', (user_id, today, study_minutes, note))
            checkin_id = cursor.lastrowid
            is_first_today = True
        except sqlite3.IntegrityError:
            cursor.execute('''
                UPDATE study_checkins
                SET study_minutes = ?, note = ?
                WHERE user_id = ? AND checkin_date = ?
            ''', (study_minutes, note, user_id, today))
            cursor.execute('SELECT id FROM study_checkins WHERE user_id = ? AND checkin_date = ?', (user_id, today))
            checkin_id = cursor.fetchone()[0]
            is_first_today = False
        conn.commit()

        # 计算连续打卡天数
        cursor.execute('''
            SELECT checkin_date FROM study_checkins
            WHERE user_id = ?
            ORDER BY checkin_date DESC LIMIT 60
        ''', (user_id,))
        dates = [row['checkin_date'] for row in cursor.fetchall()]
        streak = 0
        today_dt = datetime.now().date()
        for i, d in enumerate(dates):
            expected = (today_dt - timedelta(days=i)).strftime('%Y-%m-%d')
            if d == expected:
                streak += 1
            else:
                break

        cursor.execute('''
            SELECT COUNT(*) as total_days, COALESCE(SUM(study_minutes), 0) as total_minutes
            FROM study_checkins WHERE user_id = ?
        ''', (user_id,))
        agg = cursor.fetchone()

    return jsonify({
        'success': True,
        'checkin_id': checkin_id,
        'is_first_today': is_first_today,
        'streak': streak,
        'total_days': agg['total_days'],
        'total_minutes': agg['total_minutes']
    })


@app.route('/api/checkin/today', methods=['GET'])
@api_response
def get_today_checkin():
    """获取今日打卡状态"""
    user_id = get_user_id()
    today = datetime.now().strftime('%Y-%m-%d')
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM study_checkins WHERE user_id = ? AND checkin_date = ?', (user_id, today))
        row = cursor.fetchone()
        if row:
            return jsonify(dict(row))
        return jsonify({'checked_in': False, 'study_minutes': 0})


@app.route('/api/checkin/streak', methods=['GET'])
@api_response
def get_checkin_streak():
    """获取连续打卡统计"""
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT checkin_date FROM study_checkins
            WHERE user_id = ?
            ORDER BY checkin_date DESC LIMIT 365
        ''', (user_id,))
        dates = [row['checkin_date'] for row in cursor.fetchall()]

        today_dt = datetime.now().date()
        current_streak = 0
        for i, d in enumerate(dates):
            expected = (today_dt - timedelta(days=i)).strftime('%Y-%m-%d')
            if d == expected:
                current_streak += 1
            else:
                break

        longest = 0
        if dates:
            prev = None
            run = 0
            for d in sorted(dates):
                if prev:
                    diff = (datetime.strptime(d, '%Y-%m-%d').date() - prev).days
                    if diff == 1:
                        run += 1
                    else:
                        run = 1
                else:
                    run = 1
                longest = max(longest, run)
                prev = datetime.strptime(d, '%Y-%m-%d').date()

        cursor.execute('''
            SELECT COUNT(*) as total, COALESCE(SUM(study_minutes),0) as total_min,
                   MAX(checkin_date) as last_date
            FROM study_checkins WHERE user_id = ?
        ''', (user_id,))
        agg = cursor.fetchone()

    return jsonify({
        'current_streak': current_streak,
        'longest_streak': longest,
        'total_checkin_days': agg['total'],
        'total_study_minutes': agg['total_min'],
        'last_checkin_date': agg['last_date']
    })


@app.route('/api/checkin/calendar', methods=['GET'])
@api_response
def get_checkin_calendar():
    """获取指定月份的打卡日历"""
    user_id = get_user_id()
    month = request.args.get('month', datetime.now().strftime('%Y-%m'))
    try:
        datetime.strptime(month, '%Y-%m')
    except ValueError:
        return jsonify({'error': 'Invalid month format, use YYYY-MM'}), 400

    start = f'{month}-01'
    end = f'{month}-31'
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT checkin_date, study_minutes, note
            FROM study_checkins
            WHERE user_id = ? AND checkin_date BETWEEN ? AND ?
            ORDER BY checkin_date
        ''', (user_id, start, end))
        records = [dict(row) for row in cursor.fetchall()]
    return jsonify({'month': month, 'records': records})


@app.route('/api/study-session', methods=['POST'])
@api_response
def record_study_session():
    """记录一次学习会话（开始+结束+时长）"""
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    module = sanitize_string(data.get('module', ''), 50)
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    duration_minutes = safe_int(data.get('duration_minutes', 0), 0)

    if not start_time:
        start_time = datetime.now().isoformat()
    if not end_time:
        end_time = datetime.now().isoformat()
    if duration_minutes <= 0:
        try:
            duration_minutes = int((datetime.fromisoformat(end_time) - datetime.fromisoformat(start_time)).total_seconds() / 60)
        except Exception:
            duration_minutes = 0
    duration_minutes = max(0, min(1440, duration_minutes))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO study_sessions (user_id, module, start_time, end_time, duration_minutes)
            VALUES (?, ?, ?, ?, ?)
        ''', (user_id, module, start_time, end_time, duration_minutes))
        session_id = cursor.lastrowid
        conn.commit()

    return jsonify({'success': True, 'session_id': session_id, 'duration_minutes': duration_minutes})


@app.route('/api/study-session/stats', methods=['GET'])
@api_response
def get_study_session_stats():
    """学习时长统计（按日/周/月聚合）"""
    user_id = get_user_id()
    days = safe_int(request.args.get('days', 30), 30)
    days = max(1, min(365, days))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT DATE(start_time) as study_date,
                   SUM(duration_minutes) as total_minutes,
                   COUNT(*) as session_count
            FROM study_sessions
            WHERE user_id = ? AND start_time >= ?
            GROUP BY DATE(start_time)
            ORDER BY study_date
        ''', (user_id, (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')))
        daily = [dict(row) for row in cursor.fetchall()]

        cursor.execute('''
            SELECT module, SUM(duration_minutes) as total_minutes, COUNT(*) as cnt
            FROM study_sessions
            WHERE user_id = ? AND start_time >= ?
            GROUP BY module ORDER BY total_minutes DESC
        ''', (user_id, (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')))
        by_module = [dict(row) for row in cursor.fetchall()]

        total_minutes = sum(d['total_minutes'] or 0 for d in daily)
        active_days = len(daily)

    return jsonify({
        'days': days,
        'total_minutes': total_minutes,
        'active_days': active_days,
        'avg_minutes_per_day': round(total_minutes / days, 1) if days else 0,
        'avg_minutes_per_active_day': round(total_minutes / active_days, 1) if active_days else 0,
        'daily_records': daily,
        'by_module': by_module
    })


# ==================== 自定义题目（手动录入/导入） ====================

@app.route('/api/custom-questions', methods=['POST'])
@api_response
def create_custom_question():
    """手动录入题目"""
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    question_text = sanitize_string(data.get('question_text', ''), 5000)
    question_type = sanitize_string(data.get('question_type', 'single_choice'), 30) or 'single_choice'
    correct_answer = sanitize_string(data.get('correct_answer', ''), 500)
    explanation = sanitize_string(data.get('explanation', ''), 5000)
    category = sanitize_string(data.get('category', ''), 100)
    kp_id = data.get('kp_id')
    source = sanitize_string(data.get('source', 'manual'), 30) or 'manual'

    if not question_text:
        return jsonify({'error': '题目内容不能为空'}), 400
    if not correct_answer:
        return jsonify({'error': '正确答案不能为空'}), 400

    options = data.get('options')
    options_json = json.dumps(options, ensure_ascii=False) if options is not None else None

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO custom_questions
            (user_id, question_text, question_type, options, correct_answer, explanation, category, kp_id, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, question_text, question_type, options_json, correct_answer, explanation, category, kp_id, source))
        qid = cursor.lastrowid
        cursor.execute('SELECT * FROM custom_questions WHERE id = ?', (qid,))
        row = dict(cursor.fetchone())
        conn.commit()

    return jsonify({'success': True, 'question': row})


@app.route('/api/custom-questions', methods=['GET'])
@api_response
def list_custom_questions():
    """列表查询自定义题目"""
    user_id = get_user_id()
    page = safe_int(request.args.get('page', 1), 1)
    limit = safe_int(request.args.get('limit', 20), 20)
    limit = max(1, min(100, limit))
    offset = (page - 1) * limit
    category = request.args.get('category', '').strip()

    with get_db_conn() as conn:
        cursor = conn.cursor()
        where_sql = 'WHERE user_id = ?'
        params = [user_id]
        if category:
            like_pattern = sanitize_search_query(category)
            where_sql += ' AND category LIKE ? ESCAPE \'\\\''
            params.append(f'%{like_pattern}%')

        cursor.execute(f'SELECT COUNT(*) FROM custom_questions {where_sql}', params)
        total = cursor.fetchone()[0]

        cursor.execute(f'''
            SELECT * FROM custom_questions {where_sql}
            ORDER BY created_at DESC LIMIT ? OFFSET ?
        ''', params + [limit, offset])
        items = [dict(row) for row in cursor.fetchall()]

        cursor.execute('SELECT DISTINCT category FROM custom_questions WHERE user_id = ? AND category IS NOT NULL', (user_id,))
        categories = [row['category'] for row in cursor.fetchall()]

    return jsonify({'items': items, 'total': total, 'page': page, 'limit': limit, 'categories': categories})


@app.route('/api/custom-questions/<int:qid>', methods=['GET'])
@api_response
def get_custom_question(qid):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM custom_questions WHERE id = ? AND user_id = ?', (qid, user_id))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Question not found'}), 404
        return jsonify(dict(row))


@app.route('/api/custom-questions/<int:qid>', methods=['PUT'])
@api_response
def update_custom_question(qid):
    user_id = request.get_json().get('user_id', 'default_user') if request.get_json() else 'default_user'
    user_id = user_id or 'default_user'
    data = request.get_json() or {}

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM custom_questions WHERE id = ? AND user_id = ?', (qid, user_id))
        if not cursor.fetchone():
            return jsonify({'error': 'Question not found'}), 404

        updates = []
        params = []
        for field, max_len in [('question_text', 5000), ('question_type', 30), ('correct_answer', 500),
                                ('explanation', 5000), ('category', 100), ('source', 30)]:
            if field in data:
                updates.append(f'{field} = ?')
                params.append(sanitize_string(data[field], max_len))
        if 'options' in data:
            updates.append('options = ?')
            params.append(json.dumps(data['options'], ensure_ascii=False) if data['options'] is not None else None)
        if 'kp_id' in data:
            updates.append('kp_id = ?')
            params.append(data['kp_id'])

        if not updates:
            return jsonify({'error': 'No fields to update'}), 400

        params.append(qid)
        params.append(user_id)
        cursor.execute(f'UPDATE custom_questions SET {", ".join(updates)} WHERE id = ? AND user_id = ?', params)
        cursor.execute('SELECT * FROM custom_questions WHERE id = ?', (qid,))
        row = dict(cursor.fetchone())
        conn.commit()

    return jsonify({'success': True, 'question': row})


@app.route('/api/custom-questions/<int:qid>', methods=['DELETE'])
@api_response
def delete_custom_question(qid):
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM custom_questions WHERE id = ? AND user_id = ?', (qid, user_id))
        deleted = cursor.rowcount
        conn.commit()
    if deleted == 0:
        return jsonify({'error': 'Question not found'}), 404
    return jsonify({'success': True, 'deleted': deleted})


@app.route('/api/custom-questions/import', methods=['POST'])
@api_response
def import_custom_questions():
    """批量导入题目（JSON 数组）"""
    data = request.get_json() or {}
    user_id = data.get('user_id', 'default_user') or 'default_user'
    questions = data.get('questions', [])
    if not isinstance(questions, list) or len(questions) == 0:
        return jsonify({'error': 'questions must be a non-empty array'}), 400
    if len(questions) > 500:
        return jsonify({'error': 'Cannot import more than 500 questions at once'}), 400

    imported = 0
    errors = []
    with get_db_conn() as conn:
        cursor = conn.cursor()
        for idx, q in enumerate(questions):
            try:
                if not isinstance(q, dict):
                    errors.append(f'Item {idx}: not an object')
                    continue
                question_text = sanitize_string(q.get('question_text', ''), 5000)
                correct_answer = sanitize_string(q.get('correct_answer', ''), 500)
                if not question_text or not correct_answer:
                    errors.append(f'Item {idx}: missing question_text or correct_answer')
                    continue
                question_type = sanitize_string(q.get('question_type', 'single_choice'), 30) or 'single_choice'
                explanation = sanitize_string(q.get('explanation', ''), 5000)
                category = sanitize_string(q.get('category', ''), 100)
                source = sanitize_string(q.get('source', 'import'), 30) or 'import'
                options = q.get('options')
                options_json = json.dumps(options, ensure_ascii=False) if options is not None else None
                kp_id = q.get('kp_id')

                cursor.execute('''
                    INSERT INTO custom_questions
                    (user_id, question_text, question_type, options, correct_answer, explanation, category, kp_id, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (user_id, question_text, question_type, options_json, correct_answer, explanation, category, kp_id, source))
                imported += 1
            except Exception as e:
                errors.append(f'Item {idx}: {str(e)}')
        conn.commit()

    return jsonify({'success': True, 'imported': imported, 'errors': errors, 'total': len(questions)})


# ==================== 复习优先级队列 ====================

@app.route('/api/review/queue', methods=['GET'])
@api_response
def get_review_queue():
    """今日待复习队列：到期/逾期错题，按优先级排序"""
    user_id = get_user_id()
    limit = safe_int(request.args.get('limit', 20), 20)
    limit = max(1, min(100, limit))
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    today_str = datetime.now().strftime('%Y-%m-%d')
    today_end = today_str + ' 23:59:59'

    with get_db_conn() as conn:
        cursor = conn.cursor()
        # 优先级：逾期(srs_stage>0且过期) > 今日到期 > 新错题(srs_stage=0) > 未到期
        # srs_stage=0 视为"新错题"，即使 next_review_time 过期也不算逾期/今日到期
        cursor.execute('''
            SELECT id, question, category, chapter, srs_stage, next_review_time,
                   wrong_count, last_review_time,
                   CASE
                       WHEN srs_stage > 0 AND next_review_time IS NOT NULL AND next_review_time < ? THEN 1
                       WHEN srs_stage = 0 OR next_review_time IS NULL THEN 3
                       WHEN next_review_time IS NOT NULL AND next_review_time <= ? THEN 2
                       ELSE 4
                   END as priority
            FROM wrong_questions
            WHERE user_id = ? AND is_mastered = 0
            AND (next_review_time IS NULL OR next_review_time <= ? OR srs_stage = 0)
            ORDER BY priority ASC, next_review_time ASC, wrong_count DESC
            LIMIT ?
        ''', (now, today_end, user_id, today_end, limit))
        items = [dict(row) for row in cursor.fetchall()]

        # 统计：与 priority CASE 完全一致
        cursor.execute('''
            SELECT
                SUM(CASE WHEN srs_stage > 0 AND next_review_time IS NOT NULL AND next_review_time < ? THEN 1 ELSE 0 END) as overdue_count,
                SUM(CASE WHEN (srs_stage > 0 AND next_review_time IS NOT NULL AND next_review_time >= ? AND next_review_time <= ?) THEN 1 ELSE 0 END) as today_count,
                SUM(CASE WHEN srs_stage = 0 OR next_review_time IS NULL THEN 1 ELSE 0 END) as new_count,
                COUNT(*) as total_pending
            FROM wrong_questions
            WHERE user_id = ? AND is_mastered = 0
        ''', (now, now, today_end, user_id))
        stats = dict(cursor.fetchone())

    return jsonify({
        'items': items,
        'stats': {
            'new_count': stats['new_count'] or 0,
            'overdue_count': stats['overdue_count'] or 0,
            'today_count': stats['today_count'] or 0,
            'total_pending': stats['total_pending'] or 0
        },
        'returned': len(items)
    })


@app.route('/api/review/submit', methods=['POST'])
@api_response
def submit_review():
    """提交单题复习结果，推进 SRS 阶段。
    请求体: { question_id: int, is_correct: bool, time_spent?: int }
    """
    data = request.get_json(silent=True) or {}
    question_id = data.get('question_id')
    is_correct = bool(data.get('is_correct'))
    time_spent = safe_int(data.get('time_spent', 0), 0)
    user_id = get_user_id()

    if not question_id:
        return jsonify({'error': 'question_id 必填'}), 400

    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, correct_answer, created_at FROM wrong_questions WHERE id = ? AND user_id = ?',
                       (question_id, user_id))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': '错题不存在'}), 404

        # 更新知识点认知度
        cursor.execute('SELECT kp_id FROM question_mapping WHERE question_id = ?', (question_id,))
        for m in cursor.fetchall():
            update_cognition(cursor, m['kp_id'], is_correct, None, user_id)

        # 推进 SRS
        new_stage = update_srs(cursor, question_id, is_correct)

        # 记录练习 attempt（复用 practice_attempts 表）
        cursor.execute('''
            INSERT INTO practice_attempts (
                user_id, question_id, selected_answer, is_correct, error_pattern_id,
                time_spent, first_wrong_at, completed
            ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1)
        ''', (user_id, question_id, row['correct_answer'] if is_correct else '', 1 if is_correct else 0,
              time_spent, row['created_at']))
        attempt_id = cursor.lastrowid
        conn.commit()

    next_days = SRS_INTERVALS[new_stage] if new_stage is not None else 0
    return jsonify({
        'question_id': question_id,
        'is_correct': is_correct,
        'srs_stage': new_stage,
        'next_review_days': next_days,
        'is_mastered': new_stage is not None and new_stage >= len(SRS_INTERVALS) - 2,
        'attempt_id': attempt_id
    })


@app.route('/api/study/today-goals', methods=['GET'])
@api_response
def get_today_study_goals():
    """今日学习目标：复习N题+练习N题+打卡状态，返回进度"""
    user_id = get_user_id()
    today = datetime.now().strftime('%Y-%m-%d')

    with get_db_conn() as conn:
        cursor = conn.cursor()

        # 今日待复习数（复习队列总量）
        cursor.execute('''
            SELECT COUNT(*) FROM wrong_questions
            WHERE user_id = ? AND is_mastered = 0
            AND (next_review_time IS NULL OR next_review_time <= ? OR srs_stage = 0)
        ''', (user_id, today + ' 23:59:59'))
        review_target = cursor.fetchone()[0]
        review_target = min(review_target, 10)  # 目标上限 10 题

        # 今日已练习数
        cursor.execute('''
            SELECT COUNT(*) FROM practice_attempts
            WHERE user_id = ? AND DATE(attempted_at, 'localtime') = DATE('now', 'localtime')
        ''', (user_id,))
        practiced_today = cursor.fetchone()[0]

        # 今日已复习数（通过 review/submit 或 practice 完成的复习）
        cursor.execute('''
            SELECT COUNT(DISTINCT question_id) FROM practice_attempts
            WHERE user_id = ? AND DATE(attempted_at, 'localtime') = DATE('now', 'localtime')
        ''', (user_id,))
        reviewed_today = cursor.fetchone()[0]

        # 今日打卡
        cursor.execute('''
            SELECT COUNT(*) FROM study_checkins
            WHERE user_id = ? AND checkin_date = DATE('now', 'localtime')
        ''', (user_id,))
        checked_in = cursor.fetchone()[0] > 0

        # 连续打卡天数
        cursor.execute('''
            SELECT checkin_date FROM study_checkins
            WHERE user_id = ?
            ORDER BY checkin_date DESC LIMIT 60
        ''', (user_id,))
        dates = [r['checkin_date'] for r in cursor.fetchall()]
        streak = 0
        if dates:
            from datetime import date as date_cls, timedelta as td
            today_date = date_cls.today()
            # 如果今天打了卡，从今天开始算；否则从昨天开始算
            check_date = today_date if checked_in else today_date - td(days=1)
            for d in dates:
                d_str = d if isinstance(d, str) else str(d)
                try:
                    d_obj = date_cls.fromisoformat(d_str[:10])
                except Exception:
                    continue
                if d_obj == check_date:
                    streak += 1
                    check_date -= td(days=1)
                elif d_obj < check_date:
                    break

        # 累计打卡天数
        total_checkin_days = len(dates)

    goals = [
        {
            'key': 'review',
            'label': '复习错题',
            'target': review_target,
            'done': min(reviewed_today, review_target),
            'unit': '题',
            'icon': '🔁',
            'link': '/review'
        },
        {
            'key': 'practice',
            'label': '练习答题',
            'target': 10,
            'done': min(practiced_today, 10),
            'unit': '题',
            'icon': '✍️',
            'link': '/practice?mode=today'
        },
        {
            'key': 'checkin',
            'label': '每日打卡',
            'target': 1,
            'done': 1 if checked_in else 0,
            'unit': '次',
            'icon': '🔥',
            'link': '/checkin'
        }
    ]

    total_done = sum(g['done'] for g in goals)
    total_target = sum(g['target'] for g in goals)
    overall_rate = round((total_done / total_target) * 100, 1) if total_target > 0 else 0

    return jsonify({
        'goals': goals,
        'overall_rate': overall_rate,
        'streak_days': streak,
        'total_checkin_days': total_checkin_days,
        'checked_in_today': checked_in
    })


@app.route('/api/study/streak', methods=['GET'])
@api_response
def get_study_streak():
    """连续打卡统计 + 近 30 天打卡日历"""
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT checkin_date, study_minutes FROM study_checkins
            WHERE user_id = ? AND checkin_date >= DATE('now', '-30 days')
            ORDER BY checkin_date
        ''', (user_id,))
        recent = [dict(r) for r in cursor.fetchall()]

        cursor.execute('''
            SELECT checkin_date FROM study_checkins
            WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 90
        ''', (user_id,))
        dates = [r['checkin_date'] for r in cursor.fetchall()]

        from datetime import date as date_cls, timedelta as td
        today_date = date_cls.today()
        cursor.execute('''
            SELECT COUNT(*) FROM study_checkins
            WHERE user_id = ? AND checkin_date = DATE('now', 'localtime')
        ''', (user_id,))
        checked_in_today = cursor.fetchone()[0] > 0

        streak = 0
        if dates:
            check_date = today_date if checked_in_today else today_date - td(days=1)
            for d in dates:
                d_str = d if isinstance(d, str) else str(d)
                try:
                    d_obj = date_cls.fromisoformat(d_str[:10])
                except Exception:
                    continue
                if d_obj == check_date:
                    streak += 1
                    check_date -= td(days=1)
                elif d_obj < check_date:
                    break

        # 最长连续打卡
        max_streak = 0
        if dates:
            sorted_dates = []
            for d in dates:
                d_str = d if isinstance(d, str) else str(d)
                try:
                    sorted_dates.append(date_cls.fromisoformat(d_str[:10]))
                except Exception:
                    continue
            sorted_dates.sort(reverse=True)
            cur_streak = 1
            for i in range(1, len(sorted_dates)):
                if (sorted_dates[i-1] - sorted_dates[i]).days == 1:
                    cur_streak += 1
                else:
                    max_streak = max(max_streak, cur_streak)
                    cur_streak = 1
            max_streak = max(max_streak, cur_streak)

    return jsonify({
        'current_streak': streak,
        'max_streak': max_streak,
        'total_checkin_days': len(dates),
        'checked_in_today': checked_in_today,
        'recent_30_days': recent
    })


@app.route('/api/review/upcoming', methods=['GET'])
@api_response
def get_review_upcoming():
    """未来7天到期的复习任务预览"""
    user_id = get_user_id()
    days = safe_int(request.args.get('days', 7), 7)
    days = max(1, min(30, days))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        start = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        end = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute('''
            SELECT DATE(next_review_time) as review_date, COUNT(*) as count
            FROM wrong_questions
            WHERE user_id = ? AND is_mastered = 0
            AND next_review_time BETWEEN ? AND ?
            GROUP BY DATE(next_review_time)
            ORDER BY review_date
        ''', (user_id, start, end))
        items = [dict(row) for row in cursor.fetchall()]
    return jsonify({'days': days, 'items': items})


# ==================== 能力雷达图 ====================

@app.route('/api/stats/radar', methods=['GET'])
@api_response
def get_ability_radar():
    """按章节维度的能力雷达图数据：掌握度+错题率+覆盖率"""
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        # 取顶层章节（parent_id IS NULL 或 id=parent_id）
        cursor.execute('''
            SELECT id, name, category FROM knowledge_points
            WHERE parent_id IS NULL ORDER BY id
        ''')
        top_chapters = [dict(row) for row in cursor.fetchall()]

        radar = []
        for ch in top_chapters:
            # 递归统计该章节下所有后代
            cursor.execute('''
                WITH RECURSIVE descendants AS (
                    SELECT id FROM knowledge_points WHERE id = ?
                    UNION ALL
                    SELECT kp.id FROM knowledge_points kp
                    JOIN descendants d ON kp.parent_id = d.id
                )
                SELECT
                    COUNT(DISTINCT d.id) as total_kps,
                    COUNT(DISTINCT uc.kp_id) as visited_kps,
                    AVG(uc.mastery_score) as avg_mastery
                FROM descendants d
                LEFT JOIN user_cognition uc ON d.id = uc.kp_id AND uc.user_id = ?
            ''', (ch['id'], user_id))
            kp_stats = cursor.fetchone()

            # 该章节相关错题（通过 question_mapping 关联知识点）
            cursor.execute('''
                WITH RECURSIVE descendants AS (
                    SELECT id FROM knowledge_points WHERE id = ?
                    UNION ALL
                    SELECT kp.id FROM knowledge_points kp
                    JOIN descendants d ON kp.parent_id = d.id
                )
                SELECT
                    COUNT(DISTINCT wq.id) as total_wrong,
                    SUM(CASE WHEN wq.is_mastered = 0 THEN 1 ELSE 0 END) as pending_wrong
                FROM wrong_questions wq
                JOIN question_mapping qm ON qm.question_id = wq.id
                WHERE wq.user_id = ? AND qm.kp_id IN (SELECT id FROM descendants)
            ''', (ch['id'], user_id))
            wrong_stats = cursor.fetchone()

            total_kps = kp_stats['total_kps'] or 0
            visited = kp_stats['visited_kps'] or 0
            avg_mastery = kp_stats['avg_mastery'] or 0
            total_wrong = wrong_stats['total_wrong'] or 0
            pending_wrong = wrong_stats['pending_wrong'] or 0

            coverage = round(visited / total_kps * 100, 1) if total_kps > 0 else 0
            mastery = round(avg_mastery, 1)
            # 错题攻克率：已掌握错题 / 总错题
            wrong_mastered_rate = round((total_wrong - pending_wrong) / total_wrong * 100, 1) if total_wrong > 0 else 0

            radar.append({
                'chapter_id': ch['id'],
                'chapter': ch['name'],
                'category': ch['category'],
                'coverage': min(100, coverage),
                'mastery': min(100, mastery),
                'wrong_mastered_rate': min(100, wrong_mastered_rate),
                'total_wrong': total_wrong,
                'pending_wrong': pending_wrong,
                'total_kps': total_kps,
                'visited_kps': visited
            })

        # 按章节名排序保证雷达图稳定
        radar.sort(key=lambda x: x['chapter'])

    return jsonify({
        'axes': ['覆盖率', '掌握度', '错题攻克率'],
        'data': radar,
        'summary': {
            'avg_coverage': round(sum(r['coverage'] for r in radar) / len(radar), 1) if radar else 0,
            'avg_mastery': round(sum(r['mastery'] for r in radar) / len(radar), 1) if radar else 0,
            'avg_wrong_mastered': round(sum(r['wrong_mastered_rate'] for r in radar) / len(radar), 1) if radar else 0
        }
    })


# ==================== 错题归因诊断 ====================

@app.route('/api/error-diagnosis/report', methods=['GET'])
@api_response
def get_error_diagnosis_report():
    """错题归因诊断报告：按错误类型/章节/知识点维度聚合"""
    user_id = get_user_id()
    days = safe_int(request.args.get('days', 30), 30)
    days = max(1, min(365, days))
    since = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

    with get_db_conn() as conn:
        cursor = conn.cursor()

        # 1. 按错误标签聚合（concept/memory/calculation/reading/logic）
        cursor.execute('''
            SELECT et.category, et.name, COUNT(*) as cnt
            FROM question_error_tags qet
            JOIN error_tags et ON qet.tag_id = et.id
            JOIN wrong_questions wq ON qet.question_id = wq.id
            WHERE wq.user_id = ? AND wq.created_at >= ?
            GROUP BY et.category, et.id
            ORDER BY cnt DESC
        ''', (user_id, since))
        by_tag_rows = cursor.fetchall()
        by_category = {}
        by_tag = []
        for row in by_tag_rows:
            cat = row['category']
            if cat not in by_category:
                by_category[cat] = {'count': 0, 'tags': []}
            by_category[cat]['count'] += row['cnt']
            by_category[cat]['tags'].append({'name': row['name'], 'count': row['cnt']})
            by_tag.append(dict(row))

        # 2. 按章节聚合（未掌握错题数）
        cursor.execute('''
            SELECT category, COUNT(*) as total,
                   SUM(CASE WHEN is_mastered = 0 THEN 1 ELSE 0 END) as pending,
                   AVG(wrong_count) as avg_wrong_count
            FROM wrong_questions
            WHERE user_id = ? AND created_at >= ? AND category != ''
            GROUP BY category
            ORDER BY pending DESC
            LIMIT 10
        ''', (user_id, since))
        by_chapter = [dict(row) for row in cursor.fetchall()]

        # 3. 高频错题（错误次数≥3 且未掌握）
        cursor.execute('''
            SELECT id, question, category, wrong_count, srs_stage, next_review_time
            FROM wrong_questions
            WHERE user_id = ? AND wrong_count >= 3 AND is_mastered = 0
            ORDER BY wrong_count DESC, next_review_time ASC
            LIMIT 5
        ''', (user_id,))
        hot_questions = [dict(row) for row in cursor.fetchall()]

        # 4. 总览统计
        cursor.execute('''
            SELECT
                COUNT(*) as total_wrong,
                SUM(CASE WHEN is_mastered = 1 THEN 1 ELSE 0 END) as mastered,
                SUM(CASE WHEN is_mastered = 0 THEN 1 ELSE 0 END) as pending,
                AVG(wrong_count) as avg_wrong_per_q
            FROM wrong_questions
            WHERE user_id = ? AND created_at >= ?
        ''', (user_id, since))
        overview = dict(cursor.fetchone())

        # 5. 时间趋势（近 N 天每日错题数）
        cursor.execute('''
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM wrong_questions
            WHERE user_id = ? AND created_at >= ?
            GROUP BY DATE(created_at)
            ORDER BY date
        ''', (user_id, since))
        trend = [dict(row) for row in cursor.fetchall()]

    # 诊断建议
    suggestions = []
    cat_order = sorted(by_category.items(), key=lambda x: x[1]['count'], reverse=True)
    if cat_order:
        top_cat, top_info = cat_order[0]
        cat_advice = {
            'concept': '概念类错误最多，建议回归教材梳理核心定义，使用知识图谱确认关联',
            'memory': '记忆类错误突出，建议加强间隔重复，重点记忆公式/术语',
            'calculation': '计算类错误较多，建议多做真题训练，注意单位与公式套用',
            'reading': '审题类错误频繁，建议做题时先标记关键词，避免漏看条件',
            'logic': '逻辑推理错误较多，建议练习因果分析与流程图梳理'
        }
        suggestions.append({
            'type': 'top_category',
            'message': cat_advice.get(top_cat, f'{top_cat} 类错误较多，建议针对性强化'),
            'detail': top_info
        })

    if hot_questions:
        suggestions.append({
            'type': 'hot_questions',
            'message': f'有 {len(hot_questions)} 道题错误≥3次仍未掌握，建议优先攻克',
            'detail': [{'id': q['id'], 'question': q['question'][:80] if q['question'] else '', 'wrong_count': q['wrong_count']} for q in hot_questions]
        })

    if overview['pending'] and overview['pending'] > overview['total_wrong'] * 0.6:
        suggestions.append({
            'type': 'low_mastery',
            'message': f'未掌握错题占比 {round(overview["pending"] / overview["total_wrong"] * 100)}%，复习效率偏低，建议用 SRS 队列系统化复习',
            'detail': {'pending': overview['pending'], 'total': overview['total_wrong']}
        })

    return jsonify({
        'days': days,
        'overview': {
            'total_wrong': overview['total_wrong'] or 0,
            'mastered': overview['mastered'] or 0,
            'pending': overview['pending'] or 0,
            'mastered_rate': round((overview['mastered'] or 0) / (overview['total_wrong'] or 1) * 100, 1),
            'avg_wrong_per_q': round(overview['avg_wrong_per_q'] or 0, 2)
        },
        'by_category': [{'category': k, 'count': v['count'], 'tags': v['tags']} for k, v in cat_order],
        'by_chapter': by_chapter,
        'hot_questions': hot_questions,
        'trend': trend,
        'suggestions': suggestions
    })


# ==================== 学习路径推荐 ====================

@app.route('/api/learning-path/recommend', methods=['GET'])
@api_response
def get_learning_path_recommend():
    """基于薄弱点的智能学习路径推荐"""
    user_id = get_user_id()
    limit = safe_int(request.args.get('limit', 5), 5)
    limit = max(1, min(20, limit))

    with get_db_conn() as conn:
        cursor = conn.cursor()

        # 1. 找出掌握度最低且未掌握错题最多的知识点
        cursor.execute('''
            SELECT kp.id, kp.name, kp.category, kp.parent_id,
                   uc.mastery_score, uc.stability,
                   COUNT(wq.id) as wrong_count,
                   SUM(CASE WHEN wq.is_mastered = 0 THEN 1 ELSE 0 END) as pending_wrong
            FROM knowledge_points kp
            LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
            LEFT JOIN question_mapping qm ON qm.kp_id = kp.id
            LEFT JOIN wrong_questions wq ON qm.question_id = wq.id AND wq.user_id = ?
            WHERE kp.parent_id IS NOT NULL
            GROUP BY kp.id
            HAVING wrong_count > 0 OR (uc.mastery_score IS NOT NULL AND uc.mastery_score < 60)
            ORDER BY pending_wrong DESC, (uc.mastery_score IS NULL) DESC, uc.mastery_score ASC
            LIMIT ?
        ''', (user_id, user_id, limit * 2))
        weak_kps = [dict(row) for row in cursor.fetchall()]

        # 2. 对每个薄弱知识点，找关联教材章节与相邻知识点
        recommendations = []
        for kp in weak_kps[:limit]:
            rec = {
                'knowledge_point': kp,
                'reason': '',
                'actions': []
            }

            if kp['pending_wrong'] and kp['pending_wrong'] > 0:
                rec['reason'] = f'有 {kp["pending_wrong"]} 道错题未掌握'
                rec['actions'].append({'type': 'review', 'label': '复习错题', 'target': '/review'})
            elif kp['mastery_score'] is None:
                rec['reason'] = '尚未学习此知识点'
                rec['actions'].append({'type': 'learn', 'label': '学习教材', 'target': '/textbook'})
            elif kp['mastery_score'] < 60:
                rec['reason'] = f'掌握度仅 {kp["mastery_score"]}%，需加强'
                rec['actions'].append({'type': 'practice', 'label': '专项练习', 'target': '/practice'})

            # 找父章节
            if kp['parent_id']:
                cursor.execute('SELECT id, name FROM knowledge_points WHERE id = ?', (kp['parent_id'],))
                parent = cursor.fetchone()
                if parent:
                    rec['parent_chapter'] = dict(parent)

            # 找同级相邻知识点（同 parent，已掌握的作为参考）
            if kp['parent_id']:
                cursor.execute('''
                    SELECT name, mastery_score FROM knowledge_points kp2
                    LEFT JOIN user_cognition uc ON kp2.id = uc.kp_id AND uc.user_id = ?
                    WHERE kp2.parent_id = ? AND kp2.id != ?
                    ORDER BY (uc.mastery_score IS NULL), uc.mastery_score DESC
                    LIMIT 3
                ''', (user_id, kp['parent_id'], kp['id']))
                siblings = [dict(r) for r in cursor.fetchall()]
                if siblings:
                    rec['siblings'] = siblings

            recommendations.append(rec)

        # 3. 推荐学习顺序（按 pending_wrong 降序，未学习的优先）
        recommendations.sort(key=lambda r: (
            r['knowledge_point']['pending_wrong'] or 0,
            r['knowledge_point']['mastery_score'] is not None,
            r['knowledge_point']['mastery_score'] or 0
        ), reverse=False)

    return jsonify({
        'recommendations': recommendations,
        'total_weak_kps': len(weak_kps),
        'returned': len(recommendations)
    })


@app.route('/api/report/learning', methods=['GET'])
@api_response
def get_learning_report():
    """综合学习报告：聚合概览、掌握度、错题归因、薄弱点、趋势、建议"""
    user_id = get_user_id()
    days = safe_int(request.args.get('days', 30), 30)
    days = max(1, min(365, days))

    with get_db_conn() as conn:
        cursor = conn.cursor()

        # 1. 概览
        cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE user_id = ?', (user_id,))
        total_wrong = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE user_id = ? AND is_mastered = 1', (user_id,))
        mastered = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM practice_attempts WHERE user_id = ?', (user_id,))
        practice_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM practice_attempts WHERE user_id = ? AND is_correct = 1', (user_id,))
        correct_count = cursor.fetchone()[0]
        accuracy = round((correct_count / practice_count) * 100, 2) if practice_count > 0 else 0
        mastery_rate = round((mastered / total_wrong) * 100, 2) if total_wrong > 0 else 0

        # 学习连续天数
        cursor.execute('''
            SELECT COUNT(*) FROM study_checkins WHERE user_id = ?
        ''', (user_id,))
        total_checkin_days = cursor.fetchone()[0]
        cursor.execute('''
            SELECT MAX(checkin_date) as last, MIN(checkin_date) as first
            FROM study_checkins WHERE user_id = ?
        ''', (user_id,))
        row = cursor.fetchone()
        last_checkin = row['last'] if row else None
        today_checkin = 0
        cursor.execute('''
            SELECT COUNT(*) FROM study_checkins
            WHERE user_id = ? AND checkin_date = DATE('now', 'localtime')
        ''', (user_id,))
        today_checkin = cursor.fetchone()[0]

        # 2. 章节掌握度（顶层章节）
        cursor.execute('''
            WITH RECURSIVE descendants AS (
                SELECT id, parent_id FROM knowledge_points WHERE id = kp.id
                UNION ALL
                SELECT kp2.id, kp2.parent_id FROM knowledge_points kp2
                JOIN descendants d ON kp2.parent_id = d.id
            )
            SELECT kp.id, kp.name,
                   (SELECT COUNT(*) FROM descendants) as kp_count,
                   uc.mastery_score
            FROM knowledge_points kp
            LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
            WHERE kp.parent_id IS NULL
            ORDER BY kp.id
        ''', (user_id,))
        chapters = []
        for r in cursor.fetchall():
            chapters.append({
                'name': r['name'],
                'knowledge_point_count': r['kp_count'],
                'mastery_score': r['mastery_score']
            })

        # 3. 错题分类聚合
        cursor.execute('''
            SELECT category, COUNT(*) as cnt,
                   SUM(CASE WHEN is_mastered = 1 THEN 1 ELSE 0 END) as mastered
            FROM wrong_questions
            WHERE user_id = ? AND category != ''
            GROUP BY category ORDER BY cnt DESC
        ''', (user_id,))
        by_category = [dict(r) for r in cursor.fetchall()]

        # 4. 错题标签聚合
        cursor.execute('''
            SELECT et.name as tag, et.category, COUNT(qet.question_id) as cnt
            FROM question_error_tags qet
            JOIN error_tags et ON qet.tag_id = et.id
            JOIN wrong_questions wq ON qet.question_id = wq.id
            WHERE wq.user_id = ?
            GROUP BY et.id ORDER BY cnt DESC LIMIT 10
        ''', (user_id,))
        top_tags = [dict(r) for r in cursor.fetchall()]

        # 5. 薄弱知识点 Top 5
        cursor.execute('''
            SELECT kp.name, uc.mastery_score,
                   COUNT(wq.id) as wrong_count,
                   SUM(CASE WHEN wq.is_mastered = 0 THEN 1 ELSE 0 END) as pending
            FROM knowledge_points kp
            LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
            LEFT JOIN question_mapping qm ON qm.kp_id = kp.id
            LEFT JOIN wrong_questions wq ON qm.question_id = wq.id AND wq.user_id = ?
            WHERE kp.parent_id IS NOT NULL
            GROUP BY kp.id
            HAVING wrong_count > 0 OR (uc.mastery_score IS NOT NULL AND uc.mastery_score < 60)
            ORDER BY pending DESC, uc.mastery_score ASC
            LIMIT 5
        ''', (user_id, user_id))
        weak_kps = [dict(r) for r in cursor.fetchall()]

        # 6. 近 N 天学习趋势
        cursor.execute('''
            SELECT DATE(attempted_at) as date,
                   COUNT(*) as practiced,
                   SUM(is_correct) as correct
            FROM practice_attempts
            WHERE user_id = ? AND attempted_at >= DATE('now', ?)
            GROUP BY DATE(attempted_at) ORDER BY date
        ''', (user_id, f'-{days} days'))
        trend = []
        for r in cursor.fetchall():
            practiced = r['practiced'] or 0
            correct = r['correct'] or 0
            trend.append({
                'date': r['date'],
                'practiced': practiced,
                'correct': correct,
                'correct_rate': round((correct / practiced) * 100, 2) if practiced > 0 else 0
            })

        # 7. 模考统计
        cursor.execute('''
            SELECT COUNT(*) as total, AVG(score) as avg_score, MAX(score) as max_score
            FROM mock_exams WHERE user_id = ? AND status = 'submitted'
        ''', (user_id,))
        exam_row = cursor.fetchone()
        exam_stats = {
            'total_exams': exam_row['total'] if exam_row else 0,
            'avg_score': round(exam_row['avg_score'], 2) if exam_row and exam_row['avg_score'] else 0,
            'max_score': exam_row['max_score'] if exam_row else 0
        }

    # 8. 生成建议
    suggestions = []
    if mastery_rate < 50 and total_wrong > 0:
        suggestions.append(f'当前错题掌握率仅 {mastery_rate}%，建议每日完成今日复习队列中的题目。')
    if accuracy < 70 and practice_count > 10:
        suggestions.append(f'练习正确率 {accuracy}% 偏低，重点攻克错题诊断中的高频错误类型。')
    if weak_kps:
        suggestions.append(f'发现 {len(weak_kps)} 个薄弱知识点，按学习路径推荐顺序逐个攻克。')
    if not today_checkin:
        suggestions.append('今日尚未打卡，坚持每日学习是通关关键。')
    if not suggestions:
        suggestions.append('学习状态良好，继续保持当前节奏，注意考前模考冲刺。')

    report = {
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'period_days': days,
        'overview': {
            'total_wrong_questions': total_wrong,
            'mastered': mastered,
            'unmastered': total_wrong - mastered,
            'mastery_rate': mastery_rate,
            'practice_count': practice_count,
            'accuracy': accuracy,
            'total_checkin_days': total_checkin_days,
            'last_checkin': last_checkin,
            'today_checkin': today_checkin > 0
        },
        'chapters': chapters,
        'error_by_category': by_category,
        'top_error_tags': top_tags,
        'weak_knowledge_points': weak_kps,
        'trend': trend,
        'exam_stats': exam_stats,
        'suggestions': suggestions
    }
    return jsonify(report)


@app.route('/api/report/export', methods=['GET'])
@api_response
def export_learning_report():
    """导出综合学习报告：支持 json / md 格式下载"""
    fmt = (request.args.get('format') or 'json').lower()
    if fmt not in ('json', 'md'):
        fmt = 'json'

    # 复用学习报告逻辑
    user_id = get_user_id()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE user_id = ?', (user_id,))
        total_wrong = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE user_id = ? AND is_mastered = 1', (user_id,))
        mastered = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM practice_attempts WHERE user_id = ?', (user_id,))
        practice_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM practice_attempts WHERE user_id = ? AND is_correct = 1', (user_id,))
        correct_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM study_checkins WHERE user_id = ?', (user_id,))
        total_checkin_days = cursor.fetchone()[0]
        cursor.execute('''
            SELECT category, COUNT(*) as cnt FROM wrong_questions
            WHERE user_id = ? AND category != '' GROUP BY category ORDER BY cnt DESC
        ''', (user_id,))
        by_category = [dict(r) for r in cursor.fetchall()]
        cursor.execute('''
            SELECT kp.name, uc.mastery_score, COUNT(wq.id) as wrong_count
            FROM knowledge_points kp
            LEFT JOIN user_cognition uc ON kp.id = uc.kp_id AND uc.user_id = ?
            LEFT JOIN question_mapping qm ON qm.kp_id = kp.id
            LEFT JOIN wrong_questions wq ON qm.question_id = wq.id AND wq.user_id = ?
            WHERE kp.parent_id IS NOT NULL
            GROUP BY kp.id HAVING wrong_count > 0 OR (uc.mastery_score IS NOT NULL AND uc.mastery_score < 60)
            ORDER BY wrong_count DESC LIMIT 5
        ''', (user_id, user_id))
        weak_kps = [dict(r) for r in cursor.fetchall()]

    accuracy = round((correct_count / practice_count) * 100, 2) if practice_count > 0 else 0
    mastery_rate = round((mastered / total_wrong) * 100, 2) if total_wrong > 0 else 0
    generated_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if fmt == 'json':
        payload = {
            'generated_at': generated_at,
            'overview': {
                'total_wrong_questions': total_wrong,
                'mastered': mastered,
                'mastery_rate': mastery_rate,
                'practice_count': practice_count,
                'accuracy': accuracy,
                'total_checkin_days': total_checkin_days
            },
            'error_by_category': by_category,
            'weak_knowledge_points': weak_kps
        }
        resp = make_response(json.dumps(payload, ensure_ascii=False, indent=2))
        resp.headers['Content-Type'] = 'application/json; charset=utf-8'
        resp.headers['Content-Disposition'] = 'attachment; filename="learning_report.json"'
        return resp

    # Markdown 格式
    lines = []
    lines.append('# 软考系统架构师 - 学习报告\n')
    lines.append(f'> 生成时间：{generated_at}\n\n')
    lines.append('## 一、学习概览\n')
    lines.append(f'- 错题总数：**{total_wrong}**')
    lines.append(f'- 已掌握：**{mastered}**（掌握率 {mastery_rate}%）')
    lines.append(f'- 未掌握：**{total_wrong - mastered}**')
    lines.append(f'- 练习总次数：**{practice_count}**，正确率 **{accuracy}%**')
    lines.append(f'- 累计打卡：**{total_checkin_days}** 天\n')
    lines.append('## 二、错题分类分布\n')
    if by_category:
        lines.append('| 分类 | 错题数 |')
        lines.append('| --- | --- |')
        for c in by_category:
            lines.append(f"| {c['category']} | {c['cnt']} |")
    else:
        lines.append('暂无分类数据')
    lines.append('\n## 三、薄弱知识点 Top 5\n')
    if weak_kps:
        lines.append('| 知识点 | 掌握度 | 错题数 |')
        lines.append('| --- | --- | --- |')
        for kp in weak_kps:
            score = kp['mastery_score'] if kp['mastery_score'] is not None else '未学习'
            lines.append(f"| {kp['name']} | {score} | {kp['wrong_count']} |")
    else:
        lines.append('暂无薄弱知识点')
    lines.append('\n## 四、改进建议\n')
    if mastery_rate < 50 and total_wrong > 0:
        lines.append(f'- 当前掌握率 {mastery_rate}% 偏低，建议坚持每日复习队列')
    if accuracy < 70 and practice_count > 10:
        lines.append(f'- 练习正确率 {accuracy}%，需重点攻克高频错题')
    if not weak_kps:
        lines.append('- 暂无明显薄弱点，保持学习节奏')
    lines.append('\n---\n*由软考错题分析系统自动生成*\n')

    resp = make_response('\n'.join(lines))
    resp.headers['Content-Type'] = 'text/markdown; charset=utf-8'
    resp.headers['Content-Disposition'] = 'attachment; filename="learning_report.md"'
    return resp


@app.route('/api/wrong-questions/auto-classify', methods=['POST'])
@api_response
def auto_classify_wrong_questions():
    """自动补全错题分类/章节并建立知识点关联。
    基于题目内容关键词匹配知识点，反推 category（顶层章节）和 chapter（直接父章节）。
    可选参数：question_ids（list，指定题号；为空则处理所有未分类错题）
    """
    user_id = get_user_id()
    body = request.get_json(silent=True) or {}
    question_ids = body.get('question_ids') or []

    with get_db_conn() as conn:
        cursor = conn.cursor()

        # 1. 加载所有知识点（含父子关系），构建关键词索引
        cursor.execute('SELECT id, name, parent_id, category, chapter FROM knowledge_points')
        all_kps = [dict(r) for r in cursor.fetchall()]
        kp_by_id = {kp['id']: kp for kp in all_kps}

        # 构建知识点名 -> kp 的映射（按名称长度降序，优先匹配更具体的）
        kp_name_list = sorted(all_kps, key=lambda x: -len(x['name'] or ''))

        # 区分叶子节点（无子节点）和层级节点，匹配时优先叶子节点（更具体）
        parent_ids = {kp['parent_id'] for kp in all_kps if kp['parent_id'] is not None}
        leaf_kps = [kp for kp in all_kps if kp['id'] not in parent_ids and kp['parent_id'] is not None]
        leaf_kps_sorted = sorted(leaf_kps, key=lambda x: -len(x['name'] or ''))

        # 通用词停用词表（避免误匹配）
        STOPWORDS = {'系统', '设计', '管理', '概述', '基础', '应用', '技术', '原理', '结构', '方法', '分析', '实现', '概念', '基本', '关系', '模型', '语言', '步骤', '理论', '组成', '分类', '层次', '类型', '特性', '要求', '模式', '三级', '两级', '映射', '一级', '二级'}

        import re as _re
        def extract_keywords(name):
            """从知识点名提取候选关键词：去编号前缀 + 滑窗生成2-3字子串"""
            if not name:
                return []
            # 去除前导编号如 "1.2 "、"第1章 "、"5.2 "
            cleaned = _re.sub(r'^(第\d+[章节]\s*)?(\d+[\.\-]\d*\s*)+', '', name)
            # 按非字母数字汉字字符拆分
            parts = _re.split(r'[\s/、，,（）()【】\[\]:：；;]+', cleaned)
            keywords = []
            for p in parts:
                p = p.strip()
                if not p:
                    continue
                # 英文/数字整体保留
                if _re.fullmatch(r'[A-Za-z0-9\-\.]+', p):
                    if len(p) >= 2 and p not in STOPWORDS:
                        keywords.append(p)
                    continue
                # 中文：生成2字前缀/后缀子串（避免中间噪声词）
                if len(p) >= 2:
                    # 整词优先
                    if p not in STOPWORDS:
                        keywords.append(p)
                    # 前2/后2 子串（3字子串噪声大，弃用）
                    if len(p) > 2:
                        prefix = p[:2]
                        suffix = p[-2:]
                        if prefix not in STOPWORDS and prefix not in keywords:
                            keywords.append(prefix)
                        if suffix not in STOPWORDS and suffix not in keywords:
                            keywords.append(suffix)
            return keywords

        def match_kp_for_text(text, kp_list):
            """在文本中匹配知识点：先全名子串，再关键词拆分"""
            for kp in kp_list:
                name = kp['name'] or ''
                if not name or len(name) < 2:
                    continue
                # 1. 全名子串匹配（最精确）
                if name in text:
                    return kp
            # 2. 关键词拆分匹配（更宽松）
            for kp in kp_list:
                name = kp['name'] or ''
                if not name or len(name) < 2:
                    continue
                kws = extract_keywords(name)
                for kw in kws:
                    if len(kw) >= 2 and kw in text:
                        return kp
            return None

        def match_kp_smart(text):
            """智能匹配：先叶子节点，再回退到全部"""
            r = match_kp_for_text(text, leaf_kps_sorted)
            if r:
                return r
            return match_kp_for_text(text, kp_name_list)

        def find_top_ancestor(kp_id):
            """向上找到顶层章节（parent_id IS NULL）"""
            cur = kp_by_id.get(kp_id)
            while cur and cur['parent_id'] is not None:
                parent = kp_by_id.get(cur['parent_id'])
                if not parent:
                    break
                cur = parent
            return cur

        def find_direct_parent_name(kp_id):
            """返回直接父知识点名"""
            cur = kp_by_id.get(kp_id)
            if cur and cur['parent_id'] is not None:
                parent = kp_by_id.get(cur['parent_id'])
                if parent:
                    return parent['name']
            return None

        # 2. 选取待补全的错题
        if question_ids:
            placeholders = ','.join('?' * len(question_ids))
            cursor.execute(
                f'SELECT * FROM wrong_questions WHERE user_id = ? AND id IN ({placeholders})',
                (user_id, *question_ids)
            )
        else:
            cursor.execute(
                'SELECT * FROM wrong_questions WHERE user_id = ? AND (category IS NULL OR category = "" OR chapter IS NULL OR chapter = "")',
                (user_id,)
            )
        questions = [dict(r) for r in cursor.fetchall()]

        updated = 0
        mappings_created = 0
        details = []

        for q in questions:
            text = (q['question'] or '') + ' ' + (q['analysis'] or '')
            matched_kp = match_kp_smart(text)

            new_category = q['category']
            new_chapter = q['chapter']
            kp_linked = None

            if matched_kp:
                # 反推顶层章节作为 category
                top = find_top_ancestor(matched_kp['id'])
                if top and top['name']:
                    new_category = top['name']
                # 匹配到的知识点自身作为 chapter（最具体的归属）
                if matched_kp['parent_id'] is not None:
                    new_chapter = matched_kp['name']
                else:
                    # 若匹配到的就是顶层章节，chapter 取其名
                    new_chapter = matched_kp['name']
                kp_linked = matched_kp

            # 更新分类/章节
            if new_category != q['category'] or new_chapter != q['chapter']:
                cursor.execute(
                    'UPDATE wrong_questions SET category = ?, chapter = ? WHERE id = ?',
                    (new_category, new_chapter, q['id'])
                )
                updated += 1

            # 建立 question_mapping
            if kp_linked:
                cursor.execute(
                    'SELECT id FROM question_mapping WHERE question_id = ? AND kp_id = ?',
                    (q['id'], kp_linked['id'])
                )
                if not cursor.fetchone():
                    cursor.execute(
                        'INSERT INTO question_mapping (question_id, kp_id) VALUES (?, ?)',
                        (q['id'], kp_linked['id'])
                    )
                    mappings_created += 1

            details.append({
                'id': q['id'],
                'matched_kp': kp_linked['name'] if kp_linked else None,
                'category': new_category,
                'chapter': new_chapter
            })

        conn.commit()

    return jsonify({
        'total': len(questions),
        'updated': updated,
        'mappings_created': mappings_created,
        'details': details
    })


@app.route('/api/admin/cleanup-test-data', methods=['POST'])
@api_response
def cleanup_test_data():
    """清理测试/开发残留的脏数据。
    识别规则：category/chapter 命中 TEST_CATEGORY_PATTERNS，或题目内容含 XSS/测试关键字。
    可选 body: { user_id: 'xxx', dry_run: true|false }
    dry_run=true 时只返回将删除的列表，不实际删除。
    """
    body = request.get_json(silent=True) or {}
    target_user = body.get('user_id')
    dry_run = bool(body.get('dry_run', False))

    with get_db_conn() as conn:
        cursor = conn.cursor()
        # 拉取候选删除项
        if target_user:
            cursor.execute(
                'SELECT id, user_id, question, category, chapter FROM wrong_questions WHERE user_id = ?',
                (target_user,)
            )
        else:
            cursor.execute('SELECT id, user_id, question, category, chapter FROM wrong_questions')
        candidates = []
        for r in cursor.fetchall():
            if is_test_data(r['category'] or '', r['chapter'] or '', r['question'] or ''):
                candidates.append({
                    'id': r['id'], 'user_id': r['user_id'],
                    'category': r['category'], 'chapter': r['chapter'],
                    'question_preview': (r['question'] or '')[:60]
                })

        if dry_run:
            return jsonify({
                'dry_run': True,
                'matched': len(candidates),
                'candidates': candidates
            })

        deleted = 0
        for c in candidates:
            # 同步清理 question_mapping / practice_attempts 由外键级联（如有），这里显式清理 mapping
            cursor.execute('DELETE FROM question_mapping WHERE question_id = ?', (c['id'],))
            cursor.execute('DELETE FROM wrong_questions WHERE id = ?', (c['id'],))
            deleted += 1
        conn.commit()

    return jsonify({
        'dry_run': False,
        'matched': len(candidates),
        'deleted': deleted,
        'candidates': candidates
    })


if __name__ == '__main__':
    ensure_schema()
    app.run(port=5002, debug=True)
