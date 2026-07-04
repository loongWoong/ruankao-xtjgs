from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import sqlite3
import json
import os
import hashlib
import csv
import io
from datetime import datetime
from contextlib import contextmanager
from functools import wraps

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'ruankao.db')
REFLECTION_ROLLOUT_PERCENT = 10

MAX_PAGE_LIMIT = 100
DEFAULT_PAGE_LIMIT = 20

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

        conn.commit()

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
        'last_review_time': row['last_review_time'],
        'srs_stage': row['srs_stage'] if 'srs_stage' in row.keys() else 0,
        'next_review_time': row['next_review_time'] if 'next_review_time' in row.keys() else None,
        'created_at': row['created_at']
    }

SRS_INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120]

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
            is_mastered = ?
        WHERE id = ?
    ''', (new_stage, f'+{days} day', is_mastered, question_id))

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
    data = request.get_json()
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO wrong_questions (
                question_id, question, options, user_answer, correct_answer,
                analysis, category, chapter, source_url, user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('question_id', ''),
            data.get('question', ''),
            json.dumps(data.get('options', [])),
            data.get('user_answer', ''),
            data.get('correct_answer', ''),
            data.get('analysis', ''),
            data.get('category', ''),
            data.get('chapter', ''),
            data.get('source_url', ''),
            data.get('user_id', 'default_user')
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
            kp_name = data.get('chapter') or data.get('category') or 'General'
            kps = [kp_name]

        user_id = data.get('user_id', 'default_user')
        for kp_name in kps:
            kp_id = get_or_create_kp(cursor, kp_name, data.get('category'), data.get('chapter'))
            cursor.execute('INSERT INTO question_mapping (question_id, kp_id) VALUES (?, ?)', (q_id, kp_id))
            cursor.execute('''
                INSERT OR IGNORE INTO user_cognition (kp_id, user_id, mastery_score, stability, last_visit)
                VALUES (?, ?, 0.3, 0.5, CURRENT_TIMESTAMP)
            ''', (kp_id, user_id))

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
            where_clauses.append('(question LIKE ? OR analysis LIKE ? OR options LIKE ? OR category LIKE ? OR chapter LIKE ?)')
            like_pattern = f'%{search}%'
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
            stats.append({
                'name': row['name'],
                'score': row['mastery_score'],
                'stability': row['stability'],
                'category': row['category']
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
    with get_db_conn() as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM wrong_questions
            WHERE user_id = ?
            AND is_mastered = 0
            AND (next_review_time IS NULL OR next_review_time <= datetime('now'))
            ORDER BY 
                CASE WHEN next_review_time IS NULL THEN 0 ELSE 1 END,
                next_review_time ASC,
                srs_stage ASC,
                created_at ASC
            LIMIT ?
        ''', (user_id, limit))

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

if __name__ == '__main__':
    ensure_schema()
    app.run(port=5002, debug=True)
