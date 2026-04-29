from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import json
import os
import hashlib
from datetime import datetime

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'ruankao.db')
REFLECTION_ROLLOUT_PERCENT = 10

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def ensure_column(cursor, table, column, definition):
    cursor.execute(f"PRAGMA table_info({table})")
    existing = {row["name"] for row in cursor.fetchall()}
    if column not in existing:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

def ensure_schema():
    conn = get_db()
    cursor = conn.cursor()
    try:
        ensure_column(cursor, 'wrong_questions', 'user_id', "TEXT DEFAULT 'default_user'")
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
        conn.commit()
    finally:
        conn.close()

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

def update_cognition(cursor, kp_id, result, error_pattern_id=None):
    """Update user's cognitive state based on practice result"""
    # Ensure state exists
    cursor.execute('SELECT mastery_score, stability FROM user_cognition WHERE kp_id = ?', (kp_id,))
    row = cursor.fetchone()
    
    if not row:
        cursor.execute('INSERT INTO user_cognition (kp_id, mastery_score, stability) VALUES (?, 0.5, 1.0)', (kp_id,))
        score, stability = 0.5, 1.0
    else:
        score, stability = row['mastery_score'], row['stability']

    # Dynamic weighting based on result and error pattern
    if result: # Correct
        score = min(1.0, score + 0.1)
        stability = min(2.0, stability + 0.2)
    else: # Wrong
        # Penalty depends on the error pattern (simplified implementation)
        penalty = 0.15 if error_pattern_id else 0.1
        score = max(0.0, score - penalty)
        stability = max(0.1, stability - 0.3)

    cursor.execute('''
        UPDATE user_cognition 
        SET mastery_score = ?, stability = ?, last_visit = ? 
        WHERE kp_id = ?
    ''', (score, stability, datetime.now(), kp_id))

# --- API Routes ---

@app.route('/api/wrong-questions', methods=['POST'])
def add_wrong_question():
    data = request.get_json()
    conn = get_db()
    cursor = conn.cursor()

    # 1. Standard Question Insertion
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

    # 2. Ontology Mapping: Map Question to Knowledge Points
    # In a real scenario, this could be LLM-generated. Here we use category/chapter as proxy if kps not provided.
    kps = data.get('knowledge_points', [])
    if not kps:
        # Fallback: Treat the chapter or category as a knowledge point for now
        kp_name = data.get('chapter') or data.get('category') or 'General'
        kps = [kp_name]

    for kp_name in kps:
        kp_id = get_or_create_kp(cursor, kp_name, data.get('category'), data.get('chapter'))
        cursor.execute('INSERT INTO question_mapping (question_id, kp_id) VALUES (?, ?)', (q_id, kp_id))

    conn.commit()
    conn.close()
    return jsonify({'success': True, 'id': q_id})

@app.route('/api/wrong-questions', methods=['GET'])
def get_wrong_questions():
    # Keep original functionality but allow sorting by cognition gaps
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 20, type=int)
    category = request.args.get('category', '')
    is_mastered = request.args.get('is_mastered', '')
    search = request.args.get('search', '')

    conn = get_db()
    cursor = conn.cursor()
    where_clauses = []
    params = []

    if category:
        where_clauses.append('category = ?')
        params.append(category)
    if is_mastered != '':
        where_clauses.append('is_mastered = ?')
        params.append(int(is_mastered))
    if search:
        where_clauses.append('(question LIKE ? OR analysis LIKE ?)')
        params.append(f'%{search}%')
        params.append(f'%{search}%')

    where_sql = ' AND '.join(where_clauses) if where_clauses else '1=1'
    cursor.execute(f'SELECT COUNT(*) FROM wrong_questions WHERE {where_sql}', params)
    total = cursor.fetchone()[0]

    offset = (page - 1) * limit
    cursor.execute(f'SELECT * FROM wrong_questions WHERE {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?', params + [limit, offset])
    
    questions = []
    for row in cursor.fetchall():
        questions.append({
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
            'created_at': row['created_at']
        })
    conn.close()
    return jsonify({'items': questions, 'total': total, 'page': page, 'limit': limit})

