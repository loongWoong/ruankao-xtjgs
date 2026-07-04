import sys
import json

sys.path.insert(0, '.')
from app import app

client = app.test_client()

print("=" * 60)
print("模拟考试系统功能冒烟测试")
print("=" * 60)

def test_endpoint(name, method, path, json_data=None, expected_status=200):
    print(f"\n测试: {name}")
    print(f"  接口: {method} {path}")
    if method == 'GET':
        resp = client.get(path)
    elif method == 'POST':
        resp = client.post(path, json=json_data or {})
    elif method == 'PUT':
        resp = client.put(path, json=json_data or {})
    else:
        resp = client.delete(path)
    print(f"  状态码: {resp.status_code}")
    assert resp.status_code == expected_status, f"期望 {expected_status}, 实际 {resp.status_code}"
    data = resp.get_json()
    data_str = json.dumps(data, ensure_ascii=False)
    if len(data_str) > 300:
        print(f"  响应数据(部分): {data_str[:300]}...")
    else:
        print(f"  响应数据: {data_str}")
    return data

try:
    test_user = 'test_mock_exam_user'

    data = test_endpoint(
        "1. 创建模拟考试",
        "POST",
        "/api/mock-exam/create",
        json_data={
            'user_id': test_user,
            'title': '系统架构师模拟考试',
            'exam_type': 'full',
            'question_count': 10,
            'duration_minutes': 30
        }
    )
    assert data['success'] is True
    assert 'exam_id' in data
    assert data['total_questions'] == 10
    exam_id = data['exam_id']
    print(f"  考试ID: {exam_id}")
    print("  ✅ 通过")

    data = test_endpoint(
        "2. 获取考试详情",
        "GET",
        f"/api/mock-exam/{exam_id}?user_id={test_user}"
    )
    assert 'exam' in data
    assert 'questions' in data
    assert len(data['questions']) == 10
    assert data['exam']['status'] == 'draft'
    for q in data['questions']:
        assert 'correct_answer' not in q or q.get('correct_answer') is None
        assert 'question_text' in q
        assert 'options' in q
    print("  草稿状态不包含正确答案 ✅")
    print("  ✅ 通过")

    data = test_endpoint(
        "3. 开始考试",
        "POST",
        f"/api/mock-exam/{exam_id}/start",
        json_data={
            'user_id': test_user
        }
    )
    assert data['success'] is True
    assert data['exam']['status'] == 'in_progress'
    assert data['exam']['started_at'] is not None
    print("  ✅ 通过")

    data = test_endpoint(
        "4. 提交第0题答案",
        "POST",
        f"/api/mock-exam/{exam_id}/answer",
        json_data={
            'user_id': test_user,
            'question_index': 0,
            'user_answer': 'A'
        }
    )
    assert data['success'] is True
    assert data['question_index'] == 0
    assert data['user_answer'] == 'A'
    print("  ✅ 通过")

    data = test_endpoint(
        "5. 提交第1题答案",
        "POST",
        f"/api/mock-exam/{exam_id}/answer",
        json_data={
            'user_id': test_user,
            'question_index': 1,
            'user_answer': 'B'
        }
    )
    assert data['success'] is True
    print("  ✅ 通过")

    data = test_endpoint(
        "6. 提交考试",
        "POST",
        f"/api/mock-exam/{exam_id}/submit",
        json_data={
            'user_id': test_user
        }
    )
    assert data['success'] is True
    assert data['exam']['status'] == 'submitted'
    assert data['exam']['score'] is not None
    assert data['correct_count'] + data['wrong_count'] == 10
    print(f"  得分: {data['score']}")
    print(f"  正确: {data['correct_count']}, 错误: {data['wrong_count']}")
    print("  ✅ 通过")

    data = test_endpoint(
        "7. 获取考试结果",
        "GET",
        f"/api/mock-exam/{exam_id}/result?user_id={test_user}"
    )
    assert 'exam' in data
    assert 'questions' in data
    assert 'kp_accuracy' in data
    assert 'correct_count' in data
    assert 'wrong_count' in data
    assert 'score' in data
    for q in data['questions']:
        assert 'correct_answer' in q
        assert 'is_correct' in q
        assert 'explanation' in q
    print("  结果包含正确答案和解析 ✅")
    print(f"  知识点正确率数: {len(data['kp_accuracy'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "8. 获取考试记录列表",
        "GET",
        f"/api/mock-exam/list?user_id={test_user}"
    )
    assert 'items' in data
    assert 'total' in data
    assert 'page' in data
    assert 'limit' in data
    assert data['total'] >= 1
    assert len(data['items']) >= 1
    print(f"  总记录数: {data['total']}")
    print("  ✅ 通过")

    data = test_endpoint(
        "9. 获取考试统计",
        "GET",
        f"/api/mock-exam/stats?user_id={test_user}"
    )
    assert 'total_exams' in data
    assert 'avg_score' in data
    assert 'max_score' in data
    assert 'recent_trend' in data
    assert data['total_exams'] >= 1
    print(f"  总考试次数: {data['total_exams']}")
    print(f"  平均分: {data['avg_score']}")
    print(f"  最高分: {data['max_score']}")
    print("  ✅ 通过")

    data = test_endpoint(
        "10. 创建自定义考试",
        "POST",
        "/api/mock-exam/create",
        json_data={
            'user_id': test_user,
            'title': '自定义章节考试',
            'exam_type': 'custom',
            'question_count': 5,
            'duration_minutes': 15
        }
    )
    assert data['success'] is True
    assert data['total_questions'] == 5
    custom_exam_id = data['exam_id']
    print(f"  自定义考试ID: {custom_exam_id}")
    print("  ✅ 通过")

    data = test_endpoint(
        "11. 不存在的考试返回404",
        "GET",
        "/api/mock-exam/999999?user_id=test_user",
        expected_status=404
    )
    assert 'error' in data
    print("  ✅ 通过")

    data = test_endpoint(
        "12. 未开始的考试不能提交",
        "POST",
        f"/api/mock-exam/{custom_exam_id}/answer",
        json_data={
            'user_id': test_user,
            'question_index': 0,
            'user_answer': 'A'
        },
        expected_status=400
    )
    assert 'error' in data
    print("  ✅ 通过")

    data = test_endpoint(
        "13. 已提交的考试不能重复提交",
        "POST",
        f"/api/mock-exam/{exam_id}/submit",
        json_data={
            'user_id': test_user
        },
        expected_status=400
    )
    assert 'error' in data
    print("  ✅ 通过")

    data = test_endpoint(
        "14. 验证错题已加入错题库",
        "GET",
        f"/api/wrong-questions?user_id={test_user}"
    )
    assert 'items' in data
    assert 'total' in data
    print(f"  错题库题目数: {data['total']}")
    print("  ✅ 通过")

    print("\n" + "=" * 60)
    print("🎉 所有模拟考试系统测试通过!")
    print("=" * 60)

except AssertionError as e:
    print(f"\n❌ 测试失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
except Exception as e:
    print(f"\n❌ 异常: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
