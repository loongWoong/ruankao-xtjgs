from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import json
import os
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'ruankao.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Removed old database at {DB_PATH}")

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
    CREATE TABLE wrong_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT,
        user_answer TEXT NOT NULL,
        correct_answer TEXT NOT NULL,
        analysis TEXT,
        category TEXT,
        chapter TEXT,
        source_url TEXT,
        is_mastered INTEGER DEFAULT 0,
        review_count INTEGER DEFAULT 0,
        last_review_time DATETIME,
        correct_count INTEGER DEFAULT 0,
        wrong_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    cursor.execute('''
    CREATE TABLE study_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER,
        action_type TEXT NOT NULL,
        result INTEGER,
        time_spent INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (question_id) REFERENCES wrong_questions (id)
    )
    ''')

    cursor.execute('''
    CREATE TABLE daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL UNIQUE,
        total_questions INTEGER DEFAULT 0,
        correct_count INTEGER DEFAULT 0,
        wrong_count INTEGER DEFAULT 0,
        practiced_count INTEGER DEFAULT 0,
        mastered_count INTEGER DEFAULT 0
    )
    ''')

    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")

init_db()

@app.route('/api/wrong-questions', methods=['POST'])
def add_wrong_question():
    data = request.get_json()

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        INSERT INTO wrong_questions (
            question_id, question, options, user_answer, correct_answer,
            analysis, category, chapter, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data.get('question_id', ''),
        data.get('question', ''),
        json.dumps(data.get('options', [])),
        data.get('user_answer', ''),
        data.get('correct_answer', ''),
        data.get('analysis', ''),
        data.get('category', ''),
        data.get('chapter', ''),
        data.get('source_url', '')
    ))

    question_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id': question_id})

@app.route('/api/wrong-questions', methods=['GET'])
def get_wrong_questions():
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
    cursor.execute(f'''
        SELECT * FROM wrong_questions
        WHERE {where_sql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    ''', params + [limit, offset])

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
            'review_count': row['review_count'],
            'correct_count': row['correct_count'],
            'wrong_count': row['wrong_count'],
            'created_at': row['created_at']
        })

    conn.close()

    return jsonify({
        'items': questions,
        'total': total,
        'page': page,
        'limit': limit
    })

@app.route('/api/wrong-questions/<int:id>', methods=['GET'])
def get_wrong_question(id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM wrong_questions WHERE id = ?', (id,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    question = {
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
        'correct_count': row['correct_count'],
        'wrong_count': row['wrong_count'],
        'created_at': row['created_at']
    }

    conn.close()
    return jsonify(question)

@app.route('/api/wrong-questions/<int:id>', methods=['PUT'])
def update_wrong_question(id):
    data = request.get_json()

    conn = get_db()
    cursor = conn.cursor()

    update_fields = []
    params = []

    if 'is_mastered' in data:
        update_fields.append('is_mastered = ?')
        params.append(1 if data['is_mastered'] else 0)
    if 'review_count' in data:
        update_fields.append('review_count = ?')
        params.append(data['review_count'])
    if 'correct_count' in data:
        update_fields.append('correct_count = ?')
        params.append(data['correct_count'])
    if 'wrong_count' in data:
        update_fields.append('wrong_count = ?')
        params.append(data['wrong_count'])
    if 'last_review_time' in data:
        update_fields.append('last_review_time = ?')
        params.append(data['last_review_time'])

    if update_fields:
        params.append(id)
        cursor.execute(f'''
            UPDATE wrong_questions
            SET {', '.join(update_fields)}
            WHERE id = ?
        ''', params)
        conn.commit()

    conn.close()
    return jsonify({'success': True})