@app.route('/api/stats/cognition', methods=['GET'])
def get_cognition_stats():
    """New Ontology API: Return mastery levels of all knowledge points"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT kp.name, uc.mastery_score, uc.stability, kp.category 
        FROM knowledge_points kp
        JOIN user_cognition uc ON kp.id = uc.kp_id
        ORDER BY uc.mastery_score ASC
    ''')
    
    stats = []
    for row in cursor.fetchall():
        stats.append({
            'name': row['name'],
            'score': row['mastery_score'],
            'stability': row['stability'],
            'category': row['category']
        })
    conn.close()
    return jsonify({'cognition_map': stats})

@app.route('/api/practice/submit', methods=['POST'])
def submit_practice():
    data = request.get_json()
    question_id = data.get('question_id')
    answer = data.get('answer')
    error_pattern_id = data.get('error_pattern_id') # New: Metacognitive input
    user_id = data.get('user_id', 'default_user')
    time_spent = data.get('time_spent', 0)
    
    conn = get_db()
    cursor = conn.cursor()

    # 1. Get the correct answer
    cursor.execute('SELECT correct_answer, created_at FROM wrong_questions WHERE id = ?', (question_id,))
    row = cursor.fetchone()
    if not row:
        return jsonify({'error': 'Question not found'}), 404
    
    is_correct = (answer == row['correct_answer'])
    
    # 2. Update all associated Knowledge Points (The Core Ontology Logic)
    cursor.execute('SELECT kp_id FROM question_mapping WHERE question_id = ?', (question_id,))
    mappings = cursor.fetchall()
    
    for m in mappings:
        update_cognition(cursor, m['kp_id'], is_correct, error_pattern_id)

    # 3. Update the Question state for legacy support
    cursor.execute('UPDATE wrong_questions SET is_mastered = ? WHERE id = ?', (1 if is_correct else 0, question_id))

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
    conn.close()
    
    return jsonify({
        'is_correct': is_correct,
        'correct_answer': row['correct_answer'],
        'attempt_id': attempt_id,
        'requires_reflection': requires_reflection
    })

@app.route('/api/practice/reflection', methods=['POST'])
def submit_reflection():
    data = request.get_json()
    attempt_id = data.get('attempt_id')
    question_id = data.get('question_id')
    error_pattern_id = data.get('error_pattern_id')
    user_id = data.get('user_id', 'default_user')

    if not attempt_id or not question_id or not error_pattern_id:
        return jsonify({'error': 'attempt_id, question_id, error_pattern_id are required'}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, is_correct
        FROM practice_attempts
        WHERE id = ? AND user_id = ? AND question_id = ?
    ''', (attempt_id, user_id, question_id))
    attempt = cursor.fetchone()
    if not attempt:
        conn.close()
        return jsonify({'error': 'Attempt not found'}), 404

    if attempt['is_correct']:
        conn.close()
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
    conn.close()
    return jsonify({'success': True, 'reflection_id': reflection_id})

@app.route('/api/practice/recommend', methods=['GET'])
def recommend_practice():
    """Cognition-driven recommendation: find questions testing the weakest points"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Find the top 5 weakest knowledge points
    cursor.execute('''
        SELECT kp_id FROM user_cognition 
        ORDER BY mastery_score ASC LIMIT 5
    ''')
    weak_kps = [row['kp_id'] for row in cursor.fetchall()]
    
    if not weak_kps:
        # Fallback to random if no cognition data yet
        cursor.execute('SELECT * FROM wrong_questions ORDER BY RANDOM() LIMIT 10')
        rows = cursor.fetchall()
    else:
        # Get questions that test these weak points
        placeholders = ','.join(['?'] * len(weak_kps))
        cursor.execute(f'''
            SELECT qw.* FROM wrong_questions qw
            JOIN question_mapping qm ON qw.id = qm.question_id
            WHERE qm.kp_id IN ({placeholders})
            ORDER BY RANDOM() LIMIT 10
        ''', weak_kps)
        rows = cursor.fetchall()

    questions = []
    for row in rows:
        questions.append({
            'id': row['id'],
            'question': row['question'],
            'options': json.loads(row['options']) if row['options'] else [],
            'correct_answer': row['correct_answer'],
            'analysis': row['analysis'],
            'category': row['category']
        })
    conn.close()
    return jsonify({'questions': questions})

@app.route('/api/error-patterns', methods=['GET'])
def get_error_patterns():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM error_patterns')
    patterns = [{'id': row['id'], 'name': row['pattern_name']} for row in cursor.fetchall()]
    conn.close()
    return jsonify({'patterns': patterns})

@app.route('/api/feature-flags', methods=['GET'])
def get_feature_flags():
    user_id = request.args.get('user_id', 'default_user')
    enabled = is_reflection_required_for_user(user_id)
    return jsonify({
        'reflection_gate': {
            'enabled': enabled,
            'rollout_percent': REFLECTION_ROLLOUT_PERCENT
        }
    })

@app.route('/api/metrics/repractice-conversion', methods=['GET'])
def get_repractice_conversion():
    days = request.args.get('days', 7, type=int)
    hours = request.args.get('hours', 72, type=int)
    conn = get_db()
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
    conn.close()

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
