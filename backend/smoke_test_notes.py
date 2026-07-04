import sys
import json
import time

sys.path.insert(0, '.')
from app import app, ensure_schema

ensure_schema()

client = app.test_client()
USER_ID = 'test_user_smoke'

def test_endpoint(name, method, path, data=None, params=None, expected_status=200):
    start = time.time()
    if method == 'GET':
        resp = client.get(path, query_string=params)
    elif method == 'POST':
        resp = client.post(path, json=data, query_string=params)
    elif method == 'PUT':
        resp = client.put(path, json=data, query_string=params)
    elif method == 'DELETE':
        resp = client.delete(path, query_string=params)
    else:
        resp = None

    elapsed = (time.time() - start) * 1000
    status_ok = resp.status_code == expected_status

    status_str = 'PASS' if status_ok else 'FAIL'
    print(f'  [{status_str}] {method} {path} ({resp.status_code}) - {elapsed:.1f}ms')

    if not status_ok:
        try:
            body = resp.get_json()
            print(f'    Expected {expected_status}, got {resp.status_code}: {body}')
        except:
            print(f'    Expected {expected_status}, got {resp.status_code}')

    return resp, status_ok

passed = 0
failed = 0

print('\n=== 笔记 API 测试 ===')

resp, ok = test_endpoint('创建笔记', 'POST', '/api/notes', {
    'user_id': USER_ID,
    'title': '测试笔记',
    'content': '这是一条测试笔记的内容',
    'note_type': 'general',
    'tags': '测试,学习',
    'is_favorite': 0
})
if ok: passed += 1
else: failed += 1
note_id = resp.get_json()['note']['id'] if ok else None

resp, ok = test_endpoint('获取笔记列表', 'GET', '/api/notes', params={'user_id': USER_ID})
if ok: passed += 1
else: failed += 1

if note_id:
    resp, ok = test_endpoint('获取单条笔记', 'GET', f'/api/notes/{note_id}', params={'user_id': USER_ID})
    if ok: passed += 1
    else: failed += 1

    resp, ok = test_endpoint('更新笔记', 'PUT', f'/api/notes/{note_id}', {
        'user_id': USER_ID,
        'title': '更新后的标题',
        'content': '更新后的内容'
    })
    if ok: passed += 1
    else: failed += 1

resp, ok = test_endpoint('搜索笔记', 'GET', '/api/notes', params={'user_id': USER_ID, 'search': '测试'})
if ok: passed += 1
else: failed += 1

resp, ok = test_endpoint('按类型筛选笔记', 'GET', '/api/notes', params={'user_id': USER_ID, 'note_type': 'general'})
if ok: passed += 1
else: failed += 1

print('\n=== 收藏 API 测试 ===')

resp, ok = test_endpoint('添加收藏', 'POST', '/api/favorites', {
    'user_id': USER_ID,
    'target_type': 'kp',
    'target_id': 13
})
if ok: passed += 1
else: failed += 1

resp, ok = test_endpoint('检查是否收藏', 'GET', '/api/favorites/check/kp/13', params={'user_id': USER_ID})
if ok: passed += 1
else: failed += 1

resp, ok = test_endpoint('获取收藏列表', 'GET', '/api/favorites', params={'user_id': USER_ID})
if ok: passed += 1
else: failed += 1

resp, ok = test_endpoint('按类型筛选收藏', 'GET', '/api/favorites', params={'user_id': USER_ID, 'target_type': 'kp'})
if ok: passed += 1
else: failed += 1

resp, ok = test_endpoint('取消收藏', 'DELETE', '/api/favorites/kp/13', params={'user_id': USER_ID})
if ok: passed += 1
else: failed += 1

print('\n=== 知识卡片 API 测试 ===')

resp, ok = test_endpoint('获取卡片列表', 'GET', '/api/flashcards', params={'user_id': USER_ID, 'limit': 10})
if ok: passed += 1
else: failed += 1
data = resp.get_json() if ok else {}
card_id = None
if data.get('items'):
    card_id = data['items'][0]['id']
    print(f'    使用系统卡片 ID: {card_id}')

