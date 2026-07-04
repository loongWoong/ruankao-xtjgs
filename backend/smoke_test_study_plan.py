import sys
import json
from datetime import datetime, timedelta

sys.path.insert(0, '.')
from app import app

client = app.test_client()

print("=" * 60)
print("学习计划引擎功能冒烟测试")
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
    future_date = (datetime.now() + timedelta(days=60)).strftime('%Y-%m-%d')
    test_user = 'test_study_plan_user'

    data = test_endpoint(
        "1. 创建学习计划",
        "POST",
        "/api/study-plan",
        json_data={
            'user_id': test_user,
            'exam_date': future_date,
            'daily_target': 20,
            'daily_kp_target': 3
        }
    )
    assert data['success'] is True
    assert 'plan' in data
    assert data['plan']['user_id'] == test_user
    assert data['plan']['exam_date'] == future_date
    assert data['plan']['daily_target'] == 20
    assert data['plan']['daily_kp_target'] == 3
    assert data['plan']['status'] == 'active'
    assert data['total_tasks_generated'] > 0
    print(f"  生成任务数: {data['total_tasks_generated']}")
    print("  ✅ 通过")

    data = test_endpoint(
        "2. 获取学习计划",
        "GET",
        f"/api/study-plan?user_id={test_user}"
    )
    assert 'plan' in data
    assert data['plan'] is not None
    assert 'today_tasks' in data
    assert 'week_overview' in data
    assert isinstance(data['today_tasks'], list)
    assert isinstance(data['week_overview'], list)
    print(f"  今日任务数: {len(data['today_tasks'])}")
    print(f"  本周概览天数: {len(data['week_overview'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "3. 获取今日任务",
        "GET",
        f"/api/study-plan/today?user_id={test_user}"
    )
    assert 'tasks' in data
    assert 'stats' in data
    assert isinstance(data['tasks'], list)
    stats = data['stats']
    assert 'total_tasks' in stats
    assert 'completed_tasks' in stats
    assert 'total_questions' in stats
    assert 'completed_questions' in stats
    assert 'progress' in stats
    print(f"  今日任务数: {stats['total_tasks']}")
    print(f"  今日总题数: {stats['total_questions']}")
    print(f"  完成进度: {stats['progress']}%")

    task_types = set(t['task_type'] for t in data['tasks'])
    print(f"  任务类型: {task_types}")
    assert 'learn' in task_types or 'review' in task_types or 'practice' in task_types

    for task in data['tasks']:
        assert 'id' in task
        assert 'task_type' in task
        assert 'question_count' in task
        assert 'completed_count' in task
        assert 'status' in task
        if task.get('kp_id'):
            assert 'kp_name' in task
    print("  ✅ 通过")

    today_tasks = data['tasks']
    if today_tasks:
        first_task_id = today_tasks[0]['id']
        data = test_endpoint(
            "4. 标记任务完成",
            "POST",
            f"/api/study-plan/tasks/{first_task_id}/complete",
            json_data={
                'user_id': test_user
            }
        )
        assert data['success'] is True
        assert 'task' in data
        assert data['task']['status'] == 'completed'
        assert data['task']['completed_count'] == data['task']['question_count']
        print("  ✅ 通过")

        data = test_endpoint(
            "5. 标记任务部分完成",
            "POST",
            f"/api/study-plan/tasks/{first_task_id}/complete",
            json_data={
                'user_id': test_user,
                'completed_count': 2
            }
        )
        assert data['success'] is True
        assert data['task']['completed_count'] == 2
        assert data['task']['status'] == 'in_progress'
        print("  ✅ 通过")
    else:
        print("  跳过任务完成测试（今日无任务）")

    data = test_endpoint(
        "6. 学习计划总览",
        "GET",
        f"/api/study-plan/overview?user_id={test_user}"
    )
    assert 'plan' in data
    assert 'days_until_exam' in data
    assert 'total_progress' in data
    assert 'completed_days' in data
    assert 'total_days' in data
    assert 'total_tasks' in data
    assert 'completed_tasks' in data
    assert 'total_questions' in data
    assert 'completed_questions' in data
    assert 'chapter_progress' in data
    assert isinstance(data['chapter_progress'], list)
    print(f"  考试倒计时: {data['days_until_exam']} 天")
    print(f"  总进度: {data['total_progress']}%")
    print(f"  章节数: {len(data['chapter_progress'])}")
    for ch in data['chapter_progress'][:3]:
        print(f"    {ch['chapter_name']}: {ch['progress']}%")
    print("  ✅ 通过")

    data = test_endpoint(
        "7. 重新生成计划",
        "POST",
        "/api/study-plan/regenerate",
        json_data={
            'user_id': test_user
        }
    )
    assert data['success'] is True
    assert 'plan' in data
    assert 'total_tasks' in data
    assert 'message' in data
    print(f"  重新生成任务数: {data['total_tasks']}")
    print("  ✅ 通过")

    data = test_endpoint(
        "8. 无学习计划时获取计划",
        "GET",
        "/api/study-plan?user_id=no_plan_user"
    )
    assert data['plan'] is None
    assert data['today_tasks'] == []
    assert data['week_overview'] == []
    print("  ✅ 通过")

    data = test_endpoint(
        "9. 无学习计划时总览返回404",
        "GET",
        "/api/study-plan/overview?user_id=no_plan_user",
        expected_status=404
    )
    assert 'error' in data
    print("  ✅ 通过")

    data = test_endpoint(
        "10. 不存在的任务标记完成返回404",
        "POST",
        "/api/study-plan/tasks/999999/complete",
        json_data={'user_id': test_user},
        expected_status=404
    )
    assert 'error' in data
    print("  ✅ 通过")

    data = test_endpoint(
        "11. 更新现有学习计划",
        "POST",
        "/api/study-plan",
        json_data={
            'user_id': test_user,
            'exam_date': (datetime.now() + timedelta(days=90)).strftime('%Y-%m-%d'),
            'daily_target': 30,
            'daily_kp_target': 5
        }
    )
    assert data['success'] is True
    assert data['plan']['daily_target'] == 30
    assert data['plan']['daily_kp_target'] == 5
    print("  ✅ 通过")

    data = test_endpoint(
        "12. 缺少exam_date返回400",
        "POST",
        "/api/study-plan",
        json_data={
            'user_id': test_user
        },
        expected_status=400
    )
    assert 'error' in data
    print("  ✅ 通过")

    print("\n" + "=" * 60)
    print("🎉 所有学习计划引擎测试通过!")
    print("=" * 60)

except AssertionError as e:
    print(f"\n❌ 测试失败: {e}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ 异常: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