@app.route('/api/wrong-questions/<int:id>', methods=['DELETE'])
def delete_wrong_question(id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('DELETE FROM wrong_questions WHERE id = ?', (id,))
    cursor.execute('DELETE FROM study_records WHERE question_id = ?', (id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/api/stats/overview', methods=['GET'])
def get_stats_overview():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT COUNT(*) FROM wrong_questions')
    total_wrong = cursor.fetchone()[0]

    cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE is_mastered = 1')
    total_mastered = cursor.fetchone()[0]

    cursor.execute('SELECT COUNT(*) FROM wrong_questions WHERE is_mastered = 0')
    total_not_mastered = cursor.fetchone()[0]

    today = datetime.now().strftime('%Y-%m-%d')
    cursor.execute('''
        SELECT COALESCE(SUM(practiced_count), 0),
               COALESCE(SUM(correct_count), 0)
        FROM daily_stats WHERE date = ?
    ''', (today,))
    today_row = cursor.fetchone()
    today_practiced = today_row[0] if today_row else 0
    today_correct = today_row[1] if today_row else 0

    today_correct_rate = (today_correct / today_practiced * 100) if today_practiced > 0 else 0

    mastery_rate = (total_mastered / total_wrong * 100) if total_wrong > 0 else 0

    conn.close()

    return jsonify({
        'total_wrong_questions': total_wrong,
        'total_mastered': total_mastered,
        'total_not_mastered': total_not_mastered,
        'mastery_rate': round(mastery_rate, 1),
        'today_practiced': today_practiced,
        'today_correct_rate': round(today_correct_rate, 1)
    })

@app.route('/api/stats/category', methods=['GET'])
def get_stats_category():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT
            category,
            COUNT(*) as total,
            SUM(CASE WHEN is_mastered = 1 THEN 1 ELSE 0 END) as mastered
        FROM wrong_questions
        WHERE category IS NOT NULL AND category != ''
        GROUP BY category
        ORDER BY total DESC
    ''')

    categories = []
    for row in cursor.fetchall():
        total = row['total']
        mastered = row['mastered']
        categories.append({
            'name': row['category'] or '未分类',
            'total': total,
            'mastered': mastered,
            'mastery_rate': round((mastered / total * 100) if total > 0 else 0, 1)
        })

    conn.close()
    return jsonify({'categories': categories})

@app.route('/api/stats/chapter', methods=['GET'])
def get_stats_chapter():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT
            category,
            chapter,
            COUNT(*) as total,
            SUM(CASE WHEN is_mastered = 1 THEN 1 ELSE 0 END) as mastered
        FROM wrong_questions
        WHERE chapter IS NOT NULL AND chapter != ''
        GROUP BY category, chapter
        ORDER BY total DESC
    ''')

    chapters = []
    for row in cursor.fetchall():
        total = row['total']
        mastered = row['mastered']
        chapters.append({
            'name': row['chapter'] or '未分类',
            'category': row['category'] or '未分类',
            'total': total,
            'mastered': mastered,
            'mastery_rate': round((mastered / total * 100) if total > 0 else 0, 1)
        })

    conn.close()
    return jsonify({'chapters': chapters})

@app.route('/api/stats/weak-points', methods=['GET'])
def get_stats_weak_points():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT
            category,
            COUNT(*) as total,
            SUM(CASE WHEN is_mastered = 0 THEN 1 ELSE 0 END) as not_mastered
        FROM wrong_questions
        WHERE category IS NOT NULL AND category != ''
        GROUP BY category
        ORDER BY (CAST(SUM(CASE WHEN is_mastered = 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) DESC
        LIMIT 10
    ''')

    weak_points = []
    for row in cursor.fetchall():
        total = row['total']
        not_mastered = row['not_mastered']
        weak_points.append({
            'name': row['category'] or '未分类',
            'total': total,
            'not_mastered': not_mastered,
            'weak_rate': round((not_mastered / total * 100) if total > 0 else 0, 1)
        })

    conn.close()
    return jsonify({'weak_points': weak_points})

@app.route('/api/stats/daily', methods=['GET'])
def get_stats_daily():
    days = request.args.get('days', 7, type=int)

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT date, practiced_count, correct_count, wrong_count
        FROM daily_stats
        ORDER BY date DESC
        LIMIT ?
    ''', (days,))

    daily_stats = []
    for row in cursor.fetchall():
        practiced = row['practiced_count']
        correct = row['correct_count']
        daily_stats.append({
            'date': row['date'],
            'practiced': practiced,
            'correct': correct,
            'wrong': row['wrong_count'],
            'correct_rate': round((correct / practiced * 100) if practiced > 0 else 0, 1)
        })

    daily_stats.reverse()
    conn.close()

    return jsonify({'daily_stats': daily_stats})

@app.route('/api/practice/today', methods=['GET'])
def get_practice_today():
    limit = request.args.get('limit', 10, type=int)

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT * FROM wrong_questions
        WHERE is_mastered = 0
        ORDER BY
            CASE
                WHEN last_review_time IS NULL THEN 0
                WHEN last_review_time < datetime('now', '-1 day') THEN 1
                WHEN last_review_time < datetime('now', '-3 day') THEN 2
                WHEN last_review_time < datetime('now', '-7 day') THEN 3
                ELSE 4
            END,
            RANDOM()
        LIMIT ?
    ''', (limit,))

    questions = []
    for row in cursor.fetchall():
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

@app.route('/api/practice/random', methods=['GET'])
def get_practice_random():
    limit = request.args.get('limit', 10, type=int)
    category = request.args.get('category', '')

    conn = get_db()
    cursor = conn.cursor()

    if category:
        cursor.execute('''
            SELECT * FROM wrong_questions
            WHERE category = ?
            ORDER BY RANDOM()
            LIMIT ?
        ''', (category, limit))
    else:
        cursor.execute('''
            SELECT * FROM wrong_questions
            ORDER BY RANDOM()
            LIMIT ?
        ''', (limit,))

    questions = []
    for row in cursor.fetchall():
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

@app.route('/api/practice/submit', methods=['POST'])
def submit_practice():
    data = request.get_json()
    question_id = data.get('question_id')
    answer = data.get('answer')
    time_spent = data.get('time_spent', 0)

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM wrong_questions WHERE id = ?', (question_id,))
    question = cursor.fetchone()

    if not question:
        conn.close()
        return jsonify({'error': 'Question not found'}), 404

    is_correct = answer == question['correct_answer']

    cursor.execute('''
        INSERT INTO study_records (question_id, action_type, result, time_spent)
        VALUES (?, ?, ?, ?)
    ''', (question_id, 'practice', 1 if is_correct else 0, time_spent))

    correct_count = question['correct_count']
    wrong_count = question['wrong_count']
    review_count = question['review_count']

    if is_correct:
        correct_count += 1
    else:
        wrong_count += 1

    review_count += 1

    is_mastered = correct_count >= 3 and (correct_count / (correct_count + wrong_count)) >= 0.7

    next_review_days = 1
    if is_mastered:
        next_review_days = 7
    elif correct_count > wrong_count:
        next_review_days = 3

    cursor.execute('''
        UPDATE wrong_questions
        SET correct_count = ?,
            wrong_count = ?,
            review_count = ?,
            is_mastered = ?,
            last_review_time = datetime('now')
        WHERE id = ?
    ''', (correct_count, wrong_count, review_count, 1 if is_mastered else 0, question_id))

    today = datetime.now().strftime('%Y-%m-%d')
    cursor.execute('SELECT * FROM daily_stats WHERE date = ?', (today,))
    daily = cursor.fetchone()

    if daily:
        cursor.execute('''
            UPDATE daily_stats
            SET practiced_count = practiced_count + 1,
                correct_count = correct_count + ?,
                wrong_count = wrong_count + ?
            WHERE date = ?
        ''', (1 if is_correct else 0, 1 if not is_correct else 0, today))
    else:
        cursor.execute('''
            INSERT INTO daily_stats (date, practiced_count, correct_count, wrong_count)
            VALUES (?, 1, ?, ?)
        ''', (today, 1 if is_correct else 0, 1 if not is_correct else 0))

    conn.commit()
    conn.close()

    return jsonify({
        'is_correct': is_correct,
        'is_mastered': is_mastered,
        'next_review_interval': next_review_days
    })

@app.route('/api/categories', methods=['GET'])
def get_categories():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT DISTINCT category FROM wrong_questions
        WHERE category IS NOT NULL AND category != ''
        ORDER BY category
    ''')

    categories = [row['category'] for row in cursor.fetchall()]
    conn.close()

    return jsonify({'categories': categories})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5002)