resp, ok = test_endpoint('按知识点筛选卡片', 'GET', '/api/flashcards', params={'user_id': USER_ID, 'kp_id': 13})
if ok: passed += 1
else: failed += 1

resp, ok = test_endpoint('创建自定义卡片', 'POST', '/api/flashcards', {
    'user_id': USER_ID,
    'kp_id': 13,
    'front': '什么是Cache命中率？',
    'back': 'Cache命中率是CPU在Cache中找到所需数据的概率。命中率越高，系统访问效率越高。',
    'difficulty': 2
})
if ok: passed += 1
else: failed += 1
custom_card_id = resp.get_json()['flashcard']['id'] if ok else None

if custom_card_id:
    resp, ok = test_endpoint('更新卡片', 'PUT', f'/api/flashcards/{custom_card_id}', {
        'user_id': USER_ID,
        'front': '什么是Cache命中率？（更新）',
        'difficulty': 3
    })
    if ok: passed += 1
    else: failed += 1

if card_id:
    resp, ok = test_endpoint('复习卡片(quality=5)', 'POST', f'/api/flashcards/{card_id}/review', {
        'user_id': USER_ID,
        'quality': 5
    })
    if ok:
        passed += 1
        body = resp.get_json()
        print(f'    srs_stage: {body.get("srs_stage")}, next_review_days: {body.get("next_review_days")}')
    else:
        failed += 1

if card_id:
    resp, ok = test_endpoint('复习卡片(quality=2)', 'POST', f'/api/flashcards/{card_id}/review', {
        'user_id': USER_ID,
        'quality': 2
    })
    if ok:
        passed += 1
        body = resp.get_json()
        print(f'    srs_stage: {body.get("srs_stage")}, next_review_days: {body.get("next_review_days")}')
    else:
        failed += 1

resp, ok = test_endpoint('获取到期卡片', 'GET', '/api/flashcards', params={'user_id': USER_ID, 'due_only': 1})
if ok: passed += 1
else: failed += 1

resp, ok = test_endpoint('获取卡片统计', 'GET', '/api/flashcards/stats', params={'user_id': USER_ID})
if ok:
    passed += 1
    stats = resp.get_json()
    print(f'    总卡片: {stats.get("total_cards")}, 已掌握: {stats.get("mastered_count")}, 待复习: {stats.get("due_count")}')
else:
    failed += 1

if custom_card_id:
    resp, ok = test_endpoint('删除自定义卡片', 'DELETE', f'/api/flashcards/{custom_card_id}', params={'user_id': USER_ID})
    if ok: passed += 1
    else: failed += 1

print('\n=== SRS 算法验证 ===')
from app import calculate_next_review

test_cases = [
    (0, 5, 2, 1),
    (0, 4, 1, 1),
    (0, 3, 0, 1),
    (0, 2, 0, 1),
    (3, 5, 5, 15),
    (3, 4, 4, 9),
    (3, 3, 3, 6),
    (3, 2, 0, 1),
    (10, 5, 10, 50),
]

srs_ok = True
for stage, quality, exp_stage, exp_days in test_cases:
    new_stage, days = calculate_next_review(stage, quality)
    ok = (new_stage == exp_stage and days == exp_days)
    status = 'PASS' if ok else 'FAIL'
    print(f'  [{status}] stage={stage}, quality={quality} -> stage={new_stage}, days={days} (expected stage={exp_stage}, days={exp_days})')
    if not ok:
        srs_ok = False

if srs_ok:
    passed += 1
else:
    failed += 1

if note_id:
    resp, ok = test_endpoint('删除笔记', 'DELETE', f'/api/notes/{note_id}', params={'user_id': USER_ID})
    if ok: passed += 1
    else: failed += 1

print(f'\n{"="*50}')
print(f'测试完成: {passed} 通过, {failed} 失败')
print(f'{"="*50}')

sys.exit(0 if failed == 0 else 1)